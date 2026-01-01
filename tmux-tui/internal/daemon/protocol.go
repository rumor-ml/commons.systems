package daemon

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/commons-systems/tmux-tui/internal/tmux"
)

// TODO(#280): Document error variables with usage context - see PR review for #273
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

// Health status error types
var (
	ErrHealthValidationFailed = errors.New("health status validation failed: internal state corrupted")
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
	// MsgTypeHealthQuery is sent by client to request health status
	MsgTypeHealthQuery = "health_query"
	// MsgTypeHealthResponse is sent by daemon with health metrics
	MsgTypeHealthResponse = "health_response"
	// MsgTypeTreeUpdate is sent by daemon with complete tmux tree state
	MsgTypeTreeUpdate = "tree_update"
	// MsgTypeTreeError is sent by daemon when tree collection fails
	MsgTypeTreeError = "tree_error"
)

// Message represents a message exchanged between daemon and clients
type Message struct {
	Type            string            `json:"type"`
	ClientID        string            `json:"client_id,omitempty"`
	SeqNum          uint64            `json:"seq_num,omitempty"`           // Sequence number for ordering/gap detection
	OriginalMsgType string            `json:"original_msg_type,omitempty"` // For sync_warning messages - indicates which message type failed (e.g., "full_state" means full_state broadcast failed to sync)
	Alerts          map[string]string `json:"alerts,omitempty"`            // Full alert state (for full_state messages)
	PaneID          string            `json:"pane_id,omitempty"`           // For alert_change and block messages
	EventType       string            `json:"event_type,omitempty"`        // For alert_change messages
	Created         bool              `json:"created,omitempty"`           // For alert_change messages
	ActivePaneID    string            `json:"active_pane_id,omitempty"`    // For pane_focus messages
	// BlockedPanes maps paneID to the branch it's blocked on (inverse of BlockedBranches)
	//
	// TODO(#280): Update deprecation timeline to specific version - see PR review for #273
	// DEPRECATED AS OF: Current development (never released) - Never populated by daemon
	// REPLACEMENT: Use BlockedBranches (branch -> blockedByBranch) for all block state queries
	//
	// MIGRATION:
	//   - Daemon: Never writes this field (always nil/empty, omitempty prevents serialization)
	//   - Clients: Should ignore this field entirely; use BlockedBranches instead
	//   - Old clients: No clients ever used this field (introduced and deprecated before first release)
	//
	// REMOVAL: Can be removed in v1.0.0 when protocol breaking changes are bundled
	//
	// SEMANTIC NOTE: This was the INVERSE mapping of BlockedBranches
	//   BlockedPanes: pane → blocking branch (never implemented)
	//   BlockedBranches: blocked branch → blocking branch (correct implementation)
	//
	// Example of what this WOULD have been: {"pane-1": "main"} means pane-1 is blocked on branch main
	BlockedPanes    map[string]string `json:"blocked_panes,omitempty"`
	BlockedBranches map[string]string `json:"blocked_branches,omitempty"` // Full blocked state: branch -> blockedByBranch
	Branch          string            `json:"branch,omitempty"`           // For block_branch messages
	BlockedBranch   string            `json:"blocked_branch,omitempty"`   // For block_branch messages
	Blocked         bool              `json:"blocked,omitempty"`          // For block_change messages (true = blocked, false = unblocked)
	IsBlocked       bool              `json:"is_blocked,omitempty"`       // For blocked_state_response messages
	Error           string            `json:"error,omitempty"`            // For persistence_error and sync_warning messages
	HealthStatus    *HealthStatus     `json:"health_status,omitempty"`    // For health_response messages
	Tree            *tmux.RepoTree    `json:"tree,omitempty"`             // Non-nil for tree_update only. Pointer enables omitempty to reduce message size.
}

