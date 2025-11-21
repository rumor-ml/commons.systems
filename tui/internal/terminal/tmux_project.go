// Package terminal provides tmux project mapping functionality.

package terminal

import (
	"fmt"
	"strings"
	"time"

	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// TmuxProjectMapper handles project-to-session mapping functionality
type TmuxProjectMapper struct {
	logger log.Logger
}

// NewTmuxProjectMapper creates a new project mapper
func NewTmuxProjectMapper(logger log.Logger) *TmuxProjectMapper {
	return &TmuxProjectMapper{
		logger: logger,
	}
}

// addSessionShellsToProject adds shells from a tmux session to a project
func (pm *TmuxProjectMapper) addSessionShellsToProject(session *TmuxSession, project *model.Project) {
	for _, window := range session.Windows {
		// Determine shell type based on window name, command, and pane title
		var shellType model.ShellType
		switch {
		case window.Name == "zsh" || strings.Contains(window.Command, "zsh"):
			shellType = model.ShellTypeZsh
		case window.Name == "claude" || strings.Contains(window.Command, "claude"):
			shellType = model.ShellTypeClaude
		case isClaudeSession(window):
			shellType = model.ShellTypeClaude
		default:
			shellType = model.ShellTypeUnknown
		}

		// Create shell object
		shell := &model.Shell{
			Type:      shellType,
			ProcessID: 0, // Unknown for discovered sessions
			Status:    model.ShellStatusRunning,
			Command:   window.Command,
			PaneTitle: window.PaneTitle,
			CreatedAt: time.Now(),
			LastUsed:  time.Now(),
		}

		// Add to project main shells
		// For unknown sessions, each window becomes a separate shell
		if project.IsOtherSessionsProject() {
			// Use window name as unique key for other sessions
			shellKey := fmt.Sprintf("%s:%s", session.Name, window.Name)
			project.MainShells[model.ShellType(shellKey)] = shell
		} else {
			project.MainShells[shellType] = shell
		}
	}
}

// mapPanesToProjects assigns tmux panes to their corresponding projects
func (pm *TmuxProjectMapper) mapPanesToProjects(projects []*model.Project, panes map[string]*TmuxPane, paneRegistry *PaneRegistry) {
	pm.logger.Debug("Mapping panes to projects", "projectCount", len(projects), "paneCount", len(panes))

	// Register all panes with their projects
	for target, pane := range panes {
		// Find the best matching project for this pane
		bestProject := pm.findBestProjectForPane(pane, projects)
		if bestProject != nil {
			// Set the pane's project association
			pane.Project = bestProject
			// Also register in the registry
			paneRegistry.Register(pane, bestProject)
			pm.logger.Debug("Mapped pane to project",
				"paneTarget", target,
				"project", bestProject.Name,
				"paneCwd", pane.CurrentPath,
				"projectPath", bestProject.Path)
		} else {
			pm.logger.Debug("No project found for pane",
				"paneTarget", target,
				"paneCwd", pane.CurrentPath)
		}
	}
}

// findBestProjectForPane finds the project that best matches a pane's current directory
func (pm *TmuxProjectMapper) findBestProjectForPane(pane *TmuxPane, projects []*model.Project) *model.Project {
	var bestProject *model.Project
	var bestMatchLength int

	for _, project := range projects {
		if strings.HasPrefix(pane.CurrentPath, project.Path) {
			matchLength := len(project.Path)
			if matchLength > bestMatchLength {
				bestProject = project
				bestMatchLength = matchLength
			}
		}
	}

	return bestProject
}

// refreshPaneProjectMappings updates existing pane-to-project mappings
func (pm *TmuxProjectMapper) refreshPaneProjectMappings(projects []*model.Project, panes map[string]*TmuxPane, paneRegistry *PaneRegistry) {
	pm.logger.Debug("Refreshing pane project mappings",
		"projectCount", len(projects),
		"paneCount", len(panes))

	// ARCHITECTURAL DECISION: Clear registry and remap all panes from scratch
	//
	// Why we clear rather than update in-place:
	// - Panes may have moved between projects (users cd'ing around)
	// - Current directory takes precedence over historical "original" associations
	// - Simpler than tracking state changes and updating individual entries
	// - The registry's "stable mapping" purpose is within a single TUI session between refreshes
	//
	// Trade-off: We lose the historical FirstSeen and LastActive timestamps, but gain
	// correctness when users navigate between directories.
	pm.logger.Debug("Clearing registry for full remapping", "registryEntries", len(paneRegistry.entries))
	paneRegistry.entries = make(map[string]*PaneRegistryEntry)
	pm.mapPanesToProjects(projects, panes, paneRegistry)
}