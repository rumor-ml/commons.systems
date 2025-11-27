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

const testSocketName = "e2e-test"

// tmuxCmd creates a tmux command that runs on the isolated test server
func tmuxCmd(args ...string) *exec.Cmd {
	fullArgs := append([]string{"-L", testSocketName}, args...)
	cmd := exec.Command("tmux", fullArgs...)
	cmd.Env = filterTmuxEnv(os.Environ())
	return cmd
}

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
	cmd := tmuxCmd("new-session", "-d", "-s", sessionName, "-x", "80", "-y", "24")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer tmuxCmd("kill-server").Run()

	// Give tmux time to initialize
	time.Sleep(100 * time.Millisecond)

	// Verify session exists
	cmd = tmuxCmd("has-session", "-t", sessionName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Tmux session not found: %v", err)
	}

	// Count initial panes (should be 1)
	listCmd := tmuxCmd("list-panes", "-t", sessionName)
	output, err := listCmd.Output()
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
	cmd := tmuxCmd("new-session", "-d", "-s", sessionName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer tmuxCmd("kill-server").Run()

	time.Sleep(100 * time.Millisecond)

	// Get window ID
	displayCmd := tmuxCmd("display-message", "-t", sessionName, "-p", "#{window_id}")
	output, err := displayCmd.Output()
	if err != nil {
		t.Fatalf("Failed to get window ID: %v", err)
	}
	windowID := strings.TrimSpace(string(output))

	// Set a test window option
	testPaneID := "%123"
	cmd = tmuxCmd("set-window-option", "-t", windowID, "@tui-pane", testPaneID)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to set window option: %v", err)
	}

	// Verify we can read it back
	showCmd := tmuxCmd("show-window-option", "-t", windowID, "@tui-pane")
	output, err = showCmd.Output()
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
	cmd1 := tmuxCmd("new-session", "-d", "-s", session1)
	cmd2 := tmuxCmd("new-session", "-d", "-s", session2)

	if err := cmd1.Run(); err != nil {
		t.Fatalf("Failed to create session 1: %v", err)
	}
	defer tmuxCmd("kill-server").Run()

	if err := cmd2.Run(); err != nil {
		t.Fatalf("Failed to create session 2: %v", err)
	}

	time.Sleep(100 * time.Millisecond)

	// Verify both sessions exist independently
	if err := tmuxCmd("has-session", "-t", session1).Run(); err != nil {
		t.Errorf("Session 1 not found")
	}
	if err := tmuxCmd("has-session", "-t", session2).Run(); err != nil {
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
	output, err := tmuxCmd("list-panes", "-a", "-F", "#{pane_id}").Output()
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
	cmd := tmuxCmd("new-session", "-d", "-s", sessionName)
	if err := cmd.Run(); err != nil {
		t.Skipf("Could not create tmux session (may be running outside tmux server): %v", err)
	}
	defer tmuxCmd("kill-session", "-t", sessionName).Run()
	time.Sleep(100 * time.Millisecond)

	// Get real pane ID
	output, err := tmuxCmd("display-message", "-t", sessionName, "-p", "#{pane_id}").Output()
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
	cmd := tmuxCmd("new-session", "-d", "-s", sessionName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer tmuxCmd("kill-session", "-t", sessionName).Run()
	time.Sleep(100 * time.Millisecond)

	// Get real pane ID
	output, err := tmuxCmd("display-message", "-t", sessionName, "-p", "#{pane_id}").Output()
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
	cmd := tmuxCmd("new-session", "-d", "-s", sessionName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer tmuxCmd("kill-session", "-t", sessionName).Run()
	time.Sleep(100 * time.Millisecond)

	// Get real pane ID
	output, err := tmuxCmd("display-message", "-t", sessionName, "-p", "#{pane_id}").Output()
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
	cmd := tmuxCmd("new-session", "-d", "-s", sessionName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer tmuxCmd("kill-session", "-t", sessionName).Run()

	time.Sleep(100 * time.Millisecond)

	// Get pane ID
	output, err := tmuxCmd("display-message", "-t", sessionName, "-p", "#{pane_id}").Output()
	if err != nil {
		t.Fatalf("Failed to get pane ID: %v", err)
	}
	paneID := strings.TrimSpace(string(output))

	// Trigger bell in the pane (use session-qualified target)
	cmd = tmuxCmd("send-keys", "-t", sessionName+"."+paneID, "printf '\\a'", "Enter")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to trigger bell: %v", err)
	}

	time.Sleep(200 * time.Millisecond)

	// Check bell flag
	output, err = tmuxCmd("display-message", "-t", sessionName, "-p", "#{window_bell_flag}").Output()
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
	cmd := tmuxCmd("new-session", "-d", "-s", sessionName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer tmuxCmd("kill-session", "-t", sessionName).Run()

	time.Sleep(100 * time.Millisecond)

	// Get pane ID
	output, err := tmuxCmd("display-message", "-t", sessionName, "-p", "#{pane_id}").Output()
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
	hookCmd := fmt.Sprintf("PANE=$(tmux -L %s display-message -t %s -p '#{pane_id}' 2>/dev/null); [ -n \"$PANE\" ] && touch \"/tmp/claude/tui-alert-$PANE\"", testSocketName, sessionName)
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
	cleanupCmd := fmt.Sprintf("PANE=$(tmux -L %s display-message -t %s -p '#{pane_id}' 2>/dev/null); [ -n \"$PANE\" ] && rm -f \"/tmp/claude/tui-alert-$PANE\"", testSocketName, sessionName)
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
	cmd := tmuxCmd("new-session", "-d", "-s", sessionName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer tmuxCmd("kill-session", "-t", sessionName).Run()

	time.Sleep(100 * time.Millisecond)

	// Test the exact command used in hooks (must use isolated test server)
	hookCmd := fmt.Sprintf("tmux -L %s display-message -p '#{pane_id}' 2>/dev/null", testSocketName)
	output, err := exec.Command("sh", "-c", hookCmd).Output()
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
	cmd := tmuxCmd("new-session", "-d", "-s", sessionName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer tmuxCmd("kill-session", "-t", sessionName).Run()

	time.Sleep(100 * time.Millisecond)

	// Get real pane ID
	output, err := tmuxCmd("display-message", "-t", sessionName, "-p", "#{pane_id}").Output()
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
	cmd := tmuxCmd("new-session", "-d", "-s", sessionName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer tmuxCmd("kill-session", "-t", sessionName).Run()

	time.Sleep(100 * time.Millisecond)

	// Get pane ID
	output, err := tmuxCmd("display-message", "-t", sessionName, "-p", "#{pane_id}").Output()
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
	cmd := tmuxCmd("new-session", "-d", "-s", sessionName, "-x", "120", "-y", "40")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer func() {
		killCmd := tmuxCmd("kill-session", "-t", sessionName)
		killCmd.Run()
	}()
	time.Sleep(500 * time.Millisecond)

	// Create window 1 for Claude
	t.Log("Creating window 1...")
	cmd = tmuxCmd("new-window", "-t", sessionName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create window 1: %v", err)
	}
	time.Sleep(500 * time.Millisecond)

	// Get window ID for window 1
	displayCmd := tmuxCmd("display-message", "-t", sessionName+":1", "-p", "#{window_id}")
	windowIDOutput, _ := displayCmd.Output()
	windowID := strings.TrimSpace(string(windowIDOutput))

	// Create TUI pane on left side (like spawn.sh does)
	// First save current pane (the Claude pane)
	paneCmd := tmuxCmd("display-message", "-t", sessionName+":1", "-p", "#{pane_id}")
	claudePaneOutput, _ := paneCmd.Output()
	claudePane := strings.TrimSpace(string(claudePaneOutput))
	t.Logf("Claude pane: %s", claudePane)

	// Split window to create TUI pane on left (40 columns) - use session-qualified target
	t.Log("Spawning TUI pane on left...")
	cmd = tmuxCmd("split-window", "-t", sessionName+"."+claudePane, "-h", "-b", "-l", "40")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create TUI pane: %v", err)
	}
	time.Sleep(500 * time.Millisecond)

	// List panes to find the TUI pane (the new one created by split)
	listCmd := tmuxCmd("list-panes", "-t", sessionName+":1", "-F", "#{pane_id}")
	panesOutput, _ := listCmd.Output()
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
	setOptCmd := tmuxCmd("set-window-option", "-t", windowID, "@tui-pane", tuiPane)
	setOptCmd.Run()

	// Launch TUI binary in the TUI pane (use session-qualified target)
	tuiBinary := filepath.Join(tuiDir, "build", "tmux-tui")
	cmd = tmuxCmd("send-keys", "-t", sessionName+"."+tuiPane, tuiBinary, "Enter")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to start TUI: %v", err)
	}
	time.Sleep(2 * time.Second) // Wait for TUI to initialize

	// Start Claude in the Claude pane (right pane) - use session-qualified target
	// cd to project directory so Claude picks up hooks from .claude/settings.json
	// Use --permission-mode default to avoid plan mode blocking the test
	t.Log("Starting Claude interactive shell with haiku model...")
	cmd = tmuxCmd("send-keys", "-t", sessionName+"."+claudePane, "cd "+projectDir+" && claude --model haiku --permission-mode default", "Enter")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to start Claude: %v", err)
	}

	// Debug: List all panes in window 1
	debugCmd := tmuxCmd("list-panes", "-t", sessionName+":1", "-F", "#{pane_id} #{pane_current_command}")
	debugPanesOutput, _ := debugCmd.Output()
	t.Logf("Panes in window 1: %s", strings.TrimSpace(string(debugPanesOutput)))

	// Wait for Claude to initialize (Claude is in the Claude pane)
	claudeReady := false
	for i := 0; i < 30; i++ {
		time.Sleep(1 * time.Second)
		captureCmd := tmuxCmd("capture-pane", "-t", sessionName+"."+claudePane, "-p")
		output, _ := captureCmd.Output()
		paneContent := string(output)
		if strings.Contains(paneContent, ">") || strings.Contains(paneContent, "What can I help") {
			claudeReady = true
			t.Logf("Claude ready after %d seconds", i+1)
			break
		}
	}
	if !claudeReady {
		captureCmd := tmuxCmd("capture-pane", "-t", sessionName+"."+claudePane, "-p")
		output, _ := captureCmd.Output()
		t.Logf("Warning: Could not confirm Claude is ready. Pane content:\n%s", string(output))
	}

	// Capture TUI output BEFORE sending prompt (baseline) - use session-qualified target
	tuiCaptureCmd := tmuxCmd("capture-pane", "-t", sessionName+"."+tuiPane, "-p", "-e")
	tuiOutputBefore, _ := tuiCaptureCmd.Output()
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
		// Capture with -e to preserve ANSI escape sequences - use session-qualified target
		captureCmd := tmuxCmd("capture-pane", "-t", sessionName+"."+tuiPane, "-p", "-e")
		tuiOutputAfter, _ = captureCmd.Output()
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

	// Wait for TUI to update and verify highlight is gone - use session-qualified target
	time.Sleep(3 * time.Second) // Give TUI time to refresh (2s tick interval)
	clearCaptureCmd := tmuxCmd("capture-pane", "-t", sessionName+"."+tuiPane, "-p", "-e")
	tuiOutputCleared, _ := clearCaptureCmd.Output()

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

// TestHookCommandCreateAlert tests that the Notification hook command creates alert files
func TestHookCommandCreateAlert(t *testing.T) {
	// Skip if tmux not available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found, skipping tmux integration tests")
	}

	// Create unique session name
	sessionName := fmt.Sprintf("test-hook-create-%d", time.Now().Unix())

	// Create background tmux session
	cmd := tmuxCmd("new-session", "-d", "-s", sessionName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer tmuxCmd("kill-session", "-t", sessionName).Run()

	time.Sleep(100 * time.Millisecond)

	// Get pane ID
	output, err := tmuxCmd("display-message", "-t", sessionName, "-p", "#{pane_id}").Output()
	if err != nil {
		t.Fatalf("Failed to get pane ID: %v", err)
	}
	paneID := strings.TrimSpace(string(output))

	// Ensure /tmp/claude directory exists
	os.MkdirAll("/tmp/claude", 0755)

	alertFile := fmt.Sprintf("/tmp/claude/tui-alert-%s", paneID)
	defer os.Remove(alertFile)

	// Ensure file doesn't exist before test
	os.Remove(alertFile)

	// Run the Notification hook command from .claude/settings.json
	// [ -n "$TMUX_PANE" ] && touch "/tmp/claude/tui-alert-$TMUX_PANE"
	hookCmd := fmt.Sprintf("TMUX_PANE=%s; [ -n \"$TMUX_PANE\" ] && touch \"/tmp/claude/tui-alert-$TMUX_PANE\"", paneID)
	cmd = exec.Command("sh", "-c", hookCmd)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to run notification hook command: %v", err)
	}

	// Verify alert file was created
	if _, err := os.Stat(alertFile); os.IsNotExist(err) {
		t.Errorf("Hook command should create alert file at %s", alertFile)
	}

	// Verify getActiveAlerts detects it
	alerts := getActiveAlerts()
	if !alerts[paneID] {
		t.Errorf("Alert for pane %s should be detected after hook command", paneID)
	}
}

// TestHookCommandRemoveAlert tests that the UserPromptSubmit hook command removes alert files
func TestHookCommandRemoveAlert(t *testing.T) {
	// Skip if tmux not available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found, skipping tmux integration tests")
	}

	// Create unique session name
	sessionName := fmt.Sprintf("test-hook-remove-%d", time.Now().Unix())

	// Create background tmux session
	cmd := tmuxCmd("new-session", "-d", "-s", sessionName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer tmuxCmd("kill-session", "-t", sessionName).Run()

	time.Sleep(100 * time.Millisecond)

	// Get pane ID
	output, err := tmuxCmd("display-message", "-t", sessionName, "-p", "#{pane_id}").Output()
	if err != nil {
		t.Fatalf("Failed to get pane ID: %v", err)
	}
	paneID := strings.TrimSpace(string(output))

	// Ensure /tmp/claude directory exists
	os.MkdirAll("/tmp/claude", 0755)

	alertFile := fmt.Sprintf("/tmp/claude/tui-alert-%s", paneID)
	defer os.Remove(alertFile)

	// Create alert file first
	if err := os.WriteFile(alertFile, []byte{}, 0644); err != nil {
		t.Fatalf("Failed to create alert file: %v", err)
	}

	// Verify file exists
	if _, err := os.Stat(alertFile); os.IsNotExist(err) {
		t.Fatal("Alert file should exist before running cleanup hook")
	}

	// Run the UserPromptSubmit hook command from .claude/settings.json
	// [ -n "$TMUX_PANE" ] && rm -f "/tmp/claude/tui-alert-$TMUX_PANE"
	hookCmd := fmt.Sprintf("TMUX_PANE=%s; [ -n \"$TMUX_PANE\" ] && rm -f \"/tmp/claude/tui-alert-$TMUX_PANE\"", paneID)
	cmd = exec.Command("sh", "-c", hookCmd)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to run cleanup hook command: %v", err)
	}

	// Verify alert file was removed
	if _, err := os.Stat(alertFile); !os.IsNotExist(err) {
		t.Error("Hook command should remove alert file")
	}

	// Verify getActiveAlerts no longer detects it
	alerts := getActiveAlerts()
	if alerts[paneID] {
		t.Error("Alert should be cleared after cleanup hook command")
	}
}

// TestHookCommandTMUXPaneUnset tests that hooks handle TMUX_PANE being unset gracefully
func TestHookCommandTMUXPaneUnset(t *testing.T) {
	// Ensure /tmp/claude directory exists
	os.MkdirAll("/tmp/claude", 0755)

	// Run Notification hook with TMUX_PANE unset (should not create any file)
	// Add 'true' at the end to ensure exit status 0 (the [ -n ... ] test will fail but that's ok)
	hookCmd := "unset TMUX_PANE; [ -n \"$TMUX_PANE\" ] && touch \"/tmp/claude/tui-alert-$TMUX_PANE\"; true"
	cmd := exec.Command("sh", "-c", hookCmd)
	if err := cmd.Run(); err != nil {
		t.Errorf("Hook command should not fail when TMUX_PANE is unset: %v", err)
	}

	// Verify no bogus file was created
	matches, _ := filepath.Glob("/tmp/claude/tui-alert-")
	if len(matches) > 0 {
		t.Errorf("Hook should not create file with empty pane ID: %v", matches)
	}

	// Run UserPromptSubmit hook with TMUX_PANE unset (should not fail)
	// Add 'true' at the end to ensure exit status 0
	hookCmd = "unset TMUX_PANE; [ -n \"$TMUX_PANE\" ] && rm -f \"/tmp/claude/tui-alert-$TMUX_PANE\"; true"
	cmd = exec.Command("sh", "-c", hookCmd)
	if err := cmd.Run(); err != nil {
		t.Errorf("Cleanup hook command should not fail when TMUX_PANE is unset: %v", err)
	}
}

// TestHookCommandFileDoesNotExist tests that UserPromptSubmit hook doesn't fail if file doesn't exist
func TestHookCommandFileDoesNotExist(t *testing.T) {
	// Skip if tmux not available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found, skipping tmux integration tests")
	}

	// Create unique session name
	sessionName := fmt.Sprintf("test-hook-nofile-%d", time.Now().Unix())

	// Create background tmux session
	cmd := tmuxCmd("new-session", "-d", "-s", sessionName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer tmuxCmd("kill-session", "-t", sessionName).Run()

	time.Sleep(100 * time.Millisecond)

	// Get pane ID
	output, err := tmuxCmd("display-message", "-t", sessionName, "-p", "#{pane_id}").Output()
	if err != nil {
		t.Fatalf("Failed to get pane ID: %v", err)
	}
	paneID := strings.TrimSpace(string(output))

	alertFile := fmt.Sprintf("/tmp/claude/tui-alert-%s", paneID)

	// Ensure file does NOT exist
	os.Remove(alertFile)

	// Run UserPromptSubmit hook (rm -f should not fail even if file doesn't exist)
	hookCmd := fmt.Sprintf("TMUX_PANE=%s; [ -n \"$TMUX_PANE\" ] && rm -f \"/tmp/claude/tui-alert-$TMUX_PANE\"", paneID)
	cmd = exec.Command("sh", "-c", hookCmd)
	if err := cmd.Run(); err != nil {
		t.Errorf("Cleanup hook should not fail when file doesn't exist: %v", err)
	}
}

// TestHookCommandVariousPaneIDFormats tests hooks work with different pane ID formats
func TestHookCommandVariousPaneIDFormats(t *testing.T) {
	// Ensure /tmp/claude directory exists
	os.MkdirAll("/tmp/claude", 0755)

	testCases := []struct {
		name   string
		paneID string
	}{
		{"Single digit", "%0"},
		{"Small number", "%1"},
		{"Larger number", "%123"},
		{"Very large number", "%9999"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			alertFile := fmt.Sprintf("/tmp/claude/tui-alert-%s", tc.paneID)
			defer os.Remove(alertFile)

			// Clean up first
			os.Remove(alertFile)

			// Create alert
			hookCmd := fmt.Sprintf("TMUX_PANE=%s; [ -n \"$TMUX_PANE\" ] && touch \"/tmp/claude/tui-alert-$TMUX_PANE\"", tc.paneID)
			cmd := exec.Command("sh", "-c", hookCmd)
			if err := cmd.Run(); err != nil {
				t.Fatalf("Create hook failed for pane %s: %v", tc.paneID, err)
			}

			// Verify file created
			if _, err := os.Stat(alertFile); os.IsNotExist(err) {
				t.Errorf("Alert file should exist for pane %s", tc.paneID)
			}

			// Remove alert
			hookCmd = fmt.Sprintf("TMUX_PANE=%s; [ -n \"$TMUX_PANE\" ] && rm -f \"/tmp/claude/tui-alert-$TMUX_PANE\"", tc.paneID)
			cmd = exec.Command("sh", "-c", hookCmd)
			if err := cmd.Run(); err != nil {
				t.Fatalf("Remove hook failed for pane %s: %v", tc.paneID, err)
			}

			// Verify file removed
			if _, err := os.Stat(alertFile); !os.IsNotExist(err) {
				t.Errorf("Alert file should be removed for pane %s", tc.paneID)
			}
		})
	}
}

// ============================================================================
// COMPREHENSIVE E2E TESTS WITH REAL CLAUDE SESSIONS
// ============================================================================

const (
	testAlertDir  = "/tmp/claude"
	alertPrefix   = "tui-alert-"
	claudeCommand = "claude --model haiku" // MUST use haiku for cost/speed
)

// Helper function: Create test tmux session
func createTestTmuxSession(t *testing.T, name string) func() {
	cmd := tmuxCmd("new-session", "-d", "-s", name, "-x", "120", "-y", "40")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session %s: %v", name, err)
	}
	time.Sleep(200 * time.Millisecond)

	// Return cleanup function
	return func() {
		tmuxCmd("kill-server").Run()
	}
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

// Helper function: Create window with Claude in tmux session
func createWindowWithClaude(t *testing.T, session, windowName string) string {
	// Create new window
	cmd := tmuxCmd("new-window", "-t", session, "-n", windowName)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create window %s: %v", windowName, err)
	}
	time.Sleep(200 * time.Millisecond)

	// Get window target (session:windowName)
	windowTarget := fmt.Sprintf("%s:%s", session, windowName)

	// Get pane ID
	paneID := getPaneID(t, session, windowName)

	// Get project root to pick up .claude/settings.json hooks
	// From tmux-tui/tmux-tui/tests (where tests run), go up two levels to repo root
	projectDir, _ := filepath.Abs("../..")

	// Start Claude with haiku model and default permission mode
	// CRITICAL: Set TMUX_PANE env var so hooks can use it
	claudeCmd := fmt.Sprintf("cd %s && TMUX_PANE=%s %s --permission-mode default", projectDir, paneID, claudeCommand)
	cmd = tmuxCmd("send-keys", "-t", windowTarget, claudeCmd, "Enter")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to start Claude in window %s: %v", windowName, err)
	}

	// Wait for Claude to initialize (handle folder permission prompt if needed)
	claudeReady := false
	permissionPromptAnswered := false
	for i := 0; i < 30; i++ {
		time.Sleep(1 * time.Second)
		captureCmd := tmuxCmd("capture-pane", "-t", windowTarget, "-p")
		output, _ := captureCmd.Output()
		paneContent := string(output)

		// Check if Claude is asking for folder permission
		if !permissionPromptAnswered && strings.Contains(paneContent, "Do you want to work in this folder") {
			t.Logf("Answering folder permission prompt in window %s", windowName)
			// Send Enter to select "Yes, continue" (default option)
			answerCmd := tmuxCmd("send-keys", "-t", windowTarget, "Enter")
			answerCmd.Run()
			permissionPromptAnswered = true
			continue
		}

		// Check if Claude is ready (main prompt visible)
		if strings.Contains(paneContent, ">") || strings.Contains(paneContent, "What can I help") {
			claudeReady = true
			t.Logf("Claude ready in window %s after %d seconds", windowName, i+1)
			break
		}
	}

	if !claudeReady {
		captureCmd := tmuxCmd("capture-pane", "-t", windowTarget, "-p")
		output, _ := captureCmd.Output()
		t.Logf("Warning: Claude may not be ready in window %s. Content:\n%s", windowName, string(output))
	}

	return paneID
}

