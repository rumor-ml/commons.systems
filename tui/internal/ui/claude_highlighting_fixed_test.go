package ui

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
	"github.com/natb1/tui/internal/status"
	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
	"github.com/stretchr/testify/require"
)

func TestClaudeHighlightingWithProperLipgloss(t *testing.T) {
	// Test that Claude highlighting works after setting color profile

	// Set color profile as done in NewNavigationListComponent
	lipgloss.SetColorProfile(termenv.TrueColor)

	// Create test data
	keyMgr := model.NewKeyBindingManager()

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

	t.Logf("Claude item title: %q", claudeItem.title)

	// Check for ANSI color codes
	hasOrangeColor := strings.Contains(claudeItem.title, "\x1b[38;5;208m")
	hasResetCode := strings.Contains(claudeItem.title, "\x1b[0m")

	t.Logf("Has orange color code: %v", hasOrangeColor)
	t.Logf("Has reset code: %v", hasResetCode)

	// Verify Claude highlighting works with proper lipgloss setup
	require.True(t, hasOrangeColor, "Claude pane should have orange color code")
	require.True(t, hasResetCode, "Claude pane should have reset code")
	require.Contains(t, claudeItem.title, "🤖 Claude", "Should contain Claude icon")

	// Verify the expected structure
	t.Log("SUCCESS: Claude highlighting works with SetColorProfile(TrueColor)!")
}

func TestClaudeHighlightingComparison(t *testing.T) {
	// Compare the old approach (raw ANSI) vs new approach (proper lipgloss)

	testTitle := "│ 🤖 Claude: Idle Shell"

	// Old approach: Raw ANSI
	rawHighlighted := "\x1b[38;5;208m" + testTitle + "\x1b[0m"

	// New approach: Lipgloss with color profile
	lipgloss.SetColorProfile(termenv.TrueColor)
	orangeStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("208"))
	lipglossHighlighted := orangeStyle.Render(testTitle)

	t.Logf("Raw ANSI: %q", rawHighlighted)
	t.Logf("Lipgloss: %q", lipglossHighlighted)

	// Both should produce ANSI color codes
	require.True(t, strings.Contains(rawHighlighted, "\x1b[38;5;208m"), "Raw ANSI should have color")
	require.True(t, strings.Contains(lipglossHighlighted, "\x1b[38;5;208m"), "Lipgloss should have color")

	// Both should have the same color output
	require.Equal(t, rawHighlighted, lipglossHighlighted, "Both approaches should produce identical output")

	t.Log("SUCCESS: Both raw ANSI and proper lipgloss produce identical results!")
}
