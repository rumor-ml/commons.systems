package terminal

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/natb1/tui/pkg/model"
)

// findSessionForWindow finds the session name for a given window
// Returns the session name or an error if the session cannot be determined
func (tm *TmuxManager) findSessionForWindow(window *TmuxWindow) (string, error) {
	tm.mutex.RLock()
	defer tm.mutex.RUnlock()

	// Search for window in sessions registry
	for sessionName, session := range tm.sessions {
		for _, w := range session.Windows {
			// Compare window properties instead of pointers
			if w.Name == window.Name && w.Index == window.Index {
				return sessionName, nil
			}
		}
	}

	// If we couldn't find the session, try to get the current session as fallback
	currentSession, err := tm.getCurrentTmuxSession()
	if err != nil {
		return "", fmt.Errorf("failed to determine session for window %s: %w", window.Name, err)
	}

	tm.logger.Debug("Using current session as fallback", "session", currentSession, "window", window.Name)
	return currentSession, nil
}

// EnsureProjectWindow ensures a window exists for the project where all panes have the same cwd
// Returns the window and a boolean indicating if a new window was created (true) or existing found (false)
func (tm *TmuxManager) EnsureProjectWindow(project *model.Project, shellType model.ShellType, paneMode string) (*TmuxWindow, bool, error) {
	// Get or create session for this project (don't lock here, CreateProjectSession handles its own locking)
	session, err := tm.CreateProjectSession(project)
	if err != nil {
		return nil, false, fmt.Errorf("failed to create project session: %w", err)
	}

	tm.mutex.Lock()
	defer tm.mutex.Unlock()

	// In grouped mode, find existing project window
	// In unsplit mode, always create new windows
	if paneMode == "grouped" {
		// Find a window where all panes have the project's path as cwd
		validWindow := tm.findValidProjectWindow(session, project)
		if validWindow != nil {
			tm.logger.Info("Found existing valid project window",
				"project", project.Name,
				"window", validWindow.Name,
				"index", validWindow.Index)
			return validWindow, false, nil // Existing window found
		}
	}
	// In unsplit mode or when no valid window exists in grouped mode

	// No valid window found, create a new one
	windowName := tm.generateProjectWindowName(project, shellType, paneMode)

	// Determine the command to run based on shell type
	var command string
	switch shellType {
	case model.ShellTypeClaude:
		command = "claude -c"
	case model.ShellTypeNvim:
		command = "nvim"
	default:
		command = "zsh"
	}

	// Create the window with the project's path as working directory
	output, err := tm.executor.Execute("new-window",
		"-t", session.Name,
		"-n", windowName,
		"-c", project.Path,
		command)

	if err != nil {
		return nil, false, fmt.Errorf("failed to create project window: %w\nOutput: %s", err, string(output))
	}

	// Get the newly created window's index
	indexOutput, err := tm.executor.Execute("list-windows",
		"-t", session.Name,
		"-F", "#{window_index}:#{window_name}")

	if err != nil {
		return nil, false, fmt.Errorf("failed to get window index: %w", err)
	}

	var windowIndex int
	lines := strings.Split(strings.TrimSpace(string(indexOutput)), "\n")
	for _, line := range lines {
		parts := strings.Split(line, ":")
		if len(parts) >= 2 && parts[1] == windowName {
			fmt.Sscanf(parts[0], "%d", &windowIndex)
			break
		}
	}

	window := &TmuxWindow{
		Name:    windowName,
		Index:   windowIndex,
	}

	// Register the window
	session.Windows[windowName] = window

	tm.logger.Info("Created new project window",
		"project", project.Name,
		"window", windowName,
		"index", windowIndex,
		"command", command)

	// No need to discover panes - we know the new window has exactly one pane (pane 0)
	// running the command we specified. The coordinator will attach to it directly.

	return window, true, nil // New window created
}

// findValidProjectWindow finds a window where all panes have the same cwd as the project
func (tm *TmuxManager) findValidProjectWindow(session *TmuxSession, project *model.Project) *TmuxWindow {
	// Get all windows in the session
	output, err := tm.executor.Execute("list-windows",
		"-t", session.Name,
		"-F", "#{window_index}:#{window_name}")

	if err != nil {
		tm.logger.Warn("Failed to list windows", "session", session.Name, "error", err)
		return nil
	}

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}

		parts := strings.Split(line, ":")
		if len(parts) < 2 {
			continue
		}

		windowIndex := parts[0]
		windowName := parts[1]

		// Check if this window is valid (all panes have project path as cwd)
		if tm.isWindowValid(session.Name, windowIndex, project.Path) {
			// Found a valid window
			var idx int
			fmt.Sscanf(windowIndex, "%d", &idx)
			
			window := &TmuxWindow{
				Name:    windowName,
				Index:   idx,
			}

			// Cache it
			session.Windows[windowName] = window
			
			return window
		}
	}

	return nil
}

