package audio

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// AudioFileDiscoverer discovers audio files in a directory
type AudioFileDiscoverer struct {
	Extensions []string // e.g., [".mp3", ".flac", ".m4a", ".wav", ".ogg"]
}

// NewAudioFileDiscoverer creates a new audio file discoverer
func NewAudioFileDiscoverer() *AudioFileDiscoverer {
	return &AudioFileDiscoverer{
		Extensions: []string{".mp3", ".flac", ".m4a", ".wav", ".ogg", ".aac", ".wma"},
	}
}

// Discover finds all audio files at the given path
func (d *AudioFileDiscoverer) Discover(ctx context.Context, basePath string) ([]string, error) {
	var files []string

	err := filepath.Walk(basePath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Check for context cancellation
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Skip directories
		if info.IsDir() {
			return nil
		}

		// Check if file has audio extension
		ext := strings.ToLower(filepath.Ext(path))
		for _, audioExt := range d.Extensions {
			if ext == audioExt {
				files = append(files, path)
				break
			}
		}

		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to walk directory: %w", err)
	}

	return files, nil
}
