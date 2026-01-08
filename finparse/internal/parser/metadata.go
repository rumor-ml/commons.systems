package parser

import (
	"fmt"
	"time"
)

// Metadata contains context about the file being parsed.
// Extracted from directory structure: ~/statements/{institution}/{account}/[{period}/]file.ext
//
// Create instances using NewMetadata(filePath, detectedAt). This constructor validates
// required fields (filePath and detectedAt) to ensure metadata is always in a valid state.
// Optional fields (institution, account, period) can be set after construction using setter methods.
//
// When Institution() or AccountNumber() return empty strings, the file path didn't match
// the expected directory structure. This is not an error - downstream processing should
// handle empty values by either prompting the user for manual categorization or treating
// the file as unorganized (not categorized by institution/account).
type Metadata struct {
	filePath      string
	institution   string // Inferred from directory (e.g., "american_express")
	accountNumber string // Inferred from directory (e.g., "2011")
	period        string // Optional period directory (e.g., "2025-10")
	detectedAt    time.Time
}

// NewMetadata creates a new Metadata instance with validated required fields.
// Returns an error if filePath is empty or detectedAt is zero.
func NewMetadata(filePath string, detectedAt time.Time) (*Metadata, error) {
	if filePath == "" {
		return nil, fmt.Errorf("file path cannot be empty")
	}
	if detectedAt.IsZero() {
		return nil, fmt.Errorf("detected time cannot be zero")
	}
	return &Metadata{
		filePath:   filePath,
		detectedAt: detectedAt,
	}, nil
}

// FilePath returns the absolute file path
func (m *Metadata) FilePath() string {
	return m.filePath
}

// Institution returns the institution name inferred from directory structure.
// Returns empty string if path didn't match expected structure.
func (m *Metadata) Institution() string {
	return m.institution
}

// AccountNumber returns the account number inferred from directory structure.
// Returns empty string if path didn't match expected structure.
func (m *Metadata) AccountNumber() string {
	return m.accountNumber
}

// Period returns the period inferred from directory structure.
// Returns empty string if no period directory exists.
func (m *Metadata) Period() string {
	return m.period
}

// DetectedAt returns the timestamp when the file was detected
func (m *Metadata) DetectedAt() time.Time {
	return m.detectedAt
}

// SetInstitution sets the institution name
// TODO(#1284): Missing test for Metadata.SetInstitution allowing empty values
func (m *Metadata) SetInstitution(institution string) {
	m.institution = institution
}

// SetAccountNumber sets the account number
func (m *Metadata) SetAccountNumber(accountNumber string) {
	m.accountNumber = accountNumber
}

// SetPeriod sets the period
func (m *Metadata) SetPeriod(period string) {
	m.period = period
}
