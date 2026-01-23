package detector

import "github.com/commons-systems/tmux-tui/internal/watcher"

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

// StateEvent represents a state change event for a pane
type StateEvent struct {
	PaneID string
	State  State
	Error  error // nil for normal events, non-nil for detection errors
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
