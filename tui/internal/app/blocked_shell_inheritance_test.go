package app

import (
	"strings"
	"testing"

	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestBlockedProjectShellInheritance tests that shells inherit muted color from blocked projects
func TestBlockedProjectShellInheritance(t *testing.T) {
	// Initialize logging
	log.Get().WithComponent("test")

	// Create temporary workspace
	tmpDir := t.TempDir()

	// Create app
	app, err := New(tmpDir)
	require.NoError(t, err)

	// Create test project with blocked state
	testProjects := []*model.Project{
		{
			Name:   "assistant",
			Path:   "/test/assistant",
			Status: model.ProjectStatusBlocked,
		},
	}

	// Create test panes for the project
	testPanes := map[string]*terminal.TmuxPane{
		"assistant:1.1": {
			SessionName: "assistant",
			WindowIndex: 1,
			PaneIndex:   1,
			PaneTitle:   "Testing Frameworks",
			ShellType:   model.ShellTypeClaude,
			CurrentPath: "/test/assistant",
			Project:     testProjects[0],
		},
	}

	// Set projects and panes on navigation
	nav := app.uiManager.GetNavigationComponent()
	require.NotNil(t, nav)
	nav.SetProjects(testProjects)
	nav.SetPanes(testPanes)

	// Get the view
	view := app.View()
	t.Logf("View with blocked project and Claude shell:\n%s", view)

	// The Claude shell should have muted color since parent project is blocked
	lines := strings.Split(view, "\n")
	claudeLineFound := false
	for _, line := range lines {
		if strings.Contains(line, "Testing Frameworks") {
			claudeLineFound = true
			// Check that the line has muted color
			assert.Contains(t, line, "\x1b[38;5;239m",
				"Claude shell should have muted color when project is blocked")
			break
		}
	}
	assert.True(t, claudeLineFound, "Should find Claude shell line in view")
}

// TestBlockedWorktreeShellInheritance tests that shells inherit muted color from blocked worktrees
func TestBlockedWorktreeShellInheritance(t *testing.T) {
	// Initialize logging
	log.Get().WithComponent("test")

	// Create temporary workspace
	tmpDir := t.TempDir()

	// Create app
	app, err := New(tmpDir)
	require.NoError(t, err)

	// Create test project with a blocked worktree
	testProjects := []*model.Project{
		{
			Name:     "assistant",
			Path:     "/test/assistant",
			Status:   model.ProjectStatusNormal, // Project not blocked
			Expanded: true,                      // Must be expanded to show worktrees
			Worktrees: []*model.Worktree{
				{
					ID:     "blocked-indicator",
					Name:   "blocked-indicator",
					Path:   "/test/assistant/.worktrees/blocked-indicator",
					Status: model.ProjectStatusBlocked, // Worktree is blocked
				},
			},
		},
	}

	// Create test panes for the worktree
	testPanes := map[string]*terminal.TmuxPane{
		"assistant:2.1": {
			SessionName: "assistant",
			WindowIndex: 2,
			PaneIndex:   1,
			PaneTitle:   "Testing Frameworks",
			ShellType:   model.ShellTypeClaude,
			CurrentPath: "/test/assistant/.worktrees/blocked-indicator",
			Project:     testProjects[0],
			Worktree:    testProjects[0].Worktrees[0],
		},
	}

	// Set projects and panes on navigation
	nav := app.uiManager.GetNavigationComponent()
	require.NotNil(t, nav)
	nav.SetProjects(testProjects)
	nav.SetPanes(testPanes)

	// Get the view
	view := app.View()
	t.Logf("View with blocked worktree and Claude shell:\n%s", view)

	// The Claude shell should have muted color since parent worktree is blocked
	lines := strings.Split(view, "\n")
	claudeLineFound := false
	for _, line := range lines {
		if strings.Contains(line, "Testing Frameworks") {
			claudeLineFound = true
			// Check that the line has muted color
			assert.Contains(t, line, "\x1b[38;5;239m",
				"Claude shell should have muted color when worktree is blocked")
			break
		}
	}
	assert.True(t, claudeLineFound, "Should find Claude shell line in view")
}
