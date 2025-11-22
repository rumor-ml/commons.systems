package strategies

import (
	"context"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
)

// AudioStrategy handles audio file processing
type AudioStrategy struct {
	enabled bool
}

// NewAudioStrategy creates a new audio strategy
func NewAudioStrategy(enabled bool) *AudioStrategy {
	return &AudioStrategy{
		enabled: enabled,
	}
}

// Name returns the strategy name
func (s *AudioStrategy) Name() string {
	return "audio"
}

// FileExtensions returns supported audio file extensions
func (s *AudioStrategy) FileExtensions() []string {
	return []string{".mp3", ".flac", ".m4a", ".wav", ".ogg", ".aac", ".wma"}
}

// IsEnabled returns whether this strategy is enabled
func (s *AudioStrategy) IsEnabled() bool {
	return s.enabled
}

// ExtractMetadata extracts metadata from an audio file
func (s *AudioStrategy) ExtractMetadata(ctx context.Context, filePath string) (metadata map[string]interface{}, logs []string, err error) {
	logs = []string{}
	metadata = make(map[string]interface{})

	// TODO: Implement ID3 tag extraction when library is available
	// For now, extract from filename/path
	logs = append(logs, "ID3 tag extraction temporarily disabled - extracting from filename")

	// Extract basic info from path
	fileName := filepath.Base(filePath)
	ext := filepath.Ext(fileName)
	baseName := strings.TrimSuffix(fileName, ext)

	metadata["filename"] = fileName
	metadata["basename"] = baseName
	metadata["extension"] = ext
	metadata["mediaType"] = "audio"

	// Try to parse artist - title format
	if strings.Contains(baseName, " - ") {
		parts := strings.SplitN(baseName, " - ", 2)
		if len(parts) == 2 {
			metadata["artist"] = strings.TrimSpace(parts[0])
			metadata["title"] = strings.TrimSpace(parts[1])
			logs = append(logs, "Extracted artist and title from filename")
		}
	}

	return metadata, logs, nil
}

// NormalizePath generates a normalized GCS path for audio files
func (s *AudioStrategy) NormalizePath(metadata map[string]interface{}, fileName string) (string, error) {
	// Default format: artist/album/track - title.ext
	// Fallback: uncategorized/filename if metadata is missing

	artist, _ := metadata["artist"].(string)
	album, _ := metadata["album"].(string)
	title, _ := metadata["title"].(string)

	if artist == "" {
		artist = "Unknown Artist"
	}
	if album == "" {
		album = "Unknown Album"
	}
	if title == "" {
		title = strings.TrimSuffix(fileName, filepath.Ext(fileName))
	}

	// Sanitize for filesystem
	artist = sanitizePathComponent(artist)
	album = sanitizePathComponent(album)
	title = sanitizePathComponent(title)
	ext := filepath.Ext(fileName)

	// Build path: artist/album/title.ext
	return filepath.Join(artist, album, title+ext), nil
}

// sanitizePathComponent removes invalid filesystem characters
func sanitizePathComponent(s string) string {
	// Remove or replace invalid characters
	reg := regexp.MustCompile(`[<>:"/\\|?*]`)
	s = reg.ReplaceAllString(s, "_")

	// Trim spaces and dots (invalid at start/end in many filesystems)
	s = strings.Trim(s, " .")

	if s == "" {
		s = "unknown"
	}

	return s
}
