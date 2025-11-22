// Package app provides unified message handling functionality for the ICF TUI application.

package app

import (
	"fmt"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/natb1/tui/internal/devserver"
	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/internal/ui"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// MessageHandler handles comprehensive Bubble Tea message processing and routing
type MessageHandler struct {
	app *App
}

// NewMessageHandler creates a new message handler
func NewMessageHandler(app *App) *MessageHandler {
	return &MessageHandler{
		app: app,
	}
}

// HandleUpdate processes all Bubble Tea messages and returns commands
func (mh *MessageHandler) HandleUpdate(msg tea.Msg) (tea.Model, tea.Cmd) {
	logger := log.Get()
	var cmds []tea.Cmd

	// Removed: High-frequency DEBUG log for every message (UPDATE_CALLED)
	// Removed: High-frequency DEBUG log for every keypress (KEY_RECEIVED)

	switch msg := msg.(type) {
	case tea.KeyMsg:

		// Check for global quit keys using key binding system
		keyBindings := mh.app.uiManager.GetKeyBindings()
		keyStr := ui.KeyToString(msg)

		if keyBindings.ShouldHandle(keyStr, "global") {
			action := keyBindings.GetAction(keyStr)
			if action == ui.ActionQuit {
				logger.Info("Quit key detected via key binding system", "key", keyStr)
				return mh.app, tea.Quit
			}
		}

		// Handle key messages - only route once through HandleKey
		cmd := mh.handleKeyMsg(msg)
		if cmd != nil {
			cmds = append(cmds, cmd)
		}

	case tea.MouseMsg:
		// Route mouse events based on current mode
		cmd := mh.handleMouseMsg(msg)
		if cmd != nil {
			cmds = append(cmds, cmd)
		}

	case tea.WindowSizeMsg:
		// Handle window size changes
		cmd := mh.handleWindowSizeMsg(msg)
		if cmd != nil {
			cmds = append(cmds, cmd)
		}

	case terminal.SessionCreatedMsg:
		// Propagate to terminal manager to store the session
		if termCmd := mh.app.terminalManager.HandleMsg(msg); termCmd != nil {
			cmds = append(cmds, termCmd)
		}

		// Propagate to UI manager so terminal component gets the session
		if uiCmd := mh.app.uiManager.Update(msg); uiCmd != nil {
			cmds = append(cmds, uiCmd)
		}

	case registerWorktreeSessionMsg:
		// Register the session with worktree service
		sessions := mh.app.terminalManager.GetSessions()

		// Find the most recently created session (should be for this worktree)
		var latestSession *terminal.Session
		for _, session := range sessions {
			if session.WorktreeID == msg.WorktreeID {
				latestSession = session
				break
			}
		}

		if latestSession != nil {
			err := mh.app.worktreeService.RegisterSession(
				msg.WorktreeID,
				latestSession.ID,
				msg.ProjectPath,
				msg.ShellType,
			)
			if err != nil {
				logger.Error("Failed to register worktree session", "error", err)
			} else {
				logger.Info("Registered worktree session",
					"worktree", msg.WorktreeID,
					"session", latestSession.ID)
			}
		}

	case ui.NavigationCancelMsg:
		// No mode switching - just acknowledge the cancel
		// User can quit with ctrl+q if they want to exit

	case ui.SwitchToMuxMsg:
		// No mode switching - navigation is always visible

	case ui.PaneManagementModeMsg:
		// Handle pane management mode switching
		logger.Info("Switching pane management mode", "mode", msg.Mode)

		if msg.Mode == "unsplit" {
			mh.app.SetPaneManagementMode(PaneModeUnsplit)
			// Apply unsplit layout
			if err := mh.app.tmuxManager.ApplyUnsplitLayout(); err != nil {
				logger.Error("Failed to apply unsplit layout", "error", err)
			}
		} else if msg.Mode == "grouped" {
			mh.app.SetPaneManagementMode(PaneModeGrouped)
			// Apply grouped layout
			if err := mh.app.tmuxManager.ApplyGroupedLayout(); err != nil {
				logger.Error("Failed to apply grouped layout", "error", err)
			}
		}

		// After layout change, refresh pane mappings
		logger.Info("Refreshing pane mappings after layout change")
		if err := mh.app.tmuxCoordinator.RefreshPaneMappings(); err != nil {
			logger.Error("Failed to refresh pane mappings", "error", err)
		}

		// Update UI to reflect mode change and new pane mappings
		cmd := mh.app.uiManager.Update(msg)
		if cmd != nil {
			cmds = append(cmds, cmd)
		}

	default:
		// Handle all other message types
		cmd := mh.handleOtherMsg(msg)
		if cmd != nil {
			cmds = append(cmds, cmd)
		}

		// Also route to UI manager for component updates
		if uiCmd := mh.app.uiManager.Update(msg); uiCmd != nil {
			cmds = append(cmds, uiCmd)
		}
	}

	// Removed: High-frequency DEBUG log for command batching
	return mh.app, tea.Batch(cmds...)
}

// handleKeyMsg processes keyboard input messages
func (mh *MessageHandler) handleKeyMsg(msg tea.KeyMsg) tea.Cmd {
	// Delegate to ui manager
	return mh.app.uiManager.HandleKey(msg)
}

// handleMouseMsg processes mouse input messages
func (mh *MessageHandler) handleMouseMsg(msg tea.MouseMsg) tea.Cmd {
	// Delegate to ui manager
	return mh.app.uiManager.HandleMouse(msg)
}

// handleWindowSizeMsg processes window resize messages
func (mh *MessageHandler) handleWindowSizeMsg(msg tea.WindowSizeMsg) tea.Cmd {
	// Propagate resize to all components
	return mh.app.uiManager.HandleResize(msg)
}

// handleOtherMsg processes all other message types
func (mh *MessageHandler) handleOtherMsg(msg tea.Msg) tea.Cmd {
	logger := log.Get()
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case ui.ProjectShellMsg:
		// Handle project shell selection from navigation using tmux
		// Check for nil project to prevent crash
		if msg.Project == nil {
			logger.Error("ProjectShellMsg received with nil project")
			return nil
		}

		logger.Debug("🚀 ProjectShellMsg received",
			"projectName", msg.Project.Name,
			"projectPath", msg.Project.Path,
			"shellType", msg.ShellType)

		// Handle synchronously but with careful error checking
		logger.Info("Handling tmux attachment synchronously")

		// Measure total time
		startTime := time.Now()
		defer func() {
			duration := time.Since(startTime)
			logger.Info("ProjectShellMsg total handling time", "duration_ms", duration.Milliseconds())
		}()

		// Call handleTmuxAttachment
		attachMsg := mh.app.tmuxCoordinator.HandleTmuxAttachment(msg.Project, msg.ShellType)
		if attachMsg == nil {
			logger.Info("handleTmuxAttachment returned nil - already attached to existing pane")
			// TUI continues running after attaching to existing pane
			return nil
		}

		// Process the attachment
		if tmuxMsg, ok := attachMsg.(TmuxAttachmentMsg); ok {
			logger.Info("Got TmuxAttachmentMsg, setting pending and scheduling quit",
				"session", tmuxMsg.SessionName,
				"window", tmuxMsg.WindowName)
			mh.app.pendingAttachment = &tmuxMsg

			// Return the attachment message to be handled in the next update
			// This ensures the quit happens in the TmuxAttachmentMsg handler
			return func() tea.Msg { return tmuxMsg }
		}

		logger.Error("Unexpected return type from handleTmuxAttachment",
			"type", fmt.Sprintf("%T", attachMsg))

	case TmuxAttachmentMsg:
		// Handle tmux attachment using tmux switching (TUI stays running)
		logger.Info("TmuxAttachmentMsg received",
			"session", msg.SessionName, "window", msg.WindowName)

		// Perform the actual tmux switch using the tmux manager
		err := mh.app.tmuxManager.AttachToWindow(msg.SessionName, msg.WindowName)
		if err != nil {
			logger.Error("Failed to switch to tmux window",
				"session", msg.SessionName,
				"window", msg.WindowName,
				"error", err)
		} else {
			logger.Info("Successfully switched to tmux window, TUI staying active",
				"session", msg.SessionName,
				"window", msg.WindowName)
		}

		// TUI continues running - no tea.Quit needed
		return nil

	case AutoQuitMsg:
		logger.Info("AutoQuitMsg received - quitting gracefully")
		return tea.Quit

	case ProjectDiscoveryCompleteMsg:
		// Handle project discovery completion
		// Removed: High-frequency INFO log (fires on every project discovery cycle)
		// Trigger navigation update
		return func() tea.Msg {
			return updateNavigationProjectsMsg{}
		}

	case updateNavigationProjectsMsg:
		// Update navigation with discovered projects
		// Removed: High-frequency DEBUG log (can fire multiple times per second with debouncing)

		// Debouncing: Check if we updated recently
		now := time.Now()
		if now.Sub(mh.app.lastNavigationUpdate) < 100*time.Millisecond {
			// Removed: High-frequency DEBUG log (fires during rapid updates)
			// Don't queue another update if one is already pending
			if !mh.app.navigationUpdatePending {
				mh.app.navigationUpdatePending = true
				// Schedule a delayed update
				return tea.Tick(150*time.Millisecond, func(t time.Time) tea.Msg {
					return updateNavigationProjectsMsg{}
				})
			}
			return nil
		}

		mh.app.navigationUpdatePending = false
		mh.app.lastNavigationUpdate = now

		if mh.app.projects == nil {
			logger.Warn("Projects is nil in Update")
		}
		// Removed: High-frequency DEBUG log
		if mh.app.uiManager == nil {
			logger.Warn("UI Manager is nil in Update")
		} else if nav := mh.app.uiManager.GetNavigationComponent(); nav == nil {
			logger.Warn("Navigation component is nil in Update")
		}
		// Removed: High-frequency DEBUG log
		mh.app.navigationUpdater.UpdateNavigationProjects()

	case RefreshUIMsg:
		// Refresh the UI after port management changes
		// Removed: High-frequency DEBUG log (can fire frequently during UI updates)
		mh.app.navigationUpdater.UpdateNavigationProjects()
		mh.app.navigationUpdater.UpdateNavigationWithTmuxInfo()

	case tmuxUpdateTickMsg:
		// Periodic update of tmux window information
		// Navigation is always visible, so always update
		mh.app.navigationUpdater.UpdateNavigationWithTmuxInfo()
		// Continue the ticker
		return mh.tickTmuxUpdate()

	case devServerUpdateTickMsg:
		// Periodic update of dev server status
		var cmds []tea.Cmd
		if mh.app.devServerManager != nil {
			status := mh.app.devServerManager.GetStatus()
			// Send status update message that will be routed to the component
			cmds = append(cmds, func() tea.Msg {
				return ui.DevServerStatusUpdateMsg{Status: status}
			})
		}
		// Continue the ticker
		cmds = append(cmds, mh.tickDevServerUpdate())
		return tea.Batch(cmds...)

	case ui.WorktreeShellMsg:
		// Handle worktree shell selection from navigation using tmux
		logger.Info("WorktreeShellMsg received",
			"project", msg.Project.Name,
			"worktree", msg.Worktree.ID,
			"shellType", msg.ShellType)

		// Handle synchronously
		logger.Info("Handling worktree tmux attachment synchronously")

		// Call handleWorktreeTmuxAttachment
		attachMsg := mh.app.tmuxCoordinator.HandleWorktreeTmuxAttachment(msg.Project, msg.Worktree, msg.ShellType)
		if attachMsg == nil {
			logger.Info("handleWorktreeTmuxAttachment returned nil - already attached to existing pane")
			// TUI continues running after attaching to existing pane
			return nil
		}

		// Process the attachment
		if tmuxMsg, ok := attachMsg.(TmuxAttachmentMsg); ok {
			logger.Info("Got TmuxAttachmentMsg for worktree, returning it to be processed",
				"session", tmuxMsg.SessionName,
				"window", tmuxMsg.WindowName)
			// Return the attachment message to be handled in the next update
			return func() tea.Msg { return tmuxMsg }
		}

		logger.Error("Unexpected return type from handleWorktreeTmuxAttachment",
			"type", fmt.Sprintf("%T", attachMsg))

	case ui.DevServerRestartMsg:
		// Handle dev server restart
		logger.Info("DevServerRestartMsg received")

		// Check current status before starting
		var initialStatus devserver.StatusInfo
		if mh.app.devServerManager != nil {
			initialStatus = mh.app.devServerManager.GetStatus()
		}

		// RestartAsync starts the operation in background and updates status immediately
		err := mh.app.devServerManager.RestartAsync("")
		if err != nil {
			logger.Error("Failed to initiate restart", "error", err.Error())
			// Send error status to UI so user can see what went wrong
			return func() tea.Msg {
				return ui.DevServerStatusUpdateMsg{
					Status: devserver.StatusInfo{
						Status:      devserver.StatusError,
						CurrentPath: initialStatus.CurrentPath,
						Port:        initialStatus.Port,
						Error:       err,
					},
				}
			}
		}

		// Determine immediate status based on initial state
		wasRunning := initialStatus.Status == devserver.StatusRunning
		immediateStatus := devserver.StatusStarting
		if wasRunning {
			immediateStatus = devserver.StatusRestarting
		}

		// Return batched commands for immediate feedback and follow-up
		return tea.Batch(
			func() tea.Msg {
				return ui.DevServerStatusUpdateMsg{
					Status: devserver.StatusInfo{
						Status:      immediateStatus,
						CurrentPath: initialStatus.CurrentPath,
						Port:        initialStatus.Port,
					},
				}
			},
			// Quick follow-up updates to catch actual status changes
			tea.Tick(500*time.Millisecond, func(t time.Time) tea.Msg {
				return devServerUpdateTickMsg{}
			}),
			tea.Tick(1500*time.Millisecond, func(t time.Time) tea.Msg {
				return devServerUpdateTickMsg{}
			}),
		)

	case ui.ActivatePathInputMsg:
		// Handle dev server path input activation - enter input mode
		logger.Info("ActivatePathInputMsg received, entering path input mode")
		// Tell the UI manager to enter path input mode
		if mh.app.uiManager != nil {
			mh.app.uiManager.StartPathInput()
			// Get current status and send update message
			if mh.app.devServerManager != nil {
				status := mh.app.devServerManager.GetStatus()
				return func() tea.Msg {
					return ui.DevServerStatusUpdateMsg{Status: status}
				}
			}
		}
		return nil

	case ui.DevServerPathMsg:
		// Legacy path message handler
		logger.Info("DevServerPathMsg received, entering path input mode")
		// Tell the UI manager to enter path input mode
		if mh.app.uiManager != nil {
			mh.app.uiManager.StartPathInput()
			// Get current status and send update message
			if mh.app.devServerManager != nil {
				status := mh.app.devServerManager.GetStatus()
				return func() tea.Msg {
					return ui.DevServerStatusUpdateMsg{Status: status}
				}
			}
		}
		return nil

	case ui.DevServerSetPathMsg:
		// Handle dev server path setting
		logger.Info("DevServerSetPathMsg received", "path", msg.Path)

		// Check current status before starting
		var initialStatus devserver.StatusInfo
		if mh.app.devServerManager != nil {
			initialStatus = mh.app.devServerManager.GetStatus()
		}

		// SetPath is now async, it starts the operation in background
		err := mh.app.devServerManager.SetPath(msg.Path)
		if err != nil {
			logger.Error("Invalid path", "error", err.Error())
			return nil
		}

		// If server was stopped or errored, manually set status to Starting for immediate UI feedback
		if initialStatus.Status == devserver.StatusStopped || initialStatus.Status == devserver.StatusError {
			// Send immediate Starting status
			return tea.Batch(
				func() tea.Msg {
					return ui.DevServerStatusUpdateMsg{
						Status: devserver.StatusInfo{
							Status:      devserver.StatusStarting,
							CurrentPath: msg.Path,
							Port:        initialStatus.Port,
						},
					}
				},
				// Quick follow-up updates to catch actual status changes
				tea.Tick(500*time.Millisecond, func(t time.Time) tea.Msg {
					return devServerUpdateTickMsg{}
				}),
				tea.Tick(1500*time.Millisecond, func(t time.Time) tea.Msg {
					return devServerUpdateTickMsg{}
				}),
			)
		} else {
			// For restart case when already running, get current status
			return func() tea.Msg {
				if mh.app.devServerManager != nil {
					status := mh.app.devServerManager.GetStatus()
					return ui.DevServerStatusUpdateMsg{Status: status}
				}
				return nil
			}
		}

	case ui.DevServerStatusUpdateMsg:
		// This message is routed to components by the message router
		// No need to handle it here
		return nil

	case ui.ToggleBlockedMsg:
		// Handle toggle blocked state
		logger.Info("ToggleBlockedMsg received",
			"project", msg.Project.Name,
			"worktree", func() string {
				if msg.Worktree != nil {
					return msg.Worktree.ID
				}
				return "nil"
			}())

		// Toggle between normal and blocked status
		if msg.Worktree != nil {
			// Toggle worktree blocked status
			if msg.Worktree.Status == model.ProjectStatusBlocked {
				msg.Worktree.Status = model.ProjectStatusNormal
			} else {
				msg.Worktree.Status = model.ProjectStatusBlocked
			}
			logger.Info("Toggled worktree blocked status",
				"worktree", msg.Worktree.ID,
				"status", msg.Worktree.Status)

			// Persist worktree status
			if mh.app.statusRepo != nil {
				if err := mh.app.statusRepo.SaveWorktreeStatus(
					msg.Project.Path,
					msg.Worktree.ID,
					string(msg.Worktree.Status)); err != nil {
					logger.Warn("Failed to persist worktree status", "error", err)
				}
			}
		} else {
			// Toggle project blocked status
			if msg.Project.Status == model.ProjectStatusBlocked {
				msg.Project.Status = model.ProjectStatusNormal
			} else {
				msg.Project.Status = model.ProjectStatusBlocked
			}
			logger.Info("Toggled project blocked status",
				"project", msg.Project.Name,
				"status", msg.Project.Status)

			// Persist project status
			if mh.app.statusRepo != nil {
				if err := mh.app.statusRepo.SaveProjectStatus(
					msg.Project.Path,
					string(msg.Project.Status)); err != nil {
					logger.Warn("Failed to persist project status", "error", err)
				}
			}
		}

		// Directly refresh the navigation display without rebuilding from discovery
		// This preserves the toggled status
		if navComp := mh.app.uiManager.GetNavigationComponent(); navComp != nil {
			navComp.RefreshDisplay()
			logger.Info("Refreshed navigation display after toggle")
		}
		return nil

	case ui.ToggleTestingMsg:
		// Handle toggle testing state
		logger.Info("ToggleTestingMsg received",
			"project", msg.Project.Name,
			"worktree", func() string {
				if msg.Worktree != nil {
					return msg.Worktree.ID
				}
				return "nil"
			}())

		// Toggle between normal and testing status
		if msg.Worktree != nil {
			// Toggle worktree testing status
			if msg.Worktree.Status == model.ProjectStatusTesting {
				msg.Worktree.Status = model.ProjectStatusNormal
			} else {
				msg.Worktree.Status = model.ProjectStatusTesting
			}
			logger.Info("Toggled worktree testing status",
				"worktree", msg.Worktree.ID,
				"status", msg.Worktree.Status)

			// Persist worktree status
			if mh.app.statusRepo != nil {
				if err := mh.app.statusRepo.SaveWorktreeStatus(
					msg.Project.Path,
					msg.Worktree.ID,
					string(msg.Worktree.Status)); err != nil {
					logger.Warn("Failed to persist worktree status", "error", err)
				}
			}
		} else {
			// Toggle project testing status
			if msg.Project.Status == model.ProjectStatusTesting {
				msg.Project.Status = model.ProjectStatusNormal
			} else {
				msg.Project.Status = model.ProjectStatusTesting
			}
			logger.Info("Toggled project testing status",
				"project", msg.Project.Name,
				"status", msg.Project.Status)

			// Persist project status
			if mh.app.statusRepo != nil {
				if err := mh.app.statusRepo.SaveProjectStatus(
					msg.Project.Path,
					string(msg.Project.Status)); err != nil {
					logger.Warn("Failed to persist project status", "error", err)
				}
			}
		}

		// Directly refresh the navigation display without rebuilding from discovery
		// This preserves the toggled status
		if navComp := mh.app.uiManager.GetNavigationComponent(); navComp != nil {
			navComp.RefreshDisplay()
			logger.Info("Refreshed navigation display after toggle")
		}
		return nil

	case MarkProjectTestingMsg:
		// Handle testing marker from tmux navigation
		logger.Info("MarkProjectTestingMsg received - processing request",
			"session", msg.SessionName,
			"window", msg.WindowIndex)

		// Find the project that owns this tmux window
		// This uses path-based lookup for maximum reliability
		project := mh.app.findProjectByTmuxWindow(msg.SessionName, msg.WindowIndex)
		if project == nil {
			logger.Error("Failed to find project for tmux window - cannot toggle status",
				"session", msg.SessionName,
				"window", msg.WindowIndex)
			// Continue ticker even if project not found
			return tickTestingMarkerCheck()
		}

		// Toggle testing status
		oldStatus := project.Status
		if project.Status == model.ProjectStatusTesting {
			project.Status = model.ProjectStatusNormal
			logger.Info("Toggling testing status OFF",
				"project", project.Name,
				"path", project.Path)
		} else {
			project.Status = model.ProjectStatusTesting
			logger.Info("Toggling testing status ON",
				"project", project.Name,
				"path", project.Path)
		}

		// Persist the status change
		if mh.app.statusRepo != nil {
			if err := mh.app.statusRepo.SaveProjectStatus(project.Path, string(project.Status)); err != nil {
				logger.Error("Failed to persist testing status",
					"error", err,
					"project", project.Name,
					"status", project.Status)
			} else {
				logger.Info("Successfully persisted testing status",
					"project", project.Name,
					"oldStatus", oldStatus,
					"newStatus", project.Status)
			}
		} else {
			logger.Warn("statusRepo is nil - status will not persist across restarts")
		}

		// Refresh display
		if navComp := mh.app.uiManager.GetNavigationComponent(); navComp != nil {
			navComp.RefreshDisplay()
			logger.Debug("Refreshed navigation display")
		} else {
			logger.Warn("navigationComponent is nil - display will not refresh")
		}

		// Continue the ticker to check for more marker files
		return tickTestingMarkerCheck()

	case TestingMarkerCheckMsg:
		// Continue the ticker - this is returned from the periodic check
		return tickTestingMarkerCheck()

	case ui.ProjectDashboardMsg:
		// Handle dashboard selection from navigation
		// Dashboard functionality not yet implemented
		// Navigation remains visible

	case worktreeCreationStartedMsg:
		// This message is deprecated - worktree creation via uppercase keys was removed
		logger.Info("worktreeCreationStartedMsg received (deprecated)", "project", msg.ProjectName)

	case worktreeCreationFailedMsg:
		// Handle worktree creation failure
		logger.Error("Worktree creation failed",
			"project", msg.ProjectName,
			"error", msg.Error)

		// Clear progress indicator
		mh.app.worktreeCreationInProgress = false
		mh.app.worktreeCreationProject = ""
		// Error will be visible in logs panel

	case error:
		// Handle errors from terminal session creation or other sources
		logger.Error("Error in Update", "error", msg.Error())
		// Errors are logged but not displayed in UI

	case ui.WorktreeProgressUpdateMsg:
		// Route worktree progress updates to UI manager
		logger.Info("Controller received WorktreeProgressUpdateMsg",
			"inProgress", msg.InProgress,
			"projectName", msg.ProjectName)
		if uiCmd := mh.app.uiManager.Update(msg); uiCmd != nil {
			cmds = append(cmds, uiCmd)
		}
	}

	return tea.Batch(cmds...)
}

