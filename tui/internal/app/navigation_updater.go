// Package app provides navigation management functionality for ICF TUI application.

package app

import (
	"os"
	"path/filepath"

	"github.com/natb1/tui/pkg/model"
	projectworktree "github.com/rumor-ml/carriercommons/pkg/worktree"
	"github.com/rumor-ml/log/pkg/log"
)

// NavigationUpdater handles navigation state synchronization and project mapping
type NavigationUpdater struct {
	app *App
}

// startsWith checks if a string starts with a prefix
func startsWith(s, prefix string) bool {
	return len(s) >= len(prefix) && s[0:len(prefix)] == prefix
}

// NewNavigationUpdater creates a new navigation updater
func NewNavigationUpdater(app *App) *NavigationUpdater {
	return &NavigationUpdater{
		app: app,
	}
}

// UpdateNavigationWithTmuxInfo updates navigation with current tmux window information
func (nu *NavigationUpdater) UpdateNavigationWithTmuxInfo() {
	logger := log.Get()

	// Get current navigation projects
	navComp := nu.app.uiManager.GetNavigationComponent()
	if navComp == nil {
		logger.Warn("Navigation component not found")
		return
	}

	if nu.app.tmuxManager == nil {
		logger.Warn("Tmux manager not available")
		return
	}

	// First discover all existing tmux sessions
	err := nu.app.tmuxManager.DiscoverExistingSessions()
	if err != nil {
		logger.Error("Failed to discover tmux sessions", "error", err)
		return
	}

	// Discover all tmux panes across all sessions
	err = nu.app.tmuxManager.DiscoverAllPanes()
	if err != nil {
		logger.Error("Failed to discover tmux panes", "error", err)
		return
	}

	// Get current projects from navigation
	currentProjects := navComp.GetProjects()
	if currentProjects == nil || len(currentProjects) == 0 {
		// This is normal during startup before project discovery completes
		return
	}

	// Map tmux sessions to projects based on CWD
	mappedProjects, err := nu.app.tmuxManager.MapSessionsToProjects(currentProjects)
	if err != nil {
		logger.Error("Failed to map tmux sessions to projects", "error", err)
		return
	}

	// Also refresh pane mappings to ensure Claude panes are properly associated
	nu.app.tmuxManager.RefreshPaneProjectMappings(mappedProjects)

	// Get discovered panes for navigation display
	discoveredPanes := nu.app.tmuxManager.GetAllPanes()

	// Update panes only - projects are managed by updateNavigationProjects()
	// This prevents duplicate project entries in the UI
	navComp.SetPanes(discoveredPanes)
}

// UpdateNavigationProjects converts discovered projects to model projects for navigation
func (nu *NavigationUpdater) UpdateNavigationProjects() {
	logger := log.Get()
	logger.Debug("updateNavigationProjects called")
	nu.doUpdateNavigationProjects()
}

