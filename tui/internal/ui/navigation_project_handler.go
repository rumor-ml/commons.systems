// navigation_project_handler.go - Project management functionality for navigation component

package ui

import (
	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// NavigationProjectHandler handles project management operations
type NavigationProjectHandler struct {
	logger      log.Logger
	hashHandler *NavigationHashHandler
}

// NewNavigationProjectHandler creates a new project handler
func NewNavigationProjectHandler(hashHandler *NavigationHashHandler) *NavigationProjectHandler {
	return &NavigationProjectHandler{
		logger:      log.Get(),
		hashHandler: hashHandler,
	}
}

// ProcessProjectUpdate handles project updates with change detection
func (ph *NavigationProjectHandler) ProcessProjectUpdate(projects []*model.Project, lastProjectsHash *uint64, tmuxPanes map[string]*terminal.TmuxPane) (bool, uint64) {
	// Calculate hash of projects for change detection
	projectsHash := ph.hashHandler.HashProjects(projects)

	// Skip update if projects haven't changed
	if projectsHash == *lastProjectsHash {
		return false, projectsHash
	}

	// Update pane project references to match new project objects
	if tmuxPanes != nil && projects != nil {
		ph.updatePaneProjectReferences(projects, tmuxPanes)
	}

	return true, projectsHash
}

// updatePaneProjectReferences updates pane project pointers to match new project objects
func (ph *NavigationProjectHandler) updatePaneProjectReferences(newProjects []*model.Project, tmuxPanes map[string]*terminal.TmuxPane) {
	// Create a map of path -> project for quick lookup
	projectMap := make(map[string]*model.Project)
	for _, p := range newProjects {
		projectMap[p.Path] = p
	}

	// Update each pane's project reference
	for _, pane := range tmuxPanes {
		if pane.Project != nil {
			if newProject, exists := projectMap[pane.Project.Path]; exists {
				pane.Project = newProject
			}
		}
	}
}