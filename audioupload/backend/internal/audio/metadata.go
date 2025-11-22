package audio

import (
	"context"
	"fmt"
	// "os"
	// "time"

	// "github.com/dhowden/tag" // TODO: Add back when deploying with proper version
)

// MetadataExtractor extracts metadata from audio files
// It attempts fingerprinting via MusicBrainz first, then falls back to ID3 tags
type MetadataExtractor struct {
	FingerprintEnabled bool
	MusicBrainzAPIURL  string
}

// NewMetadataExtractor creates a new metadata extractor
func NewMetadataExtractor(enableFingerprint bool) *MetadataExtractor {
	return &MetadataExtractor{
		FingerprintEnabled: enableFingerprint,
		MusicBrainzAPIURL:  "https://musicbrainz.org/ws/2/",
	}
}

// Extract extracts metadata from an audio file
func (e *MetadataExtractor) Extract(ctx context.Context, filePath string) (metadata map[string]interface{}, logs []string, err error) {
	logs = []string{}
	metadata = make(map[string]interface{})

	// Attempt fingerprinting if enabled
	if e.FingerprintEnabled {
		fpMetadata, fpLogs, fpErr := e.extractViaFingerprint(ctx, filePath)
		logs = append(logs, fpLogs...)

		if fpErr == nil && len(fpMetadata) > 0 {
			logs = append(logs, "Successfully extracted metadata via MusicBrainz fingerprinting")

			// Update ID3 tags with fingerprint data
			if updateErr := e.updateID3Tags(filePath, fpMetadata); updateErr != nil {
				logs = append(logs, fmt.Sprintf("Warning: Failed to update ID3 tags: %v", updateErr))
			} else {
				logs = append(logs, "Updated ID3 tags with MusicBrainz metadata")
			}

			return fpMetadata, logs, nil
		}

		if fpErr != nil {
			logs = append(logs, fmt.Sprintf("Fingerprint lookup failed: %v, falling back to ID3 tags", fpErr))
		}
	}

	// Fallback to reading existing ID3 tags
	// TODO: Re-enable ID3 tag extraction when github.com/dhowden/tag is available
	// tagMetadata, tagErr := e.extractFromID3Tags(filePath)
	// if tagErr != nil {
	// 	logs = append(logs, fmt.Sprintf("ID3 tag extraction failed: %v", tagErr))
	// 	return nil, logs, fmt.Errorf("failed to extract metadata: %w", tagErr)
	// }
	//
	// logs = append(logs, "Extracted metadata from ID3 tags")
	// return tagMetadata, logs, nil

	// For now, return basic file info
	logs = append(logs, "ID3 tag extraction temporarily disabled - using basic file info")
	metadata["filename"] = filePath
	return metadata, logs, nil
}

// extractViaFingerprint attempts to fingerprint the file and lookup in MusicBrainz
func (e *MetadataExtractor) extractViaFingerprint(ctx context.Context, filePath string) (map[string]interface{}, []string, error) {
	logs := []string{"Starting MusicBrainz fingerprint lookup..."}

	// TODO: Implement actual fingerprinting using acoustid/chromaprint
	// For now, return an error to fall back to ID3 tags
	// This would require:
	// 1. Generate acoustic fingerprint using chromaprint
	// 2. Query AcoustID API
	// 3. Lookup recording in MusicBrainz
	// 4. Parse and return metadata

	logs = append(logs, "Fingerprinting not yet implemented")
	return nil, logs, fmt.Errorf("fingerprinting not yet implemented")
}

// extractFromID3Tags reads metadata from ID3 tags
// TODO: Re-enable when github.com/dhowden/tag dependency is available
/*
func (e *MetadataExtractor) extractFromID3Tags(filePath string) (map[string]interface{}, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	m, err := tag.ReadFrom(file)
	if err != nil {
		return nil, fmt.Errorf("failed to read tags: %w", err)
	}

	metadata := make(map[string]interface{})

	// Extract standard tags
	if title := m.Title(); title != "" {
		metadata["title"] = title
	}
	if artist := m.Artist(); artist != "" {
		metadata["artist"] = artist
	}
	if album := m.Album(); album != "" {
		metadata["album"] = album
	}
	if albumArtist := m.AlbumArtist(); albumArtist != "" {
		metadata["albumArtist"] = albumArtist
	}
	if genre := m.Genre(); genre != "" {
		metadata["genre"] = genre
	}

	year, trackNum, trackTotal := m.Year(), m.Track()
	if year != 0 {
		metadata["year"] = year
	}
	if trackNum != 0 {
		metadata["trackNumber"] = trackNum
	}
	if trackTotal != 0 {
		metadata["trackTotal"] = trackTotal
	}

	discNum, discTotal := m.Disc()
	if discNum != 0 {
		metadata["discNumber"] = discNum
	}
	if discTotal != 0 {
		metadata["discTotal"] = discTotal
	}

	metadata["format"] = string(m.Format())
	metadata["fileType"] = string(m.FileType())

	return metadata, nil
}
*/

// updateID3Tags updates the ID3 tags of a file with new metadata
func (e *MetadataExtractor) updateID3Tags(filePath string, metadata map[string]interface{}) error {
	// TODO: Implement ID3 tag writing
	// This would require a library that supports writing tags (tag library only reads)
	// Options: github.com/bogem/id3v2, github.com/mikkyang/id3-go
	// For now, we'll skip this and just log
	return fmt.Errorf("ID3 tag writing not yet implemented")
}
