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

const (
	testSocketPrefix = "e2e-test"
	alertPrefix      = "tui-alert-"
)

// uniqueSocketName generates a unique socket name for each test
func uniqueSocketName() string {
	return fmt.Sprintf("%s-%d", testSocketPrefix, time.Now().UnixNano())
}

// getTestAlertDir returns the alert directory for a given socket name
func getTestAlertDir(socketName string) string {
	dir := filepath.Join("/tmp/claude", socketName)
	os.MkdirAll(dir, 0755) // Ensure directory exists
	return dir
}

// tmuxCmd creates a tmux command that runs on the isolated test server
// Now accepts a socket name parameter for per-test isolation
func tmuxCmd(socketName string, args ...string) *exec.Cmd {
	fullArgs := append([]string{"-L", socketName}, args...)
	cmd := exec.Command("tmux", fullArgs...)
	env := filterTmuxEnv(os.Environ())
	env = append(env, "CLAUDE_E2E_TEST=1")
	cmd.Env = env

	// Also ensure the global environment is set on the test server
	// This needs to happen once but is safe to call multiple times
	setGlobalTestEnv(socketName)

	return cmd
}

// setGlobalTestEnv sets CLAUDE_E2E_TEST globally on the test tmux server
// This ensures all processes spawned in test sessions inherit the variable
func setGlobalTestEnv(socketName string) {
	cmd := exec.Command("tmux", "-L", socketName, "set-environment", "-g", "CLAUDE_E2E_TEST", "1")
	cmd.Run() // Ignore errors - may fail if server isn't running yet
}

// waitForTmuxSocket polls for the tmux socket to exist and be ready
// Returns error if socket doesn't become available within timeout
func waitForTmuxSocket(socketName string, timeout time.Duration) error {
	socketPath := filepath.Join("/tmp", "tmux-"+fmt.Sprint(os.Getuid()), socketName)
	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		if _, err := os.Stat(socketPath); err == nil {
			// Socket exists, verify it's responsive
			cmd := exec.Command("tmux", "-L", socketName, "list-sessions")
			if err := cmd.Run(); err == nil {
				return nil
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	return fmt.Errorf("tmux socket %s not ready after %v", socketName, timeout)
}

// cleanupStaleSockets removes orphaned tmux sockets from /tmp that have no running server
// This prevents socket directory pollution from interfering with test execution
func cleanupStaleSockets() error {
	socketDir := filepath.Join("/tmp", "tmux-"+fmt.Sprint(os.Getuid()))

	entries, err := os.ReadDir(socketDir)
	if err != nil {
		// Socket directory doesn't exist or can't be read - not an error
		return nil
	}

	cleaned := 0
	for _, entry := range entries {
		// Only process e2e-test sockets
		if !strings.HasPrefix(entry.Name(), testSocketPrefix) {
			continue
		}

		// Check if server is running for this socket
		checkCmd := exec.Command("tmux", "-L", entry.Name(), "list-sessions")
		if err := checkCmd.Run(); err != nil {
			// Server not running, safe to remove socket
			socketPath := filepath.Join(socketDir, entry.Name())
			if err := os.Remove(socketPath); err == nil {
				cleaned++
			}
		}
	}

	if cleaned > 0 {
		fmt.Printf("Cleaned %d stale test sockets\n", cleaned)
	}

	return nil
}

// filterTmuxEnv removes TMUX and TMUX_PANE env vars to ensure test session isolation
func filterTmuxEnv(env []string) []string {
	filtered := make([]string, 0, len(env))
	for _, e := range env {
		if !strings.HasPrefix(e, "TMUX=") && !strings.HasPrefix(e, "TMUX_PANE=") {
			filtered = append(filtered, e)
		}
	}
	return filtered
}

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
func captureDiagnostics(t *testing.T, socketName, session, paneID string) DiagnosticInfo {
	t.Helper()

	info := DiagnosticInfo{
		PaneID:    paneID,
		Timestamp: time.Now(),
	}

	// Check alert file
	alertDir := getTestAlertDir(socketName)
	alertFile := filepath.Join(alertDir, alertPrefix+paneID)
	_, err := os.Stat(alertFile)
	info.AlertFileExists = !os.IsNotExist(err)

	// Capture pane content
	windowTarget := fmt.Sprintf("%s.%s", session, paneID)
	captureCmd := tmuxCmd(socketName, "capture-pane", "-t", windowTarget, "-p")
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
func waitForAlertFile(t *testing.T, socketName, session, paneID string, shouldExist bool, timeout time.Duration) bool {
	t.Helper()

	alertDir := getTestAlertDir(socketName)
	alertFile := filepath.Join(alertDir, alertPrefix+paneID)

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
				info := captureDiagnostics(t, socketName, session, paneID)
				logDiagnostics(t, info,
					fmt.Sprintf("Waiting for alert (attempt %d)", attempt))
			}
		},
	}

	err := waitForCondition(t, cond)
	if err != nil {
		info := captureDiagnostics(t, socketName, session, paneID)
		logDiagnostics(t, info, "FAILURE - Alert file wait timeout")
		t.Logf("Error: %v", err)
		return false
	}

	return true
}

