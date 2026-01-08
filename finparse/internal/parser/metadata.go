package parser

import (
	"fmt"
	"time"
)

// Metadata contains context about the file being parsed
// Extracted from directory structure: ~/statements/{institution}/{account}/[{period}/]file.ext
// Period directory is optional
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
	// Institution and AccountNumber can be empty if not parsed from path
	return nil
}
