// Package terminal provides tmux session coordination and management for ICF projects.
// Coordinates tmux sessions, windows, and panes while providing comprehensive discovery 
// and real-time monitoring of all tmux activity across projects.

package terminal

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)


// TmuxManager coordinates tmux sessions for ICF projects
type TmuxManager struct {
	sessions         map[string]*TmuxSession // project name -> session
	panes            map[string]*TmuxPane    // pane target -> pane (session:window.pane)
	paneRegistry     *PaneRegistry           // stable pane-to-project mappings
	projects         []*model.Project        // cached projects for layout operations
	navigator        *TmuxNavigator          // handles navigation and attachment
	sessionManager   *TmuxSessionManager     // handles session management
	windowManager    *TmuxWindowManager      // handles window management
	config           *TmuxConfig             // handles configuration and key bindings
	projectMapper    *TmuxProjectMapper      // handles project mapping functionality
	sessionDiscovery *SessionDiscovery       // handles session discovery and management
	paneDiscovery    *PaneDiscovery          // handles pane discovery and mapping
	operations       *TmuxOperations         // handles high-level operations
	discovery        *TmuxDiscovery          // handles discovery and mapping
	finder           *TmuxFinder             // handles pane finding and matching
	advancedOps      *TmuxAdvancedOperations // handles advanced session operations
	mutex            sync.RWMutex
	ctx              context.Context
	cancel           context.CancelFunc
	logger           log.Logger
	tmuxPath         string // cached tmux executable path
	executor         TmuxExecutor // tmux command executor (real or mock)

	// Providers for clean dependency injection
	paneProvider    PaneProvider    // abstracts pane data source
	sessionProvider SessionProvider // abstracts session state

	// Change detection for optimization
	lastSessionsOutput string
	lastPanesOutput    string

}

// TmuxSession represents a tmux session for a project
type TmuxSession struct {
	Name    string                 // tmux session name (project name)
	Project *model.Project         // associated project
	Windows map[string]*TmuxWindow // window name -> window info
	Active  bool                   // whether session is active
	mutex   sync.RWMutex
}

// TmuxWindow represents a window within a tmux session
type TmuxWindow struct {
	Index      int    // tmux window index
	Name       string // window name (zsh, claude, worktree-<name>-zsh, etc.)
	Command    string // command running in window
	PaneTitle  string // tmux pane title from #{pane_title}
	WorktreeID string // worktree ID if applicable
	Active     bool   // whether window is currently active
}

// SessionRegistry tracks project-session-window mappings
type SessionRegistry struct {
	ProjectSessions map[string]string            // project name -> session name
	SessionWindows  map[string]map[string]string // session name -> window name -> window index
	mutex           sync.RWMutex
}

// NewTmuxManager creates a new tmux manager
// DEPRECATED: Use NewTmuxManagerFactory().NewProduction(ctx) instead.
// This constructor is maintained for backward compatibility during migration.
func NewTmuxManager(ctx context.Context) *TmuxManager {
	factory := NewTmuxManagerFactory()
	return factory.NewProduction(ctx)
}

// getCurrentTmuxSession gets the current tmux session name
func (tm *TmuxManager) getCurrentTmuxSession() (string, error) {
	// Use session provider if available
	if tm.sessionProvider != nil {
		return tm.sessionProvider.GetCurrentSession(tm.executor, tm.tmuxPath)
	}
	// Fallback to advanced ops
	return tm.advancedOps.GetCurrentTmuxSession("")
}

// GetCurrentSessionName returns the current tmux session name (public wrapper)
func (tm *TmuxManager) GetCurrentSessionName() (string, error) {
	return tm.getCurrentTmuxSession()
}

// CreateProjectSession creates or finds a tmux session for a project
func (tm *TmuxManager) CreateProjectSession(project *model.Project) (*TmuxSession, error) {
	return tm.advancedOps.CreateProjectSession(tm, project)
}

// CreateWindow creates a window in the specified session
func (tm *TmuxManager) CreateWindow(sessionName, windowName, command string, worktreeID string, project *model.Project) (*TmuxWindow, error) {
	return tm.operations.CreateWindow(tm, sessionName, windowName, command, worktreeID, project)
}

