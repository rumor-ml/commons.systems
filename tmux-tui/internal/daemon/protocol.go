package daemon

import "errors"

// Query response channel error types
var (
	ErrQueryChannelFull   = errors.New("query response channel full")
	ErrQueryChannelClosed = errors.New("query response channel closed")
	ErrQueryTimeout       = errors.New("timeout waiting for blocked state response")
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
	// MsgTypeBlockPane is sent by client to block a pane on a specific branch (deprecated - use BlockBranch)
	MsgTypeBlockPane = "block_pane"
	// MsgTypeUnblockPane is sent by client to unblock a pane (deprecated - use UnblockBranch)
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
	// MsgTypePersistenceError is sent by daemon when blocked state can't be saved
	MsgTypePersistenceError = "persistence_error"
	// MsgTypeSyncWarning is sent by daemon when some clients missed an update (broadcast partial failure)
	// This is informational only - clients should log it but not treat it as an error
	MsgTypeSyncWarning = "sync_warning"
	// MsgTypeResyncRequest is sent by client when it detects a gap in sequence numbers
	MsgTypeResyncRequest = "resync_request"
)

// Message represents a message exchanged between daemon and clients
type Message struct {
	Type            string            `json:"type"`
	ClientID        string            `json:"client_id,omitempty"`
	SeqNum          uint64            `json:"seq_num,omitempty"`          // Sequence number for ordering/gap detection
	Alerts          map[string]string `json:"alerts,omitempty"`           // Full alert state (for full_state messages)
	PaneID          string            `json:"pane_id,omitempty"`          // For alert_change and block messages
	EventType       string            `json:"event_type,omitempty"`       // For alert_change messages
	Created         bool              `json:"created,omitempty"`          // For alert_change messages
	ActivePaneID    string            `json:"active_pane_id,omitempty"`   // For pane_focus messages
	BlockedPanes    map[string]string `json:"blocked_panes,omitempty"`    // Deprecated: paneID -> blockedOnBranch
	BlockedBranches map[string]string `json:"blocked_branches,omitempty"` // Full blocked state: branch -> blockedByBranch
	Branch          string            `json:"branch,omitempty"`           // For block_branch messages
	BlockedBranch   string            `json:"blocked_branch,omitempty"`   // For block_branch messages
	Blocked         bool              `json:"blocked,omitempty"`          // For block_change messages (true = blocked, false = unblocked)
	IsBlocked       bool              `json:"is_blocked,omitempty"`       // For blocked_state_response messages
	Error           string            `json:"error,omitempty"`            // For persistence_error and sync_warning messages
}

// HealthStatus represents daemon health metrics for monitoring
type HealthStatus struct {
	BroadcastFailures  int64  `json:"broadcast_failures"`
	LastBroadcastError string `json:"last_broadcast_error,omitempty"`
	WatcherErrors      int64  `json:"watcher_errors"`
	LastWatcherError   string `json:"last_watcher_error,omitempty"`
	ConnectedClients   int    `json:"connected_clients"`
	ActiveAlerts       int    `json:"active_alerts"`
	BlockedBranches    int    `json:"blocked_branches"`
}
