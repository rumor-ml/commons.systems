package domain

import (
	"fmt"
	"time"
)

// Category represents the budget category enum (12 standard categories from TypeScript schema).
// Use ValidateCategory to ensure validity before use.
type Category string

const (
	CategoryIncome         Category = "income"
	CategoryHousing        Category = "housing"
	CategoryUtilities      Category = "utilities"
	CategoryGroceries      Category = "groceries"
	CategoryDining         Category = "dining"
	CategoryTransportation Category = "transportation"
	CategoryHealthcare     Category = "healthcare"
	CategoryEntertainment  Category = "entertainment"
	CategoryShopping       Category = "shopping"
	CategoryTravel         Category = "travel"
	CategoryInvestment     Category = "investment"
	CategoryOther          Category = "other"
)

// AccountType represents the account type enum.
// Use ValidateAccountType to ensure validity before use.
type AccountType string

const (
	AccountTypeChecking   AccountType = "checking"
	AccountTypeSavings    AccountType = "savings"
	AccountTypeCredit     AccountType = "credit"
	AccountTypeInvestment AccountType = "investment"
)

// Transaction matches TypeScript Transaction interface
type Transaction struct {
	ID                  string   `json:"id"`
	Date                string   `json:"date"` // ISO format YYYY-MM-DD
	Description         string   `json:"description"`
	Amount              float64  `json:"amount"` // Sign convention: Positive=income, Negative=expense (matches TypeScript schema)
	Category            Category `json:"category"`
	Redeemable          bool     `json:"redeemable"`
	Vacation            bool     `json:"vacation"`
	Transfer            bool     `json:"transfer"`
	RedemptionRate      float64  `json:"redemptionRate"`
	LinkedTransactionID *string  `json:"linkedTransactionId,omitempty"`
	StatementIDs        []string `json:"statementIds"`
}

// Statement matches TypeScript Statement interface
type Statement struct {
	ID             string   `json:"id"`
	AccountID      string   `json:"accountId"`
	StartDate      string   `json:"startDate"` // YYYY-MM-DD
	EndDate        string   `json:"endDate"`   // YYYY-MM-DD
	TransactionIDs []string `json:"transactionIds"`
}

// Account matches TypeScript Account interface
type Account struct {
	ID            string      `json:"id"`
	InstitutionID string      `json:"institutionId"`
	Name          string      `json:"name"`
	Type          AccountType `json:"type"`
}

// Institution matches TypeScript Institution interface
type Institution struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Budget is the root output structure (full JSON file)
// TODO(#1273): Add validation for referential integrity between collections
type Budget struct {
	Institutions []Institution `json:"institutions"`
	Accounts     []Account     `json:"accounts"`
	Statements   []Statement   `json:"statements"`
	Transactions []Transaction `json:"transactions"`
}

// NewTransaction creates a validated transaction
func NewTransaction(id, date, description string, amount float64, category Category) (*Transaction, error) {
	if id == "" {
		return nil, fmt.Errorf("transaction ID cannot be empty")
	}
	if _, err := time.Parse("2006-01-02", date); err != nil {
		return nil, fmt.Errorf("invalid date format: %w", err)
	}
	if description == "" {
		return nil, fmt.Errorf("description cannot be empty")
	}
	if !ValidateCategory(category) {
		return nil, fmt.Errorf("invalid category: %s", category)
	}

	return &Transaction{
		ID:             id,
		Date:           date,
		Description:    description,
		Amount:         amount,
		Category:       category,
		StatementIDs:   []string{}, // Initialize to empty slice, not nil, to match TypeScript schema expectation ([] vs null in JSON)
		RedemptionRate: 0.0,
	}, nil
}

// SetRedemptionRate validates and sets the redemption rate
func (t *Transaction) SetRedemptionRate(rate float64) error {
	if rate < 0 || rate > 1 {
		return fmt.Errorf("redemption rate must be in [0,1], got %f", rate)
	}
	t.RedemptionRate = rate
	return nil
}

// NewStatement creates a validated statement
func NewStatement(id, accountID, startDate, endDate string) (*Statement, error) {
	if id == "" {
		return nil, fmt.Errorf("statement ID cannot be empty")
	}
	if accountID == "" {
		return nil, fmt.Errorf("account ID cannot be empty")
	}

	start, err := time.Parse("2006-01-02", startDate)
	if err != nil {
		return nil, fmt.Errorf("invalid start date: %w", err)
	}

	end, err := time.Parse("2006-01-02", endDate)
	if err != nil {
		return nil, fmt.Errorf("invalid end date: %w", err)
	}

	if !start.Before(end) {
		return nil, fmt.Errorf("start date must be before end date")
	}

	return &Statement{
		ID:             id,
		AccountID:      accountID,
		StartDate:      startDate,
		EndDate:        endDate,
		TransactionIDs: []string{}, // Initialize to empty slice, not nil, to match TypeScript schema expectation ([] vs null in JSON)
	}, nil
}

// NewAccount creates a validated account
func NewAccount(id, institutionID, name string, accountType AccountType) (*Account, error) {
	if id == "" {
		return nil, fmt.Errorf("account ID cannot be empty")
	}
	if institutionID == "" {
		return nil, fmt.Errorf("institution ID cannot be empty")
	}
	if name == "" {
		return nil, fmt.Errorf("account name cannot be empty")
	}
	if !ValidateAccountType(accountType) {
		return nil, fmt.Errorf("invalid account type: %s", accountType)
	}

	return &Account{
		ID:            id,
		InstitutionID: institutionID,
		Name:          name,
		Type:          accountType,
	}, nil
}

// NewInstitution creates a validated institution
func NewInstitution(id, name string) (*Institution, error) {
	if id == "" {
		return nil, fmt.Errorf("institution ID cannot be empty")
	}
	if name == "" {
		return nil, fmt.Errorf("institution name cannot be empty")
	}

	return &Institution{
		ID:   id,
		Name: name,
	}, nil
}

// ValidateCategory checks if category is valid
func ValidateCategory(c Category) bool {
	switch c {
	case CategoryIncome, CategoryHousing, CategoryUtilities,
		CategoryGroceries, CategoryDining, CategoryTransportation,
		CategoryHealthcare, CategoryEntertainment, CategoryShopping,
		CategoryTravel, CategoryInvestment, CategoryOther:
		return true
	default:
		return false
	}
}

// ValidateAccountType checks if account type is valid
func ValidateAccountType(t AccountType) bool {
	switch t {
	case AccountTypeChecking, AccountTypeSavings, AccountTypeCredit, AccountTypeInvestment:
		return true
	default:
		return false
	}
}
