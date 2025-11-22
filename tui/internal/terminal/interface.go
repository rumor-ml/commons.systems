// interface.go - Terminal manager interface for testing
//
// ## Metadata
//
// TUI terminal manager interface for dependency injection and testing.
//
// ### Purpose
//
// Define the interface contract for terminal management to enable proper unit testing
// with mock implementations while maintaining type safety and clear API boundaries.

package terminal

import tea "github.com/charmbracelet/bubbletea"

// ManagerInterface defines the contract for terminal management
type ManagerInterface interface {
	WriteToSession(sessionID string, data []byte) error
	GetSessionOutput(sessionID string) ([]byte, error)
	HandleResize(width, height int) tea.Cmd
	ResizeSessionImmediate(sessionID string, width, height int) error
}

// Ensure Manager implements the interface
var _ ManagerInterface = (*Manager)(nil)
