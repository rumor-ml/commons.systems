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
)

// Message represents a message exchanged between daemon and clients
type Message struct {
	Type      string            `json:"type"`
	ClientID  string            `json:"client_id,omitempty"`
	Alerts    map[string]string `json:"alerts,omitempty"`     // Full alert state (for full_state messages)
	PaneID    string            `json:"pane_id,omitempty"`    // For alert_change messages
	EventType string            `json:"event_type,omitempty"` // For alert_change messages
	Created   bool              `json:"created,omitempty"`    // For alert_change messages
}
