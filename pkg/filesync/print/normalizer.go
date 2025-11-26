package print

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/commons-systems/filesync"
)

// ContentType indicates the category of print content
type ContentType int

const (
	ContentTypeUnknown ContentType = iota
	ContentTypeBook
	ContentTypeComic
)

// PathNormalizer normalizes paths for print files
type PathNormalizer struct {
	bookTemplate   *filesync.PathTemplate
	comicTemplate  *filesync.PathTemplate
	unsortTemplate *filesync.PathTemplate
	resolver       *filesync.CollisionResolver // optional
}

// NormalizerOption configures a PathNormalizer
type NormalizerOption func(*PathNormalizer)

// WithCollisionResolver sets an optional collision resolver
func WithCollisionResolver(r *filesync.CollisionResolver) NormalizerOption {
	return func(n *PathNormalizer) {
		n.resolver = r
	}
}

// NewPathNormalizer creates a new PathNormalizer with default templates
func NewPathNormalizer(opts ...NormalizerOption) *PathNormalizer {
	n := &PathNormalizer{
		bookTemplate: filesync.NewPathTemplate(
			"print/books/{Author}/{Title}.{ext}",
			filesync.WithDefault("Author", "Unknown Author"),
			filesync.WithSanitizer("Author", filesync.SanitizePath),
			filesync.WithSanitizer("Title", filesync.SanitizePath),
		),
		comicTemplate: filesync.NewPathTemplate(
			"print/comics/{Publisher}/{Series}/{Volume}.{ext}",
			filesync.WithDefault("Publisher", "Unknown Publisher"),
			filesync.WithDefault("Series", "Unknown Series"),
			filesync.WithDefault("Volume", "Unknown Volume"),
			filesync.WithSanitizer("Publisher", filesync.SanitizePath),
			filesync.WithSanitizer("Series", filesync.SanitizePath),
			filesync.WithSanitizer("Volume", filesync.SanitizePath),
		),
		unsortTemplate: filesync.NewPathTemplate(
			"print/unsorted/{filename}",
		),
	}

	for _, opt := range opts {
		opt(n)
	}

	return n
}

// Normalize implements filesync.PathNormalizer
func (n *PathNormalizer) Normalize(file filesync.FileInfo, metadata *filesync.ExtractedMetadata) (*filesync.NormalizedPath, error) {
	contentType := detectContentType(file, metadata)

	var gcsPath string
	var err error

	switch contentType {
	case ContentTypeBook:
		gcsPath, err = n.normalizeBook(file, metadata)
	case ContentTypeComic:
		gcsPath, err = n.normalizeComic(file, metadata)
	default:
		gcsPath, err = n.normalizeUnsorted(file)
	}

	if err != nil {
		return nil, err
	}

	// Validate the generated path
	if err := filesync.ValidateGCSPath(gcsPath); err != nil {
		return nil, fmt.Errorf("invalid GCS path generated: %w", err)
	}

	// Split into directory and filename
	dir := filepath.Dir(gcsPath)
	filename := filepath.Base(gcsPath)

	return &filesync.NormalizedPath{
		GCSPath:       gcsPath,
		Directory:     dir,
		Filename:      filename,
		Deduplication: false, // Not using hash-based deduplication for print files
	}, nil
}

// normalizeBook generates a path for a book file
func (n *PathNormalizer) normalizeBook(file filesync.FileInfo, metadata *filesync.ExtractedMetadata) (string, error) {
	values := make(map[string]string)

	// Extract author from metadata
	if metadata != nil && metadata.Raw != nil {
		if author, ok := metadata.Raw["author"].(string); ok && author != "" {
			values["Author"] = author
		}
	}

	// Use title from metadata
	if metadata != nil && metadata.Title != "" {
		values["Title"] = metadata.Title
	} else {
		// Fallback to filename without extension
		ext := filepath.Ext(file.Path)
		values["Title"] = strings.TrimSuffix(filepath.Base(file.Path), ext)
	}

	// Get file extension
	ext := strings.TrimPrefix(filepath.Ext(file.Path), ".")
	if ext == "" {
		ext = "unknown"
	}
	values["ext"] = ext

	return n.bookTemplate.Execute(values)
}

// normalizeComic generates a path for a comic file
func (n *PathNormalizer) normalizeComic(file filesync.FileInfo, metadata *filesync.ExtractedMetadata) (string, error) {
	values := make(map[string]string)

	// Extract comic metadata from Raw fields
	if metadata != nil && metadata.Raw != nil {
		if publisher, ok := metadata.Raw["publisher"].(string); ok && publisher != "" {
			values["Publisher"] = publisher
		}
		if series, ok := metadata.Raw["series"].(string); ok && series != "" {
			values["Series"] = series
		}
		if volume, ok := metadata.Raw["volume"].(string); ok && volume != "" {
			values["Volume"] = volume
		}
	}

	// Get file extension
	ext := strings.TrimPrefix(filepath.Ext(file.Path), ".")
	if ext == "" {
		ext = "unknown"
	}
	values["ext"] = ext

	return n.comicTemplate.Execute(values)
}

// normalizeUnsorted generates a path for unsorted files
func (n *PathNormalizer) normalizeUnsorted(file filesync.FileInfo) (string, error) {
	values := map[string]string{
		"filename": filepath.Base(file.Path),
	}
	return n.unsortTemplate.Execute(values)
}

// detectContentType determines the content type based on file info and metadata
func detectContentType(file filesync.FileInfo, metadata *filesync.ExtractedMetadata) ContentType {
	ext := strings.ToLower(filepath.Ext(file.Path))

	// Check for comic extensions
	if ext == ".cbz" || ext == ".cbr" {
		return ContentTypeComic
	}

	// Check for series metadata (indicates comic)
	if metadata != nil && metadata.Raw != nil {
		if _, hasSeries := metadata.Raw["series"]; hasSeries {
			return ContentTypeComic
		}
	}

	// Check for book metadata (must have Title, Author can use default)
	// A book needs at minimum a title to be properly organized
	if metadata != nil && metadata.Title != "" {
		return ContentTypeBook
	}

	return ContentTypeUnknown
}
