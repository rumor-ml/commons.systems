// Package app provides application initialization and discovery processes for ICF TUI application.

package app

import (
	"context"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/natb1/tui/internal/status"
	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/internal/ui"
	worktreeservice "github.com/natb1/tui/internal/worktree"
	"github.com/rumor-ml/log/pkg/log"
)

// AppLifecycle handles application initialization and discovery processes
type AppLifecycle struct {
	app *App
}

// NewAppLifecycle creates a new app lifecycle manager
func NewAppLifecycle(app *App) *AppLifecycle {
	return &AppLifecycle{
		app: app,
	}
}

// Init implements tea.Model initialization for the application
func (al *AppLifecycle) Init() tea.Cmd {
	logger := log.Get()
	// Removed: Verbose INFO log (startup message, not useful in production)

	// Start with minimal initialization to ensure UI is responsive
	var cmds []tea.Cmd

	// Initialize UI first
	if cmd := al.app.uiManager.Init(); cmd != nil {
		cmds = append(cmds, cmd)
	}

	// Log TUI ready
	logger.Info("TUI started")

	// Start Claude monitoring for navigation asynchronously
	cmds = append(cmds, func() tea.Msg {
		logger.Info("Attempting to start Claude monitoring")
		if navComp := al.app.uiManager.GetNavigationComponent(); navComp != nil {
			logger.Info("Navigation component found, configuring Claude monitoring")

			// Set the notification handler on the ClaudeStatusManager
			if statusMgr := navComp.GetClaudeStatusManager(); statusMgr != nil {
				statusMgr.SetNotificationHandler(al.app.notificationHandler)
				logger.Info("Notification handler set on ClaudeStatusManager")
			}

			ctx := context.Background()
			if err := navComp.StartClaudeMonitoring(ctx); err != nil {
				logger.Error("Failed to start Claude monitoring", "error", err)
			}
			// Removed: Verbose INFO log (only useful during development, not in production)
		} else {
			logger.Error("Navigation component not found for Claude monitoring")
		}
		return nil
	})

	// Update navigation with empty projects immediately so UI shows something
	cmds = append(cmds, func() tea.Msg {
		logger.Debug("Sending initial updateNavigationProjectsMsg")
		return updateNavigationProjectsMsg{}
	})

	// Trigger immediate tmux discovery for Claude panes
	cmds = append(cmds, func() tea.Msg {
		logger.Debug("Sending immediate tmux update")
		return tmuxUpdateTickMsg{}
	})

	// Start dev server status updates
	cmds = append(cmds, func() tea.Msg {
		logger.Debug("Starting dev server status updates")
		return devServerUpdateTickMsg{}
	})

	// Start testing marker check ticker for tmux integration
	cmds = append(cmds, tickTestingMarkerCheck())

	// Then initialize other subsystems asynchronously
	cmds = append(cmds,
		al.app.projects.Init(),
		al.app.assistant.Init(),
		al.app.status.Init(),
	)

	// Start tmux update ticker for pane discovery
	cmds = append(cmds, al.tickTmuxUpdate())

	// Quick updates to ensure Claude panes appear (reduced frequency to prevent flashing)
	cmds = append(cmds,
		tea.Tick(time.Millisecond*250, func(t time.Time) tea.Msg {
			return updateNavigationProjectsMsg{}
		}),
		tea.Tick(time.Second*1, func(t time.Time) tea.Msg {
			return updateNavigationProjectsMsg{}
		}),
	)

	logger.Info("App.Init() returning commands", "count", len(cmds))
	return tea.Batch(cmds...)
}

// DiscoverWorktrees discovers existing worktrees for all projects
func (al *AppLifecycle) DiscoverWorktrees() tea.Cmd {
	return func() tea.Msg {
		logger := log.Get()
		logger.Info("Discovering worktrees")

		// Get all projects
		projects := make([]worktreeservice.ProjectInfo, 0)
		if al.app.projects != nil {
			for _, project := range al.app.projects.GetProjects() {
				projects = append(projects, project)
			}
		}

		// Discover worktrees
		err := al.app.worktreeService.DiscoverWorktrees(projects)
		if err != nil {
			logger.Error("Failed to discover worktrees", "error", err)
		}

		// Shell sessions for discovered worktrees can be created on demand

		return nil
	}
}

// CreateInitialTerminalSession creates the initial terminal session
func (al *AppLifecycle) CreateInitialTerminalSession() tea.Cmd {
	// NOTE: Disabled PTY session creation - we use tmux for all terminal management now
	// The initial state shows navigation UI, and terminals are created on-demand via tmux
	return nil
}

// Shutdown gracefully shuts down the application
func (al *AppLifecycle) Shutdown() error {
	if al.app.terminalManager != nil {
		return al.app.terminalManager.Shutdown()
	}
	return nil
}

// Close cleans up application resources
func (al *AppLifecycle) Close() error {
	// Close status persistence repository
	if al.app.statusRepo != nil {
		if err := al.app.statusRepo.Close(); err != nil {
			return err
		}
	}
	return nil
}

// IsInitialized returns whether the app is initialized
func (al *AppLifecycle) IsInitialized() bool {
	return true // Always initialized now
}

// tickTmuxUpdate creates a periodic ticker to update tmux info
func (al *AppLifecycle) tickTmuxUpdate() tea.Cmd {
	// Balanced interval - frequent enough for responsiveness but not too frequent to cause flashing
	return tea.Tick(time.Second*2, func(t time.Time) tea.Msg {
		return tmuxUpdateTickMsg{}
	})
}

// Accessor methods for testing and external access

// GetTerminalSessions returns all terminal sessions for testing
func (al *AppLifecycle) GetTerminalSessions() map[string]*terminal.Session {
	if al.app.terminalManager != nil {
		return al.app.terminalManager.GetSessions()
	}
	return nil
}

// GetActiveSession returns the active terminal session for testing
func (al *AppLifecycle) GetActiveSession() *terminal.Session {
	if al.app.terminalManager != nil {
		return al.app.terminalManager.GetActiveSession()
	}
	return nil
}

// GetTerminalManager returns the terminal manager for testing
func (al *AppLifecycle) GetTerminalManager() *terminal.Manager {
	return al.app.terminalManager
}

// IsCreatingWorktree returns whether a worktree is currently being created
func (al *AppLifecycle) IsCreatingWorktree() (bool, string) {
	return al.app.worktreeCreationInProgress, al.app.worktreeCreationProject
}

// GetPendingAttachment returns the pending tmux attachment if any
func (al *AppLifecycle) GetPendingAttachment() *TmuxAttachmentMsg {
	return al.app.pendingAttachment
}

// GetTmuxManager returns the tmux manager for testing
func (al *AppLifecycle) GetTmuxManager() *terminal.TmuxManager {
	return al.app.tmuxManager
}

// GetProjectMap returns the project map for testing
func (al *AppLifecycle) GetProjectMap() ProjectMapInterface {
	return al.app.projects
}


// GetNotificationHandler returns the notification handler
func (al *AppLifecycle) GetNotificationHandler() *status.NotificationHandler {
	return al.app.notificationHandler
}

// GetUIManager returns the UI manager for testing
func (al *AppLifecycle) GetUIManager() *ui.Manager {
	return al.app.uiManager
}