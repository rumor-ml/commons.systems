package parser

import (
	"fmt"
	"time"
)

// Metadata contains context about the file being parsed.
// Extracted from directory structure: ~/statements/{institution}/{account}/[{period}/]file.ext
//
// Invariants:
// - FilePath must be non-empty (validated by Validate())
// - DetectedAt must not be zero time (validated by Validate())
// - Institution can be empty if path doesn't match expected structure
// - AccountNumber can be empty if path doesn't match expected structure
// - Period is optional (empty if no period directory exists)
//
// When Institution or AccountNumber are empty, downstream processing should handle
// this gracefully, either by warning the user or treating the file as "unorganized".
type Metadata struct {
	FilePath      string
	Institution   string // Inferred from directory (e.g., "american_express")
	AccountNumber string // Inferred from directory (e.g., "2011")
	Period        string // Optional period directory (e.g., "2025-10")
	DetectedAt    time.Time
}

// Validate checks that metadata is well-formed
func (m *Metadata) Validate() error {
	if m.FilePath == "" {
		return fmt.Errorf("file path cannot be empty")
	}
	if m.DetectedAt.IsZero() {
		return fmt.Errorf("detected time cannot be zero")
	}
	// Institution and AccountNumber can be empty if path structure doesn't match
	// the expected format (~/statements/{institution}/{account}/...).
	// Downstream processing should handle missing institution/account metadata gracefully.
	// FilePath and DetectedAt are always required for tracking purposes.
	return nil
}
