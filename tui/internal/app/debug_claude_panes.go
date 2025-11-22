// debug_claude_panes.go - Debugging helpers for Claude pane issues

package app

import (
	"fmt"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
	"time"
)

// DebugClaudePanes logs detailed information about Claude pane discovery and matching
func (a *App) DebugClaudePanes(project *model.Project) {
	logger := log.Get()

	logger.Info("=== DEBUG CLAUDE PANES ===")
	logger.Info("Target project", "name", project.Name, "path", project.Path)

	if a.tmuxManager == nil {
		logger.Error("TmuxManager is nil")
		return
	}

	// Get all panes
	allPanes := a.tmuxManager.GetAllPanes()
	logger.Info("Total panes discovered", "count", len(allPanes))

	// Log all Claude panes
	claudePaneCount := 0
	for paneTarget, pane := range allPanes {
		if pane.ShellType == model.ShellTypeClaude {
			claudePaneCount++
			logger.Info("Found Claude pane",
				"paneTarget", paneTarget,
				"panePath", pane.CurrentPath,
				"paneTitle", pane.PaneTitle,
				"project", func() string {
					if pane.Project != nil {
						return fmt.Sprintf("%s (%s)", pane.Project.Name, pane.Project.Path)
					}
					return "nil"
				}(),
				"worktree", func() string {
					if pane.Worktree != nil {
						return pane.Worktree.ID
					}
					return "nil"
				}(),
				"matchesTargetPath", pane.CurrentPath == project.Path,
				"matchesTargetProject", pane.Project != nil && pane.Project.Name == project.Name,
			)
		}
	}

	logger.Info("Total Claude panes found", "count", claudePaneCount)

	// Log registry information
	registry := a.tmuxManager.GetPaneRegistry()
	if registry != nil {
		registryEntries := registry.GetProjectPanes(project, model.ShellTypeClaude)
		logger.Info("Registry entries for project", "count", len(registryEntries))

		for i, entry := range registryEntries {
			logger.Info("Registry entry",
				"index", i,
				"paneTarget", entry.PaneTarget,
				"originalPath", entry.OriginalPath,
				"firstSeen", entry.FirstSeen,
				"lastActive", entry.LastActive,
				"timeSinceActive", time.Since(entry.LastActive),
				"priority", func() string {
					if time.Since(entry.LastActive) < time.Minute {
						return "HIGH (active < 1min)"
					} else if i == 0 {
						return "SELECTED (most recent)"
					}
					return "normal"
				}())
		}
	}

	// Test the new FindProjectPane method
	existingPane := a.tmuxManager.FindProjectPane(project, model.ShellTypeClaude)
	if existingPane != nil {
		logger.Info("FindProjectPane returned a pane",
			"paneTarget", existingPane.GetTmuxTarget(),
			"currentPath", existingPane.CurrentPath,
			"paneTitle", existingPane.PaneTitle,
			"selectionMethod", func() string {
				// Check if it was found via registry
				if entry, exists := registry.GetEntry(existingPane.GetTmuxTarget()); exists {
					return fmt.Sprintf("registry (original path: %s)", entry.OriginalPath)
				}
				return "exact path match"
			}())
	} else {
		logger.Info("FindProjectPane returned nil - will create new Claude shell")
	}

	logger.Info("=== END DEBUG CLAUDE PANES ===")
}
