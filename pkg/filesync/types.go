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
	GCSPath       string
	Directory     string
	Filename      string
	Deduplication bool
}

// UploadResult represents the result of a file upload operation
type UploadResult struct {
	Success       bool
	GCSPath       string
	BytesUploaded int64
	Deduplicated  bool
	Error         error
}

// PipelineSessionStatus represents the state of a sync session (pipeline view)
type PipelineSessionStatus string

const (
	PipelineSessionStatusPending     PipelineSessionStatus = "pending"
	PipelineSessionStatusDiscovering PipelineSessionStatus = "discovering"
	PipelineSessionStatusProcessing  PipelineSessionStatus = "processing"
	PipelineSessionStatusCompleted   PipelineSessionStatus = "completed"
	PipelineSessionStatusFailed      PipelineSessionStatus = "failed"
	PipelineSessionStatusCancelled   PipelineSessionStatus = "cancelled"
)

// PipelineSession represents a complete sync operation (pipeline view)
type PipelineSession struct {
	ID             string
	RootDir        string
	StartedAt      time.Time
	Status         PipelineSessionStatus
	TotalFiles     int64
	ProcessedFiles int64
	TotalBytes     int64
	ProcessedBytes int64
}

// FileProcessingStatus represents the state of a file being processed
type FileProcessingStatus string

const (
	FileProcessingStatusPending     FileProcessingStatus = "pending"
	FileProcessingStatusExtracting  FileProcessingStatus = "extracting"
	FileProcessingStatusNormalizing FileProcessingStatus = "normalizing"
	FileProcessingStatusUploading   FileProcessingStatus = "uploading"
	FileProcessingStatusCompleted   FileProcessingStatus = "completed"
	FileProcessingStatusSkipped     FileProcessingStatus = "skipped"
	FileProcessingStatusFailed      FileProcessingStatus = "failed"
)

// FileProcessingState represents the status of a file in the sync session (pipeline view)
type FileProcessingState struct {
	File         FileInfo
	Status       FileProcessingStatus
	Error        error
	UploadResult *UploadResult
}

// ProgressType represents the type of progress update
type ProgressType string

const (
	// ProgressTypeOperation represents normal progress for file operations
	ProgressTypeOperation ProgressType = "operation"
	// ProgressTypeStatus represents status messages (e.g., stats flush notifications)
	ProgressTypeStatus ProgressType = "status"
	// ProgressTypeError represents error notifications
	ProgressTypeError ProgressType = "error"
)

// Progress represents progress information for a file operation
type Progress struct {
	Type           ProgressType // Explicit type (operation, status, or error)
	Operation      string
	File           string
	BytesProcessed int64
	TotalBytes     int64
	Percentage     float64 // Always 0-100, no magic -1 values
	Message        string
}