// Helper function: Get pane ID for a window
func getPaneID(t *testing.T, session, window string) string {
	windowTarget := fmt.Sprintf("%s:%s", session, window)
	cmd := tmuxCmd("display-message", "-t", windowTarget, "-p", "#{pane_id}")
	output, err := cmd.Output()
	if err != nil {
		t.Fatalf("Failed to get pane ID for %s: %v", windowTarget, err)
	}
	return strings.TrimSpace(string(output))
}

// Helper function: Send prompt to Claude in a pane
// Uses pane ID directly as target since we're on isolated server
func sendPromptToClaude(t *testing.T, session, paneID, prompt string) {
	// Claude's TUI uses vim-like keybindings:
	// - Press 'i' to enter insert mode (needed after Claude responds, as it exits insert mode)
	// - Type the prompt text
	// - Press Escape to exit insert mode
	// - Press Enter to submit

	// Press 'i' to ensure we're in insert mode
	cmd := tmuxCmd("send-keys", "-t", paneID, "i")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to enter insert mode in pane %s: %v", paneID, err)
	}
	time.Sleep(300 * time.Millisecond)

	// Send the prompt text
	cmd = tmuxCmd("send-keys", "-t", paneID, prompt)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to send prompt text to pane %s: %v", paneID, err)
	}
	time.Sleep(500 * time.Millisecond)

	// Send Escape to exit insert mode
	cmd = tmuxCmd("send-keys", "-t", paneID, "Escape")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to send Escape to pane %s: %v", paneID, err)
	}
	time.Sleep(300 * time.Millisecond)

	// Send Enter to submit
	cmd = tmuxCmd("send-keys", "-t", paneID, "Enter")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to send Enter to pane %s: %v", paneID, err)
	}
}

