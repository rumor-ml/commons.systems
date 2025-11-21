// controller.go - Unified application controller
//
// ## Metadata
//
// TUI unified application controller managing the entire application state and coordination.
//
// ### Purpose
//
// Orchestrates the entire TUI application, managing mode transitions between
// terminal focus and assistant focus, coordinating terminal sessions, and integrating assistant
// functionality in a single cohesive Bubble Tea application.
//
// ### Instructions
//
// #### Application State Management
//
// ##### Mode Coordination
//
// Manage transitions between terminal-focused mode (with status overlays) and assistant-focused
// mode (with terminal access) while maintaining consistent state across all components and sessions.
//
// ##### Component Integration
//
// Coordinate terminal manager, assistant core, status aggregator, and UI manager to provide
// unified functionality without conflicts or state inconsistencies between subsystems.
//
// #### Event Processing
//
// ##### Unified Event Handling
//
// Process all Bubble Tea events through a single controller that routes events to appropriate
// components based on current mode and focus state, ensuring proper event isolation and coordination.
//
// ##### State Synchronization
//
// Maintain synchronization between terminal sessions, assistant state, project discovery, and
// status aggregation to provide consistent user experience across all interface modes.
//
// ### Dependencies
//
// #### [ICF](https://github.com/rumor-ml/icf)
//
// Core framework providing project discovery patterns and metadata structures that form the
// foundation for assistant intelligence and terminal session organization.

package app

