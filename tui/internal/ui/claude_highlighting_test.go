package ui

import (
	"strings"
	"testing"

	"github.com/natb1/tui/internal/status"
	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
	"github.com/stretchr/testify/require"
)

func TestClaudeOrangeHighlighting(t *testing.T) {
	// Create navigation list component
	navList := NewNavigationListComponent()

	// Create test project
	project := &model.Project{
		Name:       "test-project",
		Path:       "/test/project",
		KeyBinding: 't',
	}

	// Create Claude pane
	claudePane := &terminal.TmuxPane{
		SessionName:    "test-session",
		WindowIndex:    0,
		PaneIndex:      0,
		ShellType:      model.ShellTypeClaude,
		PaneTitle:      "Claude Shell",
		CurrentCommand: "node",
		CurrentPath:    "/test/project",
		Project:        project,
	}

	// Create pane map
	panes := map[string]*terminal.TmuxPane{
		"test-session:0.0": claudePane,
	}

	// Build list items WITHOUT Claude status (should see warning)
	items := BuildListItems([]*model.Project{project}, navList.GetKeyBindingManager(), panes, nil)

	// Should have project + Claude pane
	require.Len(t, items, 2)

	// Check Claude pane item (without status manager, it won't be highlighted)
	claudeItem := items[1].(ListItem)
	require.Contains(t, claudeItem.title, "🤖 Claude")
	require.NotContains(t, claudeItem.title, "\x1b[38;5;208m", "Should not be highlighted without status manager")

	// Now test WITH Claude status manager
	claudeStatus := status.NewClaudeStatusManager()

	// Build list items with Claude status
	items = BuildListItems([]*model.Project{project}, navList.GetKeyBindingManager(), panes, claudeStatus)

	// Should have project + Claude pane
	require.Len(t, items, 2)

	// Check Claude pane item (should be highlighted by default)
	claudeItem = items[1].(ListItem)
	require.Contains(t, claudeItem.title, "🤖 Claude")

	// Debug: print the actual title to see what we're getting
	t.Logf("Claude pane title: %q", claudeItem.title)
	t.Logf("Title bytes: %v", []byte(claudeItem.title))

	// The title should contain ANSI color code for orange (208)
	// In lipgloss, this becomes \x1b[38;5;208m
	hasOrangeHighlight := strings.Contains(claudeItem.title, "\x1b[38;5;208m") ||
		strings.Contains(claudeItem.title, "\033[38;5;208m") ||
		strings.Contains(claudeItem.title, "38;5;208")

	require.True(t, hasOrangeHighlight,
		"Claude pane should be orange highlighted by default when idle")
}

func TestClaudeHighlightingWithMultiplePanes(t *testing.T) {
	// Create navigation list component
	navList := NewNavigationListComponent()
	claudeStatus := status.NewClaudeStatusManager()

	// Create test project
	project := &model.Project{
		Name:       "test-project",
		Path:       "/test/project",
		KeyBinding: 't',
	}

	// Create multiple panes
	panes := map[string]*terminal.TmuxPane{
		"test-session:0.0": {
			SessionName:    "test-session",
			WindowIndex:    0,
			PaneIndex:      0,
			ShellType:      model.ShellTypeClaude,
			PaneTitle:      "Claude Shell 1",
			CurrentCommand: "node",
			CurrentPath:    "/test/project",
			Project:        project,
		},
		"test-session:0.1": {
			SessionName:    "test-session",
			WindowIndex:    0,
			PaneIndex:      1,
			ShellType:      model.ShellTypeZsh,
			PaneTitle:      "zsh",
			CurrentCommand: "zsh",
			CurrentPath:    "/test/project",
			Project:        project,
		},
		"test-session:0.2": {
			SessionName:    "test-session",
			WindowIndex:    0,
			PaneIndex:      2,
			ShellType:      model.ShellTypeClaude,
			PaneTitle:      "Claude Shell 2",
			CurrentCommand: "node",
			CurrentPath:    "/test/project",
			Project:        project,
		},
	}

	// Build list items
	items := BuildListItems([]*model.Project{project}, navList.GetKeyBindingManager(), panes, claudeStatus)

	// Should have project + 2 Claude panes (zsh with title "zsh" is filtered as boring)
	require.Len(t, items, 3)

	// Check each item
	projectItem := items[0].(ListItem)
	require.Equal(t, "[t]est-project", projectItem.title)

	// First Claude pane should be highlighted
	claude1Item := items[1].(ListItem)
	require.Contains(t, claude1Item.title, "🤖 Claude")
	require.True(t, strings.Contains(claude1Item.title, "\x1b[38;5;208m") ||
		strings.Contains(claude1Item.title, "\033[38;5;208m"),
		"First Claude pane should be orange highlighted")

	// Second Claude pane should also be highlighted (zsh was filtered out)
	claude2Item := items[2].(ListItem)
	require.Contains(t, claude2Item.title, "🤖 Claude")
	require.True(t, strings.Contains(claude2Item.title, "\x1b[38;5;208m") ||
		strings.Contains(claude2Item.title, "\033[38;5;208m"),
		"Second Claude pane should be orange highlighted")
}
