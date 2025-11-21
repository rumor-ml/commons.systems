// tmux_operations_advanced.go - Advanced session and discovery operations

package terminal

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// TmuxAdvancedOperations handles advanced session and discovery operations
type TmuxAdvancedOperations struct {
	tmuxPath      string
	logger        log.Logger
	executor      TmuxExecutor
}

// NewTmuxAdvancedOperations creates a new TmuxAdvancedOperations instance
func NewTmuxAdvancedOperations(tmuxPath string, logger log.Logger, executor TmuxExecutor) *TmuxAdvancedOperations {
	return &TmuxAdvancedOperations{
		tmuxPath: tmuxPath,
		logger:   logger,
		executor: executor,
	}
}

// CreateProjectSession creates or finds a tmux session for a project
func (ops *TmuxAdvancedOperations) CreateProjectSession(tm *TmuxManager, project *model.Project) (*TmuxSession, error) {
	tm.mutex.Lock()
	defer tm.mutex.Unlock()

	// Get the current tmux session instead of creating a new one
	currentSessionName, err := tm.getCurrentTmuxSession()
	if err != nil {
		return nil, fmt.Errorf("failed to get current tmux session for project %s: %w", project.Name, err)
	}

	ops.logger.Info("Using current tmux session for project",
		"sessionName", currentSessionName,
		"project", project.Name)

	// Check if session already exists in memory
	if session, exists := tm.sessions[currentSessionName]; exists {
		// Don't update the project association for shared sessions
		// This prevents navigation confusion when multiple projects use the same session
		ops.logger.Debug("Using existing shared session without changing project association",
			"session", currentSessionName,
			"existingProject", session.Project.Name,
			"requestedProject", project.Name)
		return session, nil
	}

	// Create session object for current tmux session
	session := &TmuxSession{
		Name:    currentSessionName,
		Project: project,
		Windows: make(map[string]*TmuxWindow),
		Active:  true,
	}
	tm.sessions[currentSessionName] = session

	// Discover existing windows in the current session
	if err := ops.DiscoverSessionWindowsLocked(tm, currentSessionName); err != nil {
		ops.logger.Warn("Failed to discover existing windows", "session", currentSessionName, "error", err)
	}

	ops.logger.Info("Using current tmux session for project", "session", currentSessionName, "project", project.Name)

	return session, nil
}

// AttachToWindow attaches to a specific window in a session
func (ops *TmuxAdvancedOperations) AttachToWindow(tm *TmuxManager, sessionName, windowName string) error {
	tm.mutex.RLock()
	session, exists := tm.sessions[sessionName]
	tm.mutex.RUnlock()

	if !exists {
		return fmt.Errorf("session not found: %s", sessionName)
	}

	// First check if window exists in our cache
	session.mutex.RLock()
	window, windowExists := session.Windows[windowName]
	session.mutex.RUnlock()

	if !windowExists {
		ops.logger.Warn("Window not found in cache", "session", sessionName, "window", windowName)
		// Try to parse windowName as an index if it's a number
		if windowIndex, err := strconv.Atoi(windowName); err == nil {
			// It's a window index, use it directly
			ops.logger.Info("Using window index directly", "session", sessionName, "windowIndex", windowIndex)
			return tm.navigator.AttachToWindow(sessionName, windowIndex)
		}
		return fmt.Errorf("window not found: %s", windowName)
	}

	// Use the navigator to perform the actual attachment
	return tm.navigator.AttachToWindow(sessionName, window.Index)
}

// AttachToPane attaches to a specific pane using the target string
func (ops *TmuxAdvancedOperations) AttachToPane(tm *TmuxManager, paneTarget string) error {
	if ops.tmuxPath == "" {
		return fmt.Errorf("tmux executable not found")
	}

	// Check if pane exists
	tm.mutex.RLock()
	pane, exists := tm.panes[paneTarget]
	tm.mutex.RUnlock()

	if !exists {
		return fmt.Errorf("pane not found: %s", paneTarget)
	}

	ops.logger.Info("Attaching to tmux pane",
		"target", paneTarget,
		"session", pane.SessionName,
		"window", pane.WindowIndex,
		"pane", pane.PaneIndex)

	// Use navigator to attach to the pane
	err := tm.navigator.AttachToPane(pane.SessionName, pane.WindowIndex, pane.PaneIndex)
	if err != nil {
		return fmt.Errorf("failed to attach to tmux pane: %w", err)
	}

	ops.logger.Info("Successfully attached to tmux pane", "target", paneTarget)
	return nil
}

// DiscoverExistingSessions discovers existing tmux sessions
func (ops *TmuxAdvancedOperations) DiscoverExistingSessions(tm *TmuxManager) error {
	sessions, err := tm.sessionDiscovery.DiscoverExistingSessions()
	if err != nil {
		return err
	}

	// Update internal sessions map and discover windows for each session
	tm.mutex.Lock()
	defer tm.mutex.Unlock()
	
	for sessionName, session := range sessions {
		tm.sessions[sessionName] = session
		
		// Discover windows in this session (using locked version since we already hold the lock)
		err := ops.DiscoverSessionWindowsLocked(tm, sessionName)
		if err != nil {
			ops.logger.Error("Failed to discover windows for session",
				"session", sessionName, "error", err)
			continue
		}
	}

	return nil
}