// PROTOCOL V2 MIGRATION GUIDE
//
// As of Phase 6, we have implemented type-safe message structs in protocol_v2.go.
// This provides compile-time safety while maintaining wire protocol compatibility.
//
// ARCHITECTURE:
//   - v1 Message (this file): Wire format for JSON serialization (unchanged)
//   - v2 structs (protocol_v2.go): Type-safe internal representation with private fields
//   - Conversion at boundaries: ToWireFormat() and FromWireFormat()
//
// WHEN TO USE V1 vs V2:
//   - Use v1 Message: For JSON encoding/decoding (wire protocol)
//   - Use v2 constructors: For creating messages internally (server/client)
//   - Use FromWireFormat(): To convert received v1 messages to type-safe v2
//
// MIGRATION STATUS:
//   - Server: Fully migrated to v2 constructors (Phase 6.3 complete)
//   - Client: Using v1 Message directly (migration optional)
//   - Wire protocol: Unchanged - backward compatible
//
// EXAMPLE SERVER USAGE:
//   // Create type-safe v2 message
//   msg, err := NewAlertChangeMessage(seqNum, paneID, eventType, created)
//   if err != nil {
//       // Handle validation error (required fields missing)
//       return
//   }
//   // Convert to v1 for wire protocol
//   d.broadcast(msg.ToWireFormat())
//
// EXAMPLE CLIENT USAGE (optional):
//   // Decode from wire format (v1)
//   var wireMsg Message
//   decoder.Decode(&wireMsg)
//   // Convert to type-safe v2 (optional)
//   msg, err := FromWireFormat(wireMsg)
//   if err != nil {
//       // Handle invalid message
//       return
//   }
//   // Type-safe access to fields
//   switch m := msg.(type) {
//   case *AlertChangeMessageV2:
//       paneID := m.PaneID()  // Guaranteed to be non-empty
//   }
//
// BENEFITS:
//   1. Compile-time safety: Required fields enforced by constructors
//   2. Encapsulation: Private fields prevent accidental mutation
//   3. Wire compatibility: No protocol breaking changes
//   4. Validation: Constructor errors provide clear feedback
//
// CURRENT MITIGATION: ValidateMessage() provides runtime validation for v1 messages

// HealthStatus represents daemon health metrics for monitoring.
// All fields are private to enforce validation and immutability.
// Use NewHealthStatus() to create and getters to access fields.
type HealthStatus struct {
	timestamp               time.Time
	broadcastFailures       int64
	lastBroadcastError      string
	watcherErrors           int64
	lastWatcherError        string
	connectionCloseErrors   int64
	lastCloseError          string
	audioBroadcastFailures  int64
	lastAudioBroadcastErr   string
	treeBroadcastErrors     int64  // Total tree broadcast failures
	lastTreeBroadcastErr    string // Most recent tree broadcast error
	treeMsgConstructErrors  int64  // Total tree message construction failures
	lastTreeMsgConstructErr string // Most recent tree message construction error
	connectedClients        int
	activeAlerts            int
	blockedBranches         int
}

// NewHealthStatus creates a validated HealthStatus with current timestamp.
// Returns error if any count fields are negative.
func NewHealthStatus(
	broadcastFailures int64,
	lastBroadcastError string,
	watcherErrors int64,
	lastWatcherError string,
	connectionCloseErrors int64,
	lastCloseError string,
	audioBroadcastFailures int64,
	lastAudioBroadcastErr string,
	treeBroadcastErrors int64,
	lastTreeBroadcastErr string,
	treeMsgConstructErrors int64,
	lastTreeMsgConstructErr string,
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
	if connectionCloseErrors < 0 {
		return HealthStatus{}, fmt.Errorf("connectionCloseErrors must be non-negative, got %d", connectionCloseErrors)
	}
	if audioBroadcastFailures < 0 {
		return HealthStatus{}, fmt.Errorf("audioBroadcastFailures must be non-negative, got %d", audioBroadcastFailures)
	}
	if treeBroadcastErrors < 0 {
		return HealthStatus{}, fmt.Errorf("treeBroadcastErrors must be non-negative, got %d", treeBroadcastErrors)
	}
	if treeMsgConstructErrors < 0 {
		return HealthStatus{}, fmt.Errorf("treeMsgConstructErrors must be non-negative, got %d", treeMsgConstructErrors)
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
		timestamp:               time.Now(),
		broadcastFailures:       broadcastFailures,
		lastBroadcastError:      strings.TrimSpace(lastBroadcastError),
		watcherErrors:           watcherErrors,
		lastWatcherError:        strings.TrimSpace(lastWatcherError),
		connectionCloseErrors:   connectionCloseErrors,
		lastCloseError:          strings.TrimSpace(lastCloseError),
		audioBroadcastFailures:  audioBroadcastFailures,
		lastAudioBroadcastErr:   strings.TrimSpace(lastAudioBroadcastErr),
		treeBroadcastErrors:     treeBroadcastErrors,
		lastTreeBroadcastErr:    strings.TrimSpace(lastTreeBroadcastErr),
		treeMsgConstructErrors:  treeMsgConstructErrors,
		lastTreeMsgConstructErr: strings.TrimSpace(lastTreeMsgConstructErr),
		connectedClients:        connectedClients,
		activeAlerts:            activeAlerts,
		blockedBranches:         blockedBranches,
	}, nil
}

