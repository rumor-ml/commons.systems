package streaming

import (
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

// SSEEvent represents a server-sent event
type SSEEvent struct {
	Type      string      `json:"-"`
	Timestamp time.Time   `json:"timestamp"`
	Data      interface{} `json:"data"`
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
	return SSEEvent{
		Type:      EventTypeProgress,
		Timestamp: time.Now(),
		Data: ProgressEvent{
			Operation:  operation,
			File:       file,
			Percentage: percentage,
		},
	}
}

// NewSessionEvent creates a session stats event
func NewSessionEvent(session *filesync.SyncSession) SSEEvent {
	return SSEEvent{
		Type:      EventTypeSession,
		Timestamp: time.Now(),
		Data: SessionEvent{
			ID:          session.ID,
			Status:      session.Status,
			Stats:       session.Stats,
			CompletedAt: session.CompletedAt,
		},
	}
}

// NewActionsEvent creates an actions event
func NewActionsEvent(sessionID string, stats filesync.SessionStats) SSEEvent {
	return SSEEvent{
		Type:      EventTypeActions,
		Timestamp: time.Now(),
		Data: ActionsEvent{
			SessionID: sessionID,
			Stats:     stats,
		},
	}
}

// NewFileEvent creates a file update event
func NewFileEvent(file *filesync.SyncFile, isUpdate bool) SSEEvent {
	return SSEEvent{
		Type:      EventTypeFile,
		Timestamp: time.Now(),
		Data: FileEvent{
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
	return SSEEvent{
		Type:      EventTypeComplete,
		Timestamp: time.Now(),
		Data: CompleteEvent{
			SessionID: sessionID,
			Status:    status,
		},
	}
}

// NewErrorEvent creates an error event
func NewErrorEvent(message, severity string) SSEEvent {
	return SSEEvent{
		Type:      EventTypeError,
		Timestamp: time.Now(),
		Data: ErrorEvent{
			Message:  message,
			Severity: severity,
		},
	}
}

// NewHeartbeatEvent creates a heartbeat event
func NewHeartbeatEvent() SSEEvent {
	return SSEEvent{
		Type:      EventTypeHeartbeat,
		Timestamp: time.Now(),
		Data:      nil,
	}
}
