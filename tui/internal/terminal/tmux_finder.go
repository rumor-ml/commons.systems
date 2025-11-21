// tmux_finder.go - Pane finding and matching functionality

package terminal

import (
	"sort"
	"strings"

	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// TmuxFinder handles finding and matching panes for projects and worktrees
type TmuxFinder struct {
	logger log.Logger
}

// NewTmuxFinder creates a new TmuxFinder instance
func NewTmuxFinder(logger log.Logger) *TmuxFinder {
	return &TmuxFinder{
		logger: logger,
	}
}

// FindProjectPane finds the best matching pane for a project and shell type using the registry
func (finder *TmuxFinder) FindProjectPane(tm *TmuxManager, project *model.Project, shellType model.ShellType) *TmuxPane {
	tm.mutex.RLock()
	defer tm.mutex.RUnlock()

	finder.logger.Info("Finding project pane using registry",
		"project", project.Name,
		"shellType", shellType)

	// First, check the registry for panes associated with this project
	registryEntries := tm.paneRegistry.GetProjectPanes(project, shellType)

	if len(registryEntries) > 0 {
		// Registry entries are already sorted by priority
		// But we need to check each one to ensure it's still in the project directory
		for _, entry := range registryEntries {
			// Get the actual pane from our current panes map
			if pane, exists := tm.panes[entry.PaneTarget]; exists {
				// Skip worktree panes when looking for project-level panes
				if pane.Worktree != nil {
					continue
				}

				// CRITICAL FIX: Verify the pane's CURRENT path still matches the project
				// Users may have cd'd to a different directory, so we can't trust originalPath
				if !strings.HasPrefix(pane.CurrentPath, project.Path) {
					finder.logger.Warn("Skipping registry entry - pane has moved to different project",
						"paneTarget", entry.PaneTarget,
						"originalPath", entry.OriginalPath,
						"currentPath", pane.CurrentPath,
						"expectedProject", project.Path)
					continue
				}

				// Note: Pane may be in a sub-project directory (e.g., /parent/child)
				// The registry prioritizes recently active panes, so if a pane is in a subdirectory
				// that's also a project, it will typically be found via that project's lookup first.
				// Edge case: If both parent and child projects request the same pane, the caller
				// with exact path match will find it via the fallback below.

				finder.logger.Info("Found pane via registry",
					"paneTarget", entry.PaneTarget,
					"originalPath", entry.OriginalPath,
					"currentPath", pane.CurrentPath,
					"lastActive", entry.LastActive)
				return pane
			}
		}
	}

	// Fallback: search current panes by exact path match (for newly created panes)
	for _, pane := range tm.panes {
		if pane.ShellType == shellType &&
			pane.CurrentPath == project.Path &&
			pane.Worktree == nil {
			finder.logger.Info("Found pane via exact path match (not in registry)",
				"paneTarget", pane.GetTmuxTarget(),
				"path", pane.CurrentPath)
			return pane
		}
	}

	finder.logger.Info("No matching pane found for project",
		"project", project.Name,
		"shellType", shellType)

	return nil
}

// FindWorktreePane finds the best matching pane for a worktree and shell type
func (finder *TmuxFinder) FindWorktreePane(tm *TmuxManager, project *model.Project, worktree *model.Worktree, shellType model.ShellType) *TmuxPane {
	tm.mutex.RLock()
	defer tm.mutex.RUnlock()

	finder.logger.Info("Finding worktree pane",
		"project", project.Name,
		"worktree", worktree.Name,
		"shellType", shellType,
		"worktreePath", worktree.Path)

	// First, try to find via registry
	var candidates []*TmuxPane

	// Get all panes for the project from registry
	registryEntries := tm.paneRegistry.GetProjectPanes(project, shellType)

	for _, entry := range registryEntries {
		if pane, exists := tm.panes[entry.PaneTarget]; exists {
			// Check if this pane is associated with the target worktree
			if pane.Worktree == worktree {
				candidates = append(candidates, pane)
			}
		}
	}

	// If no registry matches, search through all panes
	if len(candidates) == 0 {
		for _, pane := range tm.panes {
			if pane.Project == project && pane.Worktree == worktree && pane.ShellType == shellType {
				candidates = append(candidates, pane)
			}
		}
	}

	if len(candidates) == 0 {
		finder.logger.Info("No matching worktree pane found",
			"project", project.Name,
			"worktree", worktree.Name,
			"shellType", shellType)
		return nil
	}

	// Sort candidates by last activity (most recent first)
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].LastActivity.After(candidates[j].LastActivity)
	})

	selected := candidates[0]
	finder.logger.Info("Found worktree pane",
		"project", project.Name,
		"worktree", worktree.Name,
		"shellType", shellType,
		"pane", selected.GetTmuxTarget(),
		"candidates", len(candidates))

	return selected
}