// GetTimestamp returns the timestamp when the health status was captured
func (h HealthStatus) GetTimestamp() time.Time { return h.timestamp }

// GetBroadcastFailures returns the total broadcast failures since daemon startup
func (h HealthStatus) GetBroadcastFailures() int64 { return h.broadcastFailures }

// GetLastBroadcastError returns the most recent broadcast error message
func (h HealthStatus) GetLastBroadcastError() string { return h.lastBroadcastError }

// GetWatcherErrors returns the total watcher errors since daemon startup
func (h HealthStatus) GetWatcherErrors() int64 { return h.watcherErrors }

// GetLastWatcherError returns the most recent watcher error message
func (h HealthStatus) GetLastWatcherError() string { return h.lastWatcherError }

// GetConnectionCloseErrors returns the total connection close errors since daemon startup
func (h HealthStatus) GetConnectionCloseErrors() int64 { return h.connectionCloseErrors }

// GetLastCloseError returns the most recent connection close error message
func (h HealthStatus) GetLastCloseError() string { return h.lastCloseError }

// GetAudioBroadcastFailures returns the total audio broadcast failures since daemon startup
func (h HealthStatus) GetAudioBroadcastFailures() int64 { return h.audioBroadcastFailures }

// GetLastAudioBroadcastErr returns the most recent audio broadcast error message
func (h HealthStatus) GetLastAudioBroadcastErr() string { return h.lastAudioBroadcastErr }

// GetTreeBroadcastErrors returns the total tree broadcast failures
func (h HealthStatus) GetTreeBroadcastErrors() int64 { return h.treeBroadcastErrors }

// GetLastTreeBroadcastError returns the most recent tree broadcast error
func (h HealthStatus) GetLastTreeBroadcastError() string { return h.lastTreeBroadcastErr }

// GetTreeMsgConstructErrors returns the total tree message construction failures
func (h HealthStatus) GetTreeMsgConstructErrors() int64 { return h.treeMsgConstructErrors }

// GetLastTreeMsgConstructError returns the most recent tree message construction error
func (h HealthStatus) GetLastTreeMsgConstructError() string { return h.lastTreeMsgConstructErr }

// GetConnectedClients returns the current number of connected clients
func (h HealthStatus) GetConnectedClients() int { return h.connectedClients }

// GetActiveAlerts returns the current number of active alerts
func (h HealthStatus) GetActiveAlerts() int { return h.activeAlerts }

// GetBlockedBranches returns the current number of blocked branches
func (h HealthStatus) GetBlockedBranches() int { return h.blockedBranches }

// MarshalJSON implements custom JSON marshaling to maintain wire protocol compatibility
func (h HealthStatus) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Timestamp              time.Time `json:"timestamp"`
		BroadcastFailures      int64     `json:"broadcast_failures"`
		LastBroadcastError     string    `json:"last_broadcast_error"`
		WatcherErrors          int64     `json:"watcher_errors"`
		LastWatcherError       string    `json:"last_watcher_error"`
		ConnectionCloseErrors  int64     `json:"connection_close_errors"`
		LastCloseError         string    `json:"last_close_error"`
		AudioBroadcastFailures int64     `json:"audio_broadcast_failures"`
		LastAudioBroadcastErr  string    `json:"last_audio_broadcast_error"`
		ConnectedClients       int       `json:"connected_clients"`
		ActiveAlerts           int       `json:"active_alerts"`
		BlockedBranches        int       `json:"blocked_branches"`
	}{
		Timestamp:              h.timestamp,
		BroadcastFailures:      h.broadcastFailures,
		LastBroadcastError:     h.lastBroadcastError,
		WatcherErrors:          h.watcherErrors,
		LastWatcherError:       h.lastWatcherError,
		ConnectionCloseErrors:  h.connectionCloseErrors,
		LastCloseError:         h.lastCloseError,
		AudioBroadcastFailures: h.audioBroadcastFailures,
		LastAudioBroadcastErr:  h.lastAudioBroadcastErr,
		ConnectedClients:       h.connectedClients,
		ActiveAlerts:           h.activeAlerts,
		BlockedBranches:        h.blockedBranches,
	})
}

