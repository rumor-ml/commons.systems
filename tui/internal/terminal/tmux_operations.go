// tmux_operations.go - High-level tmux operations and business logic

package terminal

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// TmuxOperations handles high-level tmux operations and business logic
type TmuxOperations struct {
	tmuxPath      string
	logger        log.Logger
	windowManager *TmuxWindowManager
	executor      TmuxExecutor
}

// NewTmuxOperations creates a new TmuxOperations instance
func NewTmuxOperations(tmuxPath string, logger log.Logger, windowManager *TmuxWindowManager, executor TmuxExecutor) *TmuxOperations {
	return &TmuxOperations{
		tmuxPath:      tmuxPath,
		logger:        logger,
		windowManager: windowManager,
		executor:      executor,
	}
}

// CreateWindow creates a window in the specified session with proper working directory determination
func (ops *TmuxOperations) CreateWindow(tm *TmuxManager, sessionName, windowName, command string, worktreeID string, project *model.Project) (*TmuxWindow, error) {
	tm.mutex.Lock()
	defer tm.mutex.Unlock()

	session, exists := tm.sessions[sessionName]
	if !exists {
		return nil, fmt.Errorf("session not found: %s", sessionName)
	}

	// Check if window already exists
	session.mutex.RLock()
	if window, exists := session.Windows[windowName]; exists {
		session.mutex.RUnlock()
		ops.logger.Info("Window already exists, returning existing window",
			"sessionName", sessionName,
			"windowName", windowName,
			"windowIndex", window.Index)
		return window, nil
	}
	session.mutex.RUnlock()

	// Determine working directory
	workingDir := ops.determineWorkingDirectory(session, worktreeID, project, sessionName)

	// Create tmux window
	windowIndex, err := ops.windowManager.createTmuxWindow(sessionName, windowName, command, workingDir)
	if err != nil {
		return nil, fmt.Errorf("failed to create tmux window: %w", err)
	}

	// Create window object
	window := &TmuxWindow{
		Index:      windowIndex,
		Name:       windowName,
		Command:    command,
		WorktreeID: worktreeID,
		Active:     true,
	}

	session.mutex.Lock()
	session.Windows[windowName] = window
	session.mutex.Unlock()

	ops.logger.Info("Created tmux window", "session", sessionName, "window", windowName, "index", windowIndex)

	// After creating the window, verify it exists in tmux
	ops.verifyWindowCreation(sessionName)

	return window, nil
}

// CreateOrGetWindow creates a new window or returns an existing one, with intelligent path-based matching
func (ops *TmuxOperations) CreateOrGetWindow(tm *TmuxManager, sessionName, windowName, command string, worktreeID string, project *model.Project) (*TmuxWindow, error) {
	// Check if window exists first
	tm.mutex.RLock()
	session, sessionExists := tm.sessions[sessionName]
	tm.mutex.RUnlock()

	if !sessionExists {
		return nil, fmt.Errorf("session not found: %s", sessionName)
	}

	// Try to find existing window by path if we have target path information
	if existingWindow := ops.findExistingWindowByPath(tm, session, sessionName, windowName, command, worktreeID, project); existingWindow != nil {
		return existingWindow, nil
	}

	// Fall back to original logic - check by window name
	session.mutex.RLock()
	window, windowExists := session.Windows[windowName]
	session.mutex.RUnlock()

	if windowExists {
		// Check if window still exists in tmux (might have been closed)
		if tmuxWindowExists(ops.executor, sessionName, windowName) {
			ops.logger.Info("Window exists in both cache and tmux, returning existing",
				"sessionName", sessionName,
				"windowName", windowName)
			return window, nil
		}

		// Window was closed, remove from cache
		ops.logger.Info("Window exists in cache but not in tmux, removing from cache",
			"sessionName", sessionName,
			"windowName", windowName)
		session.mutex.Lock()
		delete(session.Windows, windowName)
		session.mutex.Unlock()
	}

	// Create new window
	return ops.CreateWindow(tm, sessionName, windowName, command, worktreeID, project)
}

// determineWorkingDirectory determines the appropriate working directory for a new window
func (ops *TmuxOperations) determineWorkingDirectory(session *TmuxSession, worktreeID string, project *model.Project, sessionName string) string {
	ops.logger.Info("CreateWindow - determining working directory",
		"sessionName", sessionName,
		"command", "determine",
		"worktreeID", worktreeID,
		"session.Project", session.Project)

	if worktreeID != "" {
		// Check if worktreeID is actually a full path
		if filepath.IsAbs(worktreeID) {
			// It's a full path, use it directly
			ops.logger.Info("Using provided worktree path", "path", worktreeID)
			return worktreeID
		} else if session.Project != nil {
			// It's a worktree ID, construct the path
			worktreeDir := filepath.Join(session.Project.Path, ".worktrees", worktreeID)
			ops.logger.Info("Using worktree directory", "worktreeID", worktreeID, "path", worktreeDir)
			return worktreeDir
		} else {
			// Fallback to current directory
			ops.logger.Warn("No project info for worktree, using current directory", "worktreeID", worktreeID)
			return "."
		}
	} else if project != nil {
		// Regular project window - use passed project instead of session.Project
		ops.logger.Info("🏠 Using project working directory",
			"projectName", project.Name,
			"projectPath", project.Path,
			"workingDir", project.Path)
		return project.Path
	} else {
		// No project info, use home directory as fallback
		homeDir, err := os.UserHomeDir()
		if err != nil {
			homeDir = os.Getenv("HOME")
			if homeDir == "" {
				homeDir = "/"
			}
		}
		ops.logger.Warn("No project info for session, using home directory",
			"sessionName", sessionName,
			"workingDir", homeDir)
		return homeDir
	}
}