import (
	"context"
	"path/filepath"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/natb1/tui/internal/assistant"
	"github.com/natb1/tui/internal/devserver"
	"github.com/natb1/tui/internal/persistence"
	"github.com/natb1/tui/internal/status"
	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/internal/ui"
	worktreeservice "github.com/natb1/tui/internal/worktree"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// PaneManagementMode represents the current pane layout mode
type PaneManagementMode string

const (
	// PaneModeGrouped groups all panes by project (default)
	PaneModeGrouped PaneManagementMode = "grouped"
	// PaneModeUnsplit shows one pane per window
	PaneModeUnsplit PaneManagementMode = "unsplit"
)

// TmuxAttachmentMsg indicates the app should exit and attach to tmux
type TmuxAttachmentMsg struct {
	SessionName string
	WindowName  string
}

// App represents the unified TUI application
type App struct {
	// Core subsystems
	terminalManager     *terminal.Manager
	tmuxManager         *terminal.TmuxManager
	assistant           *assistant.Core
	uiManager           *ui.Manager
	projects            ProjectMapInterface
	status              *status.Aggregator
	worktreeService     *worktreeservice.Service
	notificationHandler *status.NotificationHandler
	statusRepo          *persistence.StatusRepository

	// Extracted functional modules
	messageHandler     *MessageHandler
	tmuxCoordinator    *TmuxCoordinator
	navigationUpdater  *NavigationUpdater
	appLifecycle       *AppLifecycle
	devServerManager   *devserver.Manager

	// Application state
	workspaceRoot        string
	currentSessionID     string
	errors               []error
	paneManagementMode   PaneManagementMode

	// Tmux attachment state
	pendingAttachment *TmuxAttachmentMsg

	// Worktree creation progress
	worktreeCreationInProgress bool
	worktreeCreationProject    string

	// Debouncing for performance optimization
	lastNavigationUpdate    time.Time
	navigationUpdatePending bool
}

// New creates a new TUI application
func New(workspaceRoot string) (*App, error) {
	logger := log.Get()
	logger.Info("App.New() called", "workspaceRoot", workspaceRoot)

	// Initialize project discovery first to get the actual workspace root
	logger.Info("Initializing project discovery")
	var err error
	projects, err := NewExternalProjectMap(workspaceRoot)
	if err != nil {
		logger.Error("Failed to create project map", "error", err)
		return nil, err
	}

	// Get the actual workspace root that was resolved by project discovery
	actualWorkspaceRoot := projects.GetWorkspaceRoot()
	logger.Info("Using resolved workspace root", "path", actualWorkspaceRoot)

	// Initialize notification handler without store
	notificationHandler := status.NewNotificationHandler()

	// Initialize core subsystems
	logger.Info("Initializing terminal manager")
	terminalManager := terminal.NewManager()

	logger.Info("Initializing tmux manager")
	ctx := context.Background()
	tmuxManager := terminal.NewTmuxManager(ctx)

	logger.Info("Initializing assistant")
	assistant := assistant.NewCore(projects)

	logger.Info("Initializing status aggregator")
	status := status.NewAggregator()

	// Initialize status persistence repository
	// Use actualWorkspaceRoot to store status.db in the tui directory
	dbPath := filepath.Join(actualWorkspaceRoot, "tui", "status.db")
	logger.Info("Initializing status persistence", "db_path", dbPath)
	statusRepo, err := persistence.NewStatusRepository(dbPath)
	if err != nil {
		// Log warning but continue - persistence is optional
		logger.Warn("Failed to initialize status persistence, continuing without persistence", "error", err)
		statusRepo = nil
	}

	// Create app instance
	app := &App{
		terminalManager:     terminalManager,
		tmuxManager:         tmuxManager,
		assistant:           assistant,
		status:              status,
		projects:            projects,
		notificationHandler: notificationHandler,
		statusRepo:          statusRepo,
		workspaceRoot:       actualWorkspaceRoot,
		errors:              make([]error, 0),
		paneManagementMode:  PaneModeGrouped, // Default to grouped mode
	}

	// Initialize worktree service
	app.worktreeService = worktreeservice.NewService(workspaceRoot)

	// Initialize UI manager
	logger.Info("Initializing UI manager")
	app.uiManager = ui.NewManager()
	logger.Info("UI manager initialized")

	// Initialize extracted functional modules
	app.messageHandler = NewMessageHandler(app)
	app.tmuxCoordinator = NewTmuxCoordinator(app)
	app.navigationUpdater = NewNavigationUpdater(app)
	app.appLifecycle = NewAppLifecycle(app)

	// Initialize dev server manager
	// Use the actualWorkspaceRoot that was resolved by project discovery
	app.devServerManager = devserver.NewManager(actualWorkspaceRoot)

	// Set status callback for real-time updates
	app.devServerManager.SetStatusCallback(func(status devserver.StatusInfo) {
		// The status update will be handled by the polling mechanism
		// This callback ensures we get immediate updates when status changes
		logger.Debug("Dev server status changed",
			"status", status.Status,
			"path", status.CurrentPath,
			"error", status.Error)
	})
	// The dev server logs through the log module directly

	// Logging now goes directly to database, UI reads from there
	logger.Info("Logging initialized with database backend")

	// Log application startup
	logger.Info("TUI starting", "workspace", workspaceRoot)

	// Discover existing tmux sessions
	logger.Info("Discovering tmux sessions")
	if err := app.tmuxManager.DiscoverExistingSessions(); err != nil {
		logger.Warn("Failed to discover existing tmux sessions", "error", err)
	}

	logger.Info("App.New() completed successfully")
	return app, nil
}

// GetPaneManagementMode returns the current pane management mode
func (a *App) GetPaneManagementMode() PaneManagementMode {
	return a.paneManagementMode
}

// SetPaneManagementMode updates the pane management mode
func (a *App) SetPaneManagementMode(mode PaneManagementMode) {
	a.paneManagementMode = mode
}

// Init implements tea.Model
func (a *App) Init() tea.Cmd {
	// Delegate initialization to the app lifecycle manager
	return a.appLifecycle.Init()
}

// Update implements tea.Model
func (a *App) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	// Delegate all message handling to the extracted message handler
	return a.messageHandler.HandleUpdate(msg)
}

// View implements tea.Model
func (a *App) View() string {
	start := time.Now()
	logger := log.Get()

	view := a.uiManager.View()

	elapsed := time.Since(start)
	if elapsed > 10*time.Millisecond {
		logger.Debug("View render time", "duration_ms", elapsed.Milliseconds())
	}

	return view
}

// findProjectSession finds an existing session for a project
func (a *App) findProjectSession(projectName, projectPath, command string) *terminal.Session {
	if a.terminalManager == nil {
		return nil
	}

	sessions := a.terminalManager.GetSessions()
	for _, session := range sessions {
		// Match by project path and command type
		if session.Project != nil && session.Project.Path == projectPath {
			// For shell sessions, check if command matches
			if session.Command != nil {
				cmdStr := strings.Join(session.Command.Args, " ")
				if command == "zsh" && strings.Contains(cmdStr, "zsh") {
					return session
				}
				if command == "claude" && strings.Contains(cmdStr, "claude") {
					return session
				}
			}
		}
	}

	return nil
}