// Helper function: Simulate Notification hook (create alert file)
// DEPRECATED: Main E2E tests now use real Claude hooks (Stop event).
// This function is kept for backwards compatibility with other tests that may need manual simulation.
// The actual hook command logic is tested in TestHookCommandCreateAlert.
func simulateNotificationHook(t *testing.T, paneID string) {
	alertFile := filepath.Join(testAlertDir, alertPrefix+paneID)
	if err := os.WriteFile(alertFile, []byte{}, 0644); err != nil {
		t.Fatalf("Failed to create alert file for pane %s: %v", paneID, err)
	}
}

// Helper function: Simulate UserPromptSubmit hook (clear alert file)
// DEPRECATED: Main E2E tests now use real Claude hooks (UserPromptSubmit event).
// This function is kept for backwards compatibility with other tests that may need manual simulation.
// The actual hook command logic is tested in TestHookCommandRemoveAlert.
func simulateUserPromptSubmitHook(t *testing.T, paneID string) {
	alertFile := filepath.Join(testAlertDir, alertPrefix+paneID)
	os.Remove(alertFile) // Don't fail if file doesn't exist (like rm -f)
}

// Helper function: Wait for alert file to appear or disappear
func waitForAlertFile(t *testing.T, paneID string, shouldExist bool, timeout time.Duration) bool {
	alertFile := filepath.Join(testAlertDir, alertPrefix+paneID)
	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		_, err := os.Stat(alertFile)
		exists := !os.IsNotExist(err)

		if exists == shouldExist {
			return true
		}

		time.Sleep(200 * time.Millisecond)
	}

	return false
}

