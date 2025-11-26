package filesync

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
)

var (
	// ErrInvalidGCSPath is returned when a path is invalid for GCS
	ErrInvalidGCSPath = errors.New("invalid GCS path")

	// ErrMaxCollisionAttempts is returned when collision resolution exceeds max attempts
	ErrMaxCollisionAttempts = errors.New("exceeded max collision resolution attempts")

	// ErrMissingPlaceholder is returned when a required placeholder value is missing
	ErrMissingPlaceholder = errors.New("missing required placeholder value")

	// placeholderRegex matches {placeholder} patterns in templates
	placeholderRegex = regexp.MustCompile(`\{([^}]+)\}`)
)

// SanitizePath removes/replaces characters invalid for GCS paths
// - `/`, `\`, `:`, `|` -> `-`
// - `*`, `?`, `<`, `>` -> removed
// - `"` -> `'`
// - Trim whitespace
func SanitizePath(s string) string {
	// Trim leading/trailing whitespace
	s = strings.TrimSpace(s)

	// Replace invalid path separators and special chars with dash
	s = strings.ReplaceAll(s, "/", "-")
	s = strings.ReplaceAll(s, "\\", "-")
	s = strings.ReplaceAll(s, ":", "-")
	s = strings.ReplaceAll(s, "|", "-")

	// Replace quotes with apostrophe
	s = strings.ReplaceAll(s, "\"", "'")

	// Remove wildcards and comparison operators
	s = strings.ReplaceAll(s, "*", "")
	s = strings.ReplaceAll(s, "?", "")
	s = strings.ReplaceAll(s, "<", "")
	s = strings.ReplaceAll(s, ">", "")

	// Collapse multiple spaces to single space
	s = regexp.MustCompile(`\s+`).ReplaceAllString(s, " ")

	return s
}

// SanitizeFilename sanitizes a filename and truncates to maxLength
// Preserves file extension if present
func SanitizeFilename(s string, maxLength int) string {
	// Sanitize the path first
	s = SanitizePath(s)

	if maxLength <= 0 {
		return s
	}

	// Split extension
	ext := filepath.Ext(s)
	nameWithoutExt := strings.TrimSuffix(s, ext)

	// If already within limit, return as-is
	if len(s) <= maxLength {
		return s
	}

	// Reserve space for extension
	maxNameLength := maxLength - len(ext)
	if maxNameLength <= 0 {
		// Extension alone is too long, just truncate
		return s[:maxLength]
	}

	// Truncate name and reattach extension
	truncatedName := nameWithoutExt
	if len(nameWithoutExt) > maxNameLength {
		truncatedName = nameWithoutExt[:maxNameLength]
	}

	return truncatedName + ext
}

// ValidateGCSPath validates that a path is valid for GCS storage
// GCS object names:
// - Must be UTF-8 encoded
// - Must be 1-1024 bytes when UTF-8 encoded
// - Cannot contain Carriage Return or Line Feed characters
// - Cannot start with .well-known/acme-challenge/
func ValidateGCSPath(path string) error {
	if path == "" {
		return fmt.Errorf("%w: path cannot be empty", ErrInvalidGCSPath)
	}

	// Check UTF-8 byte length
	byteLen := len([]byte(path))
	if byteLen > 1024 {
		return fmt.Errorf("%w: path exceeds 1024 bytes (%d bytes)", ErrInvalidGCSPath, byteLen)
	}

	// Check for carriage return or line feed
	if strings.ContainsAny(path, "\r\n") {
		return fmt.Errorf("%w: path cannot contain carriage return or line feed", ErrInvalidGCSPath)
	}

	// Check for well-known ACME challenge prefix
	if strings.HasPrefix(path, ".well-known/acme-challenge/") {
		return fmt.Errorf("%w: path cannot start with .well-known/acme-challenge/", ErrInvalidGCSPath)
	}

	return nil
}

// PathTemplate generates paths from patterns with {placeholder} syntax
type PathTemplate struct {
	pattern    string
	defaults   map[string]string
	sanitizers map[string]func(string) string
}

// PathTemplateOption configures a PathTemplate
type PathTemplateOption func(*PathTemplate)

// WithDefault sets a default value for a placeholder
func WithDefault(placeholder, value string) PathTemplateOption {
	return func(t *PathTemplate) {
		if t.defaults == nil {
			t.defaults = make(map[string]string)
		}
		t.defaults[placeholder] = value
	}
}