// DiscoverAllPanes discovers and registers ALL tmux panes across all sessions
func (ops *TmuxAdvancedOperations) DiscoverAllPanes(tm *TmuxManager) error {
	panes, outputStr, err := tm.paneDiscovery.DiscoverAllPanes()
	if err != nil {
		return err
	}

	// Change detection: Check if output has actually changed
	if tm.lastPanesOutput == outputStr {
		ops.logger.Debug("Pane discovery: no changes detected, skipping processing")
		return nil
	}

	ops.logger.Debug("Pane discovery: changes detected, processing",
		"outputLength", len(outputStr),
		"previousLength", len(tm.lastPanesOutput))

	// Save existing project associations before clearing
	oldProjectAssociations := make(map[string]*model.Project)
	oldWorktreeAssociations := make(map[string]*model.Worktree)
	for target, pane := range tm.panes {
		if pane.Project != nil {
			oldProjectAssociations[target] = pane.Project
		}
		if pane.Worktree != nil {
			oldWorktreeAssociations[target] = pane.Worktree
		}
	}

	// Process pane output with old associations to restore mappings
	if outputStr != "" {
		tm.panes, err = tm.paneDiscovery.ProcessPaneOutput(outputStr, oldProjectAssociations, oldWorktreeAssociations)
		if err != nil {
			return err
		}
	} else {
		tm.panes = panes
	}

	// Only update cached output if processing succeeded
	tm.lastPanesOutput = outputStr
	return nil
}

// GetCurrentTmuxSession gets the current tmux session name
func (ops *TmuxAdvancedOperations) GetCurrentTmuxSession(currentSessionOverride string) (string, error) {
	// Check for test override first
	if currentSessionOverride != "" {
		return currentSessionOverride, nil
	}

	if ops.tmuxPath == "" {
		return "", fmt.Errorf("tmux executable not found")
	}

	// Get current session name from tmux
	output, err := ops.executor.Execute("display-message", "-p", "#S")
	if err != nil {
		return "", fmt.Errorf("failed to get current session: %w", err)
	}

	return strings.TrimSpace(string(output)), nil
}

// DiscoverSessionWindowsLocked discovers windows for a session with mutex already held
func (ops *TmuxAdvancedOperations) DiscoverSessionWindowsLocked(tm *TmuxManager, sessionName string) error {
	// Use GetWindowsWithDetails to get complete window information including pane titles
	windows, err := tm.windowManager.GetWindowsWithDetails(sessionName)
	if err != nil {
		return fmt.Errorf("failed to get windows with details for session %s: %w", sessionName, err)
	}

	// Get session - mutex is already held by caller
	session, exists := tm.sessions[sessionName]
	if !exists {
		// This shouldn't happen if called from CreateProjectSession
		return fmt.Errorf("session not found: %s", sessionName)
	}

	// Register windows with complete details
	for _, window := range windows {
		// Create window entry - no need to lock session mutex as we have tm.mutex
		if _, exists := session.Windows[window.Name]; !exists {
			session.Windows[window.Name] = window

			ops.logger.Debug("Discovered existing tmux window",
				"session", sessionName,
				"window", window.Name,
				"index", window.Index,
				"paneTitle", window.PaneTitle,
				"command", window.Command)
		}
	}

	return nil
}

// DiscoverSessionWindows discovers and registers windows for an existing tmux session
func (ops *TmuxAdvancedOperations) DiscoverSessionWindows(tm *TmuxManager, sessionName string) error {
	// Use GetWindowsWithDetails to get complete window information including pane titles
	windows, err := tm.windowManager.GetWindowsWithDetails(sessionName)
	if err != nil {
		return fmt.Errorf("failed to get windows with details for session %s: %w", sessionName, err)
	}

	// Get session - it should already exist from CreateProjectSession
	tm.mutex.RLock()
	session, exists := tm.sessions[sessionName]
	tm.mutex.RUnlock()

	if !exists {
		// This shouldn't happen if called from CreateProjectSession, but handle it
		ops.logger.Warn("Session not found during window discovery, creating minimal entry", "sessionName", sessionName)
		tm.mutex.Lock()
		session = &TmuxSession{
			Name:    sessionName,
			Project: nil, // Will be nil for discovered sessions
			Windows: make(map[string]*TmuxWindow),
			Active:  true,
		}
		tm.sessions[sessionName] = session
		tm.mutex.Unlock()
	}

	// Register windows with complete details
	for _, window := range windows {
		// Create window entry with full details including pane title
		session.mutex.Lock()
		if _, exists := session.Windows[window.Name]; !exists {
			session.Windows[window.Name] = window

			ops.logger.Debug("Discovered existing tmux window",
				"session", sessionName,
				"window", window.Name,
				"index", window.Index,
				"paneTitle", window.PaneTitle,
				"command", window.Command)
		}
		session.mutex.Unlock()
	}

	return nil
}