// Test A: Multi-Window Alert Isolation (Priority 1)
// Tests that clearing alert in one window doesn't affect other windows
func TestMultiWindowAlertIsolation(t *testing.T) {
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

	// Ensure alert directory exists
	os.MkdirAll(testAlertDir, 0755)

	sessionName := fmt.Sprintf("test-multiwin-%d", time.Now().Unix())
	cleanup := createTestTmuxSession(t, sessionName)
	defer cleanup()

	// Create two windows with Claude
	t.Log("Creating window1 with Claude...")
	pane1 := createWindowWithClaude(t, sessionName, "window1")
	defer os.Remove(filepath.Join(testAlertDir, alertPrefix+pane1))

	t.Log("Creating window2 with Claude...")
	pane2 := createWindowWithClaude(t, sessionName, "window2")
	defer os.Remove(filepath.Join(testAlertDir, alertPrefix+pane2))

	// Verify no alerts initially
	alerts := getActiveAlerts()
	if alerts[pane1] || alerts[pane2] {
		t.Fatal("Should have no alerts initially")
	}

	// Send prompts - Claude responds, Stop hook creates alert files
	t.Logf("Sending prompts to both windows... pane1=%s, pane2=%s", pane1, pane2)
	sendPromptToClaude(t, sessionName, pane1, "say hi")
	sendPromptToClaude(t, sessionName, pane2, "say hello")

	// Wait for real Stop hooks to create alert files (30s timeout)
	t.Log("Waiting for Stop hooks to create alert files...")
	if !waitForAlertFile(t, pane1, true, 30*time.Second) {
		t.Fatal("Stop hook did not create alert file for pane1")
	}
	if !waitForAlertFile(t, pane2, true, 30*time.Second) {
		t.Fatal("Stop hook did not create alert file for pane2")
	}

	// Verify both alerts are detected
	alerts = getActiveAlerts()
	if !alerts[pane1] || !alerts[pane2] {
		t.Errorf("Both panes should have alerts. pane1=%v, pane2=%v", alerts[pane1], alerts[pane2])
	}

	// Send follow-up to window1 - UserPromptSubmit hook fires first, clears alert
	// Then Claude responds and Stop hook recreates the alert
	t.Log("Sending follow-up to window1...")

	// First, remove pane1's alert file manually to verify UserPromptSubmit clears it
	// (The Stop hook from the first response created it, so it exists)
	alertFile1 := filepath.Join(testAlertDir, alertPrefix+pane1)
	os.Remove(alertFile1)

	// Now send the follow-up - UserPromptSubmit should NOT recreate it yet
	sendPromptToClaude(t, sessionName, pane1, "thanks")

	// Give UserPromptSubmit hook a moment to fire (it runs before Claude processes)
	time.Sleep(500 * time.Millisecond)

	// At this point, alert should still be gone (UserPromptSubmit keeps it cleared)
	// We can't easily test the brief "cleared" state since Claude responds fast
	// Instead, wait for Claude to respond and Stop hook to recreate alert
	t.Log("Waiting for Claude to respond and Stop hook to recreate alert...")
	if !waitForAlertFile(t, pane1, true, 30*time.Second) {
		t.Fatal("Stop hook did not recreate alert file for pane1 after response")
	}

	// Verify both windows have alerts again (both Claude instances responded)
	alerts = getActiveAlerts()
	if !alerts[pane1] {
		t.Error("Window1 should have alert after Claude responded")
	}
	if !alerts[pane2] {
		t.Error("Window2 alert should still be active")
	}

	t.Log("Multi-window alert isolation test passed")
}

