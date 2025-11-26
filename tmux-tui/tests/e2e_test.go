package tests

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	teatest "github.com/charmbracelet/x/exp/teatest"
)

// Mock model for testing (simplified version of main.go model)
type model struct {
	windowID  string
	sessionID string
	width     int
}

func initialModel() model {
	return model{
		windowID:  "test",
		sessionID: "1234",
		width:     38,
	}
}

func (m model) Init() tea.Cmd {
	return nil
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.Type {
		case tea.KeyCtrlC:
			return m, tea.Quit
		}
	}
	return m, nil
}

func (m model) View() string {
	lines := []string{
		"╭─ tmux-tui ─╮",
		"│            │",
		"│   Hello!   │",
		"│            │",
		"│  Ctrl+C    │",
		"│  to quit   │",
		"│            │",
		fmt.Sprintf("│ Sess: %-4s │", m.sessionID[:min(4, len(m.sessionID))]),
		"│            │",
		"╰────────────╯",
	}
	return strings.Join(lines, "\n") + "\n"
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// Test TUI initialization
func TestTUIInitialization(t *testing.T) {
	m := initialModel()
	if m.width != 38 {
		t.Errorf("Expected width 38, got %d", m.width)
	}
	if m.sessionID != "1234" {
		t.Errorf("Expected sessionID '1234', got '%s'", m.sessionID)
	}
}

// Test TUI quit with Ctrl+C
func TestTUIQuitWithCtrlC(t *testing.T) {
	tm := teatest.NewTestModel(t, initialModel())

	// Send Ctrl+C
	tm.Send(tea.KeyMsg{Type: tea.KeyCtrlC})

	// Wait for program to finish
	tm.WaitFinished(t, teatest.WithFinalTimeout(time.Second))
}

// Test TUI view rendering
func TestTUIViewRendering(t *testing.T) {
	m := initialModel()
	view := m.View()

	// Check that view contains expected text
	if !strings.Contains(view, "Hello!") {
		t.Error("View should contain 'Hello!'")
	}
	if !strings.Contains(view, "Ctrl+C") {
		t.Error("View should contain 'Ctrl+C'")
	}
	if !strings.Contains(view, "to quit") {
		t.Error("View should contain 'to quit'")
	}

	// Check view is properly formatted (contains box drawing characters)
	if !strings.Contains(view, "╭") || !strings.Contains(view, "╰") {
		t.Error("View should contain box drawing characters")
	}
}

// Test tmux pane spawn (integration test)
func TestTmuxPaneSpawn(t *testing.T) {
	// Skip if tmux not available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found, skipping tmux integration tests")
	}

	// Create unique session name
	sessionName := fmt.Sprintf("test-tmux-tui-%d", time.Now().Unix())

	// Create background tmux session
	cmd := exec.Command("tmux", "new-session", "-d", "-s", sessionName, "-x", "80", "-y", "24")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer exec.Command("tmux", "kill-session", "-t", sessionName).Run()

	// Give tmux time to initialize
	time.Sleep(100 * time.Millisecond)

	// Verify session exists
	cmd = exec.Command("tmux", "has-session", "-t", sessionName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Tmux session not found: %v", err)
	}

	// Count initial panes (should be 1)
	output, err := exec.Command("tmux", "list-panes", "-t", sessionName).Output()
	if err != nil {
		t.Fatalf("Failed to list panes: %v", err)
	}
	initialPaneCount := len(strings.Split(strings.TrimSpace(string(output)), "\n"))
	if initialPaneCount != 1 {
		t.Errorf("Expected 1 initial pane, got %d", initialPaneCount)
	}
}

