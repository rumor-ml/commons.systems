package streaming

import (
	"encoding/json"
	"time"

	"github.com/commons-systems/filesync"
)

// Event type constants
const (
	EventTypeProgress  = "progress"
	EventTypeSession   = "session"
	EventTypeActions   = "actions"
	EventTypeFile      = "file"
	EventTypeComplete  = "complete"
	EventTypeHeartbeat = "heartbeat"
	EventTypeError     = "error"
)

// TimeSource is a function that returns the current time
// Default implementation uses time.Now, but can be overridden for testing
type TimeSource func() time.Time

var defaultTimeSource TimeSource = time.Now

// SSEEvent represents a server-sent event
// Fields are unexported to enforce immutability - use getters to access
type SSEEvent struct {
	eventType string      `json:"-"`
	timestamp time.Time   `json:"timestamp"`
	data      interface{} `json:"data"`
}

// EventType returns the event type
func (e SSEEvent) EventType() string {
	return e.eventType
}

// Timestamp returns the event timestamp
func (e SSEEvent) Timestamp() time.Time {
	return e.timestamp
}

// Data returns the event data
func (e SSEEvent) Data() interface{} {
	return e.data
}

// MarshalJSON implements custom JSON marshaling for SSEEvent
// This ensures the unexported fields are properly serialized
func (e SSEEvent) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Timestamp time.Time   `json:"timestamp"`
		Data      interface{} `json:"data"`
	}{
		Timestamp: e.timestamp,
		Data:      e.data,
	})
}

// ProgressEvent represents a pipeline progress update
type ProgressEvent struct {
	Operation  string  `json:"operation"`
	File       string  `json:"file,omitempty"`
	Percentage float64 `json:"percentage,omitempty"`
}

// SessionEvent represents a session state/stats change
type SessionEvent struct {
	ID          string                 `json:"id"`
	Status      filesync.SessionStatus `json:"status"`
	Stats       filesync.SessionStats  `json:"stats"`
	CompletedAt *time.Time             `json:"completedAt,omitempty"`
}

// ActionsEvent represents action buttons state update
type ActionsEvent struct {
	SessionID string                `json:"sessionId"`
	Stats     filesync.SessionStats `json:"stats"`
}

// FileEvent represents a file status change
type FileEvent struct {
	ID        string                `json:"id"`
	SessionID string                `json:"sessionId"`
	LocalPath string                `json:"localPath"`
	Status    filesync.FileStatus   `json:"status"`
	Metadata  filesync.FileMetadata `json:"metadata,omitempty"`
	Error     string                `json:"error,omitempty"`
	IsUpdate  bool                  `json:"isUpdate"`
}

// CompleteEvent represents a terminal event
type CompleteEvent struct {
	SessionID string                 `json:"sessionId"`
	Status    filesync.SessionStatus `json:"status"`
}

// ErrorEvent represents an error notification
type ErrorEvent struct {
	Message  string `json:"message"`
	Severity string `json:"severity"` // "error", "warning", "info"
}

// Constructor functions for type-safe event creation

// NewProgressEvent creates a progress event with type safety
func NewProgressEvent(operation, file string, percentage float64) SSEEvent {
	return newProgressEventWithTime(operation, file, percentage, defaultTimeSource)
}

// newProgressEventWithTime creates a progress event with injectable time source (for testing)
func newProgressEventWithTime(operation, file string, percentage float64, timeSource TimeSource) SSEEvent {
	return SSEEvent{
		eventType: EventTypeProgress,
		timestamp: timeSource(),
		data: ProgressEvent{
			Operation:  operation,
			File:       file,
			Percentage: percentage,
		},
	}
}

// NewSessionEvent creates a session stats event
func NewSessionEvent(session *filesync.SyncSession) SSEEvent {
	return newSessionEventWithTime(session, defaultTimeSource)
}

// newSessionEventWithTime creates a session event with injectable time source (for testing)
func newSessionEventWithTime(session *filesync.SyncSession, timeSource TimeSource) SSEEvent {
	return SSEEvent{
		eventType: EventTypeSession,
		timestamp: timeSource(),
		data: SessionEvent{
			ID:          session.ID,
			Status:      session.Status,
			Stats:       session.Stats,
			CompletedAt: session.CompletedAt,
		},
	}
}

// NewActionsEvent creates an actions event
func NewActionsEvent(sessionID string, stats filesync.SessionStats) SSEEvent {
	return newActionsEventWithTime(sessionID, stats, defaultTimeSource)
}

// newActionsEventWithTime creates an actions event with injectable time source (for testing)
func newActionsEventWithTime(sessionID string, stats filesync.SessionStats, timeSource TimeSource) SSEEvent {
	return SSEEvent{
		eventType: EventTypeActions,
		timestamp: timeSource(),
		data: ActionsEvent{
			SessionID: sessionID,
			Stats:     stats,
		},
	}
}

// NewFileEvent creates a file update event
func NewFileEvent(file *filesync.SyncFile, isUpdate bool) SSEEvent {
	return newFileEventWithTime(file, isUpdate, defaultTimeSource)
}

// newFileEventWithTime creates a file event with injectable time source (for testing)
func newFileEventWithTime(file *filesync.SyncFile, isUpdate bool, timeSource TimeSource) SSEEvent {
	return SSEEvent{
		eventType: EventTypeFile,
		timestamp: timeSource(),
		data: FileEvent{
			ID:        file.ID,
			SessionID: file.SessionID,
			LocalPath: file.LocalPath,
			Status:    file.Status,
			Metadata:  file.Metadata,
			Error:     file.Error,
			IsUpdate:  isUpdate,
		},
	}
}

// NewCompleteEvent creates a session completion event
func NewCompleteEvent(sessionID string, status filesync.SessionStatus) SSEEvent {
	return newCompleteEventWithTime(sessionID, status, defaultTimeSource)
}

// newCompleteEventWithTime creates a complete event with injectable time source (for testing)
func newCompleteEventWithTime(sessionID string, status filesync.SessionStatus, timeSource TimeSource) SSEEvent {
	return SSEEvent{
		eventType: EventTypeComplete,
		timestamp: timeSource(),
		data: CompleteEvent{
			SessionID: sessionID,
			Status:    status,
		},
	}
}

// NewErrorEvent creates an error event
func NewErrorEvent(message, severity string) SSEEvent {
	return newErrorEventWithTime(message, severity, defaultTimeSource)
}

// newErrorEventWithTime creates an error event with injectable time source (for testing)
func newErrorEventWithTime(message, severity string, timeSource TimeSource) SSEEvent {
	return SSEEvent{
		eventType: EventTypeError,
		timestamp: timeSource(),
		data: ErrorEvent{
			Message:  message,
			Severity: severity,
		},
	}
}

// NewHeartbeatEvent creates a heartbeat event
func NewHeartbeatEvent() SSEEvent {
	return newHeartbeatEventWithTime(defaultTimeSource)
}

// newHeartbeatEventWithTime creates a heartbeat event with injectable time source (for testing)
func newHeartbeatEventWithTime(timeSource TimeSource) SSEEvent {
	return SSEEvent{
		eventType: EventTypeHeartbeat,
		timestamp: timeSource(),
		data:      nil,
	}
}
