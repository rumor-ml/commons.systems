package terminal

import (
	"context"
	"testing"

	"github.com/natb1/tui/pkg/model"
	"github.com/stretchr/testify/assert"
)

// TestTmuxPaneDiscoveryFlow tests the complete pane discovery flow
func TestTmuxPaneDiscoveryFlow(t *testing.T) {
	// Test works correctly whether tmux is available or not
	// Create tmux manager
	ctx := context.Background()
	tm := NewTmuxManager(ctx)
	defer tm.Cleanup()

	// Test that DiscoverAllPanes runs without error (even if no tmux)
	err := tm.DiscoverAllPanes()
	assert.NoError(t, err, "DiscoverAllPanes should not error even without tmux")

	// Test that GetAllPanes returns a map (may be empty or populated depending on environment)
	panes := tm.GetAllPanes()
	assert.NotNil(t, panes, "GetAllPanes should return non-nil map")
	// Note: May contain panes if tmux is available with existing sessions
}

// TestTmuxPaneCreation tests TmuxPane creation and methods
func TestTmuxPaneCreation(t *testing.T) {
	// Test NewTmuxPane
	pane := NewTmuxPane("test-session", 0, 1)
	assert.Equal(t, "test-session", pane.SessionName)
	assert.Equal(t, 0, pane.WindowIndex)
	assert.Equal(t, 1, pane.PaneIndex)
	assert.Equal(t, model.ShellTypeUnknown, pane.ShellType)

	// Test GetTmuxTarget
	target := pane.GetTmuxTarget()
	assert.Equal(t, "test-session:0.1", target)
}

// TestTmuxPaneShellTypeDetection tests shell type detection logic
func TestTmuxPaneShellTypeDetection(t *testing.T) {
	tests := []struct {
		name           string
		paneTitle      string
		currentCommand string
		expectedType   model.ShellType
	}{
		{
			name:           "Claude with star",
			paneTitle:      "✳ Building Project",
			currentCommand: "node",
			expectedType:   model.ShellTypeClaude,
		},
		{
			name:           "Claude with multi-word title",
			paneTitle:      "Model Testing",
			currentCommand: "node",
			expectedType:   model.ShellTypeClaude,
		},
		{
			name:           "Zsh shell",
			paneTitle:      "terminal",
			currentCommand: "zsh",
			expectedType:   model.ShellTypeZsh,
		},
		{
			name:           "Claude command",
			paneTitle:      "session",
			currentCommand: "claude",
			expectedType:   model.ShellTypeClaude,
		},
		{
			name:           "Node with meaningful title",
			paneTitle:      "Development Server",
			currentCommand: "node",
			expectedType:   model.ShellTypeClaude,
		},
		{
			name:           "Unknown shell",
			paneTitle:      "bash-session",
			currentCommand: "bash",
			expectedType:   model.ShellTypeUnknown,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pane := NewTmuxPane("session", 0, 0)
			pane.PaneTitle = tt.paneTitle
			pane.CurrentCommand = tt.currentCommand

			pane.DetectShellType()

			assert.Equal(t, tt.expectedType, pane.ShellType,
				"Shell type detection failed for %s with title '%s' and command '%s'",
				tt.name, tt.paneTitle, tt.currentCommand)
		})
	}
}

// TestTmuxPaneDisplayTitle tests GetDisplayTitle priority logic
func TestTmuxPaneDisplayTitle(t *testing.T) {
	tests := []struct {
		name           string
		paneTitle      string
		lastCommand    string
		currentCommand string
		shellType      model.ShellType
		expected       string
	}{
		{
			name:           "Interesting pane title takes priority",
			paneTitle:      "✳ Building Project",
			lastCommand:    "git status",
			currentCommand: "node",
			shellType:      model.ShellTypeClaude,
			expected:       "✳ Building Project",
		},
		{
			name:           "Boring pane title falls back to last command for zsh",
			paneTitle:      "nathans-macbook.local",
			lastCommand:    "git status",
			currentCommand: "zsh",
			shellType:      model.ShellTypeZsh,
			expected:       "git status",
		},
		{
			name:           "No last command falls back to current command",
			paneTitle:      "boring.local",
			lastCommand:    "",
			currentCommand: "vim",
			shellType:      model.ShellTypeUnknown,
			expected:       "vim",
		},
		{
			name:           "All boring falls back to shell type",
			paneTitle:      "host.local",
			lastCommand:    "zsh",
			currentCommand: "zsh",
			shellType:      model.ShellTypeZsh,
			expected:       "zsh",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pane := NewTmuxPane("session", 0, 0)
			pane.PaneTitle = tt.paneTitle
			pane.LastCommand = tt.lastCommand
			pane.CurrentCommand = tt.currentCommand
			pane.ShellType = tt.shellType

			result := pane.GetDisplayTitle()
			assert.Equal(t, tt.expected, result)
		})
	}
}

// TestTmuxManagerPaneStorage tests pane storage and retrieval
func TestTmuxManagerPaneStorage(t *testing.T) {
	ctx := context.Background()
	tm := NewTmuxManager(ctx)
	defer tm.Cleanup()

	// Create test panes
	pane1 := NewTmuxPane("session1", 0, 0)
	pane1.PaneTitle = "Test Pane 1"

	pane2 := NewTmuxPane("session1", 0, 1)
	pane2.PaneTitle = "Test Pane 2"

	// Manually add panes to test storage
	tm.panes[pane1.GetTmuxTarget()] = pane1
	tm.panes[pane2.GetTmuxTarget()] = pane2

	// Test GetAllPanes
	allPanes := tm.GetAllPanes()
	assert.Len(t, allPanes, 2, "Should have 2 panes")
	assert.Contains(t, allPanes, "session1:0.0")
	assert.Contains(t, allPanes, "session1:0.1")

	// Verify pane data
	assert.Equal(t, "Test Pane 1", allPanes["session1:0.0"].PaneTitle)
	assert.Equal(t, "Test Pane 2", allPanes["session1:0.1"].PaneTitle)
}
