package print

import (
	"context"
	"path/filepath"
	"strings"

	"github.com/commons-systems/filesync"
)

// ComicsOrgExtractor is a stub implementation for comics.org metadata extraction
// This will be implemented in the future to query the Grand Comics Database
type ComicsOrgExtractor struct{}

// NewComicsOrgExtractor creates a new ComicsOrgExtractor
func NewComicsOrgExtractor() *ComicsOrgExtractor {
	return &ComicsOrgExtractor{}
}

// Extract implements filesync.MetadataExtractor
// Currently returns empty metadata - to be implemented in the future
func (e *ComicsOrgExtractor) Extract(ctx context.Context, file filesync.FileInfo, progress chan<- filesync.Progress) (*filesync.ExtractedMetadata, error) {
	// Stub implementation - returns empty metadata
	return &filesync.ExtractedMetadata{
		Raw: make(map[string]interface{}),
	}, nil
}

// CanExtract implements filesync.MetadataExtractor
// Can handle comic book archive formats (CBZ, CBR)
func (e *ComicsOrgExtractor) CanExtract(file filesync.FileInfo) bool {
	ext := strings.ToLower(filepath.Ext(file.Path))
	return ext == ".cbz" || ext == ".cbr"
}
