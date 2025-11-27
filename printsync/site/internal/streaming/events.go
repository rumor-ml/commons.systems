package streaming

import (
	"time"

	"github.com/commons-systems/filesync"
)

// Event type constants
const (
	EventTypeProgress  = "progress"
	EventTypeSession   = "session"
	EventTypeFile      = "file"
	EventTypeComplete  = "complete"
	EventTypeHeartbeat = "heartbeat"
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

// FileEvent represents a file status change
type FileEvent struct {
	ID        string               `json:"id"`
	SessionID string               `json:"sessionId"`
	LocalPath string               `json:"localPath"`
	Status    filesync.FileStatus  `json:"status"`
	Metadata  filesync.FileMetadata `json:"metadata,omitempty"`
	Error     string               `json:"error,omitempty"`
}

// CompleteEvent represents a terminal event
type CompleteEvent struct {
	SessionID string                 `json:"sessionId"`
	Status    filesync.SessionStatus `json:"status"`
}