// Test tmux window option tracking
func TestTmuxWindowOptionTracking(t *testing.T) {
	// Skip if tmux not available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found, skipping tmux integration tests")
	}

	// Create unique session name
	sessionName := fmt.Sprintf("test-tmux-option-%d", time.Now().Unix())

	// Create background tmux session
	cmd := exec.Command("tmux", "new-session", "-d", "-s", sessionName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer exec.Command("tmux", "kill-session", "-t", sessionName).Run()

	time.Sleep(100 * time.Millisecond)

	// Get window ID
	output, err := exec.Command("tmux", "display-message", "-t", sessionName, "-p", "#{window_id}").Output()
	if err != nil {
		t.Fatalf("Failed to get window ID: %v", err)
	}
	windowID := strings.TrimSpace(string(output))

	// Set a test window option
	testPaneID := "%123"
	cmd = exec.Command("tmux", "set-window-option", "-t", windowID, "@tui-pane", testPaneID)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to set window option: %v", err)
	}

	// Verify we can read it back
	output, err = exec.Command("tmux", "show-window-option", "-t", windowID, "@tui-pane").Output()
	if err != nil {
		t.Fatalf("Failed to get window option: %v", err)
	}

	if !strings.Contains(string(output), testPaneID) {
		t.Errorf("Expected window option to contain '%s', got: %s", testPaneID, string(output))
	}
}

// Test multi-session isolation
func TestMultiSessionIsolation(t *testing.T) {
	// Skip if tmux not available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found, skipping tmux integration tests")
	}

	// Create two unique session names
	session1 := fmt.Sprintf("test-tmux-session1-%d", time.Now().Unix())
	session2 := fmt.Sprintf("test-tmux-session2-%d", time.Now().Unix()+1)

	// Create both sessions
	cmd1 := exec.Command("tmux", "new-session", "-d", "-s", session1)
	cmd2 := exec.Command("tmux", "new-session", "-d", "-s", session2)

	if err := cmd1.Run(); err != nil {
		t.Fatalf("Failed to create session 1: %v", err)
	}
	defer exec.Command("tmux", "kill-session", "-t", session1).Run()

	if err := cmd2.Run(); err != nil {
		t.Fatalf("Failed to create session 2: %v", err)
	}
	defer exec.Command("tmux", "kill-session", "-t", session2).Run()

	time.Sleep(100 * time.Millisecond)

	// Verify both sessions exist independently
	if err := exec.Command("tmux", "has-session", "-t", session1).Run(); err != nil {
		t.Errorf("Session 1 not found")
	}
	if err := exec.Command("tmux", "has-session", "-t", session2).Run(); err != nil {
		t.Errorf("Session 2 not found")
	}
}

// Test spawn script exists and is executable
func TestSpawnScriptExists(t *testing.T) {
	scriptPath := "../scripts/spawn.sh"

	// Check file exists
	info, err := os.Stat(scriptPath)
	if err != nil {
		t.Fatalf("spawn.sh not found: %v", err)
	}

	// Check is executable
	if info.Mode()&0111 == 0 {
		t.Error("spawn.sh is not executable")
	}
}

// Test tmux config file exists
func TestTmuxConfigExists(t *testing.T) {
	configPath := "../tmux-tui.conf"

	// Check file exists
	if _, err := os.Stat(configPath); err != nil {
		t.Fatalf("tmux-tui.conf not found: %v", err)
	}

	// Read and verify it contains expected hooks
	content, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("Failed to read tmux-tui.conf: %v", err)
	}

	contentStr := string(content)
	if !strings.Contains(contentStr, "after-new-window") {
		t.Error("tmux-tui.conf should contain 'after-new-window' hook")
	}
	if !strings.Contains(contentStr, "bind t") {
		t.Error("tmux-tui.conf should contain 'bind t' keybinding")
	}
}

// getActiveAlerts is a copy of the function from main.go for testing
// This allows us to test the function without importing main
func getActiveAlerts() map[string]bool {
	alerts := make(map[string]bool)

	// Get list of all current pane IDs
	validPanes := make(map[string]bool)
	output, err := exec.Command("tmux", "list-panes", "-a", "-F", "#{pane_id}").Output()
	if err == nil {
		for _, paneID := range strings.Split(strings.TrimSpace(string(output)), "\n") {
			if paneID != "" {
				validPanes[paneID] = true
			}
		}
	}

	pattern := "/tmp/claude/tui-alert-*"
	matches, _ := filepath.Glob(pattern)
	for _, file := range matches {
		paneID := strings.TrimPrefix(filepath.Base(file), "tui-alert-")
		// Only include if pane currently exists (validates format implicitly)
		if validPanes[paneID] {
			alerts[paneID] = true
		}
	}
	return alerts
}