// tickTmuxUpdate returns a command to trigger periodic tmux updates
func (mh *MessageHandler) tickTmuxUpdate() tea.Cmd {
	return tea.Tick(time.Second*2, func(t time.Time) tea.Msg {
		return tmuxUpdateTickMsg{}
	})
}

// tickDevServerUpdate returns a command to trigger periodic dev server status updates
func (mh *MessageHandler) tickDevServerUpdate() tea.Cmd {
	return tea.Tick(time.Second, func(t time.Time) tea.Msg {
		return devServerUpdateTickMsg{}
	})
}

// Message types used by the message handler

// AutoQuitMsg for debugging
type AutoQuitMsg struct{}

// updateNavigationProjectsMsg triggers navigation project update
type updateNavigationProjectsMsg struct{}

// tmuxUpdateTickMsg triggers periodic tmux info updates
type tmuxUpdateTickMsg struct{}

// devServerUpdateTickMsg triggers periodic dev server status updates
type devServerUpdateTickMsg struct{}

// RefreshUIMsg for UI refresh after changes
type RefreshUIMsg struct{}

// Message types for worktree operations
type registerWorktreeSessionMsg struct {
	WorktreeID  string
	ProjectPath string
	ShellType   string
}

type worktreeCreationStartedMsg struct {
	ProjectName string
}

type worktreeCreationFailedMsg struct {
	ProjectName string
	Error       error
}