package strategies

import (
	"context"
	"path/filepath"
	"strings"
)

// PrintStrategy handles print media (PDFs, ebooks, etc.)
type PrintStrategy struct {
	enabled bool
}

// NewPrintStrategy creates a new print strategy
func NewPrintStrategy(enabled bool) *PrintStrategy {
	return &PrintStrategy{
		enabled: enabled,
	}
}

// Name returns the strategy name
func (s *PrintStrategy) Name() string {
	return "print"
}

// FileExtensions returns supported print file extensions
func (s *PrintStrategy) FileExtensions() []string {
	return []string{".pdf", ".epub", ".mobi", ".azw", ".azw3", ".djvu"}
}

// IsEnabled returns whether this strategy is enabled
func (s *PrintStrategy) IsEnabled() bool {
	return s.enabled
}

// ExtractMetadata extracts metadata from a print file
func (s *PrintStrategy) ExtractMetadata(ctx context.Context, filePath string) (metadata map[string]interface{}, logs []string, err error) {
	logs = []string{}
	metadata = make(map[string]interface{})

	// TODO: Implement PDF metadata extraction, EPUB metadata parsing
	logs = append(logs, "Print metadata extraction not yet implemented - using filename")

	fileName := filepath.Base(filePath)
	ext := filepath.Ext(fileName)
	baseName := strings.TrimSuffix(fileName, ext)

	metadata["filename"] = fileName
	metadata["basename"] = baseName
	metadata["extension"] = ext
	metadata["mediaType"] = "print"

	// Try to parse "Author - Title" format
	if strings.Contains(baseName, " - ") {
		parts := strings.SplitN(baseName, " - ", 2)
		if len(parts) == 2 {
			metadata["author"] = strings.TrimSpace(parts[0])
			metadata["title"] = strings.TrimSpace(parts[1])
			logs = append(logs, "Extracted author and title from filename")
		}
	}

	return metadata, logs, nil
}

// NormalizePath generates a normalized GCS path for print files
func (s *PrintStrategy) NormalizePath(metadata map[string]interface{}, fileName string) (string, error) {
	// Default format: author/title.ext
	// Fallback: uncategorized/filename

	author, _ := metadata["author"].(string)
	title, _ := metadata["title"].(string)

	if author == "" {
		author = "Unknown Author"
	}
	if title == "" {
		title = strings.TrimSuffix(fileName, filepath.Ext(fileName))
	}

	author = sanitizePathComponent(author)
	title = sanitizePathComponent(title)
	ext := filepath.Ext(fileName)

	return filepath.Join(author, title+ext), nil
}
