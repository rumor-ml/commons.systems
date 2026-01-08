package parser

import "time"

// Metadata contains context about the file being parsed
// Extracted from directory structure: ~/statements/{institution}/{account}/{period}/
type Metadata struct {
	FilePath      string
	Institution   string // Inferred from directory (e.g., "american_express")
	AccountNumber string // Inferred from directory (e.g., "2011")
	Period        string // Optional period directory (e.g., "2025-10")
	DetectedAt    time.Time
}
