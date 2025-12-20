package daemon

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
	SeqNum          uint64            `json:"seq_num,omitempty"`          // Sequence number for ordering/gap detection
	ClientID        string            `json:"client_id,omitempty"`
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
	HealthStatus    *HealthStatus     `json:"health_status,omitempty"`    // For health_response messages
	OriginalMsgType string            `json:"original_msg_type,omitempty"` // For sync_warning messages
	Error           string            `json:"error,omitempty"`            // For error messages (persistence, audio, sync)
}

// HealthStatus contains daemon health metrics
type HealthStatus struct {
	UptimeSeconds      int64 `json:"uptime_seconds"`
	ConnectedClients   int   `json:"connected_clients"`
	ActiveAlerts       int   `json:"active_alerts"`
	BlockedBranches    int   `json:"blocked_branches"`
	BroadcastFailures  int64 `json:"broadcast_failures"`
	WatcherErrors      int64 `json:"watcher_errors"`
	PersistenceErrors  int64 `json:"persistence_errors"`
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
		UptimeSeconds:     uptimeSeconds,
		ConnectedClients:  connectedClients,
		ActiveAlerts:      activeAlerts,
		BlockedBranches:   blockedBranches,
		BroadcastFailures: broadcastFailures,
		WatcherErrors:     watcherErrors,
		PersistenceErrors: persistenceErrors,
	}, nil
}

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