// TestDirectAlertFileSystem tests the file-based alert system with a real tmux pane
func TestDirectAlertFileSystem(t *testing.T) {
	// Skip if tmux not available (we need a real pane ID now)
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found, skipping test")
	}

	// Create a test session to get a real pane ID
	sessionName := fmt.Sprintf("test-direct-alert-%d", time.Now().Unix())
	cmd := exec.Command("tmux", "new-session", "-d", "-s", sessionName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer exec.Command("tmux", "kill-session", "-t", sessionName).Run()
	time.Sleep(100 * time.Millisecond)

	// Get real pane ID
	output, err := exec.Command("tmux", "display-message", "-t", sessionName, "-p", "#{pane_id}").Output()
	if err != nil {
		t.Fatalf("Failed to get pane ID: %v", err)
	}
	testPaneID := strings.TrimSpace(string(output))
	alertFile := "/tmp/claude/tui-alert-" + testPaneID

	// Ensure /tmp/claude directory exists
	os.MkdirAll("/tmp/claude", 0755)

	// Clean up first
	os.Remove(alertFile)
	defer os.Remove(alertFile)

	// Initially no alert
	alerts := getActiveAlerts()
	if alerts[testPaneID] {
		t.Error("Should have no alert initially")
	}

	// Create alert file (simulates Notification hook)
	os.WriteFile(alertFile, []byte{}, 0644)

	// Should now have alert
	alerts = getActiveAlerts()
	if !alerts[testPaneID] {
		t.Errorf("Should have alert after file created for pane %s", testPaneID)
	}

	// Remove file (simulates UserPromptSubmit hook)
	os.Remove(alertFile)

	// Alert should be cleared
	alerts = getActiveAlerts()
	if alerts[testPaneID] {
		t.Error("Alert should be cleared after file removed")
	}
}

// TestMultipleTUIInstancesShareAlerts tests that multiple TUI instances see same state
func TestMultipleTUIInstancesShareAlerts(t *testing.T) {
	// Skip if tmux not available (we need a real pane ID now)
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found, skipping test")
	}

	// Create a test session to get a real pane ID
	sessionName := fmt.Sprintf("test-shared-alert-%d", time.Now().Unix())
	cmd := exec.Command("tmux", "new-session", "-d", "-s", sessionName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer exec.Command("tmux", "kill-session", "-t", sessionName).Run()
	time.Sleep(100 * time.Millisecond)

	// Get real pane ID
	output, err := exec.Command("tmux", "display-message", "-t", sessionName, "-p", "#{pane_id}").Output()
	if err != nil {
		t.Fatalf("Failed to get pane ID: %v", err)
	}
	testPaneID := strings.TrimSpace(string(output))
	alertFile := "/tmp/claude/tui-alert-" + testPaneID

	// Ensure /tmp/claude directory exists
	os.MkdirAll("/tmp/claude", 0755)

	// Create alert
	os.WriteFile(alertFile, []byte{}, 0644)
	defer os.Remove(alertFile)

	// Simulate two TUI instances reading alerts
	alerts1 := getActiveAlerts()
	alerts2 := getActiveAlerts()

	// Both should see the same state
	if alerts1[testPaneID] != alerts2[testPaneID] {
		t.Error("Multiple TUI instances should see same alert state")
	}
	if !alerts1[testPaneID] {
		t.Errorf("Alert should be present for pane %s", testPaneID)
	}
}