// findExistingWindowByPath attempts to find an existing window by target path
func (ops *TmuxOperations) findExistingWindowByPath(tm *TmuxManager, session *TmuxSession, sessionName, windowName, command, worktreeID string, project *model.Project) *TmuxWindow {
	// Determine the target path for this window
	var targetPath string
	if worktreeID != "" && filepath.IsAbs(worktreeID) {
		// Worktree path provided
		targetPath = worktreeID
	} else if project != nil {
		// Use passed project path instead of session.Project
		targetPath = project.Path
	}

	// If we have a target path, try to find an existing window by path
	if targetPath != "" {
		// Extract the window type from the window name (e.g., "claude" from "project-claude")
		windowType := command // Default to command
		if strings.Contains(windowName, "-") {
			parts := strings.Split(windowName, "-")
			windowType = parts[len(parts)-1]
		}

		existingWindow, err := tm.FindWindowByPath(sessionName, targetPath, windowType)
		if err != nil {
			ops.logger.Warn("Error finding window by path", "error", err)
		} else if existingWindow != nil {
			ops.logger.Info("Found existing window by path, reusing it",
				"sessionName", sessionName,
				"windowName", existingWindow.Name,
				"windowIndex", existingWindow.Index,
				"targetPath", targetPath)

			// Update our cache with this window
			session.mutex.Lock()
			session.Windows[windowName] = existingWindow
			session.mutex.Unlock()

			return existingWindow
		}
	}
	return nil
}

// verifyWindowCreation verifies that a window was successfully created in tmux
func (ops *TmuxOperations) verifyWindowCreation(sessionName string) {
	verifyOutput, _ := ops.executor.Execute("list-windows", "-t", sessionName, "-F", "#{window_index}:#{window_name}")
	ops.logger.Info("Verified tmux windows after creation",
		"sessionName", sessionName,
		"windows", string(verifyOutput))
}

// FindExistingTUIInstance searches for existing TUI instances running 'go run main.go'
func (ops *TmuxOperations) FindExistingTUIInstance() (string, string, error) {
	if ops.tmuxPath == "" {
		return "", "", fmt.Errorf("tmux executable not found")
	}

	// List all sessions with their panes and commands
	output, err := ops.executor.Execute("list-panes", "-a", "-F", "#{session_name}:#{window_index}.#{pane_index} #{pane_current_command} #{pane_current_path}")
	if err != nil {
		return "", "", fmt.Errorf("failed to list panes: %w", err)
	}

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	for _, line := range lines {
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}

		paneTarget := parts[0]
		command := parts[1]

		// Look for 'go' processes (indicating 'go run main.go' or similar)
		if command == "go" {
			// Extract session and window from pane target (format: session:window.pane)
			sessionWindow := strings.Split(paneTarget, ".")[0]
			sessionWindowParts := strings.Split(sessionWindow, ":")
			if len(sessionWindowParts) == 2 {
				sessionName := sessionWindowParts[0]
				windowIndex := sessionWindowParts[1]
				ops.logger.Info("Found existing TUI instance", "session", sessionName, "window", windowIndex, "pane", paneTarget)
				return sessionName, windowIndex, nil
			}
		}
	}

	return "", "", fmt.Errorf("no existing TUI instance found")
}

// SwitchToExistingTUI switches to an existing TUI instance
func (ops *TmuxOperations) SwitchToExistingTUI(sessionName, windowIndex string) error {
	// Parse window index
	windowIndexInt, err := strconv.Atoi(windowIndex)
	if err != nil {
		return fmt.Errorf("invalid window index: %s", windowIndex)
	}

	// Switch to the session and window
	_, err = ops.executor.Execute("select-session", "-t", sessionName)
	if err != nil {
		return fmt.Errorf("failed to switch to session %s: %w", sessionName, err)
	}

	_, err = ops.executor.Execute("select-window", "-t", fmt.Sprintf("%s:%d", sessionName, windowIndexInt))
	if err != nil {
		return fmt.Errorf("failed to switch to window %d in session %s: %w", windowIndexInt, sessionName, err)
	}

	ops.logger.Info("Switched to existing TUI instance", "session", sessionName, "window", windowIndex)
	return nil
}