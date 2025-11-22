// Package app provides navigation management functionality for ICF TUI application.

package app

import (
	"os"
	"path/filepath"

	"github.com/natb1/tui/internal/git"
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
	// Removed: High-frequency DEBUG log (called by tmux ticker every 2 seconds = 0.5/sec)
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

	// NEW: Discover repository and branches
	repo, err := nu.discoverRepositoryAndBranches()
	if err != nil {
		logger.Error("Failed to discover repository and branches", "error", err)
		// Fall back to old behavior on error
		return nu.doUpdateNavigationProjectsOld()
	}

	if repo == nil {
		logger.Debug("No repository discovered yet")
		return nu.doUpdateNavigationProjectsOld()
	}

	// Convert repository with branches to project model for UI display
	modelProjects := nu.convertRepositoryToProjects(repo)

	// If no projects discovered yet, show at least the current project
	if len(modelProjects) == 0 {
		logger.Info("No branches discovered yet, using current directory")
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

	// Note: Worktree discovery is now handled in branch discovery (see discoverRepositoryAndBranches)

	// Update navigation component with real projects
	if navComp := nu.app.uiManager.GetNavigationComponent(); navComp != nil {
		navComp.SetProjects(modelProjects)

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
		}

		// Load worktree statuses
		if wtStatuses, ok := worktreeStatuses[project.Path]; ok {
			for _, worktree := range project.Worktrees {
				if status, ok := wtStatuses[worktree.ID]; ok && status != "" {
					worktree.Status = model.ProjectStatus(status)
				}
			}
		}
	}

	// Removed: Verbose INFO log (fires on every status load)
}

// discoverRepositoryAndBranches discovers the monorepo and all its branches
func (nu *NavigationUpdater) discoverRepositoryAndBranches() (*model.Repository, error) {
	logger := log.Get()

	// Get model projects to find the monorepo root
	modelProjects := nu.app.projects.GetModelProjects()
	if len(modelProjects) == 0 {
		logger.Debug("No projects discovered yet")
		return nil, nil
	}

	// Find the monorepo root project
	var monorepoRoot *model.Project
	for _, p := range modelProjects {
		if p.Path != "" {
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
				break
			}
		}
	}

	// If no monorepo root found, use workspace root
	if monorepoRoot == nil {
		workspaceRoot := nu.app.workspaceRoot
		if workspaceRoot == "" {
			workspaceRoot, _ = os.Getwd()
		}
		repoName := filepath.Base(workspaceRoot)
		monorepoRoot = &model.Project{
			Name:       repoName,
			Path:       workspaceRoot,
			MainShells: make(map[model.ShellType]*model.Shell),
		}
	}

	logger.Info("Discovering repository branches", "repo", monorepoRoot.Name, "path", monorepoRoot.Path)

	// Create repository model
	repo := model.NewRepository(monorepoRoot.Name, monorepoRoot.Path)

	// Use BranchService to discover branches
	branchService := git.NewBranchService(monorepoRoot.Path)

	// Get current branch of the main repo
	currentBranch, err := branchService.GetCurrentBranch()
	if err != nil {
		logger.Warn("Failed to get current branch", "error", err)
	} else {
		repo.CurrentBranch = currentBranch
		logger.Info("Main repo current branch", "branch", currentBranch)
	}

	// Fetch from remote to sync with latest branches (ignore errors - work with cached data)
	err = branchService.FetchFromRemote()
	if err != nil {
		logger.Warn("Failed to fetch from remote, using cached branch data", "error", err)
		// Continue with cached data
	}

	// Get remote branches and local branches with worktrees (filters out stale local branches)
	branchInfos, err := branchService.ListRemoteBranchesAndWorktrees()
	if err != nil {
		logger.Error("Failed to discover branches", "error", err)
		return nil, err
	}

	// Convert BranchInfo to model.Branch
	for _, branchInfo := range branchInfos {
		branch := branchService.ConvertToModelBranch(branchInfo, nu.app.worktreeService)
		repo.Branches = append(repo.Branches, branch)
	}

	logger.Info("Discovered repository with branches",
		"repo", repo.Name,
		"branch_count", len(repo.Branches))

	// Load persisted status for branches
	if nu.app.statusRepo != nil {
		nu.loadPersistedBranchStatus(repo)
	}

	return repo, nil
}