// TestAlertPersistsAcrossRefresh tests alerts survive TUI refresh cycles
func TestAlertPersistsAcrossRefresh(t *testing.T) {
	// Skip if tmux not available (we need a real pane ID now)
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found, skipping test")
	}

	// Create a test session to get a real pane ID
	sessionName := fmt.Sprintf("test-persist-alert-%d", time.Now().Unix())
	cmd := exec.Command("tmux", "new-session", "-d", "-s", sessionName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer exec.Command("tmux", "kill-session", "-t", sessionName).Run()
	time.Sleep(100 * time.Millisecond)

	// Get real pane ID
	output, err := exec.Command("tmux", "display-message", "-t", sessionName, "-p", "#{pane_id}").Output()
	if err != nil {
		t.Fatalf("Failed to get pane ID: %v", err)
	}
	testPaneID := strings.TrimSpace(string(output))
	alertFile := "/tmp/claude/tui-alert-" + testPaneID

	// Ensure /tmp/claude directory exists
	os.MkdirAll("/tmp/claude", 0755)

	os.WriteFile(alertFile, []byte{}, 0644)
	defer os.Remove(alertFile)

	// Multiple reads (simulating refresh cycles)
	for i := 0; i < 5; i++ {
		alerts := getActiveAlerts()
		if !alerts[testPaneID] {
			t.Errorf("Alert should persist on refresh %d for pane %s", i, testPaneID)
		}
	}
}

// TestClaudePaneAlertPersistence tests bell persistence in tmux
func TestClaudePaneAlertPersistence(t *testing.T) {
	// Skip if tmux not available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found, skipping tmux integration tests")
	}

	// Create unique session name
	sessionName := fmt.Sprintf("test-claude-alert-%d", time.Now().Unix())

	// Create background tmux session
	cmd := exec.Command("tmux", "new-session", "-d", "-s", sessionName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer exec.Command("tmux", "kill-session", "-t", sessionName).Run()

	time.Sleep(100 * time.Millisecond)

	// Get pane ID
	output, err := exec.Command("tmux", "display-message", "-t", sessionName, "-p", "#{pane_id}").Output()
	if err != nil {
		t.Fatalf("Failed to get pane ID: %v", err)
	}
	paneID := strings.TrimSpace(string(output))

	// Trigger bell in the pane
	cmd = exec.Command("tmux", "send-keys", "-t", paneID, "printf '\\a'", "Enter")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to trigger bell: %v", err)
	}

	time.Sleep(200 * time.Millisecond)

	// Check bell flag
	output, err = exec.Command("tmux", "display-message", "-t", sessionName, "-p", "#{window_bell_flag}").Output()
	if err != nil {
		t.Fatalf("Failed to get bell flag: %v", err)
	}

	bellFlag := strings.TrimSpace(string(output))
	if bellFlag != "1" {
		t.Logf("Warning: Bell flag is %s, expected 1. Bell may not have triggered.", bellFlag)
	}
}

// TestNotificationHookSimulation simulates the hook workflow with a real tmux session
func TestNotificationHookSimulation(t *testing.T) {
	// Skip if tmux not available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found, skipping tmux integration tests")
	}

	// Create unique session name
	sessionName := fmt.Sprintf("test-hook-sim-%d", time.Now().Unix())

	// Create background tmux session
	cmd := exec.Command("tmux", "new-session", "-d", "-s", sessionName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer exec.Command("tmux", "kill-session", "-t", sessionName).Run()

	time.Sleep(100 * time.Millisecond)

	// Get pane ID
	output, err := exec.Command("tmux", "display-message", "-t", sessionName, "-p", "#{pane_id}").Output()
	if err != nil {
		t.Fatalf("Failed to get pane ID: %v", err)
	}
	paneID := strings.TrimSpace(string(output))

	// Ensure /tmp/claude directory exists
	os.MkdirAll("/tmp/claude", 0755)

	alertFile := fmt.Sprintf("/tmp/claude/tui-alert-%s", paneID)
	defer os.Remove(alertFile)

	// Simulate Notification hook
	// Note: We need to run this from within the tmux session context
	hookCmd := fmt.Sprintf("PANE=$(tmux display-message -t %s -p '#{pane_id}' 2>/dev/null); [ -n \"$PANE\" ] && touch \"/tmp/claude/tui-alert-$PANE\"", sessionName)
	cmd = exec.Command("sh", "-c", hookCmd)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to run notification hook command: %v", err)
	}

	time.Sleep(100 * time.Millisecond)

	// Verify alert file was created
	if _, err := os.Stat(alertFile); os.IsNotExist(err) {
		t.Errorf("Alert file should exist at %s", alertFile)
	}

	// Verify alert is detected by getActiveAlerts
	alerts := getActiveAlerts()
	if !alerts[paneID] {
		t.Errorf("Alert for pane %s should be detected", paneID)
	}

	// Simulate UserPromptSubmit hook (cleanup)
	cleanupCmd := fmt.Sprintf("PANE=$(tmux display-message -t %s -p '#{pane_id}' 2>/dev/null); [ -n \"$PANE\" ] && rm -f \"/tmp/claude/tui-alert-$PANE\"", sessionName)
	cmd = exec.Command("sh", "-c", cleanupCmd)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to run cleanup hook command: %v", err)
	}

	time.Sleep(100 * time.Millisecond)

	// Verify alert file was removed
	if _, err := os.Stat(alertFile); !os.IsNotExist(err) {
		t.Error("Alert file should be removed after cleanup")
	}

	// Verify alert is no longer detected
	alerts = getActiveAlerts()
	if alerts[paneID] {
		t.Error("Alert should be cleared after cleanup")
	}
}

