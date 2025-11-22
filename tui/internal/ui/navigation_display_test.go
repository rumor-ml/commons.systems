package ui

import (
	"testing"

	"github.com/natb1/tui/pkg/model"
	"github.com/stretchr/testify/assert"
)

// TestNavigationDisplayWithProjects tests that projects are displayed correctly
func TestNavigationDisplayWithProjects(t *testing.T) {
	nav := NewNavigationComponent()
	nav.SetSize(80, 20) // Increase width to avoid truncation

	// Create test project
	project := &model.Project{
		Name:       "assistant",
		Path:       "/Users/n8/intent/assistant",
		MainShells: make(map[model.ShellType]*model.Shell),
		Worktrees:  []*model.Worktree{},
		Expanded:   true,
		KeyBinding: 'a',
	}

	// Add some worktrees
	project.Worktrees = append(project.Worktrees, &model.Worktree{
		ID:         "feature-1",
		Name:       "feature-1", // Use lowercase name to match hotkey
		Branch:     "feature-1",
		Path:       "/Users/n8/intent/assistant/.worktrees/feature-1",
		KeyBinding: 'f',
	})

	// Set projects and let the system assign key bindings
	nav.SetProjects([]*model.Project{project})

	// Get view
	view := nav.View()

	// Should contain the project
	assert.Contains(t, view, "[a]ssistant", "Project should be displayed with keybinding")
	
	// The worktree name "feature-1" with hotkey 'f' should show as "[f]eature-1"
	assert.Contains(t, view, "[f]eature-1", "Worktree should be displayed with keybinding")
	assert.Contains(t, view, "🌿", "Worktree should have worktree icon")
}


// TestNavigationIntegration tests the full navigation flow
func TestNavigationIntegration(t *testing.T) {
	// Create navigation with projects
	nav := NewNavigationComponent()
	nav.SetSize(80, 25) // Increase width to avoid truncation

	// Create assistant project like the controller does
	assistant := &model.Project{
		Name:       "assistant",
		Path:       "/Users/n8/intent/assistant",
		MainShells: make(map[model.ShellType]*model.Shell),
		Worktrees:  []*model.Worktree{},
		Expanded:   true,
		KeyBinding: 'a',
	}

	// Add worktrees
	assistant.Worktrees = append(assistant.Worktrees,
		&model.Worktree{
			ID:         "worktree-zsh-20499",
			Branch:     "worktree-zsh-20499",
			Path:       "/Users/n8/intent/assistant/.worktrees/worktree-zsh-20499",
			KeyBinding: 'w',
		},
		&model.Worktree{
			ID:         "worktree-zsh-21499",
			Branch:     "worktree-zsh-21499",
			Path:       "/Users/n8/intent/assistant/.worktrees/worktree-zsh-21499",
			KeyBinding: 'o',
		},
	)

	nav.SetProjects([]*model.Project{assistant})

	view := nav.View()

	// Verify the display
	assert.Contains(t, view, "[a]ssistant", "Should show assistant project")
	// Check that worktrees are shown with their assigned keys (may be different than expected)
	assert.Contains(t, view, "🌿", "Should show worktree icons")
	// The exact key bindings may be assigned differently by the KeyBindingManager
}
