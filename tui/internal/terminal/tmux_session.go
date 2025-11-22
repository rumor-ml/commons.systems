// Package terminal provides tmux session management functionality.
// Handles creation, discovery, and management of tmux sessions for ICF projects.

package terminal

import (
	"fmt"
	"strings"
	"time"

	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// TmuxSessionManager handles tmux session operations
type TmuxSessionManager struct {
	tmuxPath string
	logger   log.Logger
	executor TmuxExecutor
}

// NewTmuxSessionManager creates a new session manager
func NewTmuxSessionManager(tmuxPath string, logger log.Logger, executor TmuxExecutor) *TmuxSessionManager {
	return &TmuxSessionManager{
		tmuxPath: tmuxPath,
		logger:   logger,
		executor: executor,
	}
}

// CreateProjectSession creates a new tmux session for the given project
func (sm *TmuxSessionManager) CreateProjectSession(project *model.Project) (*TmuxSession, error) {
	sessionName := project.Name

	// Check if session already exists
	if sm.tmuxSessionExists(sessionName) {
		sm.logger.Info("Tmux session already exists, attaching", "session", sessionName)
		
		// Get existing session
		session := &TmuxSession{
			Name:    sessionName,
			Project: project,
			Windows: make(map[string]*TmuxWindow),
			Active:  true,
		}
		
		return session, nil
	}

	// Create session in project directory
	projectPath := project.Path
	if projectPath == "" {
		return nil, fmt.Errorf("project path is empty for project %s", project.Name)
	}

	sm.logger.Info("Creating new tmux session", "session", sessionName, "path", projectPath)

	// Create tmux session with proper working directory
	_, err := sm.executor.Execute("new-session", "-d", "-s", sessionName, "-c", projectPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create tmux session %s: %w", sessionName, err)
	}

	// Create session object
	session := &TmuxSession{
		Name:    sessionName,
		Project: project,
		Windows: make(map[string]*TmuxWindow),
		Active:  true,
	}

	return session, nil
}

// ListSessions returns all active tmux sessions
func (sm *TmuxSessionManager) ListSessions() (map[string]*TmuxSession, error) {
	sessions := make(map[string]*TmuxSession)

	if sm.tmuxPath == "" {
		return sessions, nil
	}

	// Get list of all tmux sessions
	output, err := sm.executor.Execute("list-sessions", "-F", "#{session_name}")
	if err != nil {
		// No sessions exist, which is not an error
		return sessions, nil
	}

	sessionNames := strings.Split(strings.TrimSpace(string(output)), "\n")
	for _, sessionName := range sessionNames {
		if sessionName != "" {
			sessions[sessionName] = &TmuxSession{
				Name:    sessionName,
				Windows: make(map[string]*TmuxWindow),
				Active:  true,
			}
		}
	}

	return sessions, nil
}

// GetProjectSession returns the session for a project if it exists
func (sm *TmuxSessionManager) GetProjectSession(projectName string) (*TmuxSession, bool) {
	if !sm.tmuxSessionExists(projectName) {
		return nil, false
	}

	session := &TmuxSession{
		Name:    projectName,
		Windows: make(map[string]*TmuxWindow),
		Active:  true,
	}

	return session, true
}

// getSessionCwd gets the current working directory of a tmux session
func (sm *TmuxSessionManager) getSessionCwd(sessionName string) (string, error) {
	// Get the first pane's current working directory as representative of the session
	output, err := sm.executor.Execute("display-message", "-t", sessionName+":0", "-p", "#{pane_current_path}")
	if err != nil {
		return "", fmt.Errorf("failed to get session cwd for %s: %w", sessionName, err)
	}
	
	return strings.TrimSpace(string(output)), nil
}

// addSessionShellsToProject adds shells from a tmux session to a project
func (sm *TmuxSessionManager) addSessionShellsToProject(session *TmuxSession, project *model.Project) {
	for _, window := range session.Windows {
		// Determine shell type based on window name, command, and pane title
		var shellType model.ShellType
		switch {
		case window.Name == "zsh" || strings.Contains(window.Command, "zsh"):
			shellType = model.ShellTypeZsh
		case window.Name == "claude" || strings.Contains(window.Command, "claude"):
			shellType = model.ShellTypeClaude
		case isClaudeSession(window):
			shellType = model.ShellTypeClaude
		default:
			shellType = model.ShellTypeUnknown
		}

		// Create shell object
		shell := &model.Shell{
			Type:      shellType,
			ProcessID: 0, // Unknown for discovered sessions
			Status:    model.ShellStatusRunning,
			Command:   window.Command,
			PaneTitle: window.PaneTitle,
			CreatedAt: time.Now(),
			LastUsed:  time.Now(),
		}

		// Add to project main shells
		// For unknown sessions, each window becomes a separate shell
		if project.IsOtherSessionsProject() {
			// Use window name as unique key for other sessions
			shellKey := fmt.Sprintf("%s:%s", session.Name, window.Name)
			project.MainShells[model.ShellType(shellKey)] = shell
		} else {
			project.MainShells[shellType] = shell
		}
	}
}

// tmuxSessionExists checks if a tmux session exists
func (sm *TmuxSessionManager) tmuxSessionExists(sessionName string) bool {
	if sm.tmuxPath == "" {
		return false
	}

	// Use tmux has-session to check if session exists
	_, err := sm.executor.Execute("has-session", "-t", sessionName)
	return err == nil
}

// configureSessionKeyBindings sets up key bindings for a tmux session
func (sm *TmuxSessionManager) configureSessionKeyBindings(sessionName string) error {
	if sm.tmuxPath == "" {
		return fmt.Errorf("tmux executable not found")
	}

	// Set up key bindings for the session
	bindings := [][]string{
		// Bind Ctrl+N to create new zsh window
		{"bind-key", "-T", "prefix", "C-n", "new-window", "-n", "zsh", "-c", "#{pane_current_path}", "zsh"},
		// Bind Ctrl+C to create new claude window  
		{"bind-key", "-T", "prefix", "C-c", "new-window", "-n", "claude", "-c", "#{pane_current_path}", "claude"},
	}

	for _, binding := range bindings {
		args := append([]string{"-t", sessionName}, binding...)
		_, err := sm.executor.Execute(args...)
		if err != nil {
			sm.logger.Error("Failed to configure session key binding", "session", sessionName, "error", err)
			// Don't fail the entire configuration for one binding
		}
	}

	return nil
}

// findExistingTUIInstance finds an existing TUI instance in tmux sessions
func (sm *TmuxSessionManager) findExistingTUIInstance() (string, string, error) {
	if sm.tmuxPath == "" {
		return "", "", fmt.Errorf("tmux executable not found")
	}

	// Look for existing TUI instances across all sessions
	output, err := sm.executor.Execute("list-windows", "-a", "-F", "#{session_name}:#{window_index}:#{window_name}:#{pane_current_command}")
	if err != nil {
		return "", "", fmt.Errorf("failed to list windows: %w", err)
	}

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	for _, line := range lines {
		parts := strings.Split(line, ":")
		if len(parts) >= 4 {
			sessionName := parts[0]
			windowIndex := parts[1]
			command := parts[3]
			
			// Look for our TUI process (assuming it's named "tui" or similar)
			if strings.Contains(command, "tui") || strings.Contains(command, "main") {
				return sessionName, windowIndex, nil
			}
		}
	}

	return "", "", fmt.Errorf("no existing TUI instance found")
}

// switchToExistingTUI switches to an existing TUI instance
func (sm *TmuxSessionManager) switchToExistingTUI(sessionName, windowIndex string) error {
	if sm.tmuxPath == "" {
		return fmt.Errorf("tmux executable not found")
	}

	target := fmt.Sprintf("%s:%s", sessionName, windowIndex)

	// Switch to the existing TUI window
	_, err := sm.executor.Execute("select-window", "-t", target)
	if err != nil {
		return fmt.Errorf("failed to switch to TUI window %s: %w", target, err)
	}

	// Attach to the session
	_, err = sm.executor.Execute("attach-session", "-t", sessionName)
	if err != nil {
		return fmt.Errorf("failed to attach to session %s: %w", sessionName, err)
	}

	return nil
}