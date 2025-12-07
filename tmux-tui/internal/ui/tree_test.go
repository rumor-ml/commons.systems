package ui

import (
	"strings"
	"testing"

	"github.com/commons-systems/tmux-tui/internal/tmux"
	"github.com/commons-systems/tmux-tui/internal/watcher"
)

func TestTreeRenderer(t *testing.T) {
	// Create a sample tree with flattened structure
	tree := tmux.RepoTree{
		"commons.systems": {
			"tmux-tui": []tmux.Pane{
				{ID: "%129", Path: "/path/to/pane", WindowID: "@65", WindowIndex: 0, WindowActive: false, Command: "zsh"},
				{ID: "%43", Path: "/path/to/pane", WindowID: "@29", WindowIndex: 1, WindowActive: false, Command: "nvim"},
				{ID: "%118", Path: "/path/to/pane", WindowID: "@40", WindowIndex: 2, WindowActive: false, Command: "zsh"},
				{ID: "%137", Path: "/path/to/pane", WindowID: "@40", WindowIndex: 3, WindowActive: true, Command: "tmux-tui"},
			},
		},
	}

	renderer := NewTreeRenderer(80)
	claudeAlerts := make(map[string]string)
	blockedPanes := make(map[string]string)
	output := renderer.Render(tree, claudeAlerts, blockedPanes)

	// Verify output contains expected elements
	expectedElements := []string{
		"commons.systems",
		"tmux-tui",
		"0:zsh",
		"1:nvim",
		"2:zsh",
		"3:tmux-tui",
		"├──",
		"└──",
	}

	for _, element := range expectedElements {
		if !strings.Contains(output, element) {
			t.Errorf("Output missing expected element: %s\nActual output:\n%s", element, output)
		}
	}

	// Verify no borders
	borderChars := []string{"╭", "╮", "╰", "╯"}
	for _, char := range borderChars {
		if strings.Contains(output, char) {
			t.Errorf("Output contains border character: %s (should have no borders)", char)
		}
	}
}

func TestTreeRendererEmpty(t *testing.T) {
	renderer := NewTreeRenderer(80)
	claudeAlerts := make(map[string]string)
	blockedPanes := make(map[string]string)

	// Test with nil tree
	output := renderer.Render(nil, claudeAlerts, blockedPanes)
	if !strings.Contains(output, "No panes found") {
		t.Error("Expected 'No panes found' message for nil tree")
	}

	// Test with empty tree
	emptyTree := make(tmux.RepoTree)
	output = renderer.Render(emptyTree, claudeAlerts, blockedPanes)
	if !strings.Contains(output, "No panes found") {
		t.Error("Expected 'No panes found' message for empty tree")
	}
}

func TestIconForAlertType(t *testing.T) {
	// Test that each event type returns the correct icon
	testCases := []struct {
		name          string
		eventType     string
		expectedIcon  string
	}{
		{"Stop event", watcher.EventTypeStop, StopIcon},
		{"Permission event", watcher.EventTypePermission, PermissionIcon},
		{"Idle event", watcher.EventTypeIdle, IdleIcon},
		{"Elicitation event", watcher.EventTypeElicitation, ElicitationIcon},
		{"Unknown event defaults to stop", "unknown_type", StopIcon},
		{"Empty string defaults to stop", "", StopIcon},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			icon := iconForAlertType(tc.eventType)
			if icon != tc.expectedIcon {
				t.Errorf("iconForAlertType(%q) = %q, want %q", tc.eventType, icon, tc.expectedIcon)
			}
		})
	}
}

func TestIconForAlertTypeIntegration(t *testing.T) {
	// Test that icons are correctly applied in the tree renderer
	tree := tmux.RepoTree{
		"test-repo": {
			"main": []tmux.Pane{
				{ID: "%1", WindowID: "@1", WindowIndex: 0, WindowActive: false, Command: "zsh", IsClaudePane: true},
				{ID: "%2", WindowID: "@2", WindowIndex: 1, WindowActive: false, Command: "nvim", IsClaudePane: true},
				{ID: "%3", WindowID: "@3", WindowIndex: 2, WindowActive: false, Command: "vim", IsClaudePane: true},
				{ID: "%4", WindowID: "@4", WindowIndex: 3, WindowActive: false, Command: "emacs", IsClaudePane: true},
			},
		},
	}

	// Create alerts with different event types
	claudeAlerts := map[string]string{
		"%1": watcher.EventTypeStop,
		"%2": watcher.EventTypePermission,
		"%3": watcher.EventTypeIdle,
		"%4": watcher.EventTypeElicitation,
	}

	renderer := NewTreeRenderer(80)
	blockedPanes := make(map[string]string)
	output := renderer.Render(tree, claudeAlerts, blockedPanes)

	// Verify that output contains the styled window numbers with icons
	// The exact ANSI codes may vary, but we can check that the icons appear
	// Note: This is a basic check - full styling validation would require ANSI parsing
	expectedIcons := []string{StopIcon, PermissionIcon, IdleIcon, ElicitationIcon}
	for _, icon := range expectedIcons {
		if !strings.Contains(output, icon) {
			t.Errorf("Output should contain icon %q for alert type", icon)
		}
	}
}

func TestTreeRendererFullHeight(t *testing.T) {
	// Create a small tree
	tree := tmux.RepoTree{
		"commons.systems": {
			"tmux-tui": []tmux.Pane{
				{ID: "%129", Path: "/path/to/pane", WindowID: "@65", WindowIndex: 0, WindowActive: false, Command: "zsh"},
				{ID: "%43", Path: "/path/to/pane", WindowID: "@29", WindowIndex: 1, WindowActive: false, Command: "nvim"},
			},
		},
	}

	renderer := NewTreeRenderer(80)
	renderer.SetHeight(20)
	claudeAlerts := make(map[string]string)
	blockedPanes := make(map[string]string)
	output := renderer.Render(tree, claudeAlerts, blockedPanes)

	// Count the number of lines
	lines := strings.Split(output, "\n")
	if len(lines) != 20 {
		t.Errorf("Expected 20 lines (including padding), got %d", len(lines))
	}

	// Verify content lines are present (should be 4: repo + branch + 2 panes)
	// commons.systems
	// └── tmux-tui
	//     ├── 0:zsh
	//     └── 1:nvim
	// ... plus 16 blank lines
	contentLines := 0
	for _, line := range lines {
		if line != "" {
			contentLines++
		}
	}
	if contentLines != 4 {
		t.Errorf("Expected 4 content lines, got %d", contentLines)
	}
}
