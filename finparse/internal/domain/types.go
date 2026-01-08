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
	ID          string  `json:"id"`
	Date        string  `json:"date"` // ISO format YYYY-MM-DD
	Description string  `json:"description"`
	Amount      float64 `json:"amount"` // Sign convention: Positive=income/inflow, Negative=expense/outflow
	// For credit cards: charges are negative (outflow), payments are positive (inflow)
	// For bank accounts: deposits are positive (inflow), withdrawals are negative (outflow)
	// Parsers must normalize to this convention regardless of how the source file represents signs
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
type Budget struct {
	Institutions []Institution `json:"institutions"`
	Accounts     []Account     `json:"accounts"`
	Statements   []Statement   `json:"statements"`
	Transactions []Transaction `json:"transactions"`
}

// NewBudget creates an empty budget with initialized slices
func NewBudget() *Budget {
	return &Budget{
		Institutions: []Institution{},
		Accounts:     []Account{},
		Statements:   []Statement{},
		Transactions: []Transaction{},
	}
}

// AddInstitution adds a validated institution, checking for duplicate IDs
func (b *Budget) AddInstitution(inst Institution) error {
	if inst.ID == "" || inst.Name == "" {
		return fmt.Errorf("invalid institution: ID and Name are required")
	}
	for _, existing := range b.Institutions {
		if existing.ID == inst.ID {
			return fmt.Errorf("institution %s already exists", inst.ID)
		}
	}
	b.Institutions = append(b.Institutions, inst)
	return nil
}

// AddAccount adds a validated account, checking for duplicate IDs and valid institution reference
func (b *Budget) AddAccount(acc Account) error {
	if acc.ID == "" || acc.InstitutionID == "" || acc.Name == "" {
		return fmt.Errorf("invalid account: ID, InstitutionID, and Name are required")
	}

	// Check institution exists
	found := false
	for _, inst := range b.Institutions {
		if inst.ID == acc.InstitutionID {
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("institution %s not found", acc.InstitutionID)
	}

	// Check for duplicates
	for _, existing := range b.Accounts {
		if existing.ID == acc.ID {
			return fmt.Errorf("account %s already exists", acc.ID)
		}
	}

	b.Accounts = append(b.Accounts, acc)
	return nil
}

// AddStatement adds a validated statement, checking for duplicate IDs and valid account reference
func (b *Budget) AddStatement(stmt Statement) error {
	if stmt.ID == "" || stmt.AccountID == "" {
		return fmt.Errorf("invalid statement: ID and AccountID are required")
	}

	// Check account exists
	found := false
	for _, acc := range b.Accounts {
		if acc.ID == stmt.AccountID {
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("account %s not found", stmt.AccountID)
	}

	// Check for duplicates
	for _, existing := range b.Statements {
		if existing.ID == stmt.ID {
			return fmt.Errorf("statement %s already exists", stmt.ID)
		}
	}

	b.Statements = append(b.Statements, stmt)
	return nil
}

// AddTransaction adds a validated transaction, checking for duplicate IDs
func (b *Budget) AddTransaction(txn Transaction) error {
	if txn.ID == "" {
		return fmt.Errorf("invalid transaction: ID is required")
	}

	// Check for duplicates
	for _, existing := range b.Transactions {
		if existing.ID == txn.ID {
			return fmt.Errorf("transaction %s already exists", txn.ID)
		}
	}

	b.Transactions = append(b.Transactions, txn)
	return nil
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
		StatementIDs:   []string{}, // Empty slice for JSON serialization
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

// AddStatementID adds a statement ID with validation
func (t *Transaction) AddStatementID(id string) error {
	if id == "" {
		return fmt.Errorf("statement ID cannot be empty")
	}
	t.StatementIDs = append(t.StatementIDs, id)
	return nil
}

// CopyStatementIDs returns a copy of the statement IDs slice
func (t *Transaction) CopyStatementIDs() []string {
	return append([]string(nil), t.StatementIDs...)
}

// ValidateFlags checks consistency between Redeemable flag and RedemptionRate
func (t *Transaction) ValidateFlags() error {
	if t.Redeemable && t.RedemptionRate == 0.0 {
		return fmt.Errorf("redeemable transaction should have non-zero redemption rate")
	}
	if !t.Redeemable && t.RedemptionRate > 0.0 {
		return fmt.Errorf("transaction with redemption rate should be marked redeemable")
	}
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
		TransactionIDs: []string{}, // Empty slice for JSON serialization
	}, nil
}

// AddTransactionID adds a transaction ID with validation
func (s *Statement) AddTransactionID(id string) error {
	if id == "" {
		return fmt.Errorf("transaction ID cannot be empty")
	}
	s.TransactionIDs = append(s.TransactionIDs, id)
	return nil
}

// CopyTransactionIDs returns a copy of the transaction IDs slice
func (s *Statement) CopyTransactionIDs() []string {
	return append([]string(nil), s.TransactionIDs...)
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
