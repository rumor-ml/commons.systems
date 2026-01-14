// Package domain defines the core financial data structures and their validation rules.
//
// # Transaction Amount Sign Convention
//
// ALL parsers MUST follow this sign convention for transaction amounts:
//   - Positive amounts = income/inflow (credit card payments, bank deposits, paychecks)
//   - Negative amounts = expense/outflow (credit card charges, bank withdrawals, purchases)
//
// This convention applies regardless of how the source file represents amounts.
// Parsers are responsible for normalizing to this standard during import.
//
// Examples:
//   - Bank account deposit of $1000 -> +1000.00
//   - Credit card charge of $50 -> -50.00
//   - Credit card payment of $200 -> +200.00 (inflow to credit account)
//   - Bank withdrawal of $100 -> -100.00
//
// Rationale: This convention aligns with accounting principles where credits
// (inflows) are positive and debits (outflows) are negative, making the data
// easier to analyze and aggregate across different account types.
package domain

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// ErrAlreadyExists is a sentinel error for duplicate entity detection
var ErrAlreadyExists = errors.New("already exists")

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
// TODO(#1437): Consider refactoring to state machine with TransactionType enum to make redeemable/transfer mutual exclusivity more explicit
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
	redeemable          bool     `json:"redeemable"`
	vacation            bool     `json:"vacation"`
	transfer            bool     `json:"transfer"`
	redemptionRate      float64  `json:"redemptionRate"`
	LinkedTransactionID *string  `json:"linkedTransactionId,omitempty"`
	statementIDs        []string
}