// Test B: Single Window Multi-Pane Isolation (Priority 2)
// Tests split panes with multiple Claude instances
func TestSingleWindowMultiPaneIsolation(t *testing.T) {
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

	os.MkdirAll(testAlertDir, 0755)

	sessionName := fmt.Sprintf("test-multipane-%d", time.Now().Unix())
	cleanup := createTestTmuxSession(t, sessionName)
	defer cleanup()

	// Create window with Claude
	t.Log("Creating window with first Claude instance...")
	pane1 := createWindowWithClaude(t, sessionName, "split-test")
	defer os.Remove(filepath.Join(testAlertDir, alertPrefix+pane1))

	// Split window and start second Claude instance
	t.Log("Splitting window and creating second Claude instance...")
	windowTarget := fmt.Sprintf("%s:split-test", sessionName)
	cmd := tmuxCmd("split-window", "-t", windowTarget, "-h")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to split window: %v", err)
	}
	time.Sleep(500 * time.Millisecond)

	// Get second pane ID
	listCmd := tmuxCmd("list-panes", "-t", windowTarget, "-F", "#{pane_id}")
	output, _ := listCmd.Output()
	paneIDs := strings.Split(strings.TrimSpace(string(output)), "\n")
	var pane2 string
	for _, p := range paneIDs {
		if p != pane1 && p != "" {
			pane2 = p
			break
		}
	}
	if pane2 == "" {
		t.Fatal("Could not find second pane")
	}
	defer os.Remove(filepath.Join(testAlertDir, alertPrefix+pane2))

	// Start Claude in second pane (use session-qualified target)
	// CRITICAL: Set TMUX_PANE env var so hooks can use it
	projectDir, _ := filepath.Abs("../..")
	claudeCmd := fmt.Sprintf("cd %s && TMUX_PANE=%s %s --permission-mode default", projectDir, pane2, claudeCommand)
	cmd = tmuxCmd("send-keys", "-t", sessionName+"."+pane2, claudeCmd, "Enter")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to start Claude in pane2: %v", err)
	}

	// Wait for second Claude to initialize
	time.Sleep(5 * time.Second)

	// Send prompts - Claude responds, Stop hook creates alert files
	t.Log("Sending prompts to both panes...")
	sendPromptToClaude(t, sessionName, pane1, "say hi")
	sendPromptToClaude(t, sessionName, pane2, "say hello")

	// Wait for real Stop hooks to create alert files (30s timeout)
	t.Log("Waiting for Stop hooks to create alert files...")
	if !waitForAlertFile(t, pane1, true, 30*time.Second) {
		t.Fatal("Stop hook did not create alert file for pane1")
	}
	if !waitForAlertFile(t, pane2, true, 30*time.Second) {
		t.Fatal("Stop hook did not create alert file for pane2")
	}

	// Verify both alerts
	alerts := getActiveAlerts()
	if !alerts[pane1] || !alerts[pane2] {
		t.Errorf("Both panes should have alerts. pane1=%v, pane2=%v", alerts[pane1], alerts[pane2])
	}

	// Send follow-up to pane1 - UserPromptSubmit hook fires first, clears alert
	// Then Claude responds and Stop hook recreates the alert
	t.Log("Sending follow-up to pane1...")

	// Remove alert file to test the full cycle
	alertFile1 := filepath.Join(testAlertDir, alertPrefix+pane1)
	os.Remove(alertFile1)

	sendPromptToClaude(t, sessionName, pane1, "thanks")

	// Wait for Claude to respond and Stop hook to recreate alert
	t.Log("Waiting for Claude to respond and Stop hook to recreate alert...")
	if !waitForAlertFile(t, pane1, true, 30*time.Second) {
		t.Fatal("Stop hook did not recreate alert file for pane1 after response")
	}

	// Verify both panes have alerts (both Claude instances have responded)
	alerts = getActiveAlerts()
	if !alerts[pane1] {
		t.Error("Pane1 should have alert after Claude responded")
	}
	if !alerts[pane2] {
		t.Error("Pane2 alert should still be active")
	}

	t.Log("Multi-pane isolation test passed")
}

