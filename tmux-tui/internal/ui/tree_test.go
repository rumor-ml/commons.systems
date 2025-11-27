package ui

import (
	"strings"
	"testing"

	"github.com/commons-systems/tmux-tui/internal/tmux"
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
	claudeAlerts := make(map[string]bool)
	output := renderer.Render(tree, claudeAlerts)

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
	claudeAlerts := make(map[string]bool)

	// Test with nil tree
	output := renderer.Render(nil, claudeAlerts)
	if !strings.Contains(output, "No panes found") {
		t.Error("Expected 'No panes found' message for nil tree")
	}

	// Test with empty tree
	emptyTree := make(tmux.RepoTree)
	output = renderer.Render(emptyTree, claudeAlerts)
	if !strings.Contains(output, "No panes found") {
		t.Error("Expected 'No panes found' message for empty tree")
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
	claudeAlerts := make(map[string]bool)
	output := renderer.Render(tree, claudeAlerts)

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
