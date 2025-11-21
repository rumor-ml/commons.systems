package app

import (
	"testing"
	"time"

	"github.com/natb1/tui/internal/ui"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestBlockedTogglePreservation tests that blocked state is preserved when toggling
func TestBlockedTogglePreservation(t *testing.T) {
	// Initialize logging
	log.Get().WithComponent("test")
	logger := log.Get()

	// Create temporary workspace
	tmpDir := t.TempDir()
	workspaceRoot := tmpDir

	// Create app
	app, err := New(workspaceRoot)
	require.NoError(t, err)

	// Create test projects
	testProjects := []*model.Project{
		{
			Name:   "assistant",
			Path:   "/test/assistant",
			Status: model.ProjectStatusNormal,
		},
		{
			Name:   "icf",
			Path:   "/test/icf",
			Status: model.ProjectStatusNormal,
		},
	}

	// Set projects directly on navigation
	if nav := app.uiManager.GetNavigationComponent(); nav != nil {
		nav.SetProjects(testProjects)
	}

	// Create ToggleBlockedMsg for assistant project
	toggleMsg := ui.ToggleBlockedMsg{
		Project:  testProjects[0],
		Worktree: nil,
	}

	// Process the toggle message
	_, cmd := app.Update(toggleMsg)
	assert.Nil(t, cmd, "should not return a command")

	// Check that the project is now blocked
	assert.True(t, testProjects[0].IsBlocked(), "assistant project should be blocked")

	// Get the projects from navigation after toggle
	if nav := app.uiManager.GetNavigationComponent(); nav != nil {
		projects := nav.GetProjects()
		require.NotNil(t, projects)
		require.Greater(t, len(projects), 0)

		// Find the assistant project
		var assistantProject *model.Project
		for _, p := range projects {
			if p.Name == "assistant" {
				assistantProject = p
				break
			}
		}

		require.NotNil(t, assistantProject, "should find assistant project")
		assert.True(t, assistantProject.IsBlocked(), "assistant project should still be blocked in navigation")
		logger.Info("Verified blocked state is preserved", "project", assistantProject.Name, "isBlocked", assistantProject.IsBlocked())
	}
}

// TestBlockedToggleVisualUpdate tests that the visual display updates when blocked state changes
func TestBlockedToggleVisualUpdate(t *testing.T) {
	// Initialize logging
	log.Get().WithComponent("test")

	// Create temporary workspace
	tmpDir := t.TempDir()
	workspaceRoot := tmpDir

	// Create app
	app, err := New(workspaceRoot)
	require.NoError(t, err)

	// Create test projects
	testProjects := []*model.Project{
		{
			Name:   "assistant",
			Path:   "/test/assistant",
			Status: model.ProjectStatusNormal,
		},
	}

	// Set projects on navigation
	if nav := app.uiManager.GetNavigationComponent(); nav != nil {
		nav.SetProjects(testProjects)

		// Get initial view
		initialView := nav.View()
		assert.NotContains(t, initialView, "🚫", "should not have blocked indicator initially")
		assert.NotContains(t, initialView, "\x1b[38;5;239m", "should not have muted color initially")

		// Create and process toggle message
		toggleMsg := ui.ToggleBlockedMsg{
			Project:  testProjects[0],
			Worktree: nil,
		}

		app.Update(toggleMsg)

		// Give a moment for the update to process
		time.Sleep(10 * time.Millisecond)

		// Get view after toggle
		afterView := nav.View()
		assert.Contains(t, afterView, "🚫", "should have blocked indicator after toggle")
		assert.Contains(t, afterView, "\x1b[38;5;239m", "should have muted color after toggle")
	}
}
