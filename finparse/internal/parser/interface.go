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
	// TODO: Add behavioral tests for Parse() method contract (context cancellation, IO errors, metadata propagation)
	Parse(ctx context.Context, r io.Reader, meta *Metadata) (*RawStatement, error)
}

// TODO(Phase 2): Consider making Transactions slice immutable with controlled access methods
// if normalization layer needs to prevent external modification of parser results.
// Current design exposes mutable []RawTransaction which allows external modification.
// Trade-off: Simplicity vs. encapsulation. Working set is small (parser→normalization).
// Review during Phase 2 normalization if you observe: (1) accidental mutations causing bugs,
// (2) need to cache/share RawStatement across goroutines, or (3) validation requirements
// that are bypassed by direct slice access.
//
// RawStatement represents parsed data before normalization
// TODO(#1307): Consider hiding Transactions behind accessor methods to prevent external mutation
type RawStatement struct {
	Account      RawAccount
	Period       Period
	Transactions []RawTransaction
}

// RawAccount represents account information from the file
type RawAccount struct {
	institutionID   string // e.g., "AMEX", "C1", "PNC"
	institutionName string // e.g., "American Express"
	accountID       string // From file or directory
	accountType     string // "checking", "savings", "credit", "investment"
}

// InstitutionID returns the institution identifier
func (r *RawAccount) InstitutionID() string { return r.institutionID }

// InstitutionName returns the institution name
func (r *RawAccount) InstitutionName() string { return r.institutionName }

// AccountID returns the account identifier
func (r *RawAccount) AccountID() string { return r.accountID }

// AccountType returns the account type
func (r *RawAccount) AccountType() string { return r.accountType }

// SetInstitutionName updates the institution name from metadata after construction.
// Empty names are allowed when metadata is unavailable.
// TODO(#1308): Consider alternative patterns that avoid post-construction mutation
// Options: (1) Builder pattern for two-phase initialization, (2) Pass metadata to constructor,
// (3) Accept that post-construction mutation is acceptable for the parser phase since
// usage is controlled and limited to parser→normalization flow.
func (r *RawAccount) SetInstitutionName(name string) {
	r.institutionName = name
}

// NewRawAccount creates a validated raw account
func NewRawAccount(institutionID, institutionName, accountID, accountType string) (*RawAccount, error) {
	if institutionID == "" {
		return nil, fmt.Errorf("institution ID cannot be empty")
	}
	if accountID == "" {
		return nil, fmt.Errorf("account ID cannot be empty")
	}
	// Note: InstitutionName is optional at construction. Parser implementations should leave
	// this empty - it will be populated during normalization from Metadata.Institution().
	// TODO: Add normalization validation to ensure InstitutionName is populated from metadata
	// TODO(#1313): Validate AccountType during normalization against domain.AccountType enum

	return &RawAccount{
		institutionID:   institutionID,
		institutionName: institutionName,
		accountID:       accountID,
		accountType:     accountType,
	}, nil
}

// Period represents the statement period
type Period struct {
	start time.Time
	end   time.Time
}

// Start returns the period start time
func (p *Period) Start() time.Time { return p.start }

// End returns the period end time
func (p *Period) End() time.Time { return p.end }

// Duration returns the length of the period
func (p *Period) Duration() time.Duration {
	return p.end.Sub(p.start)
}

// Contains returns true if the given time falls within the period (inclusive)
func (p *Period) Contains(t time.Time) bool {
	return !t.Before(p.start) && !t.After(p.end)
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
		start: start,
		end:   end,
	}, nil
}

// RawTransaction represents a transaction before normalization
type RawTransaction struct {
	id          string // FITID from OFX or generated for CSV
	date        time.Time
	postedDate  time.Time // May differ from transaction date
	description string
	amount      float64 // Positive=income, Negative=expense
	txnType     string  // "DEBIT", "CREDIT", etc.
	memo        string  // Additional context
}

// ID returns the transaction ID
func (r *RawTransaction) ID() string { return r.id }

// Date returns the transaction date
func (r *RawTransaction) Date() time.Time { return r.date }

// PostedDate returns the posted date
func (r *RawTransaction) PostedDate() time.Time { return r.postedDate }

// Description returns the transaction description
func (r *RawTransaction) Description() string { return r.description }

// Amount returns the transaction amount
func (r *RawTransaction) Amount() float64 { return r.amount }

// Type returns the transaction type
func (r *RawTransaction) Type() string { return r.txnType }

// Memo returns the transaction memo
func (r *RawTransaction) Memo() string { return r.memo }

// SetType sets the optional transaction type.
// Example values from OFX/QFX: "DEBIT", "CREDIT", "ATM", "CHECK", "TRANSFER", "FEE", "POS", "PAYMENT".
// CSV formats may use different values depending on the institution.
// Type is free-form and not validated - normalization will handle type mapping.
// TODO(#1309): Consider single-phase construction or builder pattern to avoid mutation
// Current two-phase pattern (construct required fields, then set optional fields) is
// acceptable for parser phase. Type validation should happen in normalization, not here.
// Revisit if this becomes a source of bugs or if we need immutability guarantees.
func (r *RawTransaction) SetType(txnType string) {
	r.txnType = txnType
}

// SetMemo sets the optional memo field
func (r *RawTransaction) SetMemo(memo string) {
	r.memo = memo
}

// NewRawTransaction creates a validated raw transaction
func NewRawTransaction(id string, date, postedDate time.Time, description string, amount float64) (*RawTransaction, error) {
	if id == "" {
		return nil, fmt.Errorf("transaction ID cannot be empty")
	}
	if date.IsZero() {
		return nil, fmt.Errorf("transaction date cannot be zero")
	}
	// TODO: Consider making the fallback explicit via validation mode, warning, or logging
	// TODO(#1318): Consider logging when fallback is used or making it explicit in return value
	// This is intentionally deferred until logging infrastructure exists to avoid stderr spam.
	// The fallback (posted = transaction date) is reasonable for most OFX files but users
	// should eventually have visibility into when it occurs.
	if postedDate.IsZero() {
		postedDate = date // If postedDate is zero, use transaction date as fallback
	}
	if description == "" {
		return nil, fmt.Errorf("description cannot be empty")
	}

	return &RawTransaction{
		id:          id,
		date:        date,
		postedDate:  postedDate,
		description: description,
		amount:      amount,
	}, nil
}
