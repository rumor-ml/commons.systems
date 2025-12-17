package filesync

import (
	"fmt"
	"time"
)

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

// NewProgress creates a validated Progress instance
func NewProgress(typ ProgressType, operation, file string, bytesProcessed, totalBytes int64, message string) (Progress, error) {
	var percentage float64
	if totalBytes > 0 {
		percentage = float64(bytesProcessed) / float64(totalBytes) * 100
	}

	p := Progress{
		Type:           typ,
		Operation:      operation,
		File:           file,
		BytesProcessed: bytesProcessed,
		TotalBytes:     totalBytes,
		Percentage:     percentage,
		Message:        message,
	}

	if err := p.Validate(); err != nil {
		return Progress{}, fmt.Errorf("invalid progress: %w", err)
	}

	return p, nil
}

// Validate checks if the Progress struct contains valid data.
// Returns an error if any of the following conditions are violated:
//   - Percentage must be between 0 and 100
//   - BytesProcessed and TotalBytes must not be negative
//   - BytesProcessed must not exceed TotalBytes (when TotalBytes > 0)
//   - Type must be one of the valid ProgressType constants
func (p Progress) Validate() error {
	// Validate percentage range
	if p.Percentage < 0 || p.Percentage > 100 {
		return fmt.Errorf("percentage must be 0-100, got %.2f", p.Percentage)
	}

	// Validate bytes are not negative
	if p.BytesProcessed < 0 {
		return fmt.Errorf("bytesProcessed cannot be negative, got %d", p.BytesProcessed)
	}
	if p.TotalBytes < 0 {
		return fmt.Errorf("totalBytes cannot be negative, got %d", p.TotalBytes)
	}

	// Validate bytesProcessed doesn't exceed totalBytes (when totalBytes > 0)
	if p.TotalBytes > 0 && p.BytesProcessed > p.TotalBytes {
		return fmt.Errorf("bytesProcessed (%d) cannot exceed totalBytes (%d)", p.BytesProcessed, p.TotalBytes)
	}

	// Validate progress type
	switch p.Type {
	case ProgressTypeOperation, ProgressTypeStatus, ProgressTypeError:
		// Valid
	default:
		return fmt.Errorf("invalid progress type: %q", p.Type)
	}

	return nil
}
