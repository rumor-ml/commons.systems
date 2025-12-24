package daemon

import (
	"encoding/json"
	"time"
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
	// MsgTypeBlockPane is sent by client to block a pane on a specific branch
	// DEPRECATED as of commit 62f3136 (2024-12-20): Use MsgTypeBlockBranch instead.
	// This message type remains supported for backward compatibility but will be
	// removed in a future major version (tentatively v2.0.0, target 2025-Q2).
	// New code should use MsgTypeBlockBranch which operates on branches directly.
	MsgTypeBlockPane = "block_pane"
	// MsgTypeUnblockPane is sent by client to unblock a pane
	// DEPRECATED as of commit 62f3136 (2024-12-20): Use MsgTypeUnblockBranch instead.
	// This message type remains supported for backward compatibility but will be
	// removed in a future major version (tentatively v2.0.0, target 2025-Q2).
	// New code should use MsgTypeUnblockBranch which operates on branches directly.
	MsgTypeUnblockPane = "unblock_pane"
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
	// MsgTypeHealthQuery is sent by client to request health metrics
	MsgTypeHealthQuery = "health_query"
	// MsgTypeHealthResponse is sent by daemon with health metrics
	MsgTypeHealthResponse = "health_response"
	// MsgTypeSyncWarning is sent by daemon when a broadcast operation fails
	MsgTypeSyncWarning = "sync_warning"
	// MsgTypeResyncRequest is sent by client to request full state resync
	MsgTypeResyncRequest = "resync_request"
	// MsgTypePersistenceError is sent by daemon when file operations fail
	MsgTypePersistenceError = "persistence_error"
	// MsgTypeAudioError is sent by daemon when audio operations fail
	MsgTypeAudioError = "audio_error"
)

// Message represents a message exchanged between daemon and clients
type Message struct {
	Type            string            `json:"type"`
	SeqNum          uint64            `json:"seq_num,omitempty"` // Sequence number for ordering/gap detection
	ClientID        string            `json:"client_id,omitempty"`
	Alerts          map[string]string `json:"alerts,omitempty"`            // Full alert state (for full_state messages)
	PaneID          string            `json:"pane_id,omitempty"`           // For alert_change and block messages
	EventType       string            `json:"event_type,omitempty"`        // For alert_change messages
	Created         bool              `json:"created,omitempty"`           // For alert_change messages
	ActivePaneID    string            `json:"active_pane_id,omitempty"`    // For pane_focus messages
	BlockedPanes    map[string]string `json:"blocked_panes,omitempty"`     // Deprecated: paneID -> blockedOnBranch
	BlockedBranches map[string]string `json:"blocked_branches,omitempty"`  // Full blocked state: branch -> blockedByBranch
	Branch          string            `json:"branch,omitempty"`            // For block_branch messages
	BlockedBranch   string            `json:"blocked_branch,omitempty"`    // For block_branch messages
	Blocked         bool              `json:"blocked,omitempty"`           // For block_change messages (true = blocked, false = unblocked)
	IsBlocked       bool              `json:"is_blocked,omitempty"`        // For blocked_state_response messages
	HealthStatus    *HealthStatus     `json:"health_status,omitempty"`     // For health_response messages
	OriginalMsgType string            `json:"original_msg_type,omitempty"` // For sync_warning messages
	Error           string            `json:"error,omitempty"`             // For error messages (persistence, audio, sync)
}

// HealthStatus contains daemon health metrics
type HealthStatus struct {
	timestamp         time.Time
	uptimeSeconds     int64
	connectedClients  int
	activeAlerts      int
	blockedBranches   int
	broadcastFailures int64
	watcherErrors     int64
	persistenceErrors int64
}

// NewHealthStatus creates a validated HealthStatus.
func NewHealthStatus(
	uptimeSeconds int64,
	connectedClients int,
	activeAlerts int,
	blockedBranches int,
	broadcastFailures int64,
	watcherErrors int64,
	persistenceErrors int64,
) (HealthStatus, error) {
	return HealthStatus{
		timestamp:         time.Now(),
		uptimeSeconds:     uptimeSeconds,
		connectedClients:  connectedClients,
		activeAlerts:      activeAlerts,
		blockedBranches:   blockedBranches,
		broadcastFailures: broadcastFailures,
		watcherErrors:     watcherErrors,
		persistenceErrors: persistenceErrors,
	}, nil
}

// Timestamp returns when this health snapshot was captured
func (h HealthStatus) Timestamp() time.Time { return h.timestamp }

// UptimeSeconds returns daemon uptime in seconds
func (h HealthStatus) UptimeSeconds() int64 { return h.uptimeSeconds }

// ConnectedClients returns number of connected clients
func (h HealthStatus) ConnectedClients() int { return h.connectedClients }

// ActiveAlerts returns number of active alerts
func (h HealthStatus) ActiveAlerts() int { return h.activeAlerts }

// BlockedBranches returns number of blocked branches
func (h HealthStatus) BlockedBranches() int { return h.blockedBranches }

// BroadcastFailures returns cumulative broadcast failure count
func (h HealthStatus) BroadcastFailures() int64 { return h.broadcastFailures }

