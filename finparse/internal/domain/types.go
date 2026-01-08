package domain

import (
	"encoding/json"
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

var (
	validCategories = map[Category]struct{}{
		CategoryIncome: {}, CategoryHousing: {}, CategoryUtilities: {},
		CategoryGroceries: {}, CategoryDining: {}, CategoryTransportation: {},
		CategoryHealthcare: {}, CategoryEntertainment: {}, CategoryShopping: {},
		CategoryTravel: {}, CategoryInvestment: {}, CategoryOther: {},
	}

	validAccountTypes = map[AccountType]struct{}{
		AccountTypeChecking: {}, AccountTypeSavings: {},
		AccountTypeCredit: {}, AccountTypeInvestment: {},
	}
)

// Transaction matches TypeScript Transaction interface
type Transaction struct {
	ID          string `json:"id"`
	Date        string `json:"date"` // ISO format YYYY-MM-DD
	Description string `json:"description"`
	// Sign convention:
	//   Positive = income/inflow (credit card payments, bank deposits)
	//   Negative = expense/outflow (credit card charges, bank withdrawals)
	// Parsers must normalize to this convention regardless of source file representation.
	Amount              float64  `json:"amount"`
	Category            Category `json:"category"`
	Redeemable          bool     `json:"redeemable"`
	Vacation            bool     `json:"vacation"`
	Transfer            bool     `json:"transfer"`
	RedemptionRate      float64  `json:"redemptionRate"`
	LinkedTransactionID *string  `json:"linkedTransactionId,omitempty"`
	statementIDs        []string
}

// Statement matches TypeScript Statement interface
type Statement struct {
	ID             string `json:"id"`
	AccountID      string `json:"accountId"`
	StartDate      string `json:"startDate"` // YYYY-MM-DD
	EndDate        string `json:"endDate"`   // YYYY-MM-DD
	transactionIDs []string
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
	institutions []Institution
	accounts     []Account
	statements   []Statement
	transactions []Transaction
}

// NewBudget creates an empty budget with initialized slices
func NewBudget() *Budget {
	return &Budget{
		institutions: []Institution{},
		accounts:     []Account{},
		statements:   []Statement{},
		transactions: []Transaction{},
	}
}

// Helper methods for existence checks
func (b *Budget) hasInstitution(id string) bool {
	for _, inst := range b.institutions {
		if inst.ID == id {
			return true
		}
	}
	return false
}

func (b *Budget) hasAccount(id string) bool {
	for _, acc := range b.accounts {
		if acc.ID == id {
			return true
		}
	}
	return false
}

// AddInstitution adds a validated institution, checking for duplicate IDs
func (b *Budget) AddInstitution(inst Institution) error {
	if inst.ID == "" || inst.Name == "" {
		return fmt.Errorf("invalid institution: ID and Name are required")
	}
	for _, existing := range b.institutions {
		if existing.ID == inst.ID {
			return fmt.Errorf("institution %s already exists", inst.ID)
		}
	}
	b.institutions = append(b.institutions, inst)
	return nil
}

// AddAccount adds a validated account, checking for duplicate IDs and valid institution reference
func (b *Budget) AddAccount(acc Account) error {
	if acc.ID == "" || acc.InstitutionID == "" || acc.Name == "" {
		return fmt.Errorf("invalid account: ID, InstitutionID, and Name are required")
	}

	if !b.hasInstitution(acc.InstitutionID) {
		return fmt.Errorf("institution %s not found", acc.InstitutionID)
	}

	if b.hasAccount(acc.ID) {
		return fmt.Errorf("account %s already exists", acc.ID)
	}

	b.accounts = append(b.accounts, acc)
	return nil
}

// AddStatement adds a validated statement, checking for duplicate IDs and valid account reference
func (b *Budget) AddStatement(stmt Statement) error {
	if stmt.ID == "" || stmt.AccountID == "" {
		return fmt.Errorf("invalid statement: ID and AccountID are required")
	}

	if !b.hasAccount(stmt.AccountID) {
		return fmt.Errorf("account %s not found", stmt.AccountID)
	}

	// Check for duplicates
	for _, existing := range b.statements {
		if existing.ID == stmt.ID {
			return fmt.Errorf("statement %s already exists", stmt.ID)
		}
	}

	b.statements = append(b.statements, stmt)
	return nil
}

// AddTransaction adds a validated transaction, checking for duplicate IDs
func (b *Budget) AddTransaction(txn Transaction) error {
	if txn.ID == "" {
		return fmt.Errorf("invalid transaction: ID is required")
	}

	// Check for duplicates
	for _, existing := range b.transactions {
		if existing.ID == txn.ID {
			return fmt.Errorf("transaction %s already exists", txn.ID)
		}
	}

	b.transactions = append(b.transactions, txn)
	return nil
}

// GetInstitutions returns a defensive copy of the institutions slice
func (b *Budget) GetInstitutions() []Institution {
	return append([]Institution(nil), b.institutions...)
}

// GetAccounts returns a defensive copy of the accounts slice
func (b *Budget) GetAccounts() []Account {
	return append([]Account(nil), b.accounts...)
}

// GetStatements returns a defensive copy of the statements slice
func (b *Budget) GetStatements() []Statement {
	return append([]Statement(nil), b.statements...)
}

// GetTransactions returns a defensive copy of the transactions slice
func (b *Budget) GetTransactions() []Transaction {
	return append([]Transaction(nil), b.transactions...)
}

// MarshalJSON implements custom JSON marshaling for Budget
func (b *Budget) MarshalJSON() ([]byte, error) {
	return json.Marshal(&struct {
		Institutions []Institution `json:"institutions"`
		Accounts     []Account     `json:"accounts"`
		Statements   []Statement   `json:"statements"`
		Transactions []Transaction `json:"transactions"`
	}{
		Institutions: b.institutions,
		Accounts:     b.accounts,
		Statements:   b.statements,
		Transactions: b.transactions,
	})
}

// UnmarshalJSON implements custom JSON unmarshaling for Budget
func (b *Budget) UnmarshalJSON(data []byte) error {
	aux := &struct {
		Institutions []Institution `json:"institutions"`
		Accounts     []Account     `json:"accounts"`
		Statements   []Statement   `json:"statements"`
		Transactions []Transaction `json:"transactions"`
	}{}
	if err := json.Unmarshal(data, aux); err != nil {
		return err
	}
	b.institutions = aux.Institutions
	b.accounts = aux.Accounts
	b.statements = aux.Statements
	b.transactions = aux.Transactions
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
		statementIDs:   []string{}, // Empty slice for JSON serialization
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
	t.statementIDs = append(t.statementIDs, id)
	return nil
}

// GetStatementIDs returns a defensive copy of the statement IDs slice
func (t *Transaction) GetStatementIDs() []string {
	if t.statementIDs == nil {
		return nil
	}
	result := make([]string, len(t.statementIDs))
	copy(result, t.statementIDs)
	return result
}

// CopyStatementIDs returns a copy of the statement IDs slice
// Deprecated: Use GetStatementIDs instead
func (t *Transaction) CopyStatementIDs() []string {
	return append([]string(nil), t.statementIDs...)
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

// MarshalJSON implements custom JSON marshaling for Transaction
func (t *Transaction) MarshalJSON() ([]byte, error) {
	type Alias Transaction
	return json.Marshal(&struct {
		*Alias
		StatementIDs []string `json:"statementIds"`
	}{
		Alias:        (*Alias)(t),
		StatementIDs: t.statementIDs,
	})
}

// UnmarshalJSON implements custom JSON unmarshaling for Transaction
func (t *Transaction) UnmarshalJSON(data []byte) error {
	type Alias Transaction
	aux := &struct {
		*Alias
		StatementIDs []string `json:"statementIds"`
	}{
		Alias: (*Alias)(t),
	}
	if err := json.Unmarshal(data, aux); err != nil {
		return err
	}
	t.statementIDs = aux.StatementIDs
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
		transactionIDs: []string{}, // Empty slice for JSON serialization
	}, nil
}

// AddTransactionID adds a transaction ID with validation
func (s *Statement) AddTransactionID(id string) error {
	if id == "" {
		return fmt.Errorf("transaction ID cannot be empty")
	}
	s.transactionIDs = append(s.transactionIDs, id)
	return nil
}

// GetTransactionIDs returns a defensive copy of the transaction IDs slice
func (s *Statement) GetTransactionIDs() []string {
	if s.transactionIDs == nil {
		return nil
	}
	result := make([]string, len(s.transactionIDs))
	copy(result, s.transactionIDs)
	return result
}

// CopyTransactionIDs returns a copy of the transaction IDs slice
// Deprecated: Use GetTransactionIDs instead
func (s *Statement) CopyTransactionIDs() []string {
	return append([]string(nil), s.transactionIDs...)
}

// MarshalJSON implements custom JSON marshaling for Statement
func (s *Statement) MarshalJSON() ([]byte, error) {
	type Alias Statement
	return json.Marshal(&struct {
		*Alias
		TransactionIDs []string `json:"transactionIds"`
	}{
		Alias:          (*Alias)(s),
		TransactionIDs: s.transactionIDs,
	})
}

// UnmarshalJSON implements custom JSON unmarshaling for Statement
func (s *Statement) UnmarshalJSON(data []byte) error {
	type Alias Statement
	aux := &struct {
		*Alias
		TransactionIDs []string `json:"transactionIds"`
	}{
		Alias: (*Alias)(s),
	}
	if err := json.Unmarshal(data, aux); err != nil {
		return err
	}
	s.transactionIDs = aux.TransactionIDs
	return nil
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
	_, ok := validCategories[c]
	return ok
}

// ValidateAccountType checks if account type is valid
func ValidateAccountType(t AccountType) bool {
	_, ok := validAccountTypes[t]
	return ok
}