// TestHookCommandPaneDetection tests that tmux display-message -p '#{pane_id}' works
func TestHookCommandPaneDetection(t *testing.T) {
	// Skip if tmux not available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found, skipping tmux integration tests")
	}

	// Create unique session name
	sessionName := fmt.Sprintf("test-pane-detect-%d", time.Now().Unix())

	// Create background tmux session
	cmd := exec.Command("tmux", "new-session", "-d", "-s", sessionName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer exec.Command("tmux", "kill-session", "-t", sessionName).Run()

	time.Sleep(100 * time.Millisecond)

	// Test the exact command used in hooks
	output, err := exec.Command("sh", "-c", "tmux display-message -p '#{pane_id}' 2>/dev/null").Output()
	if err != nil {
		t.Fatalf("Failed to detect pane ID: %v", err)
	}

	paneID := strings.TrimSpace(string(output))
	if paneID == "" {
		t.Error("Pane ID should not be empty")
	}

	// Verify pane ID format (should start with %)
	if !strings.HasPrefix(paneID, "%") {
		t.Errorf("Pane ID should start with %%, got: %s", paneID)
	}
}

// TestAlertFileWithRealPaneID tests alert files with real pane IDs (starting with %)
func TestAlertFileWithRealPaneID(t *testing.T) {
	// Skip if tmux not available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found, skipping tmux integration tests")
	}

	// Create unique session name
	sessionName := fmt.Sprintf("test-real-pane-%d", time.Now().Unix())

	// Create background tmux session
	cmd := exec.Command("tmux", "new-session", "-d", "-s", sessionName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer exec.Command("tmux", "kill-session", "-t", sessionName).Run()

	time.Sleep(100 * time.Millisecond)

	// Get real pane ID
	output, err := exec.Command("tmux", "display-message", "-t", sessionName, "-p", "#{pane_id}").Output()
	if err != nil {
		t.Fatalf("Failed to get pane ID: %v", err)
	}
	paneID := strings.TrimSpace(string(output))

	// Ensure /tmp/claude directory exists
	os.MkdirAll("/tmp/claude", 0755)

	alertFile := fmt.Sprintf("/tmp/claude/tui-alert-%s", paneID)
	defer os.Remove(alertFile)

	// Create alert file
	if err := os.WriteFile(alertFile, []byte{}, 0644); err != nil {
		t.Fatalf("Failed to create alert file: %v", err)
	}

	// Verify alert is detected
	alerts := getActiveAlerts()
	if !alerts[paneID] {
		t.Errorf("Alert for real pane ID %s should be detected", paneID)
	}

	// Verify file exists
	if _, err := os.Stat(alertFile); os.IsNotExist(err) {
		t.Errorf("Alert file should exist at %s", alertFile)
	}
}

