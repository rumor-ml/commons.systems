// tmux_manager_layout.go - Pane layout management functionality

package terminal

import (
	"fmt"
	"sort"
	"strings"

	"github.com/rumor-ml/log/pkg/log"
)

// ApplyUnsplitLayout converts all windows to single-pane mode
// Each existing pane is moved to its own window named "<project>:<shell>"
func (tm *TmuxManager) ApplyUnsplitLayout() error {
	tm.mutex.Lock()
	defer tm.mutex.Unlock()

	logger := log.Get()
	logger.Info("Applying unsplit layout - reorganizing existing panes")

	// Get all panes with their information
	panes, err := tm.getAllPanesWithInfo()
	if err != nil {
		return fmt.Errorf("failed to get panes: %w", err)
	}

	// Track which panes to move and where
	type paneMove struct {
		pane       paneInfo
		newWindow  string
	}
	var moves []paneMove

	// Group panes by project
	panesByProject := tm.groupPanesByProject(panes)

	// Sort projects alphabetically
	var projects []string
	for project := range panesByProject {
		projects = append(projects, project)
	}
	sort.Strings(projects)

	// Plan moves for each pane
	for _, project := range projects {
		projectPanes := panesByProject[project]

		// Sort panes by shell type within each project
		sort.Slice(projectPanes, func(i, j int) bool {
			return projectPanes[i].shellType < projectPanes[j].shellType
		})

		for _, pane := range projectPanes {
			// Ensure proper naming for the window
			var windowName string
			if project == "" || project == "Other" {
				// Use the base path name for unnamed projects
				parts := strings.Split(pane.cwd, "/")
				if len(parts) > 0 {
					project = parts[len(parts)-1]
				}
			}
			windowName = fmt.Sprintf("%s:%s", project, pane.shellType)
			moves = append(moves, paneMove{
				pane:      pane,
				newWindow: windowName,
			})
		}
	}

	// Keep track of windows we've already created
	usedWindows := make(map[string]bool)

	// Now perform the moves - break panes out to new windows
	for _, move := range moves {
		// Check if we already have a window for this pane
		if usedWindows[move.newWindow] {
			// Window already exists for this name, skip
			continue
		}

		// Check if this pane is alone in its current window
		if move.pane.windowName == move.newWindow {
			// Already has the right name, just mark as used
			usedWindows[move.newWindow] = true
			continue
		}

		// Check if the pane is alone in its window
		output, _ := tm.executor.Execute("list-panes",
			"-t", fmt.Sprintf("%s:%s", move.pane.sessionName, move.pane.windowName),
			"-F", "#{pane_id}")
		paneCount := len(strings.Split(strings.TrimSpace(string(output)), "\n"))

		if paneCount == 1 {
			// Pane is alone, just rename the window
			_, err := tm.executor.Execute("rename-window",
				"-t", fmt.Sprintf("%s:%s", move.pane.sessionName, move.pane.windowName),
				move.newWindow)
			if err != nil {
				logger.Warn("Failed to rename window", "window", move.newWindow, "error", err)
			}
		} else {
			// Break pane out to a new window using break-pane
			// This moves the pane directly to a new window without creating a shell
			_, err := tm.executor.Execute("break-pane",
				"-s", move.pane.paneID,
				"-n", move.newWindow,
				"-d") // Don't switch to the new window
			if err != nil {
				logger.Warn("Failed to break pane to new window",
					"pane", move.pane.paneID,
					"window", move.newWindow,
					"error", err)
			}
		}
		usedWindows[move.newWindow] = true
	}

	logger.Info("Unsplit layout applied successfully - panes reorganized")
	return nil
}

