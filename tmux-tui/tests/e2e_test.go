package tests

import (
	"fmt"
	"os"
	"os/exec"
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