// AttachToWindow attaches to a specific window in a session
func (tm *TmuxManager) AttachToWindow(sessionName, windowName string) error {
	return tm.advancedOps.AttachToWindow(tm, sessionName, windowName)
}

// AttachToPane attaches to a specific pane within a tmux session
func (tm *TmuxManager) AttachToPane(paneTarget string) error {
	return tm.advancedOps.AttachToPane(tm, paneTarget)
}

// ListSessions returns all active tmux sessions
func (tm *TmuxManager) ListSessions() (map[string]*TmuxSession, error) {
	tm.mutex.RLock()
	defer tm.mutex.RUnlock()

	return tm.sessionDiscovery.ListSessions(tm.sessions)
}

// DiscoverExistingSessions discovers and registers ALL existing tmux sessions
func (tm *TmuxManager) DiscoverExistingSessions() error {
	return tm.advancedOps.DiscoverExistingSessions(tm)
}

// DiscoverAllPanes discovers and registers ALL tmux panes across all sessions
func (tm *TmuxManager) DiscoverAllPanes() error {
	return tm.advancedOps.DiscoverAllPanes(tm)
}


// GetAllPanes returns all discovered tmux panes
func (tm *TmuxManager) GetAllPanes() map[string]*TmuxPane {
	tm.mutex.RLock()
	defer tm.mutex.RUnlock()

	// Return a copy to prevent race conditions
	panes := make(map[string]*TmuxPane)
	for target, pane := range tm.panes {
		panes[target] = pane
	}

	return panes
}

// GetPaneRegistry returns the pane registry (for debugging and testing)
func (tm *TmuxManager) GetPaneRegistry() *PaneRegistry {
	return tm.paneRegistry
}

// Testing methods have been removed. Use TmuxTestConfig with factory pattern instead.
// See internal/terminal/MIGRATION_GUIDE.md for details on the new testing pattern.

// MapSessionsToProjects maps discovered tmux sessions to projects based on CWD
func (tm *TmuxManager) MapSessionsToProjects(projects []*model.Project) ([]*model.Project, error) {
	// Cache projects for layout operations
	tm.projects = projects
	return tm.discovery.MapSessionsToProjects(tm, projects)
}


// getSessionCwd gets the current working directory of a tmux session
func (tm *TmuxManager) getSessionCwd(sessionName string) (string, error) {
	return tm.sessionDiscovery.GetSessionCwd(sessionName)
}

// RefreshPaneProjectMappings re-applies project mappings to existing panes
func (tm *TmuxManager) RefreshPaneProjectMappings(projects []*model.Project) {
	tm.discovery.RefreshPaneProjectMappings(tm, projects)
}

// DiscoverPanesSynchronously performs a complete pane discovery and mapping synchronously
func (tm *TmuxManager) DiscoverPanesSynchronously(projects []*model.Project) error {
	return tm.discovery.DiscoverPanesSynchronously(tm, projects)
}

// FindProjectPane finds the best matching pane for a project and shell type using the registry
func (tm *TmuxManager) FindProjectPane(project *model.Project, shellType model.ShellType) *TmuxPane {
	return tm.finder.FindProjectPane(tm, project, shellType)
}

// FindWorktreePane finds the best matching pane for a worktree and shell type
func (tm *TmuxManager) FindWorktreePane(project *model.Project, worktree *model.Worktree, shellType model.ShellType) *TmuxPane {
	return tm.finder.FindWorktreePane(tm, project, worktree, shellType)
}


// addSessionShellsToProject adds shells from a tmux session to a project
func (tm *TmuxManager) addSessionShellsToProject(session *TmuxSession, project *model.Project) {
	tm.projectMapper.addSessionShellsToProject(session, project)
}





// Cleanup gracefully shuts down the tmux manager
func (tm *TmuxManager) Cleanup() error {
	tm.mutex.Lock()
	defer tm.mutex.Unlock()

	if tm.cancel != nil {
		tm.cancel()
	}

	// Optionally kill sessions on cleanup
	// For now, leave sessions running for persistence

	tm.logger.Info("Tmux manager cleanup completed")

	return nil
}

