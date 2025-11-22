// manager.go - Terminal PTY management coordination
//
// ## Metadata
//
// TUI terminal management coordination and event handling.
//
// ### Purpose
//
// Coordinate terminal management operations including initialization, event handling,
// and integration with the broader multiplexer system while maintaining proper
// resource management and graceful shutdown procedures.
//
// ### Instructions
//
// #### Manager Coordination
//
// ##### Event Handling
//
// Process and route terminal-related events including resize operations, message
// handling, and coordination with other multiplexer subsystems for seamless operation.
//
// ##### Resource Management
//
// Initialize and manage terminal management resources including session tracking,
// application registry, and event coordination while ensuring clean shutdown.
//
// ### Dependencies
//
// #### [ICF](https://github.com/rumor-ml/icf)
//
// Core framework providing integration patterns and project context that inform
// terminal management coordination and event handling throughout the system.

package terminal

import (
	"context"
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/natb1/tui/pkg/discovery"
	"golang.org/x/term"
)

// NewManager creates a new terminal manager
func NewManager() *Manager {
	ctx, cancel := context.WithCancel(context.Background())
	return &Manager{
		sessions: make(map[string]*Session),
		passthrough: &PassthroughHandler{
			eventQueue: make(chan Event, 100),
		},
		ctx:           ctx,
		cancel:        cancel,
		eventChan:     make(chan tea.Msg, 10),
		terminalState: nil,
	}
}

// HandleMsg processes tea messages for the terminal manager
func (m *Manager) HandleMsg(msg tea.Msg) tea.Cmd {
	switch msg := msg.(type) {
	case discovery.ProjectDiscoveredMsg:
		return m.handleProjectDiscovered(msg)
	case SessionCreatedMsg:
		return m.handleSessionCreated(msg)
	case SessionTerminatedMsg:
		return m.handleSessionTerminated(msg)
	}
	return nil
}

// HandleResize processes terminal resize events
func (m *Manager) HandleResize(width, height int) tea.Cmd {
	// Propagate resize to all active sessions
	var cmds []tea.Cmd

	// Copy sessions to avoid holding lock during resize operations
	m.mutex.RLock()
	sessions := make([]*Session, 0, len(m.sessions))
	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}
	m.mutex.RUnlock()

	for _, session := range sessions {
		session.mutex.RLock()
		isActive := session.Active
		ptyFile := session.PTY
		session.mutex.RUnlock()

		if isActive && ptyFile != nil {
			cmd := m.resizeSession(session, width, height)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
		}
	}

	return tea.Batch(cmds...)
}

// handleProjectDiscovered processes newly discovered projects
func (m *Manager) handleProjectDiscovered(msg discovery.ProjectDiscoveredMsg) tea.Cmd {
	// Register project for potential terminal sessions
	return nil
}

// Shutdown gracefully shuts down the terminal manager
func (m *Manager) Shutdown() error {
	m.cancel() // Cancel context for all operations

	// Copy sessions to avoid holding lock while calling session methods
	m.mutex.RLock()
	sessions := make([]*Session, 0, len(m.sessions))
	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}
	m.mutex.RUnlock()

	// Close all active sessions with proper synchronization
	for _, session := range sessions {
		session.mutex.RLock()
		isActive := session.Active
		cancel := session.cancel
		ptyFile := session.PTY
		session.mutex.RUnlock()

		if isActive {
			if cancel != nil {
				cancel()
			}
			if ptyFile != nil {
				ptyFile.Close()
			}
		}
	}

	// Close event channel and mark as shutting down
	m.mutex.Lock()
	m.shuttingDown = true
	close(m.eventChan)
	m.mutex.Unlock()

	return nil
}

// EnableRawMode puts the terminal into raw mode for proper PTY handling
func (m *Manager) EnableRawMode() error {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	if m.terminalState != nil {
		// Already in raw mode
		return nil
	}

	// Save current terminal state and enable raw mode
	oldState, err := term.MakeRaw(int(os.Stdin.Fd()))
	if err != nil {
		return fmt.Errorf("failed to enable raw mode: %w", err)
	}

	m.terminalState = oldState
	return nil
}

// RestoreTerminalMode restores the terminal to its original state
func (m *Manager) RestoreTerminalMode() error {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	if m.terminalState == nil {
		// Not in raw mode
		return nil
	}

	err := term.Restore(int(os.Stdin.Fd()), m.terminalState)
	if err != nil {
		return fmt.Errorf("failed to restore terminal mode: %w", err)
	}

	m.terminalState = nil
	return nil
}