// loadPersistedBranchStatus loads persisted status from database for branches
func (nu *NavigationUpdater) loadPersistedBranchStatus(repo *model.Repository) {
	logger := log.Get()

	// Bulk load all worktree statuses (branches share the same storage)
	worktreeStatuses, err := nu.app.statusRepo.LoadAllWorktreeStatuses()
	if err != nil {
		logger.Warn("Failed to load branch statuses", "error", err)
		return
	}

	// Apply loaded statuses to branches
	if branchStatuses, ok := worktreeStatuses[repo.Path]; ok {
		for _, branch := range repo.Branches {
			if status, ok := branchStatuses[branch.Name]; ok && status != "" {
				branch.Status = model.ProjectStatus(status)
				if branch.Worktree != nil {
					branch.Worktree.Status = model.ProjectStatus(status)
				}
			}
		}
	}
}

// convertRepositoryToProjects converts a Repository with Branches to Project model for UI
// This creates a single top-level project (the repository) with each branch as a "worktree"
func (nu *NavigationUpdater) convertRepositoryToProjects(repo *model.Repository) []*model.Project {
	logger := log.Get()

	// Create a single project representing the repository
	repoProject := &model.Project{
		Name:          repo.Name,
		Path:          repo.Path,
		CurrentBranch: repo.CurrentBranch,
		MainShells:    repo.MainShells,
		Worktrees:     make([]*model.Worktree, 0, len(repo.Branches)),
		Expanded:      true, // Always show branches
		Status:        repo.Status,
		StatusReason:  repo.StatusReason,
	}

	// Convert each branch to a worktree for display
	for _, branch := range repo.Branches {
		// Each branch becomes a "worktree" in the display
		// If the branch has an actual worktree, use it; otherwise create a virtual one
		var worktree *model.Worktree

		if branch.Worktree != nil {
			// Use the existing worktree
			worktree = branch.Worktree
		} else {
			// Create a virtual worktree for branches without actual worktrees
			worktree = &model.Worktree{
				ID:     branch.Name,
				Name:   branch.GetDisplayName(),
				Branch: branch.Name,
				Path:   "", // No actual path since no worktree exists
				Shells: make(map[model.ShellType]*model.Shell),
				Status: branch.Status,
				StatusReason: branch.StatusReason,
			}
		}

		repoProject.Worktrees = append(repoProject.Worktrees, worktree)
	}

	logger.Info("Converted repository to project model",
		"repo", repo.Name,
		"branch_count", len(repo.Branches),
		"worktree_count", len(repoProject.Worktrees))

	return []*model.Project{repoProject}
}

// doUpdateNavigationProjectsOld is the fallback to the old project discovery method
func (nu *NavigationUpdater) doUpdateNavigationProjectsOld() error {
	logger := log.Get()
	logger.Warn("Falling back to old project discovery method")

	// Get model projects directly from the external project map
	modelProjects := nu.app.projects.GetModelProjects()

	// If no projects discovered yet, show at least the current project
	if len(modelProjects) == 0 {
		logger.Info("No projects discovered yet, using current directory")
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
		if p.Path != "" {
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
				break
			}
		}
	}

	// Discover existing worktrees for each project
	for _, modelProject := range modelProjects {
		// Ensure shells are initialized and clear worktrees for fresh discovery
		if modelProject.MainShells == nil {
			modelProject.MainShells = make(map[model.ShellType]*model.Shell)
		}
		// Always reset worktrees to prevent duplicates on repeated calls
		modelProject.Worktrees = []*model.Worktree{}

		// Always show expanded to see worktrees
		modelProject.Expanded = true

		// ONLY discover git worktrees for the monorepo root project
		isMonorepoRoot := monorepoRoot != nil && modelProject.Path == monorepoRoot.Path

		if isMonorepoRoot && nu.app.worktreeService != nil {
			wtManager := projectworktree.NewManager(modelProject.Path)
			worktrees, err := wtManager.ListWorktrees()
			if err == nil {
				for _, wt := range worktrees {
					// Skip the main working directory (not a real worktree)
					if wt.Path == modelProject.Path {
						continue
					}

					modelWorktree := &model.Worktree{
						ID:         wt.Branch,
						Name:       filepath.Base(wt.Path),
						Branch:     wt.Branch,
						Path:       wt.Path,
						IsPrunable: wt.IsPrunable,
						Shells:     make(map[model.ShellType]*model.Shell),
					}
					modelProject.Worktrees = append(modelProject.Worktrees, modelWorktree)
				}
			}
		}
	}

	// Load persisted status for all projects and worktrees
	if nu.app.statusRepo != nil {
		nu.loadPersistedStatus(modelProjects)
	}

	// Update navigation component with real projects
	if navComp := nu.app.uiManager.GetNavigationComponent(); navComp != nil {
		navComp.SetProjects(modelProjects)
		nu.UpdateNavigationWithTmuxInfo()
	} else {
		logger.Warn("Navigation component not found")
	}

	return nil
}