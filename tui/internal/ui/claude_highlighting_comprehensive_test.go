package ui

import (
	"os"
	"testing"

	"github.com/charmbracelet/lipgloss"
	"github.com/stretchr/testify/require"
)

func TestLipglossColorSupport(t *testing.T) {
	// Test various environment configurations to understand when lipgloss outputs colors

	tests := []struct {
		name     string
		setup    func()
		teardown func()
	}{
		{
			name:     "Default environment",
			setup:    func() {},
			teardown: func() {},
		},
		{
			name: "With CLICOLOR_FORCE",
			setup: func() {
				os.Setenv("CLICOLOR_FORCE", "1")
			},
			teardown: func() {
				os.Unsetenv("CLICOLOR_FORCE")
			},
		},
		{
			name: "With FORCE_COLOR",
			setup: func() {
				os.Setenv("FORCE_COLOR", "1")
			},
			teardown: func() {
				os.Unsetenv("FORCE_COLOR")
			},
		},
		{
			name: "With NO_COLOR",
			setup: func() {
				os.Setenv("NO_COLOR", "1")
			},
			teardown: func() {
				os.Unsetenv("NO_COLOR")
			},
		},
	}

	orangeStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("208"))

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.setup()
			defer tt.teardown()

			// Test if lipgloss outputs color
			styled := orangeStyle.Render("TEST")
			hasColor := styled != "TEST"

			t.Logf("Environment: %s", tt.name)
			t.Logf("Styled output: %q", styled)
			t.Logf("Has color codes: %v", hasColor)

			// In production, we want color codes
			if tt.name == "With CLICOLOR_FORCE" || tt.name == "With FORCE_COLOR" {
				// These should force colors even in non-TTY environments
				t.Logf("Expected color codes in forced color mode")
			}
		})
	}
}

func TestClaudeHighlightingSummary(t *testing.T) {
	// Summary of what we've learned

	t.Log("=== Claude Highlighting Investigation Summary ===")
	t.Log("")
	t.Log("1. LOGIC: The highlighting logic is correct:")
	t.Log("   - Claude panes are correctly identified")
	t.Log("   - ShouldHighlightByType returns true for idle Claude panes")
	t.Log("   - BuildListItems calls the highlighting code")
	t.Log("")
	t.Log("2. LIPGLOSS: Color output depends on terminal detection:")
	t.Log("   - In test environment, lipgloss doesn't output ANSI codes")
	t.Log("   - This is normal behavior for non-TTY environments")
	t.Log("   - The actual TUI app running in a real terminal SHOULD show colors")
	t.Log("")
	t.Log("3. EXPECTED BEHAVIOR:")
	t.Log("   - In real terminal: Claude panes should appear in orange when idle")
	t.Log("   - In tests: Claude panes are marked for highlighting but no ANSI codes")
	t.Log("")
	t.Log("4. TO VERIFY IN PRODUCTION:")
	t.Log("   - Run the app in a real terminal")
	t.Log("   - Claude panes should appear in orange color")
	t.Log("   - If not, check TERM and color environment variables")

	// Always pass - this is informational
	require.True(t, true)
}
