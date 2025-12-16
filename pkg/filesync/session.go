package filesync

import (
	"context"
	"time"
)

// SessionStatus represents the current state of a sync session
type SessionStatus string

const (
	SessionStatusRunning   SessionStatus = "running"
	SessionStatusCompleted SessionStatus = "completed"
	SessionStatusFailed    SessionStatus = "failed"
)

// FileStatus represents the current state of a file in the sync process
type FileStatus string

const (
	FileStatusPending    FileStatus = "pending"
	FileStatusExtracting FileStatus = "extracting"
	FileStatusExtracted  FileStatus = "extracted" // Awaiting approval
	FileStatusRejected   FileStatus = "rejected"  // User rejected
	FileStatusTrashed    FileStatus = "trashed"   // User trashed (soft delete)
	FileStatusUploading  FileStatus = "uploading"
	FileStatusUploaded   FileStatus = "uploaded"
	FileStatusSkipped    FileStatus = "skipped"
	FileStatusError      FileStatus = "error"
)

// SessionStats tracks the counts of files in various states
type SessionStats struct {
	Discovered int `firestore:"discovered"`
	Extracted  int `firestore:"extracted"`
	Approved   int `firestore:"approved"`
	Rejected   int `firestore:"rejected"`
	Uploaded   int `firestore:"uploaded"`
	Skipped    int `firestore:"skipped"`
	Errors     int `firestore:"errors"`
}

// SyncSession represents a file synchronization session
type SyncSession struct {
	ID          string        `firestore:"-"`
	UserID      string        `firestore:"userId"`
	Status      SessionStatus `firestore:"status"`
	StartedAt   time.Time     `firestore:"startedAt"`
	CompletedAt *time.Time    `firestore:"completedAt"`
	RootDir     string        `firestore:"rootDir"`
	Stats       SessionStats  `firestore:"stats"`
}

// FileMetadata contains extracted metadata about a file
type FileMetadata struct {
	Title       string            `firestore:"title"`
	Author      string            `firestore:"author"`
	ISBN        string            `firestore:"isbn"`
	Publisher   string            `firestore:"publisher"`
	PublishDate string            `firestore:"publishDate"`
	Extra       map[string]string `firestore:"extra"`
}

// SyncFile represents a file being synchronized
type SyncFile struct {
	ID        string       `firestore:"-"`
	UserID    string       `firestore:"userId"`
	SessionID string       `firestore:"sessionId"`
	LocalPath string       `firestore:"localPath"`
	GCSPath   string       `firestore:"gcsPath"`
	Hash      string       `firestore:"hash"`
	Status    FileStatus   `firestore:"status"`
	Metadata  FileMetadata `firestore:"metadata"`
	Error     string       `firestore:"error"`
	UpdatedAt time.Time    `firestore:"updatedAt"`
}

// SessionStore defines operations for managing sync sessions
type SessionStore interface {
	Create(ctx context.Context, session *SyncSession) error
	Update(ctx context.Context, session *SyncSession) error
	Get(ctx context.Context, sessionID string) (*SyncSession, error)
	List(ctx context.Context, userID string) ([]*SyncSession, error)
	Subscribe(ctx context.Context, sessionID string, callback func(*SyncSession), errCallback func(error)) error
	Delete(ctx context.Context, sessionID string) error
}

// FileStore defines operations for managing sync files
type FileStore interface {
	Create(ctx context.Context, file *SyncFile) error
	Update(ctx context.Context, file *SyncFile) error
	Get(ctx context.Context, fileID string) (*SyncFile, error)
	ListBySession(ctx context.Context, sessionID string) ([]*SyncFile, error)
	SubscribeBySession(ctx context.Context, sessionID string, callback func(*SyncFile), errCallback func(error)) error
	Delete(ctx context.Context, fileID string) error
}