// WatcherErrors returns cumulative watcher error count
func (h HealthStatus) WatcherErrors() int64 { return h.watcherErrors }

// PersistenceErrors returns cumulative persistence error count
func (h HealthStatus) PersistenceErrors() int64 { return h.persistenceErrors }

// MarshalJSON implements json.Marshaler to support JSON encoding of private fields
func (h HealthStatus) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Timestamp         time.Time `json:"timestamp"`
		UptimeSeconds     int64     `json:"uptime_seconds"`
		ConnectedClients  int       `json:"connected_clients"`
		ActiveAlerts      int       `json:"active_alerts"`
		BlockedBranches   int       `json:"blocked_branches"`
		BroadcastFailures int64     `json:"broadcast_failures"`
		WatcherErrors     int64     `json:"watcher_errors"`
		PersistenceErrors int64     `json:"persistence_errors"`
	}{
		Timestamp:         h.timestamp,
		UptimeSeconds:     h.uptimeSeconds,
		ConnectedClients:  h.connectedClients,
		ActiveAlerts:      h.activeAlerts,
		BlockedBranches:   h.blockedBranches,
		BroadcastFailures: h.broadcastFailures,
		WatcherErrors:     h.watcherErrors,
		PersistenceErrors: h.persistenceErrors,
	})
}

// UnmarshalJSON implements json.Unmarshaler to support JSON decoding into private fields
func (h *HealthStatus) UnmarshalJSON(data []byte) error {
	var temp struct {
		Timestamp         time.Time `json:"timestamp"`
		UptimeSeconds     int64     `json:"uptime_seconds"`
		ConnectedClients  int       `json:"connected_clients"`
		ActiveAlerts      int       `json:"active_alerts"`
		BlockedBranches   int       `json:"blocked_branches"`
		BroadcastFailures int64     `json:"broadcast_failures"`
		WatcherErrors     int64     `json:"watcher_errors"`
		PersistenceErrors int64     `json:"persistence_errors"`
	}
	if err := json.Unmarshal(data, &temp); err != nil {
		return err
	}
	h.timestamp = temp.Timestamp
	h.uptimeSeconds = temp.UptimeSeconds
	h.connectedClients = temp.ConnectedClients
	h.activeAlerts = temp.ActiveAlerts
	h.blockedBranches = temp.BlockedBranches
	h.broadcastFailures = temp.BroadcastFailures
	h.watcherErrors = temp.WatcherErrors
	h.persistenceErrors = temp.PersistenceErrors
	return nil
}

// BlockedState represents the result of checking if a branch is blocked.
// This is the preferred return type for branch blocking queries instead of
// returning multiple values (blockedBy string, isBlocked bool).
type BlockedState struct {
	IsBlocked bool
	BlockedBy string // Empty if not blocked, otherwise the blocking branch name
}

// Error Handling Documentation
//
// The protocol defines validation errors that occur during message construction
// and wire format conversion. These errors indicate programmer mistakes (invalid
// inputs) rather than network/runtime failures.
//
// WHEN THESE ERRORS OCCUR:
//
// ValidationError: Returned by ValidateMessage() when a wire-format Message
// lacks required fields (currently only enforces Type field). This indicates
// a bug in message construction or corrupted wire data.
//
// Constructor Errors (from NewXxxMessage functions): Returned when required
// fields are empty after trimming whitespace. Examples:
//   - NewHelloMessage: "client_id required"
//   - NewAlertChangeMessage: "pane_id required" or "event_type required"
//   - NewBlockChangeMessage: "branch required" or "blocked_branch required when blocked is true"
//
// FromWireFormat Errors: Returned when converting v1 Message to v2:
//   - "invalid wire message: <ValidationError>" - wire message failed basic validation
//   - "unknown message type: <type>" - unrecognized Type field
//   - Any constructor error listed above - wire message has missing required fields
//
// HOW TO HANDLE THESE ERRORS:
//
// In Production Code:
//   - Log the error with full context (message type, field values)
//   - Send error response to client if applicable (PersistenceErrorMessage)
//   - Do NOT retry - these are validation failures, not transient errors
//   - Consider disconnecting clients sending consistently malformed messages
//
// In Tests:
//   - Use require.NoError(t, err) for valid inputs (catch regressions)
//   - Use require.Error(t, err) for invalid inputs (verify validation works)
//   - Check error message contains expected substring for specificity
//
// EXAMPLE USAGE:
//
//   // Server receiving message from client
//   var wire Message
//   if err := decoder.Decode(&wire); err != nil {
//       return fmt.Errorf("decode error: %w", err) // Network/JSON error
//   }
//
//   msg, err := FromWireFormat(wire)
//   if err != nil {
//       log.Printf("Invalid message from client %s: %v", clientID, err)
//       return fmt.Errorf("invalid message: %w", err) // Validation error
//   }

// ValidateMessage performs basic validation on a wire-format Message.
// Returns nil if valid, error describing the issue if invalid.
func ValidateMessage(msg Message) error {
	if msg.Type == "" {
		return &ValidationError{Field: "type", Message: "message type required"}
	}
	return nil
}

// ValidationError describes a validation failure for a message field
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	return e.Field + ": " + e.Message
}