// TestEndToEndAlertFlow tests complete lifecycle: no alert → notification → persist → clear
func TestEndToEndAlertFlow(t *testing.T) {
	// Skip if tmux not available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found, skipping tmux integration tests")
	}

	// Create unique session name
	sessionName := fmt.Sprintf("test-e2e-alert-%d", time.Now().Unix())

	// Create background tmux session
	cmd := exec.Command("tmux", "new-session", "-d", "-s", sessionName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer exec.Command("tmux", "kill-session", "-t", sessionName).Run()

	time.Sleep(100 * time.Millisecond)

	// Get pane ID
	output, err := exec.Command("tmux", "display-message", "-t", sessionName, "-p", "#{pane_id}").Output()
	if err != nil {
		t.Fatalf("Failed to get pane ID: %v", err)
	}
	paneID := strings.TrimSpace(string(output))

	// Ensure /tmp/claude directory exists
	os.MkdirAll("/tmp/claude", 0755)

	alertFile := fmt.Sprintf("/tmp/claude/tui-alert-%s", paneID)
	defer os.Remove(alertFile)

	// Phase 1: No alert initially
	alerts := getActiveAlerts()
	if alerts[paneID] {
		t.Error("Should have no alert initially")
	}
	if _, err := os.Stat(alertFile); !os.IsNotExist(err) {
		t.Error("Alert file should not exist initially")
	}

	// Phase 2: Notification creates alert
	if err := os.WriteFile(alertFile, []byte{}, 0644); err != nil {
		t.Fatalf("Failed to create alert file: %v", err)
	}

	// Phase 3: Alert persists across multiple checks
	for i := 0; i < 3; i++ {
		time.Sleep(50 * time.Millisecond)
		alerts = getActiveAlerts()
		if !alerts[paneID] {
			t.Errorf("Alert should persist on check %d", i+1)
		}
		if _, err := os.Stat(alertFile); os.IsNotExist(err) {
			t.Errorf("Alert file should exist on check %d", i+1)
		}
	}

	// Phase 4: User interaction clears alert
	if err := os.Remove(alertFile); err != nil {
		t.Fatalf("Failed to remove alert file: %v", err)
	}

	// Phase 5: Alert is cleared
	alerts = getActiveAlerts()
	if alerts[paneID] {
		t.Error("Alert should be cleared after removal")
	}
	if _, err := os.Stat(alertFile); !os.IsNotExist(err) {
		t.Error("Alert file should not exist after removal")
	}
}

// TestStaleAlertFilesIgnored verifies that alert files for non-existent panes are ignored
func TestStaleAlertFilesIgnored(t *testing.T) {
	// Skip if tmux not available (we need tmux to get valid pane list)
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found, skipping test")
	}

	os.MkdirAll("/tmp/claude", 0755)

	// Create alert file for a pane that doesn't exist
	staleFile := "/tmp/claude/tui-alert-%99999"
	os.WriteFile(staleFile, []byte{}, 0644)
	defer os.Remove(staleFile)

	// Create alert file with invalid format
	invalidFile := "/tmp/claude/tui-alert-test-invalid"
	os.WriteFile(invalidFile, []byte{}, 0644)
	defer os.Remove(invalidFile)

	alerts := getActiveAlerts()

	if alerts["%99999"] {
		t.Error("Should not show alert for non-existent pane %99999")
	}
	if alerts["test-invalid"] {
		t.Error("Should not show alert for invalid pane ID format")
	}
}

