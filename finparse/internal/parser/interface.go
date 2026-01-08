package parser

import (
	"context"
	"fmt"
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

// NewRawAccount creates a validated raw account
func NewRawAccount(institutionID, institutionName, accountID, accountType string) (*RawAccount, error) {
	if institutionID == "" {
		return nil, fmt.Errorf("institution ID cannot be empty")
	}
	if accountID == "" {
		return nil, fmt.Errorf("account ID cannot be empty")
	}
	// Note: InstitutionName can be empty (will be filled from metadata)
	// AccountType validation will happen during normalization to domain.AccountType

	return &RawAccount{
		InstitutionID:   institutionID,
		InstitutionName: institutionName,
		AccountID:       accountID,
		AccountType:     accountType,
	}, nil
}

// Period represents the statement period
type Period struct {
	Start time.Time
	End   time.Time
}

// NewPeriod creates a validated period
func NewPeriod(start, end time.Time) (*Period, error) {
	if start.IsZero() {
		return nil, fmt.Errorf("start time cannot be zero")
	}
	if end.IsZero() {
		return nil, fmt.Errorf("end time cannot be zero")
	}
	if !start.Before(end) {
		return nil, fmt.Errorf("start must be before end")
	}

	return &Period{
		Start: start,
		End:   end,
	}, nil
}

// RawTransaction represents a transaction before normalization
type RawTransaction struct {
	ID          string // FITID from OFX or generated for CSV
	Date        time.Time
	PostedDate  time.Time // May differ from transaction date
	Description string
	Amount      float64 // Positive=income, Negative=expense
	Type        string  // "DEBIT", "CREDIT", etc.
	Memo        string  // Additional context
}

// NewRawTransaction creates a validated raw transaction
func NewRawTransaction(id string, date, postedDate time.Time, description string, amount float64) (*RawTransaction, error) {
	if id == "" {
		return nil, fmt.Errorf("transaction ID cannot be empty")
	}
	if date.IsZero() {
		return nil, fmt.Errorf("transaction date cannot be zero")
	}
	if postedDate.IsZero() {
		postedDate = date // Default to transaction date if not provided
	}
	if description == "" {
		return nil, fmt.Errorf("description cannot be empty")
	}

	return &RawTransaction{
		ID:          id,
		Date:        date,
		PostedDate:  postedDate,
		Description: description,
		Amount:      amount,
	}, nil
}
