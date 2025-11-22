// session_discovery.go - Tmux session discovery and management functionality

package terminal

import (
	"strings"

	"github.com/rumor-ml/log/pkg/log"
)

// SessionDiscovery handles tmux session discovery and management
type SessionDiscovery struct {
	tmuxPath string
	logger   log.Logger
	executor TmuxExecutor
}

// NewSessionDiscovery creates a new session discovery manager
func NewSessionDiscovery(tmuxPath string, logger log.Logger, executor TmuxExecutor) *SessionDiscovery {
	return &SessionDiscovery{
		tmuxPath: tmuxPath,
		logger:   logger,
		executor: executor,
	}
}

// DiscoverExistingSessions discovers and registers ALL existing tmux sessions
func (sd *SessionDiscovery) DiscoverExistingSessions() (map[string]*TmuxSession, error) {
	if sd.tmuxPath == "" {
		sd.logger.Warn("tmux executable not found, skipping session discovery")
		return make(map[string]*TmuxSession), nil
	}

	// List existing tmux sessions with additional info
	output, err := sd.executor.Execute("list-sessions", "-F", "#{session_name}:#{pane_current_path}")
	if err != nil {
		// No sessions exist, which is fine
		return make(map[string]*TmuxSession), nil
	}

	sessions, err := sd.processSessionOutput(string(output))
	return sessions, err
}

// processSessionOutput processes tmux session listing output
func (sd *SessionDiscovery) processSessionOutput(output string) (map[string]*TmuxSession, error) {
	sessions := make(map[string]*TmuxSession)
	sessionLines := strings.Split(strings.TrimSpace(output), "\n")

	for _, line := range sessionLines {
		if line == "" {
			continue
		}

		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}

		sessionName := parts[0]
		// parts[1] is sessionCwd, not needed after removing DEBUG log

		// Removed: High-frequency DEBUG log (fired by tmux ticker every 2 seconds, once per session)

		// Create session entry - will be mapped to projects later
		session := &TmuxSession{
			Name:    sessionName,
			Project: nil, // Will be set during project mapping
			Windows: make(map[string]*TmuxWindow),
			Active:  true,
		}
		sessions[sessionName] = session
	}

	return sessions, nil
}

// ListSessions returns all discovered sessions
func (sd *SessionDiscovery) ListSessions(sessions map[string]*TmuxSession) (map[string]*TmuxSession, error) {
	// Return a copy to prevent race conditions
	sessionsCopy := make(map[string]*TmuxSession)
	for name, session := range sessions {
		sessionsCopy[name] = session
	}

	return sessionsCopy, nil
}

// GetSessionCwd gets the current working directory for a session
func (sd *SessionDiscovery) GetSessionCwd(sessionName string) (string, error) {
	if sd.tmuxPath == "" {
		return "", nil
	}

	output, err := sd.executor.Execute("display-message", "-t", sessionName, "-p", "#{pane_current_path}")
	if err != nil {
		return "", err
	}

	return strings.TrimSpace(string(output)), nil
}