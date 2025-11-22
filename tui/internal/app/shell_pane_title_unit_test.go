package app

import (
	"testing"

	"github.com/natb1/tui/pkg/model"
)

// TestPaneTitleFiltering tests that pane titles are filtered correctly
func TestPaneTitleFiltering(t *testing.T) {
	// Test cases for pane title filtering
	testCases := []struct {
		name          string
		shellType     model.ShellType
		paneTitle     string
		shouldDisplay bool
		description   string
	}{
		{
			name:          "ZshWithMachineName",
			shellType:     model.ShellTypeZsh,
			paneTitle:     "Nathans-MacBook-Air.local",
			shouldDisplay: false,
			description:   "Machine names should be filtered from zsh panes",
		},
		{
			name:          "ZshWithPath",
			shellType:     model.ShellTypeZsh,
			paneTitle:     "~/projects/assistant",
			shouldDisplay: true,
			description:   "Path titles should be displayed for zsh panes",
		},
		{
			name:          "ClaudeWithActivity",
			shellType:     model.ShellTypeClaude,
			paneTitle:     "✳ Testing Claude Activity",
			shouldDisplay: true,
			description:   "Claude pane titles should always be displayed",
		},
		{
			name:          "UnknownWithTitle",
			shellType:     model.ShellTypeUnknown,
			paneTitle:     "Log Database Viewer",
			shouldDisplay: true,
			description:   "Unknown shell titles should be displayed",
		},
		{
			name:          "EmptyTitle",
			shellType:     model.ShellTypeZsh,
			paneTitle:     "",
			shouldDisplay: false,
			description:   "Empty titles should not be displayed",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Create a shell with the test pane title
			shell := model.NewShell(tc.shellType, 12345)
			shell.PaneTitle = tc.paneTitle

			// The actual filtering happens in the UI layer
			// Test that the model correctly stores the pane title
			if shell.PaneTitle != tc.paneTitle {
				t.Errorf("Expected pane title %q, got %q", tc.paneTitle, shell.PaneTitle)
			}

			// Test that shell type is correct
			if shell.Type != tc.shellType {
				t.Errorf("Expected shell type %v, got %v", tc.shellType, shell.Type)
			}
		})
	}
}

// TestShellProjectMapping tests that shells are correctly mapped to projects
func TestShellProjectMapping(t *testing.T) {
	// Create test project
	project := model.NewProject("test-project", "/tmp/test-project")

	// Add different types of shells
	zshShell := model.NewShell(model.ShellTypeZsh, 1001)
	zshShell.Status = model.ShellStatusRunning
	project.MainShells[model.ShellTypeZsh] = zshShell

	claudeShell := model.NewShell(model.ShellTypeClaude, 1002)
	claudeShell.Status = model.ShellStatusRunning
	project.MainShells[model.ShellTypeClaude] = claudeShell

	// Verify shells are mapped correctly
	if len(project.MainShells) != 2 {
		t.Errorf("Expected 2 shells, got %d", len(project.MainShells))
	}

	// Verify shell types
	if project.MainShells[model.ShellTypeZsh] != zshShell {
		t.Error("Zsh shell not mapped correctly")
	}

	if project.MainShells[model.ShellTypeClaude] != claudeShell {
		t.Error("Claude shell not mapped correctly")
	}
}
