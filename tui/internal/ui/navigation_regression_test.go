package ui

import (
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
	"github.com/stretchr/testify/assert"
)

// TestNavigationRegressionPanesOnly tests the regression where only panes are shown
func TestNavigationRegressionPanesOnly(t *testing.T) {
	nav := NewNavigationListComponent()
	nav.SetSize(80, 20)

	// Simulate the scenario where panes exist but projects haven't been set yet
	tmuxPanes := map[string]*terminal.TmuxPane{
		"session:0.0": &terminal.TmuxPane{
			PaneTitle:      "Git Worktree Behavior",
			CurrentCommand: "go",
			CurrentPath:    "/test/assistant",
			ShellType:      model.ShellTypeZsh,
			Project:        nil, // No project association yet
		},
		"session:0.1": &terminal.TmuxPane{
			PaneTitle:      "Migration Instructions",
			CurrentCommand: "vim",
			CurrentPath:    "/test/icf",
			ShellType:      model.ShellTypeClaude,
			Project:        nil, // No project association yet
		},
	}

	// First, set panes with no projects (simulating early discovery)
	nav.SetProjectsAndPanes(nil, tmuxPanes)
	view := nav.View()

	t.Logf("View with no projects:\n%s", view)

	// Should show "No projects found" message, not the panes
	assert.Contains(t, view, "No projects found", "Should show no projects message")
	assert.NotContains(t, view, "Git Worktree Behavior", "Should not show pane titles when no projects")
	assert.NotContains(t, view, "Migration Instructions", "Should not show pane titles when no projects")
}

// TestNavigationRegressionEmptyProjects tests with empty project list
func TestNavigationRegressionEmptyProjects(t *testing.T) {
	nav := NewNavigationListComponent()
	nav.SetSize(80, 20)

	// Create panes with project associations but pass empty project list
	fakeProject := &model.Project{
		Name: "fake",
		Path: "/test/fake",
	}

	tmuxPanes := map[string]*terminal.TmuxPane{
		"session:0.0": &terminal.TmuxPane{
			PaneTitle:      "Git Worktree Behavior",
			CurrentCommand: "go",
			CurrentPath:    "/test/fake",
			ShellType:      model.ShellTypeZsh,
			Project:        fakeProject,
		},
	}

	// Set empty projects list but panes with project refs
	nav.SetProjectsAndPanes([]*model.Project{}, tmuxPanes)
	view := nav.View()

	t.Logf("View with empty projects:\n%s", view)

	// Should show "No projects found" message
	assert.Contains(t, view, "No projects found", "Should show no projects message")
	// Should NOT show the pane since its project isn't in the project list
	assert.NotContains(t, view, "Git Worktree Behavior", "Should not show panes for missing projects")
}

// TestNavigationRegressionRaceCondition simulates race condition updates
func TestNavigationRegressionRaceCondition(t *testing.T) {
	nav := NewNavigationListComponent()
	nav.SetSize(80, 20)

	// Create projects
	projects := []*model.Project{
		{
			Name:       "assistant",
			Path:       "/test/assistant",
			KeyBinding: 'a',
		},
	}

	// Create panes
	tmuxPanes := map[string]*terminal.TmuxPane{
		"session:0.0": &terminal.TmuxPane{
			PaneTitle:      "Git Worktree Behavior",
			CurrentCommand: "go",
			CurrentPath:    "/test/assistant",
			ShellType:      model.ShellTypeZsh,
			Project:        projects[0],
		},
	}

	// Simulate rapid updates (race condition)
	for i := 0; i < 5; i++ {
		// Alternate between setting projects and clearing them
		if i%2 == 0 {
			nav.SetProjectsAndPanes(projects, tmuxPanes)
		} else {
			nav.SetProjectsAndPanes(nil, tmuxPanes)
		}

		// Small delay to simulate timing
		time.Sleep(10 * time.Millisecond)

		// Force update
		nav.Update(tea.WindowSizeMsg{Width: 80, Height: 20})
	}

	// Final state should be stable
	nav.SetProjectsAndPanes(projects, tmuxPanes)
	view := nav.View()

	// Should show the project correctly
	assert.Contains(t, view, "[a]ssistant", "Should show project after race condition")
	assert.Contains(t, view, "Git Worktree Behavior", "Should show pane under project")
}
