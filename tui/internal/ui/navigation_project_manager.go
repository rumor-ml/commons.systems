// navigation_project_manager.go - Project management functionality for navigation component

package ui

import (
	"github.com/natb1/tui/internal/status"
	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
)

// NavigationProjectManager handles project state management for navigation component
type NavigationProjectManager struct {
	projects        []*model.Project
	keyBindingMgr   *model.KeyBindingManager
	listBuilder     *ListBuilder
	claudeStatus    *status.ClaudeStatusManager
}

// GetKeyBindingManager returns the key binding manager for external access
func (pm *NavigationProjectManager) GetKeyBindingManager() *model.KeyBindingManager {
	return pm.keyBindingMgr
}

// UpdatePanes updates the pane mappings without changing projects
func (pm *NavigationProjectManager) UpdatePanes(tmuxPanes map[string]*terminal.TmuxPane) {
	// The listBuilder will use the updated panes when building items
	// No need to store them here as they're passed through BuildListItems
	// Removed: High-frequency DEBUG log (UpdatePanes called)
}

// NewNavigationProjectManager creates a new project manager
func NewNavigationProjectManager(keyMgr *model.KeyBindingManager, listBuilder *ListBuilder, claudeStatus *status.ClaudeStatusManager) *NavigationProjectManager {
	return &NavigationProjectManager{
		keyBindingMgr: keyMgr,
		listBuilder:   listBuilder,
		claudeStatus:  claudeStatus,
	}
}

var setProjectsCallCount int

// SetProjects updates the navigation with real discovered projects
func (pm *NavigationProjectManager) SetProjects(projects []*model.Project) []*model.Project {
	setProjectsCallCount++
	// Removed: High-frequency DEBUG logs (SetProjects called, project iteration)

	// Deduplicate "Other Sessions" projects - only keep the first one
	deduplicatedProjects := make([]*model.Project, 0, len(projects))
	var otherSessionsProject *model.Project

	for _, project := range projects {
		if project.IsOtherSessionsProject() {
			if otherSessionsProject == nil {
				// Keep the first "Other Sessions" project
				otherSessionsProject = project
				deduplicatedProjects = append(deduplicatedProjects, project)
			}
			// Skip any additional "Other Sessions" projects
		} else {
			deduplicatedProjects = append(deduplicatedProjects, project)
		}
	}

	// Store deduplicated projects
	pm.projects = deduplicatedProjects

	// Assign keybindings to deduplicated projects
	pm.keyBindingMgr.AssignKeyBindings(deduplicatedProjects)

	// Removed: Per-project keybinding logs (high frequency)
	// Removed: Success log (high frequency)

	return deduplicatedProjects
}

// SetProjectsAndPanes updates the navigation with projects and tmux panes
func (pm *NavigationProjectManager) SetProjectsAndPanes(projects []*model.Project, tmuxPanes map[string]*terminal.TmuxPane) []*model.Project {
	// Removed: High-frequency DEBUG logs (SetProjectsAndPanes called, Claude pane iteration)

	// Store projects
	pm.projects = projects

	// Update Claude status manager with new panes
	if pm.claudeStatus != nil && tmuxPanes != nil {
		pm.claudeStatus.UpdateClaudePanes(tmuxPanes)
	}

	// Assign keybindings
	pm.keyBindingMgr.AssignKeyBindings(projects)

	// Removed: Per-project keybinding logs (high frequency)
	// Removed: Success log (high frequency)

	return projects
}

// GetProjects returns the current projects
func (pm *NavigationProjectManager) GetProjects() []*model.Project {
	return pm.projects
}

// BuildListItems creates list items from current projects and tmux panes
func (pm *NavigationProjectManager) BuildListItems(tmuxPanes map[string]*terminal.TmuxPane) []interface{} {
	// Removed: High-frequency DEBUG logs (BuildListItems called, result count)

	items := pm.listBuilder.BuildListItems(pm.projects, pm.keyBindingMgr, tmuxPanes, pm.claudeStatus)

	// Convert []list.Item to []interface{} to avoid import issues
	result := make([]interface{}, len(items))
	for i, item := range items {
		result[i] = item
	}

	return result
}

// createStubProjects creates test projects with worktrees for development
func createStubProjects() []*model.Project {
	projects := []*model.Project{
		model.NewProject("assistant", "/Users/n8/intent/assistant"),
		model.NewProject("icf", "/Users/n8/intent/icf"),
		model.NewProject("health", "/Users/n8/intent/health"),
		model.NewProject("finance", "/Users/n8/intent/finance"),
	}

	// Add main shells to assistant (simulating auto-start)
	assistant := projects[0]
	assistant.MainShells[model.ShellTypeZsh] = model.NewShell(model.ShellTypeZsh, 1234)
	assistant.MainShells[model.ShellTypeZsh].Status = model.ShellStatusRunning

	// Add a cheeky worktree to icf project
	icf := projects[1]
	icf.Worktrees = []*model.Worktree{
		model.NewWorktree("wt1", "", "/Users/n8/intent/icf/.worktrees/chaos-monkey", "chaos-monkey"),
	}

	// Initially expand assistant project and icf project
	assistant.Expanded = true
	icf.Expanded = true

	return projects
}