package gcsupload

import (
	"context"
	"time"
)

// FileStatus represents the current status of a file in the upload process
type FileStatus string

const (
	FileStatusDiscovered FileStatus = "discovered"
	FileStatusProcessing FileStatus = "processing"
	FileStatusUploading  FileStatus = "uploading"
	FileStatusCompleted  FileStatus = "completed"
	FileStatusSkipped    FileStatus = "skipped"
	FileStatusFailed     FileStatus = "failed"
)

// FileInfo represents a discovered file with its metadata
type FileInfo struct {
	ID           string                 `json:"id" firestore:"id"`
	LocalPath    string                 `json:"localPath" firestore:"localPath"`
	FileName     string                 `json:"fileName" firestore:"fileName"`
	FileSize     int64                  `json:"fileSize" firestore:"fileSize"`
	Metadata     map[string]interface{} `json:"metadata" firestore:"metadata"`
	GCSPath      string                 `json:"gcsPath,omitempty" firestore:"gcsPath,omitempty"`
	Status       FileStatus             `json:"status" firestore:"status"`
	Error        string                 `json:"error,omitempty" firestore:"error,omitempty"`
	Logs         []string               `json:"logs" firestore:"logs"`
	Progress     float64                `json:"progress" firestore:"progress"` // 0-100
	DiscoveredAt time.Time              `json:"discoveredAt" firestore:"discoveredAt"`
	UpdatedAt    time.Time              `json:"updatedAt" firestore:"updatedAt"`
	CompletedAt  *time.Time             `json:"completedAt,omitempty" firestore:"completedAt,omitempty"`
}

// UploadJobStatus represents the current status of an upload job
type UploadJobStatus string

const (
	JobStatusPending   UploadJobStatus = "pending"
	JobStatusRunning   UploadJobStatus = "running"
	JobStatusCompleted UploadJobStatus = "completed"
	JobStatusCancelled UploadJobStatus = "cancelled"
	JobStatusFailed    UploadJobStatus = "failed"
)

// UploadJob represents an upload job
type UploadJob struct {
	ID            string          `json:"id" firestore:"id"`
	Name          string          `json:"name" firestore:"name"`
	BasePath      string          `json:"basePath" firestore:"basePath"`
	GCSBucket     string          `json:"gcsBucket" firestore:"gcsBucket"`
	GCSBasePath   string          `json:"gcsBasePath" firestore:"gcsBasePath"`
	Status        UploadJobStatus `json:"status" firestore:"status"`
	TotalFiles    int             `json:"totalFiles" firestore:"totalFiles"`
	ProcessedFiles int            `json:"processedFiles" firestore:"processedFiles"`
	UploadedFiles int             `json:"uploadedFiles" firestore:"uploadedFiles"`
	SkippedFiles  int             `json:"skippedFiles" firestore:"skippedFiles"`
	FailedFiles   int             `json:"failedFiles" firestore:"failedFiles"`
	CreatedAt     time.Time       `json:"createdAt" firestore:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt" firestore:"updatedAt"`
	CompletedAt   *time.Time      `json:"completedAt,omitempty" firestore:"completedAt,omitempty"`
}

// FileDiscoverer discovers files at a given path
type FileDiscoverer interface {
	// Discover finds all files at the given path
	Discover(ctx context.Context, basePath string) ([]string, error)
}

// MetadataExtractor extracts metadata from a file
type MetadataExtractor interface {
	// Extract extracts metadata from the file at the given path
	// Returns metadata map and any logs generated during extraction
	Extract(ctx context.Context, filePath string) (metadata map[string]interface{}, logs []string, err error)
}

// PathNormalizer generates a normalized GCS path from file metadata
type PathNormalizer interface {
	// Normalize generates a normalized path from the file metadata
	Normalize(metadata map[string]interface{}, fileName string) (string, error)
}

// DuplicateDetector checks if a file already exists in GCS/Firestore
type DuplicateDetector interface {
	// IsDuplicate checks if a file with the same metadata already exists
	IsDuplicate(ctx context.Context, metadata map[string]interface{}) (bool, error)
}

// UploadConfig contains configuration for an upload job
type UploadConfig struct {
	JobName           string
	BasePath          string
	GCSBucket         string
	GCSBasePath       string
	FileDiscoverer    FileDiscoverer
	MetadataExtractor MetadataExtractor
	PathNormalizer    PathNormalizer
	DuplicateDetector DuplicateDetector
}
