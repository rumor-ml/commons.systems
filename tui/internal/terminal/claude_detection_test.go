// claude_detection_test.go - Regression test for TUI pane misdetection bug

package terminal

import (
	"testing"

	"github.com/natb1/tui/pkg/model"
)

// TestClaudeDetectionDoesNotMisdetectTUI is a regression test for the bug where
// the TUI's own pane (with title "go run main.go") was incorrectly detected as
// a Claude shell due to the multi-word title heuristic.
func TestClaudeDetectionDoesNotMisdetectTUI(t *testing.T) {
	tests := []struct {
		name            string
		paneTitle       string
		currentCommand  string
		paneTTY         string
		expectedType    model.ShellType
		description     string
	}{
		{
			name:           "TUI pane with go run main.go",
			paneTitle:      "go run main.go",
			currentCommand: "go",
			paneTTY:        "",  // No TTY or no claude process in TTY
			expectedType:   model.ShellTypeUnknown,
			description:    "TUI's own pane should be detected as unknown/generic executable, not Claude",
		},
		{
			name:           "Multi-word command not Claude",
			paneTitle:      "npm run dev",
			currentCommand: "node",
			paneTTY:        "",  // No claude process
			expectedType:   model.ShellTypeUnknown,
			description:    "Multi-word commands should not be misdetected as Claude",
		},
		{
			name:           "Actual Claude shell with ✳",
			paneTitle:      "✳ Code Changes",
			currentCommand: "node",
			paneTTY:        "/dev/ttys002", // Would have claude process in real scenario
			expectedType:   model.ShellTypeClaude,
			description:    "Real Claude shells with ✳ marker should be detected",
		},
		{
			name:           "Zsh shell",
			paneTitle:      "hostname.local",
			currentCommand: "zsh",
			paneTTY:        "",
			expectedType:   model.ShellTypeZsh,
			description:    "Zsh shells should be detected correctly",
		},
		{
			name:           "Python script execution",
			paneTitle:      "python manage.py runserver",
			currentCommand: "python",
			paneTTY:        "",
			expectedType:   model.ShellTypeUnknown,
			description:    "Python scripts should be generic executables, not Claude",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pane := NewTmuxPane("test-session", 0, 0)
			pane.PaneTitle = tt.paneTitle
			pane.CurrentCommand = tt.currentCommand
			pane.PaneTTY = tt.paneTTY

			pane.DetectShellType()

			if pane.ShellType != tt.expectedType {
				t.Errorf("%s: got ShellType=%v, want %v",
					tt.description, pane.ShellType, tt.expectedType)
			}
		})
	}
}

// TestClaudeDetectionWithRealTTY tests Claude detection using actual TTY paths
// (requires running in an environment with Claude shells active)
func TestClaudeDetectionPersistence(t *testing.T) {
	// Test that Claude detection persists even if title changes
	pane := NewTmuxPane("test-session", 0, 0)
	pane.ShellType = model.ShellTypeClaude
	pane.PaneTitle = "hostname.local" // Changed to boring title
	pane.CurrentCommand = "zsh"

	pane.DetectShellType()

	if pane.ShellType != model.ShellTypeClaude {
		t.Errorf("Claude pane should remain Claude even when title changes, got %v", pane.ShellType)
	}
}