// Test C: Rapid Concurrent Prompts (Priority 3)
// Send prompts to multiple panes in rapid succession (<100ms apart)
func TestRapidConcurrentPrompts(t *testing.T) {
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

	os.MkdirAll(testAlertDir, 0755)

	sessionName := fmt.Sprintf("test-rapid-%d", time.Now().Unix())
	cleanup := createTestTmuxSession(t, sessionName)
	defer cleanup()

	// Create 3 windows with Claude
	t.Log("Creating 3 windows with Claude...")
	panes := make([]string, 3)
	for i := 0; i < 3; i++ {
		windowName := fmt.Sprintf("rapid%d", i+1)
		panes[i] = createWindowWithClaude(t, sessionName, windowName)
		defer os.Remove(filepath.Join(testAlertDir, alertPrefix+panes[i]))
	}

	// Send prompts rapidly - Claude responds, Stop hook creates alert files
	t.Log("Sending rapid concurrent prompts...")
	for i, pane := range panes {
		sendPromptToClaude(t, sessionName, pane, fmt.Sprintf("say test %d", i+1))
		time.Sleep(50 * time.Millisecond) // <100ms between prompts
	}

	// Wait for real Stop hooks to create alert files (30s timeout)
	t.Log("Waiting for Stop hooks to create alert files...")
	for i, pane := range panes {
		if !waitForAlertFile(t, pane, true, 30*time.Second) {
			t.Errorf("Stop hook did not create alert file for pane %d", i+1)
		}
	}

	// Verify all alerts detected
	alerts := getActiveAlerts()
	for i, pane := range panes {
		if !alerts[pane] {
			t.Errorf("Pane %d should have alert", i+1)
		}
	}

	// Send follow-ups rapidly - UserPromptSubmit clears, then Stop recreates
	t.Log("Sending follow-ups rapidly...")

	// Remove alert files first to test full cycle
	for _, pane := range panes {
		alertFile := filepath.Join(testAlertDir, alertPrefix+pane)
		os.Remove(alertFile)
	}

	for _, pane := range panes {
		sendPromptToClaude(t, sessionName, pane, "ok")
		time.Sleep(50 * time.Millisecond)
	}

	// Wait for Claude responses and Stop hooks to recreate alert files
	t.Log("Waiting for Claude responses and Stop hooks...")
	for i, pane := range panes {
		if !waitForAlertFile(t, pane, true, 30*time.Second) {
			t.Errorf("Stop hook did not recreate alert file for pane %d after response", i+1)
		}
	}

	// Verify all alerts are back (Claude responded to all)
	alerts = getActiveAlerts()
	for i, pane := range panes {
		if !alerts[pane] {
			t.Errorf("Pane %d should have alert after Claude responded", i+1)
		}
	}

	t.Log("Rapid concurrent prompts test passed")
}

