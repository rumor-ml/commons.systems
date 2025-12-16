package daemon

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// Query response channel error types
var (
	ErrQueryChannelFull   = errors.New("query response channel full")
	ErrQueryChannelClosed = errors.New("query response channel closed")
	ErrQueryTimeout       = errors.New("timeout waiting for blocked state response (2s). " +
		"Troubleshooting: Check daemon health with 'tmux-tui-daemon health' " +
		"or review debug logs for sequence gaps")
)

// Connection error types
var (
	ErrConnectionTimeout = errors.New("timeout connecting to daemon")
	ErrConnectionFailed  = errors.New("connection to daemon failed")
	ErrSocketNotFound    = errors.New("socket not found")
	ErrPermissionDenied  = errors.New("permission denied")
)

// Message types for client-daemon communication
const (
	// MsgTypeHello is sent by client when connecting
	MsgTypeHello = "hello"
	// MsgTypeFullState is sent by daemon after client connects with complete alert state
	MsgTypeFullState = "full_state"
	// MsgTypeAlertChange is sent by daemon when an alert changes
	MsgTypeAlertChange = "alert_change"
	// MsgTypePaneFocus is sent by daemon when the active pane changes
	MsgTypePaneFocus = "pane_focus"
	// MsgTypePing is sent by client to check daemon health
	MsgTypePing = "ping"
	// MsgTypePong is sent by daemon in response to ping
	MsgTypePong = "pong"
	// MsgTypeShowBlockPicker is sent to request TUI show branch picker for a pane
	MsgTypeShowBlockPicker = "show_block_picker"
	// MsgTypeBlockBranch is sent by client to block a branch with another branch
	MsgTypeBlockBranch = "block_branch"
	// MsgTypeUnblockBranch is sent by client to unblock a branch
	MsgTypeUnblockBranch = "unblock_branch"
	// MsgTypeBlockedState is sent by daemon with full blocked state
	MsgTypeBlockedState = "blocked_state"
	// MsgTypeBlockChange is sent by daemon when a block state changes
	MsgTypeBlockChange = "block_change"
	// MsgTypeQueryBlockedState is sent by client to query if a branch is blocked
	MsgTypeQueryBlockedState = "query_blocked_state"
	// MsgTypeBlockedStateResponse is sent by daemon in response to query_blocked_state
	MsgTypeBlockedStateResponse = "blocked_state_response"
	// MsgTypePersistenceError is sent by daemon when blocked state can't be saved
	MsgTypePersistenceError = "persistence_error"
	// MsgTypeSyncWarning is sent by daemon when some clients missed an update (broadcast partial failure)
	// This is informational only - clients should log it but not treat it as an error
	MsgTypeSyncWarning = "sync_warning"
	// MsgTypeResyncRequest is sent by client when it detects a gap in sequence numbers
	MsgTypeResyncRequest = "resync_request"
	// MsgTypeAudioError is sent by daemon when audio playback fails
	MsgTypeAudioError = "audio_error"
)

// Message represents a message exchanged between daemon and clients
type Message struct {
	Type         string            `json:"type"`
	ClientID     string            `json:"client_id,omitempty"`
	SeqNum       uint64            `json:"seq_num,omitempty"`        // Sequence number for ordering/gap detection
	Alerts       map[string]string `json:"alerts,omitempty"`         // Full alert state (for full_state messages)
	PaneID       string            `json:"pane_id,omitempty"`        // For alert_change and block messages
	EventType    string            `json:"event_type,omitempty"`     // For alert_change messages
	Created      bool              `json:"created,omitempty"`        // For alert_change messages
	ActivePaneID string            `json:"active_pane_id,omitempty"` // For pane_focus messages
	// BlockedPanes maps paneID to the branch it's blocked on (inverse of BlockedBranches)
	// DEPRECATED: Use BlockedBranches (branch -> blockedByBranch) instead
	// STATUS: Never implemented in daemon, retained only for JSON backward compatibility
	// REMOVAL: Can be safely removed in next major version when breaking protocol changes are acceptable
	// Example: {"pane-1": "main"} means pane-1 is blocked on branch main
	// This is the INVERSE of BlockedBranches which maps blocked branch -> blocking branch
	BlockedPanes    map[string]string `json:"blocked_panes,omitempty"`
	BlockedBranches map[string]string `json:"blocked_branches,omitempty"` // Full blocked state: branch -> blockedByBranch
	Branch          string            `json:"branch,omitempty"`           // For block_branch messages
	BlockedBranch   string            `json:"blocked_branch,omitempty"`   // For block_branch messages
	Blocked         bool              `json:"blocked,omitempty"`          // For block_change messages (true = blocked, false = unblocked)
	IsBlocked       bool              `json:"is_blocked,omitempty"`       // For blocked_state_response messages
	Error           string            `json:"error,omitempty"`            // For persistence_error and sync_warning messages
}

// FUTURE WORK: Message Struct Redesign
//
// The current Message struct uses optional fields for all message types, which has drawbacks:
//   1. Easy to forget required fields (compile-time safety lost)
//   2. Large struct size for all messages (memory inefficient)
//   3. Unclear which fields are valid for each message type
//
// PROPOSED: Use interface-based discriminated union with type-specific structs
// CURRENT MITIGATION: ValidateMessage() provides runtime validation (see below)
// DECISION: Redesign deferred until protocol breaking changes become necessary

