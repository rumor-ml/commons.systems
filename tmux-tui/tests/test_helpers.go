package tests

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// DiagnosticInfo captures test environment state
type DiagnosticInfo struct {
	PaneID          string
	AlertFileExists bool
	ClaudeRunning   bool
	TMUXPaneEnvSet  bool
	PaneContent     string
	Timestamp       time.Time
}

// captureDiagnostics gathers comprehensive state
func captureDiagnostics(t *testing.T, session, paneID string) DiagnosticInfo {
	t.Helper()

	info := DiagnosticInfo{
		PaneID:    paneID,
		Timestamp: time.Now(),
	}

	// Check alert file
	alertFile := filepath.Join(testAlertDir, alertPrefix+paneID)
	_, err := os.Stat(alertFile)
	info.AlertFileExists = !os.IsNotExist(err)

	// Capture pane content
	windowTarget := fmt.Sprintf("%s.%s", session, paneID)
	captureCmd := tmuxCmd("capture-pane", "-t", windowTarget, "-p")
	if output, err := captureCmd.Output(); err == nil {
		info.PaneContent = string(output)
		info.ClaudeRunning = strings.Contains(info.PaneContent, "claude") ||
			strings.Contains(info.PaneContent, "What can I help")
	}

	info.TMUXPaneEnvSet = true
	return info
}

// logDiagnostics outputs diagnostic info
func logDiagnostics(t *testing.T, info DiagnosticInfo, context string) {
	t.Helper()
	t.Logf("=== Diagnostics: %s ===", context)
	t.Logf("  Time: %s", info.Timestamp.Format("15:04:05.000"))
	t.Logf("  Pane ID: %s", info.PaneID)
	t.Logf("  Alert file exists: %v", info.AlertFileExists)
	t.Logf("  Claude appears running: %v", info.ClaudeRunning)
	if len(info.PaneContent) > 0 {
		preview := info.PaneContent
		if len(preview) > 200 {
			preview = preview[:200] + "..."
		}
		t.Logf("  Pane content preview: %s", preview)
	}
}

// WaitCondition represents a condition to wait for
type WaitCondition struct {
	Name      string
	CheckFunc func() (bool, error)
	Interval  time.Duration
	Timeout   time.Duration
	OnRetry   func(attempt int, elapsed time.Duration)
}

// waitForCondition provides robust waiting with retry logic
func waitForCondition(t *testing.T, cond WaitCondition) error {
	t.Helper()

	if cond.Interval == 0 {
		cond.Interval = 200 * time.Millisecond
	}
	if cond.Timeout == 0 {
		cond.Timeout = 30 * time.Second
	}

	deadline := time.Now().Add(cond.Timeout)
	attempt := 0

	for time.Now().Before(deadline) {
		attempt++
		elapsed := time.Since(deadline.Add(-cond.Timeout))

		satisfied, err := cond.CheckFunc()
		if err != nil {
			t.Logf("Wait condition '%s' error on attempt %d: %v",
				cond.Name, attempt, err)
		}

		if satisfied {
			t.Logf("Wait condition '%s' satisfied after %d attempts (%.1fs)",
				cond.Name, attempt, elapsed.Seconds())
			return nil
		}

		if cond.OnRetry != nil {
			cond.OnRetry(attempt, elapsed)
		}

		time.Sleep(cond.Interval)
	}

	return fmt.Errorf("wait condition '%s' not satisfied after %d attempts (%.1fs timeout)",
		cond.Name, attempt, cond.Timeout.Seconds())
}

// TestTimeouts holds configurable timeout values
type TestTimeouts struct {
	ClaudeInit     time.Duration
	AlertFileWait  time.Duration
	HookExecution  time.Duration
	PromptResponse time.Duration
}

// getTestTimeouts returns timeouts based on environment
func getTestTimeouts() TestTimeouts {
	isCI := os.Getenv("CI") != ""

	loadMultiplier := 1.0
	if isCI {
		loadMultiplier = 1.5
	}

	return TestTimeouts{
		ClaudeInit:     time.Duration(float64(45*time.Second) * loadMultiplier),
		AlertFileWait:  time.Duration(float64(30*time.Second) * loadMultiplier),
		HookExecution:  time.Duration(float64(5*time.Second) * loadMultiplier),
		PromptResponse: time.Duration(float64(30*time.Second) * loadMultiplier),
	}
}

// waitForAlertFile waits for alert file with diagnostics
func waitForAlertFile(t *testing.T, session, paneID string, shouldExist bool, timeout time.Duration) bool {
	t.Helper()

	alertFile := filepath.Join(testAlertDir, alertPrefix+paneID)

	cond := WaitCondition{
		Name:     fmt.Sprintf("alert file %s (shouldExist=%v)", paneID, shouldExist),
		Timeout:  timeout,
		Interval: 200 * time.Millisecond,
		CheckFunc: func() (bool, error) {
			_, err := os.Stat(alertFile)
			exists := !os.IsNotExist(err)

			if err != nil && !os.IsNotExist(err) {
				return false, fmt.Errorf("stat error: %w", err)
			}

			return exists == shouldExist, nil
		},
		OnRetry: func(attempt int, elapsed time.Duration) {
			if attempt%25 == 0 {
				info := captureDiagnostics(t, session, paneID)
				logDiagnostics(t, info,
					fmt.Sprintf("Waiting for alert (attempt %d)", attempt))
			}
		},
	}

	err := waitForCondition(t, cond)
	if err != nil {
		info := captureDiagnostics(t, session, paneID)
		logDiagnostics(t, info, "FAILURE - Alert file wait timeout")
		t.Logf("Error: %v", err)
		return false
	}

	return true
}

// waitForClaudePaneDetection waits for pane to be detected as Claude pane using retry logic
func waitForClaudePaneDetection(t *testing.T, session, paneID string, timeout time.Duration) bool {
	t.Helper()

	cond := WaitCondition{
		Name:     fmt.Sprintf("Claude pane detection for %s", paneID),
		Timeout:  timeout,
		Interval: 500 * time.Millisecond,
		CheckFunc: func() (bool, error) {
			target := fmt.Sprintf("%s.%s", session, paneID)

			// Get pane PID
			pidCmd := tmuxCmd("display-message", "-t", target, "-p", "#{pane_pid}")
			output, err := pidCmd.Output()
			if err != nil {
				return false, fmt.Errorf("failed to get pane PID: %w", err)
			}
			panePID := strings.TrimSpace(string(output))

			// Check for Claude child processes
			pgrepCmd := exec.Command("pgrep", "-P", panePID, "claude")
			if err := pgrepCmd.Run(); err != nil {
				return false, nil
			}

			return true, nil
		},
		OnRetry: func(attempt int, elapsed time.Duration) {
			if attempt%5 == 0 {
				t.Logf("Still waiting for Claude pane detection (%.1fs)", elapsed.Seconds())
			}
		},
	}

	err := waitForCondition(t, cond)
	if err != nil {
		t.Logf("Claude pane detection timeout: %v", err)
		return false
	}

	return true
}