// ApplyGroupedLayout groups all existing panes by project
// Panes are moved to project windows with vertical splits
func (tm *TmuxManager) ApplyGroupedLayout() error {
	tm.mutex.Lock()
	defer tm.mutex.Unlock()

	logger := log.Get()
	logger.Info("Applying grouped layout - reorganizing existing panes")

	// Get all panes with their information
	panes, err := tm.getAllPanesWithInfo()
	if err != nil {
		return fmt.Errorf("failed to get panes: %w", err)
	}

	// Group panes by project
	panesByProject := tm.groupPanesByProject(panes)
	logger.Info("Grouped panes by project", "groups", len(panesByProject))

	// Log the groups for debugging
	for project, projectPanes := range panesByProject {
		logger.Info("Project group", "project", project, "paneCount", len(projectPanes))
		for _, pane := range projectPanes {
			logger.Debug("  Pane", "id", pane.paneID, "window", pane.windowName, "cmd", pane.shellType)
		}
	}

	// Sort projects to process them in order
	var projects []string
	for project := range panesByProject {
		projects = append(projects, project)
	}
	sort.Strings(projects)

	// Process each project group
	for _, project := range projects {
		projectPanes := panesByProject[project]
		if len(projectPanes) == 0 {
			continue
		}

		// Ensure we have a valid project name
		if project == "" || project == "Other" {
			// Use the base path name for unnamed projects
			parts := strings.Split(projectPanes[0].cwd, "/")
			if len(parts) > 0 {
				project = parts[len(parts)-1]
			}
		}

		sessionName := projectPanes[0].sessionName
		windowName := project

		logger.Debug("Processing project", "project", project, "windowName", windowName, "paneCount", len(projectPanes))

		if len(projectPanes) == 1 {
			// Single pane - just rename the window
			pane := projectPanes[0]
			_, err := tm.executor.Execute("rename-window",
				"-t", fmt.Sprintf("%s:%s", sessionName, pane.windowName),
				windowName)
			if err != nil {
				logger.Warn("Failed to rename window", "window", windowName, "error", err)
			}
		} else {
			// Multiple panes - need to consolidate them
			firstPane := projectPanes[0]

			// Rename the first pane's window to the project name
			_, err := tm.executor.Execute("rename-window",
				"-t", fmt.Sprintf("%s:%s", sessionName, firstPane.windowName),
				windowName)
			if err != nil {
				logger.Warn("Failed to rename window for project", "project", project, "error", err)
			}

			// Join other panes from this project to the first window
			for i := 1; i < len(projectPanes); i++ {
				pane := projectPanes[i]

				// Use the pane ID directly for join-pane
				_, joinErr := tm.executor.Execute("join-pane",
					"-s", pane.paneID,
					"-t", fmt.Sprintf("%s:%s", sessionName, windowName),
					"-h", // Horizontal split (creates vertical panes)
					"-d")

				logger.Info("Joining pane", "paneID", pane.paneID, "target", windowName)

				if joinErr != nil {
					logger.Warn("Failed to join pane",
						"pane", pane.paneID,
						"project", project,
						"targetWindow", windowName,
						"error", err)
				}
			}

			// Even out the pane sizes
			tm.executor.Execute("select-layout",
				"-t", fmt.Sprintf("%s:%s", sessionName, windowName),
				"even-horizontal")
			// Ignore errors from layout command
		}
	}

	// Remove any empty windows
	if err := tm.removeEmptyWindows(); err != nil {
		logger.Warn("Failed to clean up empty windows", "error", err)
	}

	logger.Info("Grouped layout applied successfully - panes reorganized")
	return nil
}

// paneInfo holds information about a tmux pane
type paneInfo struct {
	sessionName string
	windowName  string
	paneID      string
	cwd         string
	shellType   string
	project     string
}

// getAllPanesWithInfo gets all panes with their metadata
func (tm *TmuxManager) getAllPanesWithInfo() ([]paneInfo, error) {
	logger := log.Get()

	// Get all panes with their session, window, and working directory
	// Use a different separator to avoid issues with paths containing colons
	output, err := tm.executor.Execute("list-panes",
		"-a", // All panes
		"-F", "#{session_name}|#{window_name}|#{pane_id}|#{pane_current_path}|#{pane_current_command}")

	if err != nil {
		return nil, fmt.Errorf("failed to list panes: %w", err)
	}

	var panes []paneInfo
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")

	for _, line := range lines {
		if line == "" {
			continue
		}

		parts := strings.Split(line, "|")
		if len(parts) < 5 {
			continue
		}

		pane := paneInfo{
			sessionName: parts[0],
			windowName:  parts[1],
			paneID:      parts[2],
			cwd:         parts[3],
			shellType:   tm.detectShellType(parts[4]),
		}

		// Detect project from cwd
		pane.project = tm.detectProjectFromPath(pane.cwd)

		logger.Debug("Found pane",
			"id", pane.paneID,
			"window", pane.windowName,
			"project", pane.project,
			"cwd", pane.cwd,
			"shellType", pane.shellType)

		panes = append(panes, pane)
	}

	return panes, nil
}