// HealthStatus represents daemon health metrics for monitoring
type HealthStatus struct {
	timestamp          time.Time `json:"timestamp"`
	broadcastFailures  int64     `json:"broadcast_failures"`
	lastBroadcastError string    `json:"last_broadcast_error,omitempty"`
	watcherErrors      int64     `json:"watcher_errors"`
	lastWatcherError   string    `json:"last_watcher_error,omitempty"`
	connectedClients   int       `json:"connected_clients"`
	activeAlerts       int       `json:"active_alerts"`
	blockedBranches    int       `json:"blocked_branches"`
}

// NewHealthStatus creates a validated HealthStatus with current timestamp.
// Returns error if any count fields are negative.
func NewHealthStatus(
	broadcastFailures int64,
	lastBroadcastError string,
	watcherErrors int64,
	lastWatcherError string,
	connectedClients int,
	activeAlerts int,
	blockedBranches int,
) (HealthStatus, error) {
	// Validation: all counts must be non-negative
	if broadcastFailures < 0 {
		return HealthStatus{}, fmt.Errorf("broadcastFailures must be non-negative, got %d", broadcastFailures)
	}
	if watcherErrors < 0 {
		return HealthStatus{}, fmt.Errorf("watcherErrors must be non-negative, got %d", watcherErrors)
	}
	if connectedClients < 0 {
		return HealthStatus{}, fmt.Errorf("connectedClients must be non-negative, got %d", connectedClients)
	}
	if activeAlerts < 0 {
		return HealthStatus{}, fmt.Errorf("activeAlerts must be non-negative, got %d", activeAlerts)
	}
	if blockedBranches < 0 {
		return HealthStatus{}, fmt.Errorf("blockedBranches must be non-negative, got %d", blockedBranches)
	}

	return HealthStatus{
		timestamp:          time.Now(),
		broadcastFailures:  broadcastFailures,
		lastBroadcastError: strings.TrimSpace(lastBroadcastError),
		watcherErrors:      watcherErrors,
		lastWatcherError:   strings.TrimSpace(lastWatcherError),
		connectedClients:   connectedClients,
		activeAlerts:       activeAlerts,
		blockedBranches:    blockedBranches,
	}, nil
}

// Timestamp returns the timestamp when the health status was captured
func (h HealthStatus) Timestamp() time.Time { return h.timestamp }

// BroadcastFailures returns the total broadcast failures since daemon startup
func (h HealthStatus) BroadcastFailures() int64 { return h.broadcastFailures }

// LastBroadcastError returns the most recent broadcast error message
func (h HealthStatus) LastBroadcastError() string { return h.lastBroadcastError }

// WatcherErrors returns the total watcher errors since daemon startup
func (h HealthStatus) WatcherErrors() int64 { return h.watcherErrors }

// LastWatcherError returns the most recent watcher error message
func (h HealthStatus) LastWatcherError() string { return h.lastWatcherError }

// ConnectedClients returns the current number of connected clients
func (h HealthStatus) ConnectedClients() int { return h.connectedClients }

// ActiveAlerts returns the current number of active alerts
func (h HealthStatus) ActiveAlerts() int { return h.activeAlerts }

// BlockedBranches returns the current number of blocked branches
func (h HealthStatus) BlockedBranches() int { return h.blockedBranches }

// BlockedState represents the result of checking if a branch is blocked
type BlockedState struct {
	IsBlocked bool
	BlockedBy string // Empty if not blocked
}

// ValidateMessage validates that a Message has required fields for its type.
// Returns nil if valid, error describing the problem if invalid.
//
// This helps catch protocol violations early and provides clear error messages
// for debugging client-daemon communication issues.
func ValidateMessage(msg Message) error {
	if msg.Type == "" {
		return errors.New("message type is required")
	}

	switch msg.Type {
	case MsgTypeHello:
		if msg.ClientID == "" {
			return errors.New("hello message requires client_id")
		}
	case MsgTypeAlertChange:
		if msg.PaneID == "" {
			return errors.New("alert_change message requires pane_id")
		}
		if msg.EventType == "" {
			return errors.New("alert_change message requires event_type")
		}
	case MsgTypePaneFocus:
		if msg.ActivePaneID == "" {
			return errors.New("pane_focus message requires active_pane_id")
		}
	case MsgTypeShowBlockPicker:
		if msg.PaneID == "" {
			return errors.New("show_block_picker message requires pane_id")
		}
	case MsgTypeBlockBranch:
		if msg.Branch == "" {
			return errors.New("block_branch message requires branch")
		}
		if msg.BlockedBranch == "" {
			return errors.New("block_branch message requires blocked_branch")
		}
	case MsgTypeUnblockBranch:
		if msg.Branch == "" {
			return errors.New("unblock_branch message requires branch")
		}
	case MsgTypeQueryBlockedState:
		if msg.Branch == "" {
			return errors.New("query_blocked_state message requires branch")
		}
	case MsgTypeBlockedStateResponse:
		if msg.Branch == "" {
			return errors.New("blocked_state_response message requires branch")
		}
	case MsgTypeFullState, MsgTypePing, MsgTypePong, MsgTypeResyncRequest:
		// No required fields
	case MsgTypeSyncWarning, MsgTypePersistenceError, MsgTypeAudioError:
		// Error field is optional but recommended
	default:
		// Unknown message type - not necessarily invalid (forward compatibility)
		return nil
	}

	return nil
}
