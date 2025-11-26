package filesync

import (
	"errors"
	"fmt"
)

// Sentinel errors
var (
	// ErrNotFound is returned when a file or resource is not found
	ErrNotFound = errors.New("not found")

	// ErrPermissionDenied is returned when access to a file or resource is denied
	ErrPermissionDenied = errors.New("permission denied")

	// ErrHashMismatch is returned when a file's hash doesn't match the expected value
	ErrHashMismatch = errors.New("hash mismatch")

	// ErrUnsupportedType is returned when a file type is not supported
	ErrUnsupportedType = errors.New("unsupported file type")

	// ErrCancelled is returned when an operation is cancelled
	ErrCancelled = errors.New("operation cancelled")

	// ErrConflict is returned when a path conflict occurs (different hash at target path)
	ErrConflict = errors.New("path conflict: different hash at target path")
)

// DiscoveryError represents an error during file discovery
type DiscoveryError struct {
	Path string
	Err  error
}

func (e *DiscoveryError) Error() string {
	return fmt.Sprintf("discovery error at %s: %v", e.Path, e.Err)
}

func (e *DiscoveryError) Unwrap() error {
	return e.Err
}

// ExtractionError represents an error during metadata extraction
type ExtractionError struct {
	File FileInfo
	Err  error
}

func (e *ExtractionError) Error() string {
	return fmt.Sprintf("extraction error for %s: %v", e.File.Path, e.Err)
}

func (e *ExtractionError) Unwrap() error {
	return e.Err
}

// NormalizationError represents an error during path normalization
type NormalizationError struct {
	File FileInfo
	Err  error
}

func (e *NormalizationError) Error() string {
	return fmt.Sprintf("normalization error for %s: %v", e.File.Path, e.Err)
}

func (e *NormalizationError) Unwrap() error {
	return e.Err
}

// UploadError represents an error during file upload
type UploadError struct {
	File    FileInfo
	GCSPath string
	Err     error
}

func (e *UploadError) Error() string {
	return fmt.Sprintf("upload error for %s to %s: %v", e.File.Path, e.GCSPath, e.Err)
}

func (e *UploadError) Unwrap() error {
	return e.Err
}