// GetProjectSession returns the session for a specific project
func (tm *TmuxManager) GetProjectSession(projectName string) (*TmuxSession, bool) {
	tm.mutex.RLock()
	defer tm.mutex.RUnlock()

	// Sanitize project name to match how sessions are stored
	// Include "icf-" prefix to match CreateProjectSession
	sessionName := "icf-" + strings.ReplaceAll(projectName, "/", "_")
	session, exists := tm.sessions[sessionName]
	return session, exists
}

// CreateOrGetWindow creates a window if it doesn't exist, or returns existing window
func (tm *TmuxManager) CreateOrGetWindow(sessionName, windowName, command string, worktreeID string, project *model.Project) (*TmuxWindow, error) {
	return tm.operations.CreateOrGetWindow(tm, sessionName, windowName, command, worktreeID, project)
}


// findExistingTUIInstance searches for existing TUI instances running 'go run main.go'
func (tm *TmuxManager) findExistingTUIInstance() (string, string, error) {
	return tm.operations.FindExistingTUIInstance()
}

// switchToExistingTUI switches to an existing TUI instance
func (tm *TmuxManager) switchToExistingTUI(sessionName, windowIndex string) error {
	return tm.operations.SwitchToExistingTUI(sessionName, windowIndex)
}


// FindWindowByPath finds a window in the given session that matches the path and window type
func (tm *TmuxManager) FindWindowByPath(sessionName string, projectPath string, windowType string) (*TmuxWindow, error) {
	return tm.windowManager.FindWindowByPath(sessionName, projectPath, windowType)
}

// syncSessionWindows syncs the cached windows with actual tmux windows
func (tm *TmuxManager) syncSessionWindows(sessionName string) error {
	session, exists := tm.sessions[sessionName]
	if !exists {
		return fmt.Errorf("session not found: %s", sessionName)
	}

	// Get actual windows from tmux
	output, err := tm.executor.Execute("list-windows", "-t", sessionName, "-F", "#{window_index}:#{window_name}")
	if err != nil {
		return fmt.Errorf("failed to list windows: %w", err)
	}

	// Build set of actual windows
	actualWindows := make(map[string]bool)
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) == 2 {
			actualWindows[parts[1]] = true
		}
	}

	// Remove windows that no longer exist
	session.mutex.Lock()
	for name := range session.Windows {
		if !actualWindows[name] {
			tm.logger.Info("Removing stale window from cache",
				"sessionName", sessionName,
				"windowName", name)
			delete(session.Windows, name)
		}
	}
	session.mutex.Unlock()

	return nil
}

// ListWindows returns all windows in a session
func (tm *TmuxManager) ListWindows(sessionName string) ([]*TmuxWindow, error) {
	return tm.windowManager.ListWindows(sessionName)
}

// GetWindowsWithDetails returns windows with their current pane titles and commands
func (tm *TmuxManager) GetWindowsWithDetails(sessionName string) ([]*TmuxWindow, error) {
	return tm.windowManager.GetWindowsWithDetails(sessionName)
}

// GetPaneCurrentPath retrieves the current working directory of a tmux pane
// identified by session name and window index. Returns empty string if the
// pane cannot be found or the command fails.
func (tm *TmuxManager) GetPaneCurrentPath(sessionName string, windowIndex int) string {
	if tm.executor == nil {
		return ""
	}

	// Build target specifier: session:window
	target := fmt.Sprintf("%s:%d", sessionName, windowIndex)

	// Execute tmux display-message to get pane_current_path
	output, err := tm.executor.Execute("display-message", "-t", target, "-p", "#{pane_current_path}")
	if err != nil {
		tm.logger.Debug("Failed to get pane current path",
			"session", sessionName,
			"window", windowIndex,
			"error", err)
		return ""
	}

	return strings.TrimSpace(string(output))
}

// discoverSessionWindowsLocked discovers windows for a session with mutex already held
func (tm *TmuxManager) discoverSessionWindowsLocked(sessionName string) error {
	return tm.advancedOps.DiscoverSessionWindowsLocked(tm, sessionName)
}

// discoverSessionWindows discovers and registers windows for an existing tmux session
func (tm *TmuxManager) discoverSessionWindows(sessionName string) error {
	return tm.advancedOps.DiscoverSessionWindows(tm, sessionName)
}