// UnmarshalJSON implements custom JSON unmarshaling with validation
func (h *HealthStatus) UnmarshalJSON(data []byte) error {
	aux := &struct {
		Timestamp              time.Time `json:"timestamp"`
		BroadcastFailures      int64     `json:"broadcast_failures"`
		LastBroadcastError     string    `json:"last_broadcast_error"`
		WatcherErrors          int64     `json:"watcher_errors"`
		LastWatcherError       string    `json:"last_watcher_error"`
		ConnectionCloseErrors  int64     `json:"connection_close_errors"`
		LastCloseError         string    `json:"last_close_error"`
		AudioBroadcastFailures int64     `json:"audio_broadcast_failures"`
		LastAudioBroadcastErr  string    `json:"last_audio_broadcast_error"`
		ConnectedClients       int       `json:"connected_clients"`
		ActiveAlerts           int       `json:"active_alerts"`
		BlockedBranches        int       `json:"blocked_branches"`
	}{}

	if err := json.Unmarshal(data, aux); err != nil {
		return err
	}

	// Validate all count fields are non-negative
	if aux.BroadcastFailures < 0 {
		return fmt.Errorf("invalid broadcast_failures: %d", aux.BroadcastFailures)
	}
	if aux.WatcherErrors < 0 {
		return fmt.Errorf("invalid watcher_errors: %d", aux.WatcherErrors)
	}
	if aux.ConnectionCloseErrors < 0 {
		return fmt.Errorf("invalid connection_close_errors: %d", aux.ConnectionCloseErrors)
	}
	if aux.AudioBroadcastFailures < 0 {
		return fmt.Errorf("invalid audio_broadcast_failures: %d", aux.AudioBroadcastFailures)
	}
	if aux.ConnectedClients < 0 {
		return fmt.Errorf("invalid connected_clients: %d", aux.ConnectedClients)
	}
	if aux.ActiveAlerts < 0 {
		return fmt.Errorf("invalid active_alerts: %d", aux.ActiveAlerts)
	}
	if aux.BlockedBranches < 0 {
		return fmt.Errorf("invalid blocked_branches: %d", aux.BlockedBranches)
	}

	h.timestamp = aux.Timestamp
	h.broadcastFailures = aux.BroadcastFailures
	h.lastBroadcastError = aux.LastBroadcastError
	h.watcherErrors = aux.WatcherErrors
	h.lastWatcherError = aux.LastWatcherError
	h.connectionCloseErrors = aux.ConnectionCloseErrors
	h.lastCloseError = aux.LastCloseError
	h.audioBroadcastFailures = aux.AudioBroadcastFailures
	h.lastAudioBroadcastErr = aux.LastAudioBroadcastErr
	h.connectedClients = aux.ConnectedClients
	h.activeAlerts = aux.ActiveAlerts
	h.blockedBranches = aux.BlockedBranches

	return nil
}

// BlockedState represents the result of checking if a branch is blocked
type BlockedState struct {
	isBlocked bool
	blockedBy string // Empty if not blocked
}

// IsBlocked returns whether the branch is blocked
func (b BlockedState) IsBlocked() bool { return b.isBlocked }

// BlockedBy returns the branch that is blocking (empty if not blocked)
func (b BlockedState) BlockedBy() string { return b.blockedBy }

// NewBlockedState creates a validated BlockedState.
// Returns error if:
//   - IsBlocked is false but BlockedBy is provided (non-empty after trimming)
//   - IsBlocked is true but BlockedBy is empty (empty after trimming whitespace)
func NewBlockedState(isBlocked bool, blockedBy string) (BlockedState, error) {
	blockedBy = strings.TrimSpace(blockedBy)

	// Validation: BlockedBy must be empty when not blocked
	if !isBlocked && blockedBy != "" {
		return BlockedState{}, fmt.Errorf("blockedBy must be empty when not blocked, got %q", blockedBy)
	}

	// Validation: BlockedBy must be specified when blocked
	if isBlocked && blockedBy == "" {
		return BlockedState{}, fmt.Errorf("blockedBy must be specified when blocked")
	}

	return BlockedState{
		isBlocked: isBlocked,
		blockedBy: blockedBy,
	}, nil
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
	case MsgTypeFullState, MsgTypePing, MsgTypePong, MsgTypeResyncRequest, MsgTypeHealthQuery, MsgTypeHealthResponse:
		// No required fields
	case MsgTypeSyncWarning, MsgTypePersistenceError, MsgTypeAudioError:
		// Error field is optional but recommended
	case MsgTypeTreeUpdate, MsgTypeTreeError:
		// Tree field is optional for tree_error (error case)
		// Tree field validated when constructing TreeUpdateMessageV2 via FromWireFormat
	default:
		// Unknown message type - not necessarily invalid (forward compatibility)
		return nil
	}

	return nil
}
