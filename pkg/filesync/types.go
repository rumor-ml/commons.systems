package filesync

import "time"

// FileInfo represents basic information about a file to be synced
type FileInfo struct {
	Path         string
	RelativePath string
	Size         int64
	ModTime      time.Time
	Hash         string
	MimeType     string
}

// ExtractedMetadata represents metadata extracted from a file
type ExtractedMetadata struct {
	CreatedAt     *time.Time
	CaptureDevice string
	Location      *GeoLocation
	Title         string
	Description   string
	Tags          []string
	Raw           map[string]interface{}
}

// GeoLocation represents geographic coordinates
type GeoLocation struct {
	Latitude  float64
	Longitude float64
	Altitude  *float64
}

// NormalizedPath represents the normalized GCS path structure
type NormalizedPath struct {
	GCSPath        string
	Directory      string
	Filename       string
	Deduplication  bool
}

// UploadResult represents the result of a file upload operation
type UploadResult struct {
	Success       bool
	GCSPath       string
	BytesUploaded int64
	Deduplicated  bool
	Error         error
}

// SessionStatus represents the state of a sync session
type SessionStatus string

const (
	SessionStatusPending     SessionStatus = "pending"
	SessionStatusDiscovering SessionStatus = "discovering"
	SessionStatusProcessing  SessionStatus = "processing"
	SessionStatusCompleted   SessionStatus = "completed"
	SessionStatusFailed      SessionStatus = "failed"
	SessionStatusCancelled   SessionStatus = "cancelled"
)

// SyncSession represents a complete sync operation
type SyncSession struct {
	ID             string
	RootDir        string
	StartedAt      time.Time
	Status         SessionStatus
	TotalFiles     int64
	ProcessedFiles int64
	TotalBytes     int64
	ProcessedBytes int64
}

// FileProcessingStatus represents the state of a file being processed
type FileProcessingStatus string

const (
	FileProcessingStatusPending    FileProcessingStatus = "pending"
	FileProcessingStatusExtracting FileProcessingStatus = "extracting"
	FileProcessingStatusNormalizing FileProcessingStatus = "normalizing"
	FileProcessingStatusUploading  FileProcessingStatus = "uploading"
	FileProcessingStatusCompleted  FileProcessingStatus = "completed"
	FileProcessingStatusSkipped    FileProcessingStatus = "skipped"
	FileProcessingStatusFailed     FileProcessingStatus = "failed"
)

// FileStatus represents the status of a file in the sync session
type FileStatus struct {
	File         FileInfo
	Status       FileProcessingStatus
	Error        error
	UploadResult *UploadResult
}

// Progress represents progress information for a file operation
type Progress struct {
	Operation      string
	File           string
	BytesProcessed int64
	TotalBytes     int64
	Percentage     float64
	Message        string
}