// isWindowValid checks if all panes in a window have the same working directory
func (tm *TmuxManager) isWindowValid(sessionName, windowIndex, projectPath string) bool {
	// Get all panes in the window with their working directories
	output, err := tm.executor.Execute("list-panes",
		"-t", fmt.Sprintf("%s:%s", sessionName, windowIndex),
		"-F", "#{pane_current_path}")

	if err != nil {
		tm.logger.Warn("Failed to list panes", "session", sessionName, "window", windowIndex, "error", err)
		return false
	}

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	if len(lines) == 0 {
		return false
	}

	// Clean the project path for comparison
	cleanProjectPath := filepath.Clean(projectPath)

	// Check that all panes have the same cwd as the project
	for _, line := range lines {
		if line == "" {
			continue
		}
		
		panePath := filepath.Clean(line)
		if panePath != cleanProjectPath {
			// This window has panes with different cwds
			return false
		}
	}

	return true
}

// CreatePaneInWindow creates a new pane in an existing window
func (tm *TmuxManager) CreatePaneInWindow(window *TmuxWindow, shellType model.ShellType, project *model.Project) error {
	// Determine the command to run based on shell type
	var command string
	switch shellType {
	case model.ShellTypeClaude:
		command = "claude -c"
	case model.ShellTypeNvim:
		command = "nvim"
	default:
		command = "zsh"
	}

	// Get session name for the window
	sessionName, err := tm.findSessionForWindow(window)
	if err != nil {
		return err
	}

	// Create a vertical split in the window
	output, err := tm.executor.Execute("split-window",
		"-t", fmt.Sprintf("%s:%d", sessionName, window.Index),
		"-h", // Horizontal split (creates vertical panes)
		"-c", project.Path,
		command)

	if err != nil {
		return fmt.Errorf("failed to create pane: %w\nOutput: %s", err, string(output))
	}

	tm.logger.Info("Created new pane in project window",
		"project", project.Name,
		"window", window.Name,
		"shellType", shellType,
		"command", command)

	// Refresh pane discovery to pick up the new pane
	if err := tm.DiscoverAllPanes(); err != nil {
		tm.logger.Warn("Failed to refresh panes after creation", "error", err)
		// Don't fail the operation, the pane was created successfully
	}

	return nil
}

// FindProjectPaneByType finds an existing pane of the specified type in the project window
func (tm *TmuxManager) FindProjectPaneByType(window *TmuxWindow, shellType model.ShellType) (string, error) {
	// Get session name for the window
	sessionName, err := tm.findSessionForWindow(window)
	if err != nil {
		return "", err
	}

	// Get all panes in the window with their current commands and pane indices
	output, err := tm.executor.Execute("list-panes",
		"-t", fmt.Sprintf("%s:%d", sessionName, window.Index),
		"-F", "#{pane_index}:#{pane_current_command}")

	if err != nil {
		return "", fmt.Errorf("failed to list panes in %s:%d: %w", sessionName, window.Index, err)
	}

	// Determine what command to look for
	var targetCommand string
	switch shellType {
	case model.ShellTypeClaude:
		targetCommand = "claude"
	case model.ShellTypeNvim:
		targetCommand = "nvim"
	case model.ShellTypeZsh:
		targetCommand = "zsh"
	default:
		targetCommand = "zsh"
	}

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}

		parts := strings.Split(line, ":")
		if len(parts) < 2 {
			continue
		}

		paneIndex := parts[0]
		paneCommand := parts[1]

		// Check if this pane matches the shell type we're looking for
		if paneCommand == targetCommand ||
		   (shellType == model.ShellTypeClaude && strings.Contains(paneCommand, "claude")) ||
		   (shellType == model.ShellTypeNvim && strings.Contains(paneCommand, "vim")) {
			// Return the full pane target string (session:window.pane)
			paneTarget := fmt.Sprintf("%s:%d.%s", sessionName, window.Index, paneIndex)
			return paneTarget, nil
		}
	}

	return "", nil // No pane of this type found
}

// generateProjectWindowName generates a window name for a project
func (tm *TmuxManager) generateProjectWindowName(project *model.Project, shellType model.ShellType, paneMode string) string {
	// Generate name based on pane management mode
	var name string

	if paneMode == "unsplit" {
		// Unsplit mode: <project>:<shell>
		shellName := string(shellType)
		if shellName == "" {
			shellName = "shell"
		}
		name = fmt.Sprintf("%s:%s", project.Name, shellName)
	} else {
		// Grouped mode: <project>
		name = project.Name
	}

	if project.IsWorktree {
		// For worktrees, include branch info
		name = fmt.Sprintf("%s-wt", name)
	}

	// Sanitize the name for tmux
	name = strings.ReplaceAll(name, "/", "-")
	name = strings.ReplaceAll(name, " ", "_")

	return name
}

