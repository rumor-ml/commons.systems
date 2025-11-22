package strategies

import (
	"context"
	"path/filepath"
	"strings"
)

// VideoStrategy handles video file processing
type VideoStrategy struct {
	enabled bool
}

// NewVideoStrategy creates a new video strategy
func NewVideoStrategy(enabled bool) *VideoStrategy {
	return &VideoStrategy{
		enabled: enabled,
	}
}

// Name returns the strategy name
func (s *VideoStrategy) Name() string {
	return "video"
}

// FileExtensions returns supported video file extensions
func (s *VideoStrategy) FileExtensions() []string {
	return []string{".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm"}
}

// IsEnabled returns whether this strategy is enabled
func (s *VideoStrategy) IsEnabled() bool {
	return s.enabled
}

// ExtractMetadata extracts metadata from a video file
func (s *VideoStrategy) ExtractMetadata(ctx context.Context, filePath string) (metadata map[string]interface{}, logs []string, err error) {
	logs = []string{}
	metadata = make(map[string]interface{})

	// TODO: Implement ffprobe metadata extraction
	logs = append(logs, "Video metadata extraction not yet implemented - using filename")

	fileName := filepath.Base(filePath)
	ext := filepath.Ext(fileName)
	baseName := strings.TrimSuffix(fileName, ext)

	metadata["filename"] = fileName
	metadata["basename"] = baseName
	metadata["extension"] = ext
	metadata["mediaType"] = "video"

	return metadata, logs, nil
}

// NormalizePath generates a normalized GCS path for video files
func (s *VideoStrategy) NormalizePath(metadata map[string]interface{}, fileName string) (string, error) {
	// Default format: collection/title.ext
	// Fallback: uncategorized/filename

	collection, _ := metadata["collection"].(string)
	title, _ := metadata["title"].(string)

	if collection == "" {
		collection = "Uncategorized"
	}
	if title == "" {
		title = strings.TrimSuffix(fileName, filepath.Ext(fileName))
	}

	collection = sanitizePathComponent(collection)
	title = sanitizePathComponent(title)
	ext := filepath.Ext(fileName)

	return filepath.Join(collection, title+ext), nil
}