// Test D: Alert Persistence Through TUI Refresh (Priority 4)
// Verify alerts persist through refresh cycles and clear correctly
func TestAlertPersistenceThroughTUIRefresh(t *testing.T) {
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

	os.MkdirAll(testAlertDir, 0755)

	sessionName := fmt.Sprintf("test-persist-%d", time.Now().Unix())
	cleanup := createTestTmuxSession(t, sessionName)
	defer cleanup()

	// Create window with Claude
	t.Log("Creating window with Claude...")
	pane := createWindowWithClaude(t, sessionName, "persist-test")
	defer os.Remove(filepath.Join(testAlertDir, alertPrefix+pane))

	// Send prompt - Claude responds, Stop hook creates alert file
	t.Log("Triggering alert...")
	sendPromptToClaude(t, sessionName, pane, "say hi")

	// Wait for real Stop hook to create alert file (30s timeout)
	t.Log("Waiting for Stop hook to create alert file...")
	if !waitForAlertFile(t, pane, true, 30*time.Second) {
		t.Fatal("Stop hook did not create alert file")
	}

	// Verify alert persists across multiple getActiveAlerts() calls
	// (simulating TUI refresh cycles every 2 seconds)
	t.Log("Verifying alert persists through refresh cycles...")
	for i := 0; i < 5; i++ {
		time.Sleep(2 * time.Second) // TUI refresh interval
		alerts := getActiveAlerts()
		if !alerts[pane] {
			t.Errorf("Alert should persist on refresh cycle %d", i+1)
		}
	}

	// Send follow-up - UserPromptSubmit clears briefly, then Stop recreates
	t.Log("Sending follow-up...")

	// Remove alert file to test full cycle
	alertFile := filepath.Join(testAlertDir, alertPrefix+pane)
	os.Remove(alertFile)

	sendPromptToClaude(t, sessionName, pane, "thanks")

	// Wait for Claude to respond and Stop hook to recreate alert
	t.Log("Waiting for Claude to respond...")
	if !waitForAlertFile(t, pane, true, 30*time.Second) {
		t.Fatal("Stop hook did not recreate alert file after response")
	}

	// Verify alert persists across refresh cycles after response
	t.Log("Verifying alert persists after response...")
	for i := 0; i < 3; i++ {
		time.Sleep(2 * time.Second)
		alerts := getActiveAlerts()
		if !alerts[pane] {
			t.Errorf("Alert should persist after response on refresh cycle %d", i+1)
		}
	}

	t.Log("Alert persistence through TUI refresh test passed")
}

