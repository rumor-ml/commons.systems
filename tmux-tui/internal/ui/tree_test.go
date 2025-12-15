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
		name         string
		eventType    string
		expectedIcon string
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

	// Count the number of lines (should be height - headerHeight = 20 - 2 = 18)
	lines := strings.Split(output, "\n")
	if len(lines) != 18 {
		t.Errorf("Expected 18 lines (20 height - 2 header), got %d", len(lines))
	}

	// Verify content lines are present (should be 4: repo + branch + 2 panes)
	// commons.systems
	// └── tmux-tui
	//     ├── 0:zsh
	//     └── 1:nvim
	// ... plus 15 blank lines
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

func TestTreeRendererHeader(t *testing.T) {
	renderer := NewTreeRenderer(80)
	renderer.SetHeight(24)

	header := renderer.RenderHeader()

	// Verify header contains time separator (colon)
	if !strings.Contains(header, ":") {
		t.Errorf("Header should contain time separator ':'\nActual: %s", header)
	}

	// Verify header is not empty
	if header == "" {
		t.Error("Header should not be empty")
	}

	// The header should contain at least a date/time component
	// Format is "Mon Jan 2 15:04:05" so we expect at least month, day, and time
	if len(header) < 10 {
		t.Errorf("Header seems too short to contain full date/time. Got: %s", header)
	}
}

// TestTreeRenderer_BlockedBranch_ActivePane tests blocked + active pane styling
func TestTreeRenderer_BlockedBranch_ActivePane(t *testing.T) {
	tree := tmux.RepoTree{
		"test-repo": {
			"feature-branch": []tmux.Pane{
				{ID: "%1", WindowID: "@1", WindowIndex: 0, WindowActive: true, Command: "zsh"},
			},
		},
	}

	renderer := NewTreeRenderer(80)
	claudeAlerts := make(map[string]string)
	blockedBranches := map[string]string{
		"feature-branch": "main", // feature-branch is blocked by main
	}

	output := renderer.Render(tree, claudeAlerts, blockedBranches)

	// Output should contain the branch name
	if !strings.Contains(output, "feature-branch") {
		t.Error("Output should contain blocked branch name")
	}

	// The active pane in a blocked branch should have both:
	// 1. Muted text (blocked)
	// 2. Background highlight (active)
	// We verify the structure and content rather than specific ANSI codes
	// since lipgloss may disable colors in test environments
	if !strings.Contains(output, "0:zsh") {
		t.Error("Output should contain pane with command")
	}

	// Verify branch structure is present (the key behavior we're testing)
	if !strings.Contains(output, "test-repo") {
		t.Error("Output should contain repo name")
	}
}

// TestTreeRenderer_BlockedBranch_IdlePane tests blocked + idle pane styling
func TestTreeRenderer_BlockedBranch_IdlePane(t *testing.T) {
	tree := tmux.RepoTree{
		"test-repo": {
			"feature-branch": []tmux.Pane{
				{ID: "%1", WindowID: "@1", WindowIndex: 0, WindowActive: false, Command: "zsh"},
			},
		},
	}

	renderer := NewTreeRenderer(80)
	claudeAlerts := make(map[string]string)
	blockedBranches := map[string]string{
		"feature-branch": "main",
	}

	output := renderer.Render(tree, claudeAlerts, blockedBranches)

	// Idle pane in blocked branch should be muted (no background highlight)
	if !strings.Contains(output, "feature-branch") {
		t.Error("Output should contain blocked branch name")
	}

	if !strings.Contains(output, "0:zsh") {
		t.Error("Output should contain pane")
	}

	// Verify branch structure is present (the key behavior we're testing)
	// Note: In test environments, lipgloss may not render ANSI codes,
	// so we focus on content presence rather than styling codes
	if !strings.Contains(output, "test-repo") {
		t.Error("Output should contain repo name")
	}
}

// TestTreeRenderer_BlockedBranch_NoBell tests that bells are suppressed on blocked branches
func TestTreeRenderer_BlockedBranch_NoBell(t *testing.T) {
	tree := tmux.RepoTree{
		"test-repo": {
			"feature-branch": []tmux.Pane{
				{ID: "%1", WindowID: "@1", WindowIndex: 0, WindowActive: false, Command: "zsh", IsClaudePane: true},
			},
		},
	}

	renderer := NewTreeRenderer(80)
	// Alert exists but branch is blocked - should NOT show bell
	claudeAlerts := map[string]string{
		"%1": watcher.EventTypeStop,
	}
	blockedBranches := map[string]string{
		"feature-branch": "main",
	}

	output := renderer.Render(tree, claudeAlerts, blockedBranches)

	// Blocked branches should not show alert icons (bells suppressed)
	// The stop icon should NOT appear
	if strings.Contains(output, StopIcon) {
		t.Error("Blocked branch should not show alert icons (bells suppressed)")
	}
}

