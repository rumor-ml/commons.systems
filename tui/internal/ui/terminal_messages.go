// terminal_messages.go - Message types for terminal component communication

package ui

// TerminalOutputUpdateMsg signals that terminal output should be refreshed
type TerminalOutputUpdateMsg struct {
	SessionID string
}

// TerminalInputErrorMsg signals an input error
type TerminalInputErrorMsg struct {
	Error error
}