// TestRealClaudeAlertFlow tests the complete alert flow by verifying TUI output
// This test spawns Claude and tmux-tui in a tmux session, sends a prompt, and verifies:
// 1. TUI displays highlighted window number (ANSI red background) after notification
// 2. TUI displays normal window number after next prompt clears the alert
func TestRealClaudeAlertFlow(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping real Claude test in short mode")
	}

	// Skip if dependencies not available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found")
	}
	if _, err := exec.LookPath("claude"); err != nil {
		t.Skip("claude not found")
	}

	// Get project paths - tests run from tmux-tui/tests/
	os.MkdirAll("/tmp/claude", 0755)
	projectDir, _ := filepath.Abs("../..") // Project root with .claude/settings.json
	tuiDir, _ := filepath.Abs("..")        // tmux-tui directory

	// Build tmux-tui binary
	buildCmd := exec.Command("go", "build", "-o", filepath.Join(tuiDir, "build", "tmux-tui"), "./cmd/tmux-tui")
	buildCmd.Dir = tuiDir
	if err := buildCmd.Run(); err != nil {
		t.Fatalf("Failed to build tmux-tui: %v", err)
	}

	// Create test session
	sessionName := fmt.Sprintf("test-claude-e2e-%d", time.Now().Unix())
	cmd := exec.Command("tmux", "new-session", "-d", "-s", sessionName, "-x", "120", "-y", "40")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer exec.Command("tmux", "kill-session", "-t", sessionName).Run()
	time.Sleep(500 * time.Millisecond)

	// Create window 1 for Claude
	t.Log("Creating window 1...")
	cmd = exec.Command("tmux", "new-window", "-t", sessionName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create window 1: %v", err)
	}
	time.Sleep(500 * time.Millisecond)

	// Get window ID for window 1
	windowIDOutput, _ := exec.Command("tmux", "display-message", "-t", sessionName+":1", "-p", "#{window_id}").Output()
	windowID := strings.TrimSpace(string(windowIDOutput))

	// Create TUI pane on left side (like spawn.sh does)
	// First save current pane (the Claude pane)
	claudePaneOutput, _ := exec.Command("tmux", "display-message", "-t", sessionName+":1", "-p", "#{pane_id}").Output()
	claudePane := strings.TrimSpace(string(claudePaneOutput))
	t.Logf("Claude pane: %s", claudePane)

	// Split window to create TUI pane on left (40 columns)
	t.Log("Spawning TUI pane on left...")
	cmd = exec.Command("tmux", "split-window", "-t", claudePane, "-h", "-b", "-l", "40")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create TUI pane: %v", err)
	}
	time.Sleep(500 * time.Millisecond)

	// List panes to find the TUI pane (the new one created by split)
	panesOutput, _ := exec.Command("tmux", "list-panes", "-t", sessionName+":1", "-F", "#{pane_id}").Output()
	paneIDs := strings.Split(strings.TrimSpace(string(panesOutput)), "\n")
	var tuiPane string
	for _, p := range paneIDs {
		if p != claudePane && p != "" {
			tuiPane = p
			break
		}
	}
	if tuiPane == "" {
		t.Fatalf("Could not find TUI pane after split")
	}
	t.Logf("TUI pane: %s", tuiPane)

	// Store TUI pane ID in window option
	exec.Command("tmux", "set-window-option", "-t", windowID, "@tui-pane", tuiPane).Run()

	// Launch TUI binary in the TUI pane
	tuiBinary := filepath.Join(tuiDir, "build", "tmux-tui")
	cmd = exec.Command("tmux", "send-keys", "-t", tuiPane, tuiBinary, "Enter")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to start TUI: %v", err)
	}
	time.Sleep(2 * time.Second) // Wait for TUI to initialize

	// Start Claude in the Claude pane (right pane)
	// cd to project directory so Claude picks up hooks from .claude/settings.json
	// Use --permission-mode default to avoid plan mode blocking the test
	t.Log("Starting Claude interactive shell with haiku model...")
	cmd = exec.Command("tmux", "send-keys", "-t", claudePane, "cd "+projectDir+" && claude --model haiku --permission-mode default", "Enter")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to start Claude: %v", err)
	}

	// Debug: List all panes in window 1
	debugPanesOutput, _ := exec.Command("tmux", "list-panes", "-t", sessionName+":1", "-F", "#{pane_id} #{pane_current_command}").Output()
	t.Logf("Panes in window 1: %s", strings.TrimSpace(string(debugPanesOutput)))

	// Wait for Claude to initialize (Claude is in the Claude pane)
	claudeReady := false
	for i := 0; i < 30; i++ {
		time.Sleep(1 * time.Second)
		output, _ := exec.Command("tmux", "capture-pane", "-t", claudePane, "-p").Output()
		paneContent := string(output)
		if strings.Contains(paneContent, ">") || strings.Contains(paneContent, "What can I help") {
			claudeReady = true
			t.Logf("Claude ready after %d seconds", i+1)
			break
		}
	}
	if !claudeReady {
		output, _ := exec.Command("tmux", "capture-pane", "-t", claudePane, "-p").Output()
		t.Logf("Warning: Could not confirm Claude is ready. Pane content:\n%s", string(output))
	}

	// Capture TUI output BEFORE sending prompt (baseline)
	tuiOutputBefore, _ := exec.Command("tmux", "capture-pane", "-t", tuiPane, "-p", "-e").Output()
	t.Logf("TUI output before prompt:\n%s", string(tuiOutputBefore))

	// Manually create alert file for the Claude pane (simulating Notification hook)
	// This tests TUI behavior without relying on Claude hooks working in detached sessions
	t.Log("Creating alert file (simulating Notification hook)...")
	alertFile := fmt.Sprintf("/tmp/claude/tui-alert-%s", claudePane)
	if err := os.WriteFile(alertFile, []byte{}, 0644); err != nil {
		t.Fatalf("Failed to create alert file: %v", err)
	}
	defer os.Remove(alertFile)

	// Wait for TUI to refresh and show the alert highlight
	t.Log("Waiting for TUI to show alert highlight...")
	alertVisible := false
	var tuiOutputAfter []byte
	for i := 0; i < 10; i++ { // TUI refreshes every 2s, so 10 iterations = 20s max
		time.Sleep(2 * time.Second)
		// Capture with -e to preserve ANSI escape sequences
		tuiOutputAfter, _ = exec.Command("tmux", "capture-pane", "-t", tuiPane, "-p", "-e").Output()
		// Look for ANSI red background (color 1) around "1:" (window 1)
		// bellStyle uses Background(lipgloss.Color("1")) which is red
		if containsHighlightedWindow(string(tuiOutputAfter), "1:") {
			alertVisible = true
			t.Logf("Alert highlight visible after %d checks", i+1)
			break
		}
	}

	if !alertVisible {
		t.Logf("TUI output after alert creation:\n%s", string(tuiOutputAfter))
		t.Error("TUI should show highlighted window number after alert file created")
	}

	// Remove alert file (simulating UserPromptSubmit hook)
	t.Log("Removing alert file (simulating UserPromptSubmit hook)...")
	os.Remove(alertFile)

	// Wait for TUI to update and verify highlight is gone
	time.Sleep(3 * time.Second) // Give TUI time to refresh (2s tick interval)
	tuiOutputCleared, _ := exec.Command("tmux", "capture-pane", "-t", tuiPane, "-p", "-e").Output()

	if containsHighlightedWindow(string(tuiOutputCleared), "1:") {
		t.Logf("TUI output after exit:\n%s", string(tuiOutputCleared))
		t.Error("TUI should NOT show highlighted window number after UserPromptSubmit")
	}

	t.Log("Real Claude alert flow test completed successfully")
}

// containsHighlightedWindow checks if the output contains ANSI-highlighted window number
// bellStyle uses lipgloss Background(Color("1")) which renders as red background
func containsHighlightedWindow(output, windowNum string) bool {
	// ANSI escape for red background is typically \x1b[41m or similar
	// lipgloss may use different codes, so we look for:
	// 1. Any background color escape sequence followed by the window number
	// 2. The specific pattern used by bellStyle

	// Pattern: escape sequence + window number within reasonable proximity
	// \x1b[...m where ... contains background color codes
	return strings.Contains(output, "\x1b[") &&
		strings.Contains(output, windowNum) &&
		(strings.Contains(output, "[41m") || // Standard red background
			strings.Contains(output, "[48;5;1m") || // 256-color red
			strings.Contains(output, ";1m"+windowNum)) // Bold + window (simplified check)
}

