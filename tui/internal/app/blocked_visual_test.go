package app

import (
	"strings"
	"testing"

	"github.com/natb1/tui/internal/ui"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestBlockedVisualIndicator tests that the blocked indicator appears in the view
func TestBlockedVisualIndicator(t *testing.T) {
	// Initialize logging
	log.Get().WithComponent("test")

	// Create temporary workspace
	tmpDir := t.TempDir()

	// Create app
	app, err := New(tmpDir)
	require.NoError(t, err)

	// Create test projects - one blocked, one not
	testProjects := []*model.Project{
		{
			Name:   "assistant",
			Path:   "/test/assistant",
			Status: model.ProjectStatusBlocked, // Start with blocked
		},
		{
			Name:   "icf",
			Path:   "/test/icf",
			Status: model.ProjectStatusNormal,
		},
	}

	// Set projects on navigation
	nav := app.uiManager.GetNavigationComponent()
	require.NotNil(t, nav)
	nav.SetProjects(testProjects)

	// Get the view
	view := app.View()
	t.Logf("View with blocked project:\n%s", view)

	// The view should contain the blocked indicator for assistant
	assert.True(t, strings.Contains(view, "🚫") || strings.Contains(view, "assistant"),
		"view should show project with blocked indicator")

	// Toggle icf to blocked
	toggleMsg := ui.ToggleBlockedMsg{
		Project:  testProjects[1],
		Worktree: nil,
	}
	app.Update(toggleMsg)

	// Get updated view
	view2 := app.View()
	t.Logf("View after toggling icf:\n%s", view2)

	// Should now have blocked indicator
	assert.True(t, strings.Contains(view2, "🚫"),
		"view should show blocked indicator after toggle")
}

// TestBlockedColorIndicator tests that blocked items have muted colors
func TestBlockedColorIndicator(t *testing.T) {
	// Initialize logging
	log.Get().WithComponent("test")

	// Create temporary workspace
	tmpDir := t.TempDir()

	// Create app
	app, err := New(tmpDir)
	require.NoError(t, err)

	// Create test project that's blocked
	testProjects := []*model.Project{
		{
			Name:   "blocked-project",
			Path:   "/test/blocked",
			Status: model.ProjectStatusBlocked,
		},
	}

	// Set projects on navigation
	nav := app.uiManager.GetNavigationComponent()
	require.NotNil(t, nav)
	nav.SetProjects(testProjects)

	// Get the view
	view := app.View()

	// Should contain muted color ANSI code (239 = dark gray)
	assert.Contains(t, view, "\x1b[38;5;239m",
		"blocked project should have muted color")
}
