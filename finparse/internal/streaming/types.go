package streaming

import (
	"encoding/json"
	"time"
)

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

// SSEEvent represents a Server-Sent Event with type-safe data
type SSEEvent struct {
	Type      EventType   `json:"type"`
	Timestamp time.Time   `json:"timestamp"`
	data      interface{} // private, accessed via typed methods
}

// Data returns the underlying data for JSON marshaling
func (e SSEEvent) Data() interface{} {
	return e.data
}

// MarshalJSON implements custom JSON marshaling to expose data field
func (e SSEEvent) MarshalJSON() ([]byte, error) {
	type Alias struct {
		Type      EventType   `json:"type"`
		Timestamp time.Time   `json:"timestamp"`
		Data      interface{} `json:"data"`
	}
	return json.Marshal(Alias{
		Type:      e.Type,
		Timestamp: e.Timestamp,
		Data:      e.data,
	})
}

// Constructors for each event type ensure type safety

// NewSessionEvent creates a new SSE event with SessionEvent data
func NewSessionEvent(data SessionEvent) SSEEvent {
	return SSEEvent{
		Type:      EventTypeSession,
		Timestamp: time.Now(),
		data:      data,
	}
}

// NewProgressEvent creates a new SSE event with ProgressEvent data
func NewProgressEvent(data ProgressEvent) SSEEvent {
	return SSEEvent{
		Type:      EventTypeProgress,
		Timestamp: time.Now(),
		data:      data,
	}
}

// NewFileEvent creates a new SSE event with FileEvent data
func NewFileEvent(data FileEvent) SSEEvent {
	return SSEEvent{
		Type:      EventTypeFile,
		Timestamp: time.Now(),
		data:      data,
	}
}

// NewTransactionEvent creates a new SSE event with TransactionEvent data
func NewTransactionEvent(data TransactionEvent) SSEEvent {
	return SSEEvent{
		Type:      EventTypeTransaction,
		Timestamp: time.Now(),
		data:      data,
	}
}

// NewErrorEvent creates a new SSE event with ErrorEvent data
func NewErrorEvent(data ErrorEvent) SSEEvent {
	return SSEEvent{
		Type:      EventTypeError,
		Timestamp: time.Now(),
		data:      data,
	}
}

// NewCompleteEvent creates a new SSE event with completion data
func NewCompleteEvent(data map[string]string) SSEEvent {
	return SSEEvent{
		Type:      EventTypeComplete,
		Timestamp: time.Now(),
		data:      data,
	}
}

// NewHeartbeatEvent creates a new SSE event for heartbeat
func NewHeartbeatEvent() SSEEvent {
	return SSEEvent{
		Type:      EventTypeHeartbeat,
		Timestamp: time.Now(),
		data:      nil,
	}
}

// Type-safe accessors

// SessionData returns the SessionEvent data if the event type matches
func (e SSEEvent) SessionData() (SessionEvent, bool) {
	if e.Type != EventTypeSession {
		return SessionEvent{}, false
	}
	data, ok := e.data.(SessionEvent)
	return data, ok
}

// ProgressData returns the ProgressEvent data if the event type matches
func (e SSEEvent) ProgressData() (ProgressEvent, bool) {
	if e.Type != EventTypeProgress {
		return ProgressEvent{}, false
	}
	data, ok := e.data.(ProgressEvent)
	return data, ok
}

// FileData returns the FileEvent data if the event type matches
func (e SSEEvent) FileData() (FileEvent, bool) {
	if e.Type != EventTypeFile {
		return FileEvent{}, false
	}
	data, ok := e.data.(FileEvent)
	return data, ok
}

// TransactionData returns the TransactionEvent data if the event type matches
func (e SSEEvent) TransactionData() (TransactionEvent, bool) {
	if e.Type != EventTypeTransaction {
		return TransactionEvent{}, false
	}
	data, ok := e.data.(TransactionEvent)
	return data, ok
}

// ErrorData returns the ErrorEvent data if the event type matches
func (e SSEEvent) ErrorData() (ErrorEvent, bool) {
	if e.Type != EventTypeError {
		return ErrorEvent{}, false
	}
	data, ok := e.data.(ErrorEvent)
	return data, ok
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