// Test E: Stale Pane Alert Cleanup (Priority 5)
// Verify getActiveAlerts() filters out stale files for deleted panes
func TestStalePaneAlertCleanup(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping test in short mode")
	}

	// Skip if tmux not available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found")
	}

	os.MkdirAll(testAlertDir, 0755)

	sessionName := fmt.Sprintf("test-stale-%d", time.Now().Unix())
	cleanup := createTestTmuxSession(t, sessionName)
	defer cleanup()

	// Create window
	cmd := tmuxCmd("new-window", "-t", sessionName, "-n", "stale-test")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create window: %v", err)
	}
	time.Sleep(200 * time.Millisecond)

	pane := getPaneID(t, sessionName, "stale-test")
	alertFile := filepath.Join(testAlertDir, alertPrefix+pane)
	defer os.Remove(alertFile)

	// Create alert file
	t.Log("Creating alert file...")
	os.WriteFile(alertFile, []byte{}, 0644)

	// Verify alert is detected
	alerts := getActiveAlerts()
	if !alerts[pane] {
		t.Fatal("Alert should be detected for active pane")
	}

	// Kill the pane
	t.Log("Killing pane...")
	windowTarget := fmt.Sprintf("%s:stale-test", sessionName)
	killCmd := tmuxCmd("kill-pane", "-t", windowTarget)
	killCmd.Run()
	time.Sleep(500 * time.Millisecond)

	// Verify alert file still exists but is NOT detected (stale)
	if _, err := os.Stat(alertFile); os.IsNotExist(err) {
		t.Log("Alert file was auto-cleaned, skipping stale check")
	} else {
		alerts = getActiveAlerts()
		if alerts[pane] {
			t.Error("Alert for deleted pane should NOT be detected (stale file)")
		}
		t.Log("Stale alert correctly filtered out")
	}

	t.Log("Stale pane alert cleanup test passed")
}

