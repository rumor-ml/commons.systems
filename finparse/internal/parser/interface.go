package parser

import (
	"context"
	"io"
	"time"
)

// Parser is the strategy interface for all file format parsers
type Parser interface {
	// Name returns parser identifier (e.g., "ofx", "csv-pnc")
	Name() string

	// CanParse checks if parser can handle this file
	// Returns true if this parser should be used for the file
	CanParse(path string, header []byte) bool

	// Parse extracts raw data from file
	Parse(ctx context.Context, r io.Reader, meta Metadata) (*RawStatement, error)
}

// RawStatement represents parsed data before normalization
type RawStatement struct {
	Account      RawAccount
	Period       Period
	Transactions []RawTransaction
}

// RawAccount represents account information from the file
type RawAccount struct {
	InstitutionID   string // e.g., "AMEX", "C1", "PNC"
	InstitutionName string // e.g., "American Express"
	AccountID       string // From file or directory
	AccountType     string // "checking", "savings", "credit", "investment"
}

// Period represents the statement period
type Period struct {
	Start time.Time
	End   time.Time
}

// RawTransaction represents a transaction before normalization
type RawTransaction struct {
	ID          string    // FITID from OFX or generated for CSV
	Date        time.Time
	PostedDate  time.Time // May differ from transaction date
	Description string
	Amount      float64 // Negative = expense, Positive = income
	Type        string  // "DEBIT", "CREDIT", etc.
	Memo        string  // Additional context
}