// groupPanesByProject groups panes by their project
func (tm *TmuxManager) groupPanesByProject(panes []paneInfo) map[string][]paneInfo {
	grouped := make(map[string][]paneInfo)

	for _, pane := range panes {
		project := pane.project
		if project == "" {
			project = "Other"
		}
		grouped[project] = append(grouped[project], pane)
	}

	return grouped
}

// detectShellType determines the shell type from the command
func (tm *TmuxManager) detectShellType(command string) string {
	switch {
	case strings.Contains(command, "claude") || strings.Contains(command, "node"):
		// node is typically Claude in our setup
		return "claude"
	case strings.Contains(command, "tui"):
		return "tui"
	case strings.Contains(command, "nvim") || strings.Contains(command, "vim"):
		return "nvim"
	case strings.Contains(command, "zsh") || strings.Contains(command, "bash"):
		return "zsh"
	default:
		return "shell"
	}
}

// detectProjectFromPath determines the project from a path
func (tm *TmuxManager) detectProjectFromPath(path string) string {
	// This should use the existing project discovery logic
	// For now, use a simple heuristic based on the path

	// Try to match against known projects
	for _, project := range tm.projects {
		if strings.HasPrefix(path, project.Path) {
			return project.Name
		}
	}

	// If no match, try to extract from path
	parts := strings.Split(path, "/")
	for i := len(parts) - 1; i >= 0; i-- {
		if parts[i] != "" && !strings.HasPrefix(parts[i], ".") {
			// Found a non-hidden directory name
			return parts[i]
		}
	}

	return ""
}

// killMultiPaneWindows removes windows with multiple panes
func (tm *TmuxManager) killMultiPaneWindows() error {
	// Get all windows with pane count
	output, err := tm.executor.Execute("list-windows",
		"-a",
		"-F", "#{session_name}:#{window_index}:#{window_panes}")
	if err != nil {
		return err
	}

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}

		parts := strings.Split(line, ":")
		if len(parts) < 3 {
			continue
		}

		var paneCount int
		fmt.Sscanf(parts[2], "%d", &paneCount)

		if paneCount > 1 {
			// Kill this window
			tm.executor.Execute("kill-window",
				"-t", fmt.Sprintf("%s:%s", parts[0], parts[1]))
			// Ignore errors
		}
	}

	return nil
}

// cleanupOldWindows removes windows that don't match the grouped layout
func (tm *TmuxManager) cleanupOldWindows(projectGroups map[string][]paneInfo) error {
	// Implementation depends on specific cleanup strategy
	// For now, we'll keep existing windows that match project names
	return nil
}

// removeEmptyWindows removes windows with no panes
func (tm *TmuxManager) removeEmptyWindows() error {
	// Get all windows with pane count
	output, err := tm.executor.Execute("list-windows",
		"-a",
		"-F", "#{session_name}:#{window_index}:#{window_panes}")
	if err != nil {
		return err
	}

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}

		parts := strings.Split(line, ":")
		if len(parts) < 3 {
			continue
		}

		var paneCount int
		fmt.Sscanf(parts[2], "%d", &paneCount)

		if paneCount == 0 {
			// Kill this empty window
			tm.executor.Execute("kill-window",
				"-t", fmt.Sprintf("%s:%s", parts[0], parts[1]))
			// Ignore errors
		}
	}

	return nil
}

// UpdateWindowNameForMode updates a window name based on the current pane management mode
func (tm *TmuxManager) UpdateWindowNameForMode(sessionName, windowIndex, projectName, shellType string, mode string) error {
	var newName string

	if mode == "unsplit" {
		newName = fmt.Sprintf("%s:%s", projectName, shellType)
	} else {
		newName = projectName
	}

	_, err := tm.executor.Execute("rename-window",
		"-t", fmt.Sprintf("%s:%s", sessionName, windowIndex),
		newName)

	return err
}