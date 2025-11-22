package ui

import (
	"strings"
	"testing"

	"github.com/natb1/tui/internal/status"
	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
	"github.com/stretchr/testify/require"
)

func TestRawANSICodesInClaudeHighlighting(t *testing.T) {
	// Create a key binding manager
	keyMgr := model.NewKeyBindingManager()

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

	panes := map[string]*terminal.TmuxPane{
		"test-session:0.0": claudePane,
	}

	// Create Claude status manager
	claudeStatus := status.NewClaudeStatusManager()

	// Build list items
	items := BuildListItems([]*model.Project{project}, keyMgr, panes, claudeStatus)

	// Get the Claude pane item (should be the second item)
	claudeItem := items[1].(ListItem)

	// Verify raw ANSI codes are present
	t.Logf("Claude item title: %q", claudeItem.title)

	// Check for raw ANSI escape codes
	require.Contains(t, claudeItem.title, "\x1b[38;5;208m", "Should contain raw ANSI orange color code")
	require.Contains(t, claudeItem.title, "\x1b[0m", "Should contain raw ANSI reset code")
	require.Contains(t, claudeItem.title, "🤖 Claude", "Should contain Claude icon and text")

	// Verify the complete expected format - the entire line is highlighted
	expectedTitle := "\x1b[38;5;208m    🤖 Claude\x1b[0m"
	require.Equal(t, expectedTitle, claudeItem.title, "Claude pane title should match expected format with raw ANSI codes")
}

func TestRawANSICodesWithDisplayInfo(t *testing.T) {
	// Create a key binding manager
	keyMgr := model.NewKeyBindingManager()

	// Create test project
	project := &model.Project{
		Name:       "test-project",
		Path:       "/test/project",
		KeyBinding: 't',
	}

	// Create Claude pane with display info
	claudePane := &terminal.TmuxPane{
		SessionName:    "test-session",
		WindowIndex:    0,
		PaneIndex:      0,
		ShellType:      model.ShellTypeClaude,
		PaneTitle:      "Running command...",
		CurrentCommand: "node",
		CurrentPath:    "/test/project",
		Project:        project,
	}

	panes := map[string]*terminal.TmuxPane{
		"test-session:0.0": claudePane,
	}

	// Create Claude status manager
	claudeStatus := status.NewClaudeStatusManager()

	// Build list items
	items := BuildListItems([]*model.Project{project}, keyMgr, panes, claudeStatus)

	// Get the Claude pane item
	claudeItem := items[1].(ListItem)

	// Verify the entire line is wrapped in ANSI codes when display info is present
	t.Logf("Claude item with info: %q", claudeItem.title)

	// Should contain the full highlighted line with display info
	require.True(t, strings.HasPrefix(claudeItem.title, "\x1b[38;5;208m"), "Should start with orange ANSI code")
	require.True(t, strings.HasSuffix(claudeItem.title, "\x1b[0m"), "Should end with reset ANSI code")
	require.Contains(t, claudeItem.title, "🤖 Running command...", "Should contain Claude icon and display info")
}
