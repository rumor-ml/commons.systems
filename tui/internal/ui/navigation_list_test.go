package ui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/natb1/tui/pkg/model"
)

// TestNavigationListRendering tests navigation list component rendering
func TestNavigationListRendering(t *testing.T) {
	// Create the navigation list component
	nav := NewNavigationListComponent()

	// Create test projects with the expected structure
	projects := []*model.Project{
		model.NewProject("assistant", "/Users/n8/intent/assistant"),
		model.NewProject("icf", "/Users/n8/intent/icf"),
		model.NewProject("health", "/Users/n8/intent/health"),
		model.NewProject("finance", "/Users/n8/intent/finance"),
	}

	// Add chaos-monkey worktree to icf project
	icf := projects[1]
	icf.Worktrees = []*model.Worktree{
		model.NewWorktree("chaos-monkey", "", "/Users/n8/intent/icf/.worktrees/chaos-monkey", "chaos-monkey"),
	}
	icf.Expanded = true // Ensure worktrees are visible

	// Set the projects
	nav.SetProjects(projects)

	// Set a reasonable size that should show all items
	nav.SetSize(30, 20) // 30 width, 20 height

	// Also send window size message to ensure proper initialization
	nav.Update(tea.WindowSizeMsg{Width: 30, Height: 20})

	// Get the rendered view
	view := nav.View()

	// Debug: Print the view to see what's happening
	t.Logf("Navigation view:\n%s", view)
	t.Logf("View height: %d lines", strings.Count(view, "\n")+1)

	// Check that all expected projects are visible
	// Note: Projects are displayed with brackets around keybindings like [a]ssistant
	expectedPatterns := []string{
		"ssistant",    // Will match [a]ssistant
		"cf",          // Will match [i]cf
		"🌿 [C]",      // Worktree shown as branch icon + keybinding
		"ealth",       // Will match [h]ealth
		"inance",      // Will match [f]inance
	}

	for i, pattern := range expectedPatterns {
		if !strings.Contains(view, pattern) {
			projectNames := []string{"assistant", "icf", "chaos-monkey", "health", "finance"}
			t.Errorf("Expected project '%s' (pattern: %s) not found in navigation view", projectNames[i], pattern)
		}
	}

	// Note: Title "Projects" is handled by the renderer, not the navigation component itself

	// Count visible lines to debug height issues
	lines := strings.Split(view, "\n")
	visibleProjects := 0
	for _, line := range lines {
		// Count lines that look like project entries (have brackets around keybinding)
		line = strings.TrimSpace(line)
		if strings.Contains(line, "[") && strings.Contains(line, "]") {
			visibleProjects++
			t.Logf("Found project line: %s", line)
		}
	}

	if visibleProjects < 5 { // assistant, icf, chaos-monkey, health, finance
		t.Errorf("Expected at least 5 project/worktree items, but found %d", visibleProjects)
	}
}

// TestNavigationListHeightCalculation tests that the list component gets the right height
func TestNavigationListHeightCalculation(t *testing.T) {
	nav := NewNavigationListComponent()

	testCases := []struct {
		totalHeight        int
		expectedListHeight int // Should be totalHeight (list manages its own title)
	}{
		{20, 20},
		{15, 15},
		{10, 10},
	}

	for _, tc := range testCases {
		nav.SetSize(30, tc.totalHeight)

		// The internal list should have the full height since it manages its own title
		if nav.list.Height() != tc.expectedListHeight {
			t.Errorf("For total height %d, expected list height %d, but got %d",
				tc.totalHeight, tc.expectedListHeight, nav.list.Height())
		}
	}
}
