package print

import (
	"context"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/commons-systems/filesync"
)

// FilenameExtractor extracts metadata from filename patterns
type FilenameExtractor struct {
	patterns []*filenamePattern
}

// filenamePattern represents a regex pattern for extracting metadata from filenames
type filenamePattern struct {
	regex       *regexp.Regexp
	extractFunc func(matches []string) *filesync.ExtractedMetadata
}

// NewFilenameExtractor creates a new FilenameExtractor with common patterns
func NewFilenameExtractor() *FilenameExtractor {
	return &FilenameExtractor{
		patterns: []*filenamePattern{
			// Pattern: "Author - Title.ext"
			{
				regex: regexp.MustCompile(`^(.+?)\s*-\s*(.+?)(?:\.[^.]+)?$`),
				extractFunc: func(matches []string) *filesync.ExtractedMetadata {
					return &filesync.ExtractedMetadata{
						Title: strings.TrimSpace(matches[2]),
						Raw: map[string]interface{}{
							"author": strings.TrimSpace(matches[1]),
						},
					}
				},
			},
			// Pattern: "Title (Author).ext"
			{
				regex: regexp.MustCompile(`^(.+?)\s*\(([^)]+)\)(?:\.[^.]+)?$`),
				extractFunc: func(matches []string) *filesync.ExtractedMetadata {
					return &filesync.ExtractedMetadata{
						Title: strings.TrimSpace(matches[1]),
						Raw: map[string]interface{}{
							"author": strings.TrimSpace(matches[2]),
						},
					}
				},
			},
			// Pattern: "Series #01 - Title.ext" or "Series Vol 1 - Title.ext"
			{
				regex: regexp.MustCompile(`^(.+?)\s+(?:#|Vol\.?\s*)(\d+)\s*-\s*(.+?)(?:\.[^.]+)?$`),
				extractFunc: func(matches []string) *filesync.ExtractedMetadata {
					return &filesync.ExtractedMetadata{
						Title: strings.TrimSpace(matches[3]),
						Raw: map[string]interface{}{
							"series": strings.TrimSpace(matches[1]),
							"volume": strings.TrimSpace(matches[2]),
						},
					}
				},
			},
			// Pattern: ISBN in brackets [ISBN-13: xxx] or (ISBN: xxx)
			{
				regex: regexp.MustCompile(`[\[\(]ISBN[-:\s]*(\d{10,13})[\]\)]`),
				extractFunc: func(matches []string) *filesync.ExtractedMetadata {
					return &filesync.ExtractedMetadata{
						Raw: map[string]interface{}{
							"isbn": strings.TrimSpace(matches[1]),
						},
					}
				},
			},
		},
	}
}

// Extract implements filesync.MetadataExtractor
func (e *FilenameExtractor) Extract(ctx context.Context, file filesync.FileInfo, progress chan<- filesync.Progress) (*filesync.ExtractedMetadata, error) {
	// Get filename without extension
	filename := filepath.Base(file.Path)
	ext := filepath.Ext(filename)
	baseFilename := strings.TrimSuffix(filename, ext)

	result := &filesync.ExtractedMetadata{
		Raw: make(map[string]interface{}),
	}

	// First, extract ISBN from the full filename (before stripping extension)
	// This helps find ISBNs that might be in brackets at the end
	// Pattern matches any 10-13 digit number inside brackets or parentheses
	isbnPattern := regexp.MustCompile(`[\[\(][^\]\)]*?(\d{10,13})[\]\)]`)
	if matches := isbnPattern.FindStringSubmatch(filename); matches != nil && len(matches) > 1 {
		result.Raw["isbn"] = strings.TrimSpace(matches[1])
		// Remove ISBN pattern from baseFilename for cleaner title extraction
		baseFilename = isbnPattern.ReplaceAllString(baseFilename, "")
		baseFilename = strings.TrimSpace(baseFilename)
	}

	// Try each pattern (excluding ISBN which we already handled)
	for i, pattern := range e.patterns {
		// Skip ISBN pattern (it's the last one)
		if i == len(e.patterns)-1 {
			continue
		}

		matches := pattern.regex.FindStringSubmatch(baseFilename)
		if matches != nil && len(matches) > 1 {
			metadata := pattern.extractFunc(matches)
			if metadata != nil {
				// Merge metadata
				mergeMetadata(result, metadata)
			}
		}
	}

	// If no title was extracted, use the base filename as title
	if result.Title == "" {
		result.Title = baseFilename
	}

	return result, nil
}

// CanExtract implements filesync.MetadataExtractor
// FilenameExtractor can handle any file
func (e *FilenameExtractor) CanExtract(file filesync.FileInfo) bool {
	return true
}
