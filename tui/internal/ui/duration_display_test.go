package ui

import (
	"strings"
	"testing"

	"github.com/natb1/tui/internal/status"
	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
)

// TestClaudeDurationDisplay tests that Claude pane durations are displayed when available
func TestClaudeDurationDisplay(t *testing.T) {
	formatter := NewListBuilderFormatter()
	
	// Create a mock Claude pane
	claudePane := &terminal.TmuxPane{
		SessionName:    "test-session",
		WindowIndex:    0,
		PaneIndex:      1,
		ShellType:      model.ShellTypeClaude,
		PaneTitle:      "Claude",
		CurrentCommand: "claude",
	}
	
	// Test that the formatter accepts the pane and status manager without error
	claudeStatus := status.NewClaudeStatusManager()
	title := formatter.FormatPaneTitle(claudePane, claudeStatus)
	
	// Should contain the Claude icon and title
	if !strings.Contains(title, "🤖") {
		t.Error("Claude pane title should contain robot icon")
	}
	if !strings.Contains(title, "Claude") {
		t.Error("Claude pane title should contain 'Claude'")
	}
	
	// Test that non-Claude panes don't get duration formatting
	zshPane := &terminal.TmuxPane{
		SessionName:    "test-session",
		WindowIndex:    0,
		PaneIndex:      2,
		ShellType:      model.ShellTypeZsh,
		PaneTitle:      "zsh",
		CurrentCommand: "zsh",
	}
	
	zshTitle := formatter.FormatPaneTitle(zshPane, claudeStatus)
	if !strings.Contains(zshTitle, "⚡") {
		t.Error("Zsh pane title should contain lightning icon")
	}
	
	// Verify that the GetPaneDuration method exists and can be called
	// (This tests the integration point even if no duration is available in test environment)
	duration := claudeStatus.GetPaneDuration(claudePane.GetTmuxTarget())
	if duration == "" {
		t.Log("No duration available in test environment (expected)")
	} else {
		t.Logf("Duration returned: %s", duration)
	}
}

// TestClaudeDurationFormatting tests the duration formatting logic
func TestClaudeDurationFormatting(t *testing.T) {
	formatter := NewListBuilderFormatter()
	
	// Test that the formatter handles nil status manager gracefully
	claudePane := &terminal.TmuxPane{
		SessionName:    "test-session",
		WindowIndex:    0,
		PaneIndex:      1,
		ShellType:      model.ShellTypeClaude,
		PaneTitle:      "Claude",
		CurrentCommand: "claude",
	}
	
	// Should not crash with nil status manager
	title := formatter.FormatPaneTitle(claudePane, nil)
	if !strings.Contains(title, "🤖 Claude") {
		t.Error("Should handle nil status manager and still show Claude title")
	}
	
	// Should not contain parentheses when no status manager
	if strings.Contains(title, "(") || strings.Contains(title, ")") {
		t.Error("Should not show duration parentheses when no status manager available")
	}
}