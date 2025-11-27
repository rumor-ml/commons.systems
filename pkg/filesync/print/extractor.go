package print

import (
	"context"

	"github.com/commons-systems/filesync"
)

// ChainedExtractor runs multiple extractors in sequence, merging their results
type ChainedExtractor struct {
	extractors []filesync.MetadataExtractor
}

// ExtractorOption configures a ChainedExtractor
type ExtractorOption func(*ChainedExtractor)

// WithExtractor adds an extractor to the chain
func WithExtractor(e filesync.MetadataExtractor) ExtractorOption {
	return func(c *ChainedExtractor) {
		c.extractors = append(c.extractors, e)
	}
}

// NewChainedExtractor creates a new ChainedExtractor with the given extractors
func NewChainedExtractor(opts ...ExtractorOption) *ChainedExtractor {
	c := &ChainedExtractor{
		extractors: make([]filesync.MetadataExtractor, 0),
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// Extract implements filesync.MetadataExtractor
// It runs all applicable extractors and merges their results using a fill-gaps strategy
func (c *ChainedExtractor) Extract(ctx context.Context, file filesync.FileInfo, progress chan<- filesync.Progress) (*filesync.ExtractedMetadata, error) {
	result := &filesync.ExtractedMetadata{
		Raw: make(map[string]interface{}),
	}

	var lastError error
	hasAnySuccess := false

	for _, extractor := range c.extractors {
		// Skip extractors that can't handle this file
		if !extractor.CanExtract(file) {
			continue
		}

		// Check if context is cancelled
		select {
		case <-ctx.Done():
			return nil, &filesync.ExtractionError{
				File: file,
				Err:  filesync.ErrCancelled,
			}
		default:
		}

		// Extract metadata
		metadata, err := extractor.Extract(ctx, file, progress)
		if err != nil {
			lastError = err
			continue
		}

		// Merge metadata using fill-gaps strategy
		if metadata != nil {
			hasAnySuccess = true
			mergeMetadata(result, metadata)
		}
	}

	// If no extractor succeeded, return the last error
	if !hasAnySuccess {
		if lastError != nil {
			return nil, lastError
		}
		// No extractors could handle this file
		return result, nil
	}

	return result, nil
}

// CanExtract implements filesync.MetadataExtractor
// Returns true if any of the chained extractors can extract from this file
func (c *ChainedExtractor) CanExtract(file filesync.FileInfo) bool {
	for _, extractor := range c.extractors {
		if extractor.CanExtract(file) {
			return true
		}
	}
	return false
}

// mergeMetadata merges source into dest using a fill-gaps strategy
// Only fills in fields that are empty in dest
func mergeMetadata(dest, source *filesync.ExtractedMetadata) {
	// Fill CreatedAt if not set
	if dest.CreatedAt == nil && source.CreatedAt != nil {
		dest.CreatedAt = source.CreatedAt
	}

	// Fill CaptureDevice if not set
	if dest.CaptureDevice == "" && source.CaptureDevice != "" {
		dest.CaptureDevice = source.CaptureDevice
	}

	// Fill Location if not set
	if dest.Location == nil && source.Location != nil {
		dest.Location = source.Location
	}

	// Fill Title if not set
	if dest.Title == "" && source.Title != "" {
		dest.Title = source.Title
	}

	// Fill Description if not set
	if dest.Description == "" && source.Description != "" {
		dest.Description = source.Description
	}

	// Merge tags (append without duplicates)
	if len(source.Tags) > 0 {
		tagSet := make(map[string]bool)
		for _, tag := range dest.Tags {
			tagSet[tag] = true
		}
		for _, tag := range source.Tags {
			if !tagSet[tag] {
				dest.Tags = append(dest.Tags, tag)
				tagSet[tag] = true
			}
		}
	}

	// Merge Raw fields (only fill missing keys)
	if source.Raw != nil {
		if dest.Raw == nil {
			dest.Raw = make(map[string]interface{})
		}
		for key, value := range source.Raw {
			if _, exists := dest.Raw[key]; !exists {
				dest.Raw[key] = value
			}
		}
	}
}

// DefaultExtractorOption configures the default extractor
type DefaultExtractorOption func(*ChainedExtractor)

// NewDefaultExtractor creates the standard print metadata extractor chain
// with all extractors enabled
func NewDefaultExtractor(opts ...DefaultExtractorOption) *ChainedExtractor {
	extractor := NewChainedExtractor(
		WithExtractor(NewFilenameExtractor()),
		WithExtractor(NewPDFMetadataExtractor()),
		WithExtractor(NewEPUBMetadataExtractor()),
		WithExtractor(NewOpenLibraryExtractor()),
		WithExtractor(NewComicsOrgExtractor()),
	)

	for _, opt := range opts {
		opt(extractor)
	}

	return extractor
}
