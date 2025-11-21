// Package app provides tmux coordination functionality for ICF TUI application.

package app

import (
	"fmt"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// TmuxCoordinator handles tmux attachment coordination and shell management
type TmuxCoordinator struct {
	app *App
}

// NewTmuxCoordinator creates a new tmux coordinator
func NewTmuxCoordinator(app *App) *TmuxCoordinator {
	return &TmuxCoordinator{
		app: app,
	}
}

// HandleTmuxAttachment handles tmux session/window creation and attachment
//
// For the 'cc' keybinding (icf + claude), this function:
// 1. Searches for existing project-level Claude shells (excluding worktree shells)
// 2. If found: attaches to the existing shell and keeps TUI running
// 3. If not found: creates a new tmux window with claude command in project directory
//
// This ensures 'cc' always provides access to a project-level Claude shell,
// either by reusing existing or creating new, never mixing with worktree shells.
func (tc *TmuxCoordinator) HandleTmuxAttachment(project *model.Project, shellType model.ShellType) tea.Msg {
	logger := log.Get()
	logger.Info("handleTmuxAttachment started", "project", project.Name, "shellType", shellType)

	// Ensure tmux sessions are properly mapped to projects before checking for existing shells
	// This prevents race conditions where the user presses 'ic' before periodic updates have run
	logger.Info("Performing synchronous tmux discovery before attachment check")

	// Get current projects for discovery
	currentProjects := make([]*model.Project, 0)
	if navComp := tc.app.uiManager.GetNavigationComponent(); navComp != nil {
		currentProjects = navComp.GetProjects()
	}

	// Perform synchronous discovery to ensure all panes are found and mapped
	if err := tc.app.tmuxManager.DiscoverPanesSynchronously(currentProjects); err != nil {
		logger.Error("Failed to perform synchronous pane discovery", "error", err)
		// Continue anyway, we might still find something
	}

	// Use the tmux manager's registry-based pane finding
	existingPane := tc.app.tmuxManager.FindProjectPane(project, shellType)
	logger.Info("Checking for existing panes",
		"project", project.Name,
		"shellType", shellType,
		"foundPane", existingPane != nil)
	if existingPane != nil {
		logger.Info("Found existing pane for project, attaching to it",
			"project", project.Name,
			"shellType", shellType,
			"paneTarget", existingPane.GetTmuxTarget(),
			"paneTitle", existingPane.PaneTitle)

		// Use the tmux manager to attach directly to the specific pane
		err := tc.app.tmuxManager.AttachToPane(existingPane.GetTmuxTarget())
		if err != nil {
			logger.Error("Failed to attach to existing pane, falling back to creation",
				"paneTarget", existingPane.GetTmuxTarget(),
				"error", err)
		} else {
			logger.Info("Successfully attached to existing pane, staying active")
			// Return nil to keep TUI running after switching to existing pane
			return nil
		}
	}

	// Use new window management: ensure project window exists
	logger.Debug("🔧 Ensuring project window exists",
		"projectName", project.Name,
		"projectPath", project.Path,
		"shellType", shellType)

	windowStart := time.Now()
	paneMode := string(tc.app.GetPaneManagementMode())
	window, isNewWindow, err := tc.app.tmuxManager.EnsureProjectWindow(project, shellType, paneMode)
	windowDuration := time.Since(windowStart)
	logger.Info("EnsureProjectWindow completed",
		"duration_ms", windowDuration.Milliseconds(),
		"isNewWindow", isNewWindow,
		"error", err,
		"windowIndex", func() int {
			if window != nil {
				return window.Index
			}
			return -1
		}())
	if err != nil {
		logger.Error("Failed to ensure project window", "error", err, "project", project.Name)
		return nil
	}

	// If we created a new window, it already has the requested shell type in pane 0
	// Just attach to it directly without creating another pane
	if isNewWindow {
		logger.Info("🆕 NEW WINDOW PATH: Window just created with shell in pane 0",
			"project", project.Name,
			"shellType", shellType,
			"window", window.Name,
			"windowIndex", window.Index)

		// Get current session name (we're running inside tmux)
		sessionName, err := tc.app.tmuxManager.GetCurrentSessionName()
		if err != nil || sessionName == "" {
			logger.Error("Failed to get current session name", "error", err)
			sessionName = "icf-assistant-main" // Fallback to known session name
		}
		logger.Info("Using current session for new window",
			"sessionName", sessionName,
			"windowName", window.Name)

		// Attach to pane 0 (the first and only pane in the new window)
		paneTarget := fmt.Sprintf("%s:%d.0", sessionName, window.Index)
		logger.Info("Attaching to new window pane 0",
			"paneTarget", paneTarget)

		err = tc.app.tmuxManager.AttachToPane(paneTarget)
		if err != nil {
			logger.Error("❌ Failed to attach to new window pane", "error", err, "paneTarget", paneTarget)
		} else {
			logger.Info("✅ Successfully attached to new window pane, staying active")
		}
		// Always return here - new window already has the shell, don't create another pane
		logger.Info("🛑 RETURNING from new window path - NOT creating additional panes")
		return nil
	}

	// Existing window - check if shell of this type already exists in the window
	logger.Info("📂 EXISTING WINDOW PATH: Checking for existing pane of this shell type",
		"project", project.Name,
		"shellType", shellType,
		"window", window.Name)

	existingPaneID, err := tc.app.tmuxManager.FindProjectPaneByType(window, shellType)
	if err != nil {
		logger.Warn("Failed to find existing pane", "error", err)
	}

	if existingPaneID != "" {
		// Shell of this type already exists, navigate to it
		logger.Info("✅ Found existing shell pane in existing window, navigating to it",
			"project", project.Name,
			"shellType", shellType,
			"paneID", existingPaneID)

		err = tc.app.tmuxManager.AttachToPane(existingPaneID)
		if err != nil {
			logger.Error("Failed to attach to existing pane", "error", err)
		} else {
			// Successfully attached to existing pane, keep TUI running
			return nil
		}
	}

	// Existing window without this shell type - create new pane
	logger.Info("➕ Creating new pane in existing window for shell type",
		"project", project.Name,
		"shellType", shellType,
		"window", window.Name)

	err = tc.app.tmuxManager.CreatePaneInWindow(window, shellType, project)
	if err != nil {
		logger.Error("Failed to create pane in window", "error", err,
			"project", project.Name, "window", window.Name)
		return nil
	}

	// Get the newly created pane and attach to it
	newPaneID, err := tc.app.tmuxManager.FindProjectPaneByType(window, shellType)
	if err != nil || newPaneID == "" {
		logger.Error("Failed to find newly created pane", "error", err)
		// Fall back to attaching to the window - need to find session name
		sessionName := tc.findSessionNameForWindow(window)
		return TmuxAttachmentMsg{
			SessionName: sessionName,
			WindowName:  window.Name,
		}
	}

	// Attach to the new pane
	err = tc.app.tmuxManager.AttachToPane(newPaneID)
	if err != nil {
		logger.Error("Failed to attach to new pane", "error", err)
		// Fall back to window attachment - need to find session name
		sessionName := tc.findSessionNameForWindow(window)
		return TmuxAttachmentMsg{
			SessionName: sessionName,
			WindowName:  window.Name,
		}
	}

	// Successfully attached to new pane, keep TUI running (no need for additional attachment)
	logger.Info("Successfully attached to new pane, staying active")
	return nil
}

// HandleWorktreeTmuxAttachment handles tmux session/window creation for worktrees
func (tc *TmuxCoordinator) HandleWorktreeTmuxAttachment(project *model.Project, worktree *model.Worktree, shellType model.ShellType) tea.Msg {
	logger := log.Get()

	logger.Info("handleWorktreeTmuxAttachment called",
		"project.Name", project.Name,
		"project.Path", project.Path,
		"worktree.ID", worktree.ID,
		"worktree.Path", worktree.Path,
		"worktree.Branch", worktree.Branch,
		"shellType", shellType)

	// Perform synchronous discovery before looking for worktree panes
	currentProjects := make([]*model.Project, 0)
	if navComp := tc.app.uiManager.GetNavigationComponent(); navComp != nil {
		currentProjects = navComp.GetProjects()
	}

	// Perform synchronous discovery to ensure all panes are found and mapped
	if err := tc.app.tmuxManager.DiscoverPanesSynchronously(currentProjects); err != nil {
		logger.Error("Failed to perform synchronous pane discovery for worktree", "error", err)
		// Continue anyway
	}

	// Use the tmux manager's method to find existing panes in this worktree
	existingPane := tc.app.tmuxManager.FindWorktreePane(project, worktree, shellType)
	logger.Info("Checking for existing worktree panes",
		"project", project.Name,
		"worktree", worktree.ID,
		"shellType", shellType,
		"foundPane", existingPane != nil)
	if existingPane != nil {
		logger.Debug("Found existing pane for worktree, attaching to it",
			"project", project.Name,
			"worktree", worktree.ID,
			"shellType", shellType,
			"paneTarget", existingPane.GetTmuxTarget(),
			"paneTitle", existingPane.PaneTitle)

		// Use the tmux manager to attach directly to the specific pane
		err := tc.app.tmuxManager.AttachToPane(existingPane.GetTmuxTarget())
		if err != nil {
			logger.Error("Failed to attach to existing worktree pane, falling back to creation",
				"paneTarget", existingPane.GetTmuxTarget(),
				"error", err)
		} else {
			logger.Info("Successfully attached to existing worktree pane, staying active")
			// Return nil to keep TUI running after switching to existing pane
			return nil
		}
	}

	// Create project object for tmux manager
	// Create or get tmux session for project (fallback if no existing pane found)
	logger.Info("Creating tmux session for worktree project", "projectName", project.Name, "projectPath", project.Path)
	session, err := tc.app.tmuxManager.CreateProjectSession(project)
	if err != nil {
		logger.Error("Failed to create tmux session for worktree", "error", err,
			"project", project.Name, "worktree", worktree.ID)
		return nil
	}

	// Determine window name and command based on shell type and worktree
	var windowName, command string
	if shellType == model.ShellTypeClaude {
		windowName = fmt.Sprintf("worktree-%s-claude", worktree.ID)
		command = "claude -c"
	} else if shellType == model.ShellTypeNvim {
		windowName = fmt.Sprintf("worktree-%s-nvim", worktree.ID)
		command = "nvim"
	} else {
		windowName = fmt.Sprintf("worktree-%s-zsh", worktree.ID)
		command = "zsh"
	}

	// Create or get window in session with worktree path
	// Pass the actual worktree path as the worktreeID parameter
	window, err := tc.app.tmuxManager.CreateOrGetWindow(session.Name, windowName, command, worktree.Path, project)
	if err != nil {
		logger.Error("Failed to create tmux window for worktree", "error", err,
			"session", session.Name, "window", windowName, "worktree", worktree.ID)
		return nil
	}

	logger.Info("Tmux worktree session/window ready",
		"session", session.Name,
		"window", windowName,
		"windowIndex", window.Index,
		"worktree", worktree.ID)

	// Return attachment message to trigger app exit and tmux attachment
	return TmuxAttachmentMsg{
		SessionName: session.Name,
		WindowName:  windowName,
	}
}

// findSessionNameForWindow finds the session name that contains the given window
func (tc *TmuxCoordinator) findSessionNameForWindow(window interface{}) string {
	// Type assertion helper to get window properties
	getWindowInfo := func(w interface{}) (string, int) {
		if windowPtr, ok := w.(*struct {
			Name  string
			Index int
		}); ok {
			return windowPtr.Name, windowPtr.Index
		}
		// Try alternative struct type
		if windowStruct, ok := w.(struct {
			Name  string
			Index int
		}); ok {
			return windowStruct.Name, windowStruct.Index
		}
		return "", -1
	}

	windowName, windowIndex := getWindowInfo(window)
	if windowName == "" {
		return ""
	}

	// Search through all sessions to find the one containing this window
	for sessionName, session := range tc.app.tmuxManager.GetSessions() {
		for _, sessionWindow := range session.Windows {
			if sessionWindow.Name == windowName && sessionWindow.Index == windowIndex {
				return sessionName
			}
		}
	}

	return ""
}

// RefreshPaneMappings updates all pane references after a layout change
func (tc *TmuxCoordinator) RefreshPaneMappings() error {
	logger := log.Get()
	logger.Info("Refreshing pane mappings after layout change")

	// Force a rediscovery of all panes
	if err := tc.app.tmuxManager.DiscoverAllPanes(); err != nil {
		return fmt.Errorf("failed to rediscover panes: %w", err)
	}

	// Update the UI's navigation with fresh pane information
	if tc.app.uiManager != nil {
		// Get the navigation component and update its panes
		if nav := tc.app.uiManager.GetNavigationComponent(); nav != nil {
			nav.UpdatePanes(tc.app.tmuxManager.GetAllPanes())
		}
	}

	logger.Info("Pane mappings refreshed successfully")
	return nil
}