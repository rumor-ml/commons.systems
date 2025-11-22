// pane_discovery.go - Tmux pane discovery and management functionality

package terminal

import (
	"strconv"
	"strings"

	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// PaneDiscovery handles tmux pane discovery and mapping functionality
type PaneDiscovery struct {
	tmuxPath string
	logger   log.Logger
	executor TmuxExecutor
}

// NewPaneDiscovery creates a new pane discovery manager
func NewPaneDiscovery(tmuxPath string, logger log.Logger, executor TmuxExecutor) *PaneDiscovery {
	return &PaneDiscovery{
		tmuxPath: tmuxPath,
		logger:   logger,
		executor: executor,
	}
}

// DiscoverAllPanes discovers and registers ALL tmux panes across all sessions
func (pd *PaneDiscovery) DiscoverAllPanes() (map[string]*TmuxPane, string, error) {
	// Removed: High-frequency DEBUG log (called by tmux ticker every 2 seconds = 0.5/sec)

	if pd.tmuxPath == "" {
		pd.logger.Warn("tmux executable not found, skipping pane discovery")
		return make(map[string]*TmuxPane), "", nil
	}

	// List all panes across all sessions with comprehensive information
	output, err := pd.executor.Execute("list-panes", "-a", "-F",
		"#{session_name}:#{window_index}:#{pane_index}:#{pane_title}:#{pane_current_command}:#{pane_current_path}:#{pane_active}:#{pane_tty}")

	if err != nil {
		pd.logger.Warn("Failed to run tmux list-panes", "error", err)
		return make(map[string]*TmuxPane), "", nil
	}

	outputStr := string(output)
	panes, err := pd.ProcessPaneOutput(outputStr, nil, nil)
	return panes, outputStr, err
}

// ProcessPaneOutput processes tmux pane listing output
func (pd *PaneDiscovery) ProcessPaneOutput(output string, oldProjectAssociations map[string]*model.Project, oldWorktreeAssociations map[string]*model.Worktree) (map[string]*TmuxPane, error) {
	panes := make(map[string]*TmuxPane)
	paneLines := strings.Split(strings.TrimSpace(output), "\n")

	for _, line := range paneLines {
		if line == "" {
			continue
		}

		parts := strings.Split(line, ":")
		if len(parts) < 8 {
			pd.logger.Warn("Insufficient parts in tmux pane line", "line", line, "parts", len(parts), "expected", 8)
			continue
		}

		sessionName := parts[0]
		windowIndex, err := strconv.Atoi(parts[1])
		if err != nil {
			pd.logger.Warn("Invalid window index", "line", line, "windowIndex", parts[1])
			continue
		}

		paneIndex, err := strconv.Atoi(parts[2])
		if err != nil {
			pd.logger.Warn("Invalid pane index", "line", line, "paneIndex", parts[2])
			continue
		}

		paneTitle := parts[3]
		currentCommand := parts[4]
		currentPath := parts[5]
		isActive := parts[6] == "1"
		paneTTY := parts[7]

		// Create pane object
		pane := NewTmuxPane(sessionName, windowIndex, paneIndex)
		pane.PaneTitle = paneTitle
		pane.CurrentCommand = currentCommand
		pane.CurrentPath = currentPath
		pane.Active = isActive
		pane.PaneTTY = paneTTY

		// Detect shell type based on pane characteristics
		pane.DetectShellType()

		// Restore associations if they existed
		paneTarget := pane.GetTmuxTarget()
		if oldProjectAssociations != nil {
			if oldProject := oldProjectAssociations[paneTarget]; oldProject != nil {
				pane.Project = oldProject
			}
		}
		if oldWorktreeAssociations != nil {
			if oldWorktree := oldWorktreeAssociations[paneTarget]; oldWorktree != nil {
				pane.Worktree = oldWorktree
			}
		}

		panes[paneTarget] = pane
	}

	// Removed: High-frequency DEBUG log (called by tmux ticker every 2 seconds = 0.5/sec)
	return panes, nil
}

// MapPanesToProjects maps discovered panes to their associated projects
func (pd *PaneDiscovery) MapPanesToProjects(panes map[string]*TmuxPane, projects []*model.Project) {
	// Find or create "Other Sessions" project for unmapped panes
	var otherSessionsProject *model.Project
	for _, project := range projects {
		if project.IsOtherSessionsProject() {
			otherSessionsProject = project
			break
		}
	}
	if otherSessionsProject == nil {
		otherSessionsProject = model.NewOtherSessionsProject()
	}
	
	for _, pane := range panes {
		if !pd.mapPaneToProject(pane, projects) {
			// Map unmapped panes to "Other Sessions"
			pane.Project = otherSessionsProject
			pd.logger.Info("Mapped pane to Other Sessions",
				"pane", pane.GetTmuxTarget(),
				"path", pane.CurrentPath)
		}
	}
}

// mapPaneToProject maps a single pane to its project based on path matching
func (pd *PaneDiscovery) mapPaneToProject(pane *TmuxPane, projects []*model.Project) bool {
	if pane.CurrentPath == "" {
		return false
	}

	// Find the most specific matching project based on path
	var bestMatch *model.Project
	var bestWorktree *model.Worktree
	longestPathMatch := 0

	for _, project := range projects {
		// Check if pane path is within project root
		if strings.HasPrefix(pane.CurrentPath, project.Path) && len(project.Path) > longestPathMatch {
			bestMatch = project
			bestWorktree = nil // Reset worktree match
			longestPathMatch = len(project.Path)

			// Check for more specific worktree match
			for _, worktree := range project.Worktrees {
				if strings.HasPrefix(pane.CurrentPath, worktree.Path) && len(worktree.Path) > longestPathMatch {
					bestWorktree = worktree
					longestPathMatch = len(worktree.Path)
				}
			}
		}
	}

	if bestMatch != nil {
		pane.Project = bestMatch
		pane.Worktree = bestWorktree
		return true
	}
	
	return false
}