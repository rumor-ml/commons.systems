// types.go - Terminal data types and structures
//
// ## Metadata
//
// TUI terminal type definitions for session management and application integration.
//
// ### Purpose
//
// Define all data structures, types, and constants used by the terminal management system,
// providing clear type definitions for sessions, applications, and integration capabilities
// while maintaining ICF compliance and supporting multiplexer functionality.
//
// ### Instructions
//
// #### Type Definitions
//
// ##### Core Types
//
// Define session, application, and management types that support the terminal multiplexer's
// core functionality including PTY management, ICF application integration, and event handling.
//
// ##### Integration Types
//
// Provide type definitions for ICF application capabilities, integration configuration,
// and status reporting to enable rich application-aware terminal session management.
//
// ### Dependencies
//
// #### [ICF](https://github.com/rumor-ml/icf)
//
// Core framework providing project context and application detection patterns that inform
// the type structure and integration capabilities defined in this package.

package terminal

import (
	"context"
	"os"
	"os/exec"
	"sync"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/natb1/tui/pkg/model"
	"golang.org/x/term"
)

// Default PTY dimensions and timeouts
const (
	DefaultPTYColumns = 120
	DefaultPTYRows    = 30
	InputDebounceTime = 10 * time.Millisecond
	SessionTimeout    = 24 * time.Hour
)

// Manager handles terminal session management
type Manager struct {
	sessions      map[string]*Session
	passthrough   *PassthroughHandler
	ctx           context.Context
	cancel        context.CancelFunc
	mutex         sync.RWMutex
	eventChan     chan tea.Msg
	terminalState *term.State // Terminal state for raw mode
	shuttingDown  bool        // Flag to track shutdown state
}

// Session represents a terminal session
type Session struct {
	ID           string             `json:"id"`
	Project      *model.Project     `json:"project"`
	PTY          *os.File           `json:"-"`
	Command      *exec.Cmd          `json:"-"`
	Active       bool               `json:"active"`
	Output       *RingBuffer        `json:"-"`             // Terminal output ring buffer
	WorktreeID   string             `json:"worktree_id"`   // Branch name if this is a worktree session
	WorktreePath string             `json:"worktree_path"` // Path to the worktree directory
	ctx          context.Context    `json:"-"`
	cancel       context.CancelFunc `json:"-"`
	mutex        sync.RWMutex       `json:"-"`
}

// Size represents terminal dimensions
type Size struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

// PassthroughHandler manages event passthrough to applications
type PassthroughHandler struct {
	activeSession string
	eventQueue    chan Event
}


// Event represents a passthrough event
type Event struct {
	Type      EventType   `json:"type"`
	Data      interface{} `json:"data"`
	SessionID string      `json:"session_id"`
	Timestamp string      `json:"timestamp"`
}

// EventType categorizes events
type EventType string

const (
	EventTypeKeyboard EventType = "keyboard"
	EventTypeMouse    EventType = "mouse"
	EventTypeResize   EventType = "resize"
	EventTypeSignal   EventType = "signal"
)

// SessionCreatedMsg is sent when a new session is created
type SessionCreatedMsg struct {
	Session *Session
}

// SessionTerminatedMsg is sent when a session ends
type SessionTerminatedMsg struct {
	SessionID string
	ExitCode  int
}
