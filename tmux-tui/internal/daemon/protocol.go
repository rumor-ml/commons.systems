package daemon

// Message types for client-daemon communication
const (
	// MsgTypeHello is sent by client when connecting
	MsgTypeHello = "hello"
	// MsgTypeFullState is sent by daemon after client connects with complete alert state
	MsgTypeFullState = "full_state"
	// MsgTypeAlertChange is sent by daemon when an alert changes
	MsgTypeAlertChange = "alert_change"
	// MsgTypePing is sent by client to check daemon health
	MsgTypePing = "ping"
	// MsgTypePong is sent by daemon in response to ping
	MsgTypePong = "pong"
	// MsgTypeShowBlockPicker is sent to request TUI show branch picker for a pane
	MsgTypeShowBlockPicker = "show_block_picker"
	// MsgTypeBlockPane is sent by client to block a pane on a specific branch
	MsgTypeBlockPane = "block_pane"
	// MsgTypeUnblockPane is sent by client to unblock a pane
	MsgTypeUnblockPane = "unblock_pane"
	// MsgTypeBlockedState is sent by daemon with full blocked state
	MsgTypeBlockedState = "blocked_state"
	// MsgTypeBlockChange is sent by daemon when a block state changes
	MsgTypeBlockChange = "block_change"
)

// Message represents a message exchanged between daemon and clients
type Message struct {
	Type          string            `json:"type"`
	ClientID      string            `json:"client_id,omitempty"`
	Alerts        map[string]string `json:"alerts,omitempty"`         // Full alert state (for full_state messages)
	PaneID        string            `json:"pane_id,omitempty"`        // For alert_change and block messages
	EventType     string            `json:"event_type,omitempty"`     // For alert_change messages
	Created       bool              `json:"created,omitempty"`        // For alert_change messages
	BlockedPanes  map[string]string `json:"blocked_panes,omitempty"`  // Full blocked state: paneID -> blockedOnBranch
	BlockedBranch string            `json:"blocked_branch,omitempty"` // For block_pane messages
	Blocked       bool              `json:"blocked,omitempty"`        // For block_change messages (true = blocked, false = unblocked)
}