// doUpdateNavigationProjects performs the actual navigation update logic
func (nu *NavigationUpdater) doUpdateNavigationProjects() error {
	logger := log.Get()

	if nu.app.projects == nil {
		logger.Warn("No projects discovered for navigation - projects is nil")
		return nil
	}

	// Check if discovery is initialized
	if !nu.app.projects.IsInitialized() {
		logger.Debug("Project discovery not yet initialized, skipping navigation update")
		return nil
	}

	// Get model projects directly from the external project map
	modelProjects := nu.app.projects.GetModelProjects()
	logger.Debug("Project discovery status", "count", len(modelProjects), "initialized", nu.app.projects.IsInitialized())

	// Debug: Log all projects to check for duplicates
	projectPaths := make(map[string]bool)
	for i, p := range modelProjects {
		logger.Debug("Project from discovery", "index", i, "name", p.Name, "path", p.Path)
		if projectPaths[p.Path] {
			logger.Error("DUPLICATE PROJECT DETECTED IN DISCOVERY!", "name", p.Name, "path", p.Path)
		}
		projectPaths[p.Path] = true
	}

	// If no projects discovered yet, show at least the current project
	if len(modelProjects) == 0 {
		logger.Info("No projects discovered yet, using current directory")
		// Create a minimal project for the current directory
		currentPath, _ := os.Getwd()
		modelProject := &model.Project{
			Name:       "assistant",
			Path:       currentPath,
			MainShells: make(map[model.ShellType]*model.Shell),
			Worktrees:  []*model.Worktree{},
			Expanded:   true,
		}
		modelProjects = []*model.Project{modelProject}
	}

	// Find the monorepo root project (if any)
	var monorepoRoot *model.Project
	for _, p := range modelProjects {
		// Check if this is a monorepo root by checking if it contains "monorepo" tag
		// or if its name matches the base directory of other projects
		if p.Path != "" {
			baseName := filepath.Base(p.Path)
			// Count how many other projects are subdirectories of this one
			childCount := 0
			for _, other := range modelProjects {
				if other.Path != p.Path && len(other.Path) > len(p.Path) {
					relPath, err := filepath.Rel(p.Path, other.Path)
					if err == nil && !filepath.IsAbs(relPath) && !startsWith(relPath, "..") {
						childCount++
					}
				}
			}
			// If this project has 2+ children, it's likely the monorepo root
			if childCount >= 2 {
				monorepoRoot = p
				logger.Debug("Identified monorepo root", "name", p.Name, "path", p.Path, "children", childCount)
				break
			}
			_ = baseName // unused for now
		}
	}

	// Discover existing worktrees for each project
	for _, modelProject := range modelProjects {
		logger.Debug("Processing discovered project", "name", modelProject.Name, "path", modelProject.Path)

		// Ensure shells are initialized and clear worktrees for fresh discovery
		if modelProject.MainShells == nil {
			modelProject.MainShells = make(map[model.ShellType]*model.Shell)
		}
		// Always reset worktrees to prevent duplicates on repeated calls
		modelProject.Worktrees = []*model.Worktree{}

		// Always show expanded to see worktrees
		modelProject.Expanded = true

		// ONLY discover git worktrees for the monorepo root project
		// Modules are subdirectories, not separate git repos, so they shouldn't have worktrees
		isMonorepoRoot := monorepoRoot != nil && modelProject.Path == monorepoRoot.Path

		if isMonorepoRoot && nu.app.worktreeService != nil {
			logger.Debug("Discovering worktrees for monorepo root", "project", modelProject.Name)
			wtManager := projectworktree.NewManager(modelProject.Path)
			worktrees, err := wtManager.ListWorktrees()
			if err == nil {
				logger.Debug("Discovered worktrees from git",
					"project", modelProject.Name,
					"rawCount", len(worktrees))

				for _, wt := range worktrees {
					// Skip the main working directory (not a real worktree)
					logger.Debug("Checking worktree",
						"project", modelProject.Name,
						"projectPath", modelProject.Path,
						"worktreePath", wt.Path,
						"worktreeID", wt.Branch,
						"worktreeBranch", wt.Branch,
						"shouldSkip", wt.Path == modelProject.Path)

					if wt.Path == modelProject.Path {
						logger.Debug("Skipping main worktree",
							"project", modelProject.Name,
							"path", wt.Path)
						continue
					}

					logger.Debug("Adding worktree to model",
						"project", modelProject.Name,
						"worktreeID", wt.Branch,
						"worktreePath", wt.Path,
						"branch", wt.Branch)

					modelWorktree := &model.Worktree{
						ID:         wt.Branch,  // Use branch as ID
						Name:       filepath.Base(wt.Path), // Use directory name from path
						Branch:     wt.Branch,
						Path:       wt.Path,
						IsPrunable: wt.IsPrunable,
						Shells:     make(map[model.ShellType]*model.Shell),
					}
					modelProject.Worktrees = append(modelProject.Worktrees, modelWorktree)
				}
				logger.Debug("Added worktrees to project",
					"project", modelProject.Name,
					"worktreeCount", len(modelProject.Worktrees))
			}
		} else if !isMonorepoRoot {
			logger.Debug("Skipping worktree discovery for module", "project", modelProject.Name)
		}
	}

	logger.Debug("Converted projects for navigation", "count", len(modelProjects))

	// Load persisted status for all projects and worktrees
	if nu.app.statusRepo != nil {
		nu.loadPersistedStatus(modelProjects)
	}

	// Update navigation component with real projects
	if navComp := nu.app.uiManager.GetNavigationComponent(); navComp != nil {
		logger.Debug("Setting projects on navigation", "projectCount", len(modelProjects))
		for _, p := range modelProjects {
			logger.Debug("Project to display", "name", p.Name, "path", p.Path, "worktrees", len(p.Worktrees))
		}
		navComp.SetProjects(modelProjects)
		logger.Debug("Navigation projects updated")

		// Now update with tmux window information
		nu.UpdateNavigationWithTmuxInfo()
	} else {
		logger.Warn("Navigation component not found")
	}

	return nil
}

// loadPersistedStatus loads persisted status from database for projects and worktrees
func (nu *NavigationUpdater) loadPersistedStatus(projects []*model.Project) {
	logger := log.Get()

	// Bulk load all statuses for efficiency
	projectStatuses, err := nu.app.statusRepo.LoadAllProjectStatuses()
	if err != nil {
		logger.Warn("Failed to load project statuses", "error", err)
		return
	}

	worktreeStatuses, err := nu.app.statusRepo.LoadAllWorktreeStatuses()
	if err != nil {
		logger.Warn("Failed to load worktree statuses", "error", err)
		return
	}

	// Apply loaded statuses to projects
	for _, project := range projects {
		// Load project status
		if status, ok := projectStatuses[project.Path]; ok && status != "" {
			project.Status = model.ProjectStatus(status)
			logger.Debug("Loaded persisted project status",
				"project", project.Name,
				"path", project.Path,
				"status", project.Status)
		}

		// Load worktree statuses
		if wtStatuses, ok := worktreeStatuses[project.Path]; ok {
			for _, worktree := range project.Worktrees {
				if status, ok := wtStatuses[worktree.ID]; ok && status != "" {
					worktree.Status = model.ProjectStatus(status)
					logger.Debug("Loaded persisted worktree status",
						"project", project.Name,
						"worktree", worktree.ID,
						"status", worktree.Status)
				}
			}
		}
	}

	logger.Info("Loaded persisted status",
		"projectStatuses", len(projectStatuses),
		"worktreeStatuses", func() int {
			total := 0
			for _, wtMap := range worktreeStatuses {
				total += len(wtMap)
			}
			return total
		}())
}