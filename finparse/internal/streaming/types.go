package streaming

import "time"

// EventType represents the type of SSE event
type EventType string

const (
	EventTypeSession     EventType = "session"
	EventTypeProgress    EventType = "progress"
	EventTypeFile        EventType = "file"
	EventTypeTransaction EventType = "transaction"
	EventTypeComplete    EventType = "complete"
	EventTypeError       EventType = "error"
	EventTypeHeartbeat   EventType = "heartbeat"
)

// SSEEvent represents a Server-Sent Event
type SSEEvent struct {
	Type      EventType   `json:"type"`
	Timestamp time.Time   `json:"timestamp"`
	Data      interface{} `json:"data"`
}

// SessionEvent represents a parse session state event
type SessionEvent struct {
	ID          string                 `json:"id"`
	Status      string                 `json:"status"`
	Stats       map[string]interface{} `json:"stats"`
	CompletedAt *time.Time             `json:"completedAt,omitempty"`
	Error       string                 `json:"error,omitempty"`
}

// ProgressEvent represents parsing progress
type ProgressEvent struct {
	FileID     string  `json:"fileId"`
	FileName   string  `json:"fileName"`
	Processed  int     `json:"processed"`
	Total      int     `json:"total"`
	Percentage float64 `json:"percentage"`
	Status     string  `json:"status"`
}

// FileEvent represents a file being parsed
type FileEvent struct {
	ID        string                 `json:"id"`
	SessionID string                 `json:"sessionId"`
	FileName  string                 `json:"fileName"`
	Status    string                 `json:"status"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
	Error     string                 `json:"error,omitempty"`
}

// TransactionEvent represents a parsed transaction
type TransactionEvent struct {
	ID          string  `json:"id"`
	Date        string  `json:"date"`
	Description string  `json:"description"`
	Amount      float64 `json:"amount"`
	Category    string  `json:"category,omitempty"`
}

// ErrorEvent represents an error during parsing
type ErrorEvent struct {
	Message string `json:"message"`
	FileID  string `json:"fileId,omitempty"`
}
