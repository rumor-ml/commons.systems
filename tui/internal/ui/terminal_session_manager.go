// terminal_session_manager.go - Session management functionality for terminal component

package ui

import (
	"github.com/natb1/tui/internal/terminal"
)

// TerminalSessionManager handles terminal session lifecycle and state management
type TerminalSessionManager struct {
	manager           terminal.ManagerInterface
	sessionID         string
	active            bool
	width             int
	height            int
	contentProcessor  *TerminalContentProcessor
	inputHandler      *TerminalInputHandler
	worktreeProgress  WorktreeProgress
}

// NewTerminalSessionManager creates a new session manager
func NewTerminalSessionManager(manager terminal.ManagerInterface, contentProcessor *TerminalContentProcessor, inputHandler *TerminalInputHandler) *TerminalSessionManager {
	return &TerminalSessionManager{
		manager:          manager,
		contentProcessor: contentProcessor,
		inputHandler:     inputHandler,
	}
}

// SetActive sets the focus state of the terminal component
func (tsm *TerminalSessionManager) SetActive(active bool) {
	tsm.active = active
}

// IsActive returns the current active state
func (tsm *TerminalSessionManager) IsActive() bool {
	return tsm.active
}

// SetSession sets the active terminal session
func (tsm *TerminalSessionManager) SetSession(sessionID string) {
	tsm.sessionID = sessionID
	
	// Update dependent components
	if tsm.contentProcessor != nil {
		tsm.contentProcessor.SetSession(sessionID)
		tsm.contentProcessor.SetLastOutputLen(0) // Reset output tracking
	}
	
	if tsm.inputHandler != nil {
		tsm.inputHandler.SetSession(sessionID)
	}

	// Immediately resize the session to match current component size
	if tsm.manager != nil && tsm.width > 0 && tsm.height > 0 {
		tsm.manager.ResizeSessionImmediate(sessionID, tsm.width, tsm.height)
	}

	// Update content immediately
	if tsm.contentProcessor != nil {
		tsm.contentProcessor.UpdateContent()
	}
}

// GetSessionID returns the current session ID
func (tsm *TerminalSessionManager) GetSessionID() string {
	return tsm.sessionID
}

// Reset resets the terminal component state (used for testing buffer replacement)
func (tsm *TerminalSessionManager) Reset() {
	if tsm.contentProcessor != nil {
		tsm.contentProcessor.SetLastOutputLen(0)
	}
	
	if tsm.inputHandler != nil {
		tsm.inputHandler.Reset()
	}
}

// SetSize updates the component dimensions and resizes the PTY session
func (tsm *TerminalSessionManager) SetSize(width, height int) {
	tsm.width = width
	tsm.height = height
	
	// Update content processor dimensions
	if tsm.contentProcessor != nil {
		tsm.contentProcessor.SetSize(width, height)
	}

	// Resize the PTY session if active
	if tsm.manager != nil && tsm.sessionID != "" {
		tsm.manager.ResizeSessionImmediate(tsm.sessionID, width, height)
	}
}

// GetSize returns the current dimensions
func (tsm *TerminalSessionManager) GetSize() (int, int) {
	return tsm.width, tsm.height
}

// HasNewOutput checks if there is new output to process
func (tsm *TerminalSessionManager) HasNewOutput() bool {
	if tsm.contentProcessor != nil {
		return tsm.contentProcessor.HasNewOutput()
	}
	return false
}

// UpdateContent triggers content update
func (tsm *TerminalSessionManager) UpdateContent() {
	if tsm.contentProcessor != nil {
		tsm.contentProcessor.UpdateContent()
	}
}

// SetWorktreeProgress updates worktree creation progress
func (tsm *TerminalSessionManager) SetWorktreeProgress(progress WorktreeProgress) {
	tsm.worktreeProgress = progress
}

// GetWorktreeProgress returns current worktree progress
func (tsm *TerminalSessionManager) GetWorktreeProgress() WorktreeProgress {
	return tsm.worktreeProgress
}