// WithSanitizer sets a custom sanitizer function for a placeholder
func WithSanitizer(placeholder string, fn func(string) string) PathTemplateOption {
	return func(t *PathTemplate) {
		if t.sanitizers == nil {
			t.sanitizers = make(map[string]func(string) string)
		}
		t.sanitizers[placeholder] = fn
	}
}

// NewPathTemplate creates a new path template with the given pattern and options
func NewPathTemplate(pattern string, opts ...PathTemplateOption) *PathTemplate {
	t := &PathTemplate{
		pattern:    pattern,
		defaults:   make(map[string]string),
		sanitizers: make(map[string]func(string) string),
	}

	for _, opt := range opts {
		opt(t)
	}

	return t
}

// Execute substitutes placeholders with values and returns the resulting path
// Missing placeholders without defaults return ErrMissingPlaceholder
func (t *PathTemplate) Execute(values map[string]string) (string, error) {
	result := t.pattern

	// Find all placeholders
	matches := placeholderRegex.FindAllStringSubmatch(result, -1)
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}

		placeholder := match[1]
		fullMatch := match[0] // e.g., "{Author}"

		// Get value from provided values or defaults
		value, ok := values[placeholder]
		if !ok {
			value, ok = t.defaults[placeholder]
			if !ok {
				return "", fmt.Errorf("%w: %s", ErrMissingPlaceholder, placeholder)
			}
		}

		// Apply sanitizer if configured
		if sanitizer, hasSanitizer := t.sanitizers[placeholder]; hasSanitizer {
			value = sanitizer(value)
		}

		// Replace placeholder with value
		result = strings.ReplaceAll(result, fullMatch, value)
	}

	return result, nil
}

// Placeholders returns a list of all placeholder names in the template
func (t *PathTemplate) Placeholders() []string {
	matches := placeholderRegex.FindAllStringSubmatch(t.pattern, -1)
	placeholders := make([]string, 0, len(matches))

	seen := make(map[string]bool)
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		placeholder := match[1]
		if !seen[placeholder] {
			placeholders = append(placeholders, placeholder)
			seen[placeholder] = true
		}
	}

	return placeholders
}

// PathExistsFunc checks if a path already exists
type PathExistsFunc func(ctx context.Context, path string) (bool, error)

// CollisionResolver resolves path collisions by adding numeric suffixes
type CollisionResolver struct {
	checkExists PathExistsFunc
	separator   string
	maxAttempts int
}

// NewCollisionResolver creates a new collision resolver with default settings
func NewCollisionResolver(checkExists PathExistsFunc) *CollisionResolver {
	return &CollisionResolver{
		checkExists: checkExists,
		separator:   "_",
		maxAttempts: 100,
	}
}

// WithSeparator sets the separator character used for collision suffixes
func (r *CollisionResolver) WithSeparator(sep string) *CollisionResolver {
	r.separator = sep
	return r
}

// WithMaxAttempts sets the maximum number of collision resolution attempts
func (r *CollisionResolver) WithMaxAttempts(max int) *CollisionResolver {
	r.maxAttempts = max
	return r
}

// Resolve returns a unique path, appending separator + number if needed
// For example, if "file.txt" exists, it tries "file_1.txt", "file_2.txt", etc.
func (r *CollisionResolver) Resolve(ctx context.Context, basePath string) (string, error) {
	// Check if base path is available
	exists, err := r.checkExists(ctx, basePath)
	if err != nil {
		return "", fmt.Errorf("failed to check if path exists: %w", err)
	}
	if !exists {
		return basePath, nil
	}

	// Extract extension
	ext := filepath.Ext(basePath)
	nameWithoutExt := strings.TrimSuffix(basePath, ext)

	// Try adding suffixes
	for i := 1; i <= r.maxAttempts; i++ {
		candidatePath := fmt.Sprintf("%s%s%d%s", nameWithoutExt, r.separator, i, ext)

		exists, err := r.checkExists(ctx, candidatePath)
		if err != nil {
			return "", fmt.Errorf("failed to check if path exists: %w", err)
		}

		if !exists {
			return candidatePath, nil
		}
	}

	return "", fmt.Errorf("%w: tried %d paths starting from %s", ErrMaxCollisionAttempts, r.maxAttempts, basePath)
}
