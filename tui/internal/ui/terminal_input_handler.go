// terminal_input_handler.go - Input handling functionality for terminal component

package ui

import (
	"bytes"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/natb1/tui/internal/terminal"
)

// TerminalInputHandler handles terminal input processing and key mapping
type TerminalInputHandler struct {
	manager       terminal.ManagerInterface
	sessionID     string
	lastInput     []byte
	lastInputTime time.Time
}

// NewTerminalInputHandler creates a new input handler
func NewTerminalInputHandler(manager terminal.ManagerInterface) *TerminalInputHandler {
	return &TerminalInputHandler{
		manager: manager,
	}
}

// SetSession updates the session ID for input handling
func (tih *TerminalInputHandler) SetSession(sessionID string) {
	tih.sessionID = sessionID
}

// HandleTerminalInput processes terminal keyboard input
func (tih *TerminalInputHandler) HandleTerminalInput(msg tea.KeyMsg) tea.Cmd {
	if tih.sessionID == "" || tih.manager == nil {
		return nil
	}

	var input []byte

	switch msg.Type {
	case tea.KeyEnter:
		input = []byte("\r")
	case tea.KeyTab:
		input = []byte("\t")
	case tea.KeyBackspace:
		input = []byte("\x7f") // Most terminals expect DEL for backspace
	case tea.KeyDelete:
		// Try to detect terminal type, default to escape sequence
		// Most modern terminals need the escape sequence for forward delete
		input = []byte("\x1b[3~")
	case tea.KeyEscape:
		input = []byte("\x1b")
	case tea.KeyCtrlC:
		input = []byte("\x03")
	case tea.KeyCtrlD:
		input = []byte("\x04")
	case tea.KeyUp:
		input = []byte("\x1b[A")
	case tea.KeyDown:
		input = []byte("\x1b[B")
	case tea.KeyRight:
		input = []byte("\x1b[C")
	case tea.KeyLeft:
		input = []byte("\x1b[D")
	case tea.KeyCtrlN:
		// Ignore ctrl+n - it doesn't do anything in our app
		return nil
	default:
		// Regular character input - only if we have actual runes
		if len(msg.Runes) > 0 {
			input = []byte(string(msg.Runes))
		} else {
			// For other control sequences we don't handle, ignore them
			return nil
		}
	}

	// Implement input deduplication to prevent double input
	now := time.Now()
	if bytes.Equal(input, tih.lastInput) && now.Sub(tih.lastInputTime) < 5*time.Millisecond {
		// Skip duplicate input within 5ms window
		return nil
	}

	tih.lastInput = append([]byte(nil), input...) // Copy input
	tih.lastInputTime = now

	return func() tea.Msg {
		err := tih.manager.WriteToSession(tih.sessionID, input)
		if err != nil {
			return TerminalInputErrorMsg{Error: err}
		}
		return nil
	}
}

// Reset clears input history for fresh session start
func (tih *TerminalInputHandler) Reset() {
	tih.lastInput = nil
	tih.lastInputTime = time.Time{}
}