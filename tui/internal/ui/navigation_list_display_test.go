package ui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
	"github.com/stretchr/testify/assert"
)

// TestNavigationListDisplay tests navigation component display with projects and panes
func TestNavigationListDisplay(t *testing.T) {
	// Create navigation component
	nav := NewNavigationListComponent()
	nav.SetSize(80, 20) // Give it some size

	// Create test projects
	projects := []*model.Project{
		{
			Name:       "assistant",
			Path:       "/test/assistant",
			KeyBinding: 'a',
		},
		{
			Name:       "icf",
			Path:       "/test/icf",
			KeyBinding: 'i',
		},
	}

	// Create test tmux panes
	tmuxPanes := map[string]*terminal.TmuxPane{
		"session:0.0": &terminal.TmuxPane{
			PaneTitle:      "Git Worktree Behavior",
			CurrentCommand: "go",
			CurrentPath:    "/test/assistant",
			ShellType:      model.ShellTypeZsh,
			Project:        projects[0], // assistant
		},
		"session:0.1": &terminal.TmuxPane{
			PaneTitle:      "docker-claude-shell",
			CurrentCommand: "docker",
			CurrentPath:    "/test/icf",
			ShellType:      model.ShellTypeClaude,
			Project:        projects[1], // icf
		},
	}

	// Set projects and panes
	nav.SetProjectsAndPanes(projects, tmuxPanes)

	// Initialize the component
	nav.Init()

	// Update with a window size to trigger rendering
	nav.Update(tea.WindowSizeMsg{Width: 80, Height: 20})

	// Get the view
	view := nav.View()

	// Check that the view contains expected content
	t.Logf("Navigation view:\n%s", view)

	// Projects should be displayed with keybindings
	assert.Contains(t, view, "[a]ssistant", "Should show assistant project with keybinding")
	assert.Contains(t, view, "[i]cf", "Should show icf project with keybinding")

	// Shells should be displayed with proper indentation and icons
	assert.Contains(t, view, "     ⚡", "Should show zsh shell with icon and indentation")
	assert.Contains(t, view, "    🤖", "Should show claude shell with icon and indentation")

	// Check that shell titles are displayed
	assert.Contains(t, view, "Git Worktree Behavior", "Should show zsh pane title")
	assert.Contains(t, view, "docker-claude-shell", "Should show claude pane title")

	// Verify the structure - shells should be indented under projects
	lines := strings.Split(view, "\n")
	var foundAssistant, foundIcf bool
	var assistantLine, icfLine int

	for i, line := range lines {
		if strings.Contains(line, "[a]ssistant") {
			foundAssistant = true
			assistantLine = i
		}
		if strings.Contains(line, "[i]cf") {
			foundIcf = true
			icfLine = i
		}
	}

	assert.True(t, foundAssistant, "Should find assistant project")
	assert.True(t, foundIcf, "Should find icf project")

	// Check that shells appear after their projects
	for i, line := range lines {
		if strings.Contains(line, "Git Worktree Behavior") {
			assert.Greater(t, i, assistantLine, "Git Worktree shell should appear after assistant project")
		}
		if strings.Contains(line, "docker-claude-shell") {
			assert.Greater(t, i, icfLine, "docker-claude shell should appear after icf project")
		}
	}
}

// TestNavigationListWithNoProjects tests display when no projects are found
func TestNavigationListWithNoProjects(t *testing.T) {
	nav := NewNavigationListComponent()
	nav.SetSize(80, 20)

	// Set empty projects
	nav.SetProjectsAndPanes([]*model.Project{}, nil)

	// Get the view
	view := nav.View()

	// Should show placeholder messages
	assert.Contains(t, view, "No projects found", "Should show no projects message")
	assert.Contains(t, view, "Scanning for projects", "Should show scanning message")
}

// TestNavigationListWithOrphanedPanes tests that orphaned panes are shown in dedicated section
func TestNavigationListWithOrphanedPanes(t *testing.T) {
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

	// Create panes - one associated, one orphaned
	tmuxPanes := map[string]*terminal.TmuxPane{
		"session:0.0": &terminal.TmuxPane{
			PaneTitle:   "Associated Pane",
			CurrentPath: "/test/assistant",
			ShellType:   model.ShellTypeZsh,
			Project:     projects[0],
		},
		"session:0.1": &terminal.TmuxPane{
			PaneTitle:   "Orphaned Pane",
			CurrentPath: "/test/unknown",
			ShellType:   model.ShellTypeZsh,
			Project:     nil, // No associated project
		},
	}

	nav.SetProjectsAndPanes(projects, tmuxPanes)
	view := nav.View()

	// Should show the associated pane
	assert.Contains(t, view, "Associated Pane", "Should show associated pane")

	// Should show orphaned panes in a dedicated section
	assert.Contains(t, view, "Orphaned Shells", "Should show orphaned shells section")
	assert.Contains(t, view, "Orphaned Pane", "Should show orphaned pane in dedicated section")
}