// Statement matches TypeScript Statement interface.
// After construction, Statement should be treated as immutable.
// Modifying StartDate or EndDate fields directly may violate invariants.
// Use Validate() method to re-check invariants if needed.
// TODO(#1438): Make StartDate and EndDate private with getters to enforce true immutability
type Statement struct {
	ID             string `json:"id"`
	AccountID      string `json:"accountId"`
	StartDate      string `json:"startDate"` // YYYY-MM-DD (immutable)
	EndDate        string `json:"endDate"`   // YYYY-MM-DD (immutable)
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
// TODO(#1439): Add atomic multi-entity operations like AddAccountWithStatements to prevent partial failures
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
			return fmt.Errorf("institution %s: %w", inst.ID, ErrAlreadyExists)
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
		return fmt.Errorf("account %s: %w", acc.ID, ErrAlreadyExists)
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
		Institutions: append([]Institution(nil), b.institutions...),
		Accounts:     append([]Account(nil), b.accounts...),
		Statements:   append([]Statement(nil), b.statements...),
		Transactions: append([]Transaction(nil), b.transactions...),
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

	// Validate referential integrity
	instIDs := make(map[string]bool)
	for _, inst := range aux.Institutions {
		if inst.ID == "" || inst.Name == "" {
			return fmt.Errorf("invalid institution: ID and Name are required")
		}
		instIDs[inst.ID] = true
	}

	accIDs := make(map[string]bool)
	for _, acc := range aux.Accounts {
		if acc.ID == "" || acc.InstitutionID == "" || acc.Name == "" {
			return fmt.Errorf("invalid account: ID, InstitutionID, and Name are required")
		}
		if !instIDs[acc.InstitutionID] {
			return fmt.Errorf("account %s references non-existent institution %s", acc.ID, acc.InstitutionID)
		}
		accIDs[acc.ID] = true
	}

	for _, stmt := range aux.Statements {
		if stmt.ID == "" || stmt.AccountID == "" {
			return fmt.Errorf("invalid statement: ID and AccountID are required")
		}
		if !accIDs[stmt.AccountID] {
			return fmt.Errorf("statement %s references non-existent account %s", stmt.ID, stmt.AccountID)
		}
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

	txn := &Transaction{
		ID:           id,
		Date:         date,
		Description:  description,
		Amount:       amount,
		Category:     category,
		statementIDs: []string{}, // Empty slice for JSON serialization
	}

	// Set default: not redeemable with 0 rate
	if err := txn.SetRedeemable(false, 0.0); err != nil {
		return nil, err // Should never happen with these defaults
	}

	return txn, nil
}

// SetRedeemable sets both the Redeemable flag and RedemptionRate together
// to maintain consistency. If redeemable is true, rate must be > 0.
// If redeemable is false, rate must be 0.
// Returns error if attempting to set redeemable=true on a transfer transaction
// (transfers should not earn cashback).
func (t *Transaction) SetRedeemable(redeemable bool, rate float64) error {
	if rate < 0 || rate > 1 {
		return fmt.Errorf("redemption rate must be in [0,1], got %f", rate)
	}
	if redeemable && rate == 0 {
		return fmt.Errorf("redeemable transaction must have non-zero redemption rate")
	}
	if !redeemable && rate != 0 {
		return fmt.Errorf("non-redeemable transaction must have zero redemption rate")
	}
	if redeemable && t.transfer {
		return fmt.Errorf("cannot set redeemable=true when transaction is a transfer (transfers should not earn cashback)")
	}
	t.redeemable = redeemable
	t.redemptionRate = rate
	return nil
}

// Redeemable returns whether the transaction is redeemable
func (t *Transaction) Redeemable() bool {
	return t.redeemable
}

// RedemptionRate returns the redemption rate for the transaction
func (t *Transaction) RedemptionRate() float64 {
	return t.redemptionRate
}

// Vacation returns whether the transaction is a vacation expense
func (t *Transaction) Vacation() bool {
	return t.vacation
}

// SetVacation sets the vacation flag
func (t *Transaction) SetVacation(vacation bool) {
	t.vacation = vacation
}

// Transfer returns whether the transaction is a transfer between accounts
func (t *Transaction) Transfer() bool {
	return t.transfer
}

// SetTransfer sets the transfer flag.
// Returns error if attempting to set transfer=true on a redeemable transaction
// (transfers should not earn cashback).
func (t *Transaction) SetTransfer(transfer bool) error {
	if transfer && t.redeemable {
		return fmt.Errorf("cannot set transfer=true when transaction is redeemable (transfers should not earn cashback)")
	}
	t.transfer = transfer
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

// MarshalJSON implements custom JSON marshaling for Transaction
func (t *Transaction) MarshalJSON() ([]byte, error) {
	// Create defensive copy for marshaling
	statementIDsCopy := make([]string, len(t.statementIDs))
	copy(statementIDsCopy, t.statementIDs)

	return json.Marshal(&struct {
		ID                  string   `json:"id"`
		Date                string   `json:"date"`
		Description         string   `json:"description"`
		Amount              float64  `json:"amount"`
		Category            Category `json:"category"`
		Redeemable          bool     `json:"redeemable"`
		Vacation            bool     `json:"vacation"`
		Transfer            bool     `json:"transfer"`
		RedemptionRate      float64  `json:"redemptionRate"`
		LinkedTransactionID *string  `json:"linkedTransactionId,omitempty"`
		StatementIDs        []string `json:"statementIds"`
	}{
		ID:                  t.ID,
		Date:                t.Date,
		Description:         t.Description,
		Amount:              t.Amount,
		Category:            t.Category,
		Redeemable:          t.redeemable,
		Vacation:            t.vacation,
		Transfer:            t.transfer,
		RedemptionRate:      t.redemptionRate,
		LinkedTransactionID: t.LinkedTransactionID,
		StatementIDs:        statementIDsCopy,
	})
}

// UnmarshalJSON implements custom JSON unmarshaling for Transaction
func (t *Transaction) UnmarshalJSON(data []byte) error {
	// Use temporary struct with exported fields for JSON unmarshaling
	aux := &struct {
		ID                  string   `json:"id"`
		Date                string   `json:"date"`
		Description         string   `json:"description"`
		Amount              float64  `json:"amount"`
		Category            Category `json:"category"`
		Redeemable          bool     `json:"redeemable"`
		Vacation            bool     `json:"vacation"`
		Transfer            bool     `json:"transfer"`
		RedemptionRate      float64  `json:"redemptionRate"`
		LinkedTransactionID *string  `json:"linkedTransactionId,omitempty"`
		StatementIDs        []string `json:"statementIds"`
	}{}

	if err := json.Unmarshal(data, aux); err != nil {
		return err
	}

	// Copy to struct fields
	t.ID = aux.ID
	t.Date = aux.Date
	t.Description = aux.Description
	t.Amount = aux.Amount
	t.Category = aux.Category
	t.vacation = aux.Vacation
	t.transfer = aux.Transfer
	t.LinkedTransactionID = aux.LinkedTransactionID
	t.statementIDs = aux.StatementIDs

	// Validate redemption rate bounds
	if aux.RedemptionRate < 0 || aux.RedemptionRate > 1 {
		return fmt.Errorf("redemption rate must be in [0,1], got %f", aux.RedemptionRate)
	}

	// Validate consistency between Redeemable and RedemptionRate
	if aux.Redeemable && aux.RedemptionRate == 0 {
		return fmt.Errorf("redeemable transaction must have non-zero redemption rate")
	}
	if !aux.Redeemable && aux.RedemptionRate != 0 {
		return fmt.Errorf("non-redeemable transaction must have zero redemption rate")
	}

	// Only assign private fields after validation
	t.redeemable = aux.Redeemable
	t.redemptionRate = aux.RedemptionRate

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

	if end.Before(start) {
		return nil, fmt.Errorf("end date %s cannot be before start date %s", endDate, startDate)
	}

	return &Statement{
		ID:             id,
		AccountID:      accountID,
		StartDate:      startDate,
		EndDate:        endDate,
		transactionIDs: []string{}, // Empty slice for JSON serialization
	}, nil
}

// Validate checks that the statement's invariants hold
func (s *Statement) Validate() error {
	if s.ID == "" {
		return fmt.Errorf("statement ID cannot be empty")
	}
	if s.AccountID == "" {
		return fmt.Errorf("account ID cannot be empty")
	}

	start, err := time.Parse("2006-01-02", s.StartDate)
	if err != nil {
		return fmt.Errorf("invalid start date: %w", err)
	}

	end, err := time.Parse("2006-01-02", s.EndDate)
	if err != nil {
		return fmt.Errorf("invalid end date: %w", err)
	}

	if end.Before(start) {
		return fmt.Errorf("end date %s cannot be before start date %s", s.EndDate, s.StartDate)
	}

	return nil
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

// MarshalJSON implements custom JSON marshaling for Statement
func (s *Statement) MarshalJSON() ([]byte, error) {
	type Alias Statement
	// Create defensive copy for marshaling
	transactionIDsCopy := make([]string, len(s.transactionIDs))
	copy(transactionIDsCopy, s.transactionIDs)

	return json.Marshal(&struct {
		*Alias
		TransactionIDs []string `json:"transactionIds"`
	}{
		Alias:          (*Alias)(s),
		TransactionIDs: transactionIDsCopy,
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
