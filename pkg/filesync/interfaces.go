package filesync

import "context"

// Discoverer discovers files to sync from a root directory
type Discoverer interface {
	// Discover walks the directory tree and sends FileInfo for each file found
	// Returns channels for files and errors. Both channels will be closed when discovery completes.
	Discover(ctx context.Context, rootDir string) (<-chan FileInfo, <-chan error)
}

// MetadataExtractor extracts metadata from files
type MetadataExtractor interface {
	// Extract extracts metadata from a file, sending progress updates
	Extract(ctx context.Context, file FileInfo, progress chan<- Progress) (*ExtractedMetadata, error)

	// CanExtract returns true if this extractor can handle the given file
	CanExtract(file FileInfo) bool
}

// PathNormalizer normalizes file paths for GCS storage
type PathNormalizer interface {
	// Normalize generates a normalized GCS path based on file info and metadata
	Normalize(file FileInfo, metadata *ExtractedMetadata) (*NormalizedPath, error)
}

// Uploader uploads files to GCS
type Uploader interface {
	// Upload uploads a file to the specified GCS path, sending progress updates
	Upload(ctx context.Context, file FileInfo, gcsPath string, metadata *ExtractedMetadata, progress chan<- Progress) (*UploadResult, error)

	// CheckExists checks if a file with the given hash already exists in GCS
	// Returns true and the GCS path if found, false otherwise
	CheckExists(ctx context.Context, hash string) (exists bool, gcsPath string, err error)
}
