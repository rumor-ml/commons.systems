package detector

import (
	"fmt"

	"github.com/commons-systems/tmux-tui/internal/watcher"
)

// State represents the idle state of a pane
type State int

const (
	// StateWorking indicates the pane is actively being used
	StateWorking State = iota
	// StateIdle indicates the pane is idle (waiting for user input)
	StateIdle
)

// String returns the string representation of the state
func (s State) String() string {
	switch s {
	case StateWorking:
		return "working"
	case StateIdle:
		return "idle"
	default:
		return "unknown"
	}
}

// NewState creates a State from an integer value, returning an error for invalid values.
// Most code should use the StateWorking or StateIdle constants directly.
// This constructor is primarily for deserialization or external input validation.
func NewState(value int) (State, error) {
	switch State(value) {
	case StateWorking, StateIdle:
		return State(value), nil
	default:
		return StateWorking, fmt.Errorf("invalid state value: %d (must be StateWorking=0 or StateIdle=1)", value)
	}
}

// NewStateFromString creates a State from a string representation.
func NewStateFromString(s string) (State, error) {
	switch s {
	case "working":
		return StateWorking, nil
	case "idle":
		return StateIdle, nil
	default:
		return StateWorking, fmt.Errorf("invalid state string: %q (must be \"working\" or \"idle\")", s)
	}
}

// StateEvent represents either a successful state change or an error.
// Use NewStateChangeEvent or NewStateErrorEvent to create instances.
type StateEvent struct {
	paneID string
	state  State
	err    error
}

// NewStateChangeEvent creates a StateEvent for a successful state change.
func NewStateChangeEvent(paneID string, state State) StateEvent {
	if paneID == "" {
		panic("detector: paneID cannot be empty for state change event")
	}
	return StateEvent{paneID: paneID, state: state}
}

// NewStateErrorEvent creates a StateEvent for an error.
func NewStateErrorEvent(err error) StateEvent {
	if err == nil {
		panic("detector: error cannot be nil for error event")
	}
	return StateEvent{err: err}
}

// IsError returns true if this is an error event.
func (e StateEvent) IsError() bool {
	return e.err != nil
}

// PaneID returns the pane ID (only valid if !IsError()).
func (e StateEvent) PaneID() string {
	if e.IsError() {
		panic("detector: cannot get PaneID from error event")
	}
	return e.paneID
}

// State returns the state (only valid if !IsError()).
func (e StateEvent) State() State {
	if e.IsError() {
		panic("detector: cannot get State from error event")
	}
	return e.state
}

// Error returns the error (only valid if IsError()).
func (e StateEvent) Error() error {
	return e.err
}

// IdleStateDetector is the interface that all detection strategies must implement
type IdleStateDetector interface {
	// Start begins monitoring for state changes and returns the event channel.
	// This should only be called once. Subsequent calls return the same channel.
	Start() <-chan StateEvent

	// Stop halts the detector and releases resources.
	// After calling Stop, the detector should not be reused.
	Stop() error
}

// eventTypeToState converts watcher.EventType to State for backward compatibility
func eventTypeToState(eventType string) State {
	switch eventType {
	case watcher.EventTypeIdle:
		return StateIdle
	case watcher.EventTypeWorking:
		return StateWorking
	default:
		// All other event types (stop, permission, elicitation) are treated as idle
		// because they indicate the pane is waiting for user input
		return StateIdle
	}
}