// findProjectByTmuxWindow finds a project that has a pane in the given tmux window
// Uses path-based lookup which is the most robust strategy:
// - Queries tmux in real-time (not relying on cache)
// - Uses the pane's actual current working directory
// - Works for nested directories and any project structure
func (a *App) findProjectByTmuxWindow(sessionName string, windowIndex int) *model.Project {
	logger := log.Get().WithComponent("project-lookup")

	logger.Info("Looking up project for tmux window",
		"session", sessionName,
		"window", windowIndex)

	if a.tmuxManager == nil {
		logger.Error("TmuxManager is nil, cannot lookup project")
		return nil
	}

	if a.projects == nil {
		logger.Error("Projects is nil, cannot lookup project")
		return nil
	}

	// Get the pane's current working directory from tmux (real-time query)
	path := a.tmuxManager.GetPaneCurrentPath(sessionName, windowIndex)
	if path == "" {
		logger.Warn("Could not get pane current path from tmux",
			"session", sessionName,
			"window", windowIndex)
		return nil
	}

	logger.Debug("Retrieved pane current path from tmux",
		"session", sessionName,
		"window", windowIndex,
		"path", path)

	// Find project by path (handles nested directories)
	project := a.projects.GetProjectByPath(path)
	if project == nil {
		logger.Warn("No project found for path",
			"session", sessionName,
			"window", windowIndex,
			"path", path,
			"availableProjects", len(a.projects.GetModelProjects()))

		// Debug: Log all available projects to help diagnose
		for _, p := range a.projects.GetModelProjects() {
			logger.Debug("Available project", "name", p.Name, "path", p.Path)
		}

		return nil
	}

	logger.Info("Successfully found project for tmux window",
		"session", sessionName,
		"window", windowIndex,
		"path", path,
		"project", project.Name,
		"projectPath", project.Path)

	return project
}

// Lifecycle and accessor methods

// Shutdown gracefully shuts down the application
func (a *App) Shutdown() error {
	return a.appLifecycle.Shutdown()
}

// Close cleans up application resources
func (a *App) Close() error {
	return a.appLifecycle.Close()
}

// IsInitialized returns whether the app is initialized
func (a *App) IsInitialized() bool {
	return a.appLifecycle.IsInitialized()
}

// Testing and access methods

// GetTerminalSessions returns all terminal sessions for testing
func (a *App) GetTerminalSessions() map[string]*terminal.Session {
	return a.appLifecycle.GetTerminalSessions()
}

// GetActiveSession returns the active terminal session for testing
func (a *App) GetActiveSession() *terminal.Session {
	return a.appLifecycle.GetActiveSession()
}

// GetTerminalManager returns the terminal manager for testing
func (a *App) GetTerminalManager() *terminal.Manager {
	return a.appLifecycle.GetTerminalManager()
}

// IsCreatingWorktree returns whether a worktree is currently being created
func (a *App) IsCreatingWorktree() (bool, string) {
	return a.appLifecycle.IsCreatingWorktree()
}

// GetPendingAttachment returns the pending tmux attachment if any
func (a *App) GetPendingAttachment() *TmuxAttachmentMsg {
	return a.appLifecycle.GetPendingAttachment()
}

// GetTmuxManager returns the tmux manager for testing
func (a *App) GetTmuxManager() *terminal.TmuxManager {
	return a.appLifecycle.GetTmuxManager()
}

// GetProjectMap returns the project map for testing
func (a *App) GetProjectMap() ProjectMapInterface {
	return a.appLifecycle.GetProjectMap()
}


// GetNotificationHandler returns the notification handler
func (a *App) GetNotificationHandler() *status.NotificationHandler {
	return a.appLifecycle.GetNotificationHandler()
}

// GetUIManager returns the UI manager for testing
func (a *App) GetUIManager() *ui.Manager {
	return a.appLifecycle.GetUIManager()
}

// handleKeyMsg wrapper method for backward compatibility with tests
func (a *App) handleKeyMsg(msg tea.KeyMsg) tea.Cmd {
	if a.messageHandler == nil {
		return nil
	}
	return a.messageHandler.handleKeyMsg(msg)
}

// updateNavigationProjects wrapper method for backward compatibility with tests
func (a *App) updateNavigationProjects() {
	if a.navigationUpdater == nil {
		return
	}
	a.navigationUpdater.UpdateNavigationProjects()
}