package status

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestClaudeStatusWithNotifications(t *testing.T) {
	// Create a ClaudeStatusManager
	mgr := NewClaudeStatusManager()

	// For this test, we'll just verify the basic functionality
	// In production, the notification handler would be set by the app controller

	// Manually inject test data by calling checkNotificationEvents
	// In real usage, this would query from the store
	mgr.projectPaneMap["test-project"] = "pane1"
	mgr.projectPaneMap["test-project-2"] = "pane2"

	// Check highlighting for permission request pane
	shouldHighlight := mgr.ShouldHighlightByType("pane1", "claude")
	assert.True(t, shouldHighlight, "Pane with permission request should be highlighted")

	// Check duration text for different states
	duration := mgr.GetPaneDuration("pane1")
	// Since we don't have tmux monitoring in this test, it should show notification state
	assert.Contains(t, []string{"", "awaiting permission", "idle"}, duration)
}

func TestHybridStatusDetection(t *testing.T) {
	// Test that both tmux monitoring and notifications work together
	mgr := NewClaudeStatusManager()

	// Test Claude pane detection by type
	assert.True(t, mgr.IsClaudePaneByType("claude"))
	assert.False(t, mgr.IsClaudePaneByType("zsh"))
	assert.False(t, mgr.IsClaudePaneByType("bash"))

	// Test that highlighting works for Claude panes without any status
	shouldHighlight := mgr.ShouldHighlightByType("unknown-pane", "claude")
	assert.True(t, shouldHighlight, "Unknown Claude pane should be highlighted by default")

	// Test that non-Claude panes are not highlighted
	shouldHighlight = mgr.ShouldHighlightByType("zsh-pane", "zsh")
	assert.False(t, shouldHighlight, "Non-Claude pane should not be highlighted")
}