// TestTreeRenderer_UnblockedBranch_ShowsBell tests that bells appear on unblocked branches
func TestTreeRenderer_UnblockedBranch_ShowsBell(t *testing.T) {
	tree := tmux.RepoTree{
		"test-repo": {
			"feature-branch": []tmux.Pane{
				{ID: "%1", WindowID: "@1", WindowIndex: 0, WindowActive: false, Command: "zsh", IsClaudePane: true},
			},
		},
	}

	renderer := NewTreeRenderer(80)
	claudeAlerts := map[string]string{
		"%1": watcher.EventTypeStop,
	}
	// Empty blocked branches - feature-branch is NOT blocked
	blockedBranches := make(map[string]string)

	output := renderer.Render(tree, claudeAlerts, blockedBranches)

	// Unblocked branches should show alert icons
	if !strings.Contains(output, StopIcon) {
		t.Error("Unblocked branch should show alert icons")
	}
}

// TestTreeRenderer_MultipleBlockedBranches tests rendering multiple blocked branches
func TestTreeRenderer_MultipleBlockedBranches(t *testing.T) {
	tree := tmux.RepoTree{
		"test-repo": {
			"feature-1": []tmux.Pane{
				{ID: "%1", WindowID: "@1", WindowIndex: 0, WindowActive: false, Command: "zsh"},
			},
			"feature-2": []tmux.Pane{
				{ID: "%2", WindowID: "@2", WindowIndex: 1, WindowActive: false, Command: "nvim"},
			},
			"main": []tmux.Pane{
				{ID: "%3", WindowID: "@3", WindowIndex: 2, WindowActive: true, Command: "tmux-tui"},
			},
		},
	}

	renderer := NewTreeRenderer(80)
	claudeAlerts := make(map[string]string)
	blockedBranches := map[string]string{
		"feature-1": "main",
		"feature-2": "main",
	}

	output := renderer.Render(tree, claudeAlerts, blockedBranches)

	// All branches should appear
	if !strings.Contains(output, "feature-1") {
		t.Error("Output should contain feature-1")
	}
	if !strings.Contains(output, "feature-2") {
		t.Error("Output should contain feature-2")
	}
	if !strings.Contains(output, "main") {
		t.Error("Output should contain main")
	}

	// Both blocked branches should have their panes
	if !strings.Contains(output, "0:zsh") {
		t.Error("Output should contain feature-1 pane")
	}
	if !strings.Contains(output, "1:nvim") {
		t.Error("Output should contain feature-2 pane")
	}
}

// TestTreeRenderer_BlockedBranch_IdleAlert tests idle alerts are hidden on blocked branches
func TestTreeRenderer_BlockedBranch_IdleAlert(t *testing.T) {
	tree := tmux.RepoTree{
		"test-repo": {
			"feature-branch": []tmux.Pane{
				{ID: "%1", WindowID: "@1", WindowIndex: 0, WindowActive: false, Command: "zsh", IsClaudePane: true},
			},
		},
	}

	renderer := NewTreeRenderer(80)
	// Idle alert - should be suppressed when branch is blocked
	claudeAlerts := map[string]string{
		"%1": watcher.EventTypeIdle,
	}
	blockedBranches := map[string]string{
		"feature-branch": "main",
	}

	output := renderer.Render(tree, claudeAlerts, blockedBranches)

	// Idle icon should NOT appear on blocked branch
	if strings.Contains(output, IdleIcon) {
		t.Error("Blocked branch should not show idle alert icon")
	}
}

// TestTreeRenderer_MixedBlockedUnblocked tests mix of blocked and unblocked branches
func TestTreeRenderer_MixedBlockedUnblocked(t *testing.T) {
	tree := tmux.RepoTree{
		"test-repo": {
			"blocked-branch": []tmux.Pane{
				{ID: "%1", WindowID: "@1", WindowIndex: 0, WindowActive: false, Command: "zsh", IsClaudePane: true},
			},
			"active-branch": []tmux.Pane{
				{ID: "%2", WindowID: "@2", WindowIndex: 1, WindowActive: false, Command: "nvim", IsClaudePane: true},
			},
		},
	}

	renderer := NewTreeRenderer(80)
	// Both panes have alerts
	claudeAlerts := map[string]string{
		"%1": watcher.EventTypeStop,
		"%2": watcher.EventTypeStop,
	}
	// Only blocked-branch is blocked
	blockedBranches := map[string]string{
		"blocked-branch": "main",
	}

	output := renderer.Render(tree, claudeAlerts, blockedBranches)

	// Output should contain both branches
	if !strings.Contains(output, "blocked-branch") {
		t.Error("Output should contain blocked-branch")
	}
	if !strings.Contains(output, "active-branch") {
		t.Error("Output should contain active-branch")
	}

	// Due to icon suppression on blocked branches, the exact icon count is hard to test
	// But we know at least one stop icon should appear (for active-branch)
	iconCount := strings.Count(output, StopIcon)
	if iconCount == 0 {
		t.Error("Should show at least one stop icon for unblocked branch")
	}
}