// waitForClaudePaneDetection waits for pane to be detected as Claude pane using retry logic
func waitForClaudePaneDetection(t *testing.T, socketName, session, paneID string, timeout time.Duration) bool {
	t.Helper()

	cond := WaitCondition{
		Name:     fmt.Sprintf("Claude pane detection for %s", paneID),
		Timeout:  timeout,
		Interval: 500 * time.Millisecond,
		CheckFunc: func() (bool, error) {
			target := fmt.Sprintf("%s.%s", session, paneID)

			// Get pane PID
			pidCmd := tmuxCmd(socketName, "display-message", "-t", target, "-p", "#{pane_pid}")
			output, err := pidCmd.Output()
			if err != nil {
				return false, fmt.Errorf("failed to get pane PID: %w", err)
			}
			panePID := strings.TrimSpace(string(output))

			// Check for Claude child processes (real or fake)
			// Try "claude" first
			pgrepCmd := exec.Command("pgrep", "-P", panePID, "claude")
			if err := pgrepCmd.Run(); err == nil {
				return true, nil
			}

			// Try "fake-claude-test" if real Claude not found
			pgrepCmd = exec.Command("pgrep", "-P", panePID, "fake-claude-test")
			if err := pgrepCmd.Run(); err == nil {
				return true, nil
			}

			return false, nil
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

// dumpHookDebugLog displays the hook execution log for debugging
func dumpHookDebugLog(t *testing.T, socketName string) {
	t.Helper()
	alertDir := getTestAlertDir(socketName)
	logFile := filepath.Join(alertDir, "hook-debug.log")
	data, err := os.ReadFile(logFile)
	if err != nil {
		t.Logf("No hook debug log found at %s: %v", logFile, err)
		return
	}
	t.Logf("=== Hook Debug Log ===\n%s\n===================", string(data))
}

// logEnvironmentState captures environment variables for a pane
func logEnvironmentState(t *testing.T, socketName, session, paneID, context string) {
	t.Helper()
	target := fmt.Sprintf("%s.%s", session, paneID)

	// Get TMUX_PANE environment variable
	tmuxPaneCmd := tmuxCmd(socketName, "show-environment", "-t", target, "TMUX_PANE")
	tmuxPaneOutput, tmuxPaneErr := tmuxPaneCmd.CombinedOutput()

	// Get CLAUDE_E2E_TEST environment variable
	claudeTestCmd := tmuxCmd(socketName, "show-environment", "-t", target, "CLAUDE_E2E_TEST")
	claudeTestOutput, claudeTestErr := claudeTestCmd.CombinedOutput()

	// Get all environment variables for comprehensive diagnostics
	allEnvCmd := tmuxCmd(socketName, "show-environment", "-t", target)
	allEnvOutput, allEnvErr := allEnvCmd.CombinedOutput()

	t.Logf("=== Environment State: %s ===", context)
	t.Logf("  Target: %s", target)

	if tmuxPaneErr != nil {
		t.Logf("  TMUX_PANE: ERROR - %v (output: %s)", tmuxPaneErr, string(tmuxPaneOutput))
	} else {
		t.Logf("  TMUX_PANE: %s", strings.TrimSpace(string(tmuxPaneOutput)))
	}

	if claudeTestErr != nil {
		t.Logf("  CLAUDE_E2E_TEST: ERROR - %v (output: %s)", claudeTestErr, string(claudeTestOutput))
	} else {
		t.Logf("  CLAUDE_E2E_TEST: %s", strings.TrimSpace(string(claudeTestOutput)))
	}

	if allEnvErr != nil {
		t.Logf("  Full environment: ERROR - %v", allEnvErr)
	} else {
		envLines := strings.Split(strings.TrimSpace(string(allEnvOutput)), "\n")
		t.Logf("  Full environment (%d variables):", len(envLines))
		for _, line := range envLines {
			if strings.Contains(line, "TMUX") || strings.Contains(line, "CLAUDE") {
				t.Logf("    %s", line)
			}
		}
	}
	t.Logf("==========================")
}

// CleanupAlertFiles removes all alert files from the test directory.
// This is useful for ensuring a clean state before tests.
func CleanupAlertFiles(socketName string) error {
	alertDir := getTestAlertDir(socketName)
	// Remove entire namespace directory
	if err := os.RemoveAll(alertDir); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove alert directory %s: %w", alertDir, err)
	}
	return nil
}

// buildFakeClaude builds the fake Claude binary for testing
func buildFakeClaude(t *testing.T) string {
	t.Helper()

	// Build once and cache in /tmp
	fakeBinary := "/tmp/fake-claude-test"

	// Check if already built
	if _, err := os.Stat(fakeBinary); err == nil {
		return fakeBinary
	}

	t.Log("Building fake Claude binary...")
	buildCmd := exec.Command("go", "build", "-o", fakeBinary,
		"./testdata/fake-claude")
	buildCmd.Dir = "." // tests directory
	if output, err := buildCmd.CombinedOutput(); err != nil {
		t.Fatalf("Failed to build fake Claude: %v\n%s", err, output)
	}

	t.Logf("Fake Claude built at: %s", fakeBinary)
	return fakeBinary
}

// ClaudeConfig holds configuration for starting Claude (real or fake)
type ClaudeConfig struct {
	Binary         string            // Path to claude binary (real or fake)
	Model          string            // --model flag value
	PermissionMode string            // --permission-mode flag value
	Scenario       string            // FAKE_CLAUDE_SCENARIO (for fake binary)
	Env            map[string]string // Additional env vars
}

// startClaude starts Claude (real or fake) in a tmux pane
func startClaude(t *testing.T, socketName, sessionName, paneID, projectDir string, cfg ClaudeConfig) error {
	t.Helper()

	windowTarget := fmt.Sprintf("%s.%s", sessionName, paneID)

	// Build command
	cmdParts := []string{
		"cd", projectDir, "&&",
	}

	// Set environment variables
	for k, v := range cfg.Env {
		cmdParts = append(cmdParts, fmt.Sprintf("%s=%s", k, v))
	}

	// Set FAKE_CLAUDE_SCENARIO if using fake binary
	if cfg.Scenario != "" {
		cmdParts = append(cmdParts, fmt.Sprintf("FAKE_CLAUDE_SCENARIO=%s", cfg.Scenario))
	}

	// Set TMUX_PANE for hooks
	cmdParts = append(cmdParts, fmt.Sprintf("TMUX_PANE=%s", paneID))
	cmdParts = append(cmdParts, "CLAUDE_E2E_TEST=1")

	// Add Claude command
	cmdParts = append(cmdParts, cfg.Binary)
	if cfg.Model != "" {
		cmdParts = append(cmdParts, "--model", cfg.Model)
	}
	if cfg.PermissionMode != "" {
		cmdParts = append(cmdParts, "--permission-mode", cfg.PermissionMode)
	}

	command := strings.Join(cmdParts, " ")

	t.Logf("Starting Claude: %s", command)

	cmd := tmuxCmd(socketName, "send-keys", "-t", windowTarget, command, "Enter")
	return cmd.Run()
}

// useFakeClaude returns true if tests should use fake Claude
// DEFAULT BEHAVIOR: Always uses fake Claude unless USE_REAL_CLAUDE=1
// This applies to both local dev and CI environments
func useFakeClaude() bool {
	if env := os.Getenv("USE_REAL_CLAUDE"); env == "1" || env == "true" {
		return false
	}
	return true // DEFAULT: fake Claude for local dev and CI
}

// getClaudeBinary returns path to Claude binary (real or fake)
func getClaudeBinary(t *testing.T) string {
	t.Helper()

	if useFakeClaude() {
		return buildFakeClaude(t)
	}

	// Use real Claude
	claudePath, err := exec.LookPath("claude")
	if err != nil {
		t.Skip("Real Claude not found, and USE_REAL_CLAUDE=1 was set")
	}
	return claudePath
}

// buildDaemon builds the tmux-tui-daemon binary for testing
func buildDaemon(t *testing.T) string {
	t.Helper()

	// Build once and cache in parent directory's build folder
	tuiDir, _ := filepath.Abs("..")
	daemonBinary := filepath.Join(tuiDir, "build", "tmux-tui-daemon")

	// Check if already built
	if _, err := os.Stat(daemonBinary); err == nil {
		return daemonBinary
	}

	t.Log("Building tmux-tui-daemon binary...")
	buildCmd := exec.Command("go", "build", "-o", daemonBinary, "./cmd/tmux-tui-daemon")
	buildCmd.Dir = tuiDir
	if output, err := buildCmd.CombinedOutput(); err != nil {
		t.Fatalf("Failed to build daemon: %v\n%s", err, output)
	}

	t.Logf("Daemon built at: %s", daemonBinary)
	return daemonBinary
}

// startDaemon starts the tmux-tui-daemon in a tmux pane
// Returns a cleanup function to stop the daemon
func startDaemon(t *testing.T, socketName, sessionName string) func() {
	t.Helper()

	daemonBinary := buildDaemon(t)

	// Construct the $TMUX environment variable for the daemon
	// Format: /path/to/socket,pid,pane_index
	// The daemon uses this to determine its namespace
	uid := os.Getuid()
	tmuxSocketPath := fmt.Sprintf("/tmp/tmux-%d/%s", uid, socketName)
	tmuxEnv := fmt.Sprintf("%s,$$,0", tmuxSocketPath) // $$ will be expanded by shell to the daemon's PID

	// Start daemon in a detached tmux window with correct TMUX env
	daemonWindow := fmt.Sprintf("%s:daemon", sessionName)
	// Use send-keys to set TMUX env before starting daemon
	createWindowCmd := tmuxCmd(socketName, "new-window", "-t", sessionName, "-n", "daemon", "-d")
	if err := createWindowCmd.Run(); err != nil {
		t.Fatalf("Failed to create daemon window: %v", err)
	}

	// Send command to start daemon with correct TMUX env and debug enabled
	daemonTarget := fmt.Sprintf("%s:daemon", sessionName)
	startCmd := fmt.Sprintf("TMUX='%s' TMUX_TUI_DEBUG=1 %s", tmuxEnv, daemonBinary)
	sendKeysCmd := tmuxCmd(socketName, "send-keys", "-t", daemonTarget, startCmd, "Enter")
	if err := sendKeysCmd.Run(); err != nil {
		t.Fatalf("Failed to start daemon: %v", err)
	}

	// Wait for daemon to be ready (socket should exist)
	alertDir := getTestAlertDir(socketName)
	daemonSocket := filepath.Join(alertDir, "daemon.sock")

	ready := false
	for i := 0; i < 20; i++ {
		if _, err := os.Stat(daemonSocket); err == nil {
			ready = true
			t.Logf("Daemon ready after %d checks", i+1)
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	if !ready {
		t.Fatal("Daemon failed to start (socket not found)")
	}

	// Return cleanup function
	return func() {
		// Kill the daemon window
		killCmd := tmuxCmd(socketName, "kill-window", "-t", daemonWindow)
		killCmd.Run() // Ignore errors - window might already be gone
	}
}
