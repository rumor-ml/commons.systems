package ui

import (
	"os"
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
	"github.com/natb1/tui/internal/status"
	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
	"github.com/stretchr/testify/require"
)

func TestClaudeHighlightingWithForcedColor(t *testing.T) {
	// Force color output
	os.Setenv("CLICOLOR_FORCE", "1")
	defer os.Unsetenv("CLICOLOR_FORCE")

	// Also try setting the lipgloss color profile
	// lipgloss.SetColorProfile(lipgloss.TrueColor) // Not available in this version

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

	// Get the Claude pane item
	claudeItem := items[1].(ListItem)

	// Check if color codes are present
	t.Logf("Claude item title: %q", claudeItem.title)
	t.Logf("Title contains ANSI codes: %v", strings.Contains(claudeItem.title, "\x1b["))

	// Test orange style directly with forced color
	orangeStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("208"))
	testText := "TEST"
	styledText := orangeStyle.Render(testText)

	t.Logf("Orange styled text: %q", styledText)
	t.Logf("Contains ANSI: %v", strings.Contains(styledText, "\x1b["))

	// At minimum, verify the logic is correct
	shouldHighlight := claudeStatus.ShouldHighlightByType("test-session:0.0", string(model.ShellTypeClaude))
	require.True(t, shouldHighlight, "Claude pane should be marked for highlighting")

	// Verify the Claude icon is present
	require.Contains(t, claudeItem.title, "🤖 Claude", "Should contain Claude icon")
}

func TestClaudeHighlightingLogicFlow(t *testing.T) {
	// This test verifies the logic flow without depending on ANSI codes

	// Create Claude status manager
	claudeStatus := status.NewClaudeStatusManager()

	// Test 1: Claude pane type should be highlighted by default
	shouldHighlight := claudeStatus.ShouldHighlightByType("test-pane-1", "claude")
	require.True(t, shouldHighlight, "Claude panes should be highlighted by default (inactive)")

	// Test 2: Non-Claude pane should not be highlighted
	shouldHighlight = claudeStatus.ShouldHighlightByType("test-pane-2", "zsh")
	require.False(t, shouldHighlight, "Non-Claude panes should not be highlighted")

	// Test 3: After updating Claude panes, they should still be highlighted
	panes := map[string]*terminal.TmuxPane{
		"test-pane-1": {
			ShellType: model.ShellTypeClaude,
		},
		"test-pane-2": {
			ShellType: model.ShellTypeZsh,
		},
	}

	claudeStatus.UpdateClaudePanes(panes)

	// Claude pane should still be highlighted
	shouldHighlight = claudeStatus.ShouldHighlightByType("test-pane-1", "claude")
	require.True(t, shouldHighlight, "Claude pane should remain highlighted after update")

	// Zsh pane should still not be highlighted
	shouldHighlight = claudeStatus.ShouldHighlightByType("test-pane-2", "zsh")
	require.False(t, shouldHighlight, "Zsh pane should still not be highlighted")
}
