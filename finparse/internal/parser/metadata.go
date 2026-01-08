package parser

import (
	"fmt"
	"time"
)

// Metadata contains context about the file being parsed.
// Extracted from directory structure: ~/statements/{institution}/{account}/[{period}/]file.ext
//
// Create instances using NewMetadata(filePath, detectedAt) which validates required fields.
// Optional fields (institution, account, period) are set after construction using setters.
// Empty institution/account values indicate the path didn't match the expected structure.
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

// SetInstitution sets the institution name. Empty string is valid and indicates
// the institution could not be extracted from the directory structure.
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
