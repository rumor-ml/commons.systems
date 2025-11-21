package audio

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
)

// PathNormalizer generates normalized GCS paths for audio files
type PathNormalizer struct {
	// Pattern for organizing files, e.g., "{artist}/{album}/{track} - {title}"
}

// NewPathNormalizer creates a new path normalizer
func NewPathNormalizer() *PathNormalizer {
	return &PathNormalizer{}
}

// Normalize generates a normalized path from audio metadata
func (n *PathNormalizer) Normalize(metadata map[string]interface{}, fileName string) (string, error) {
	// Extract metadata fields
	artist := getStringField(metadata, "artist", "albumArtist")
	album := getStringField(metadata, "album")
	title := getStringField(metadata, "title")
	trackNum := getIntField(metadata, "trackNumber")

	// Sanitize fields for filesystem
	artist = sanitizePathComponent(artist, "Unknown Artist")
	album = sanitizePathComponent(album, "Unknown Album")
	title = sanitizePathComponent(title, "")

	// Determine file extension
	ext := filepath.Ext(fileName)

	// Build path: artist/album/track - title.ext
	var trackPrefix string
	if trackNum > 0 {
		trackPrefix = fmt.Sprintf("%02d - ", trackNum)
	}

	// If we don't have a title, use the original filename
	var filename string
	if title != "" {
		filename = trackPrefix + title + ext
	} else {
		filename = fileName
	}

	path := filepath.Join(artist, album, filename)
	return path, nil
}

// getStringField retrieves a string field from metadata, trying multiple keys
func getStringField(metadata map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if val, ok := metadata[key]; ok {
			if str, ok := val.(string); ok && str != "" {
				return str
			}
		}
	}
	return ""
}

// getIntField retrieves an int field from metadata
func getIntField(metadata map[string]interface{}, key string) int {
	if val, ok := metadata[key]; ok {
		switch v := val.(type) {
		case int:
			return v
		case int64:
			return int(v)
		case float64:
			return int(v)
		}
	}
	return 0
}

// sanitizePathComponent sanitizes a string for use in a file path
func sanitizePathComponent(s, defaultValue string) string {
	if s == "" {
		return defaultValue
	}

	// Remove or replace invalid characters
	// Replace path separators and other problematic characters
	s = strings.ReplaceAll(s, "/", "-")
	s = strings.ReplaceAll(s, "\\", "-")
	s = strings.ReplaceAll(s, ":", "-")
	s = strings.ReplaceAll(s, "*", "-")
	s = strings.ReplaceAll(s, "?", "")
	s = strings.ReplaceAll(s, "\"", "'")
	s = strings.ReplaceAll(s, "<", "(")
	s = strings.ReplaceAll(s, ">", ")")
	s = strings.ReplaceAll(s, "|", "-")

	// Remove leading/trailing spaces and dots
	s = strings.TrimSpace(s)
	s = strings.Trim(s, ".")

	// Replace multiple spaces with single space
	spaceRegex := regexp.MustCompile(`\s+`)
	s = spaceRegex.ReplaceAllString(s, " ")

	// If after sanitization it's empty, use default
	if s == "" {
		return defaultValue
	}

	return s
}
