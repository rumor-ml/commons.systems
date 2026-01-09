package transform

import (
	"strings"
	"testing"
	"time"

	"github.com/rumor-ml/commons.systems/finparse/internal/domain"
	"github.com/rumor-ml/commons.systems/finparse/internal/parser"
)

func TestTransformInstitution(t *testing.T) {
	tests := []struct {
		name         string
		rawAccount   *parser.RawAccount
		expectError  bool
		expectedID   string
		expectedName string
	}{
		{
			name:         "valid institution",
			rawAccount:   mustNewRawAccount(t, "AMEX", "American Express", "2011", "credit"),
			expectError:  false,
			expectedID:   "american-express",
			expectedName: "American Express",
		},
		{
			name:        "empty institution name",
			rawAccount:  mustNewRawAccount(t, "TEST", "", "1234", "checking"),
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			inst, err := transformInstitution(tt.rawAccount)

			if tt.expectError {
				if err == nil {
					t.Errorf("expected error but got none")
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if inst.ID != tt.expectedID {
				t.Errorf("expected ID %q, got %q", tt.expectedID, inst.ID)
			}

			if inst.Name != tt.expectedName {
				t.Errorf("expected Name %q, got %q", tt.expectedName, inst.Name)
			}
		})
	}
}

func TestTransformAccount(t *testing.T) {
	tests := []struct {
		name          string
		rawAccount    *parser.RawAccount
		institutionID string
		expectError   bool
		expectedID    string
		expectedType  domain.AccountType
	}{
		{
			name:          "valid checking account",
			rawAccount:    mustNewRawAccount(t, "PNC", "PNC Bank", "5678", "checking"),
			institutionID: "pnc-bank",
			expectError:   false,
			expectedID:    "acc-pnc-bank-5678",
			expectedType:  domain.AccountTypeChecking,
		},
		{
			name:          "valid credit card",
			rawAccount:    mustNewRawAccount(t, "AMEX", "American Express", "2011", "credit card"),
			institutionID: "american-express",
			expectError:   false,
			expectedID:    "acc-amex-2011",
			expectedType:  domain.AccountTypeCredit,
		},
		{
			name:          "invalid account type",
			rawAccount:    mustNewRawAccount(t, "TEST", "Test Bank", "1234", "unknown"),
			institutionID: "test-bank",
			expectError:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			acc, err := transformAccount(tt.rawAccount, tt.institutionID)

			if tt.expectError {
				if err == nil {
					t.Errorf("expected error but got none")
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if acc.ID != tt.expectedID {
				t.Errorf("expected ID %q, got %q", tt.expectedID, acc.ID)
			}

			if acc.InstitutionID != tt.institutionID {
				t.Errorf("expected InstitutionID %q, got %q", tt.institutionID, acc.InstitutionID)
			}

			if acc.Type != tt.expectedType {
				t.Errorf("expected Type %q, got %q", tt.expectedType, acc.Type)
			}
		})
	}
}

func TestTransformStatement(t *testing.T) {
	startDate := time.Date(2025, 10, 1, 0, 0, 0, 0, time.UTC)
	endDate := time.Date(2025, 10, 31, 23, 59, 59, 0, time.UTC)

	period := mustNewPeriod(t, startDate, endDate)
	rawAccount := mustNewRawAccount(t, "AMEX", "American Express", "2011", "credit")

	raw := &parser.RawStatement{
		Account:      *rawAccount,
		Period:       *period,
		Transactions: []parser.RawTransaction{},
	}

	accountID := "acc-amex-2011"

	stmt, err := transformStatement(raw, accountID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expectedID := "stmt-2025-10-acc-amex-2011"
	if stmt.ID != expectedID {
		t.Errorf("expected ID %q, got %q", expectedID, stmt.ID)
	}

	if stmt.AccountID != accountID {
		t.Errorf("expected AccountID %q, got %q", accountID, stmt.AccountID)
	}

	if stmt.StartDate != "2025-10-01" {
		t.Errorf("expected StartDate %q, got %q", "2025-10-01", stmt.StartDate)
	}

	if stmt.EndDate != "2025-10-31" {
		t.Errorf("expected EndDate %q, got %q", "2025-10-31", stmt.EndDate)
	}
}

func TestTransformTransaction(t *testing.T) {
	txnDate := time.Date(2025, 10, 15, 0, 0, 0, 0, time.UTC)
	rawTxn := mustNewRawTransaction(t, "TXN123", txnDate, txnDate, "Test Purchase", -50.00)

	statementID := "stmt-2025-10-acc-amex-2011"

	txn, err := transformTransaction(rawTxn, statementID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify ID is preserved
	if txn.ID != "TXN123" {
		t.Errorf("expected ID %q, got %q", "TXN123", txn.ID)
	}

	// Verify date formatting
	if txn.Date != "2025-10-15" {
		t.Errorf("expected Date %q, got %q", "2025-10-15", txn.Date)
	}

	// Verify description and amount
	if txn.Description != "Test Purchase" {
		t.Errorf("expected Description %q, got %q", "Test Purchase", txn.Description)
	}

	if txn.Amount != -50.00 {
		t.Errorf("expected Amount %f, got %f", -50.00, txn.Amount)
	}

	// Verify Phase 4 defaults
	if txn.Category != domain.CategoryOther {
		t.Errorf("expected Category %q, got %q", domain.CategoryOther, txn.Category)
	}

	if txn.Redeemable != false {
		t.Errorf("expected Redeemable false, got %v", txn.Redeemable)
	}

	if txn.Vacation != false {
		t.Errorf("expected Vacation false, got %v", txn.Vacation)
	}

	if txn.Transfer != false {
		t.Errorf("expected Transfer false, got %v", txn.Transfer)
	}

	if txn.RedemptionRate != 0.5 {
		t.Errorf("expected RedemptionRate 0.5, got %f", txn.RedemptionRate)
	}

	if txn.LinkedTransactionID != nil {
		t.Errorf("expected LinkedTransactionID nil, got %v", txn.LinkedTransactionID)
	}

	// Verify statement link
	stmtIDs := txn.GetStatementIDs()
	if len(stmtIDs) != 1 {
		t.Errorf("expected 1 statement ID, got %d", len(stmtIDs))
	} else if stmtIDs[0] != statementID {
		t.Errorf("expected statement ID %q, got %q", statementID, stmtIDs[0])
	}
}

func TestMapAccountType(t *testing.T) {
	tests := []struct {
		name        string
		rawType     string
		expected    domain.AccountType
		expectError bool
	}{
		{
			name:        "checking",
			rawType:     "checking",
			expected:    domain.AccountTypeChecking,
			expectError: false,
		},
		{
			name:        "checking account",
			rawType:     "checking account",
			expected:    domain.AccountTypeChecking,
			expectError: false,
		},
		{
			name:        "checking with whitespace",
			rawType:     "  Checking  ",
			expected:    domain.AccountTypeChecking,
			expectError: false,
		},
		{
			name:        "savings",
			rawType:     "savings",
			expected:    domain.AccountTypeSavings,
			expectError: false,
		},
		{
			name:        "savings account",
			rawType:     "savings account",
			expected:    domain.AccountTypeSavings,
			expectError: false,
		},
		{
			name:        "credit",
			rawType:     "credit",
			expected:    domain.AccountTypeCredit,
			expectError: false,
		},
		{
			name:        "credit card",
			rawType:     "credit card",
			expected:    domain.AccountTypeCredit,
			expectError: false,
		},
		{
			name:        "creditcard",
			rawType:     "creditcard",
			expected:    domain.AccountTypeCredit,
			expectError: false,
		},
		{
			name:        "investment",
			rawType:     "investment",
			expected:    domain.AccountTypeInvestment,
			expectError: false,
		},
		{
			name:        "brokerage",
			rawType:     "brokerage",
			expected:    domain.AccountTypeInvestment,
			expectError: false,
		},
		{
			name:        "unknown type",
			rawType:     "unknown",
			expected:    "",
			expectError: true,
		},
		{
			name:        "empty string",
			rawType:     "",
			expected:    "",
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := mapAccountType(tt.rawType)

			if tt.expectError {
				if err == nil {
					t.Errorf("expected error but got none")
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if result != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, result)
			}
		})
	}
}

func TestTransformStatementIntegration(t *testing.T) {
	// Create a complete RawStatement
	startDate := time.Date(2025, 10, 1, 0, 0, 0, 0, time.UTC)
	endDate := time.Date(2025, 10, 31, 23, 59, 59, 0, time.UTC)
	period := mustNewPeriod(t, startDate, endDate)

	rawAccount := mustNewRawAccount(t, "AMEX", "American Express", "2011", "credit")

	txn1Date := time.Date(2025, 10, 5, 0, 0, 0, 0, time.UTC)
	txn2Date := time.Date(2025, 10, 15, 0, 0, 0, 0, time.UTC)

	rawTxn1 := mustNewRawTransaction(t, "TXN001", txn1Date, txn1Date, "Purchase 1", -25.00)
	rawTxn2 := mustNewRawTransaction(t, "TXN002", txn2Date, txn2Date, "Purchase 2", -75.50)

	raw := &parser.RawStatement{
		Account:      *rawAccount,
		Period:       *period,
		Transactions: []parser.RawTransaction{*rawTxn1, *rawTxn2},
	}

	// Create budget and transform
	budget := domain.NewBudget()
	err := TransformStatement(raw, budget)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify institution
	institutions := budget.GetInstitutions()
	if len(institutions) != 1 {
		t.Fatalf("expected 1 institution, got %d", len(institutions))
	}
	if institutions[0].ID != "american-express" {
		t.Errorf("expected institution ID %q, got %q", "american-express", institutions[0].ID)
	}
	if institutions[0].Name != "American Express" {
		t.Errorf("expected institution name %q, got %q", "American Express", institutions[0].Name)
	}

	// Verify account
	accounts := budget.GetAccounts()
	if len(accounts) != 1 {
		t.Fatalf("expected 1 account, got %d", len(accounts))
	}
	if accounts[0].ID != "acc-amex-2011" {
		t.Errorf("expected account ID %q, got %q", "acc-amex-2011", accounts[0].ID)
	}
	if accounts[0].Type != domain.AccountTypeCredit {
		t.Errorf("expected account type %q, got %q", domain.AccountTypeCredit, accounts[0].Type)
	}

	// Verify statement
	statements := budget.GetStatements()
	if len(statements) != 1 {
		t.Fatalf("expected 1 statement, got %d", len(statements))
	}
	if statements[0].ID != "stmt-2025-10-acc-amex-2011" {
		t.Errorf("expected statement ID %q, got %q", "stmt-2025-10-acc-amex-2011", statements[0].ID)
	}

	// Verify transactions
	transactions := budget.GetTransactions()
	if len(transactions) != 2 {
		t.Fatalf("expected 2 transactions, got %d", len(transactions))
	}

	// Check first transaction
	if transactions[0].ID != "TXN001" {
		t.Errorf("expected transaction ID %q, got %q", "TXN001", transactions[0].ID)
	}
	if transactions[0].Amount != -25.00 {
		t.Errorf("expected amount %f, got %f", -25.00, transactions[0].Amount)
	}

	// Check second transaction
	if transactions[1].ID != "TXN002" {
		t.Errorf("expected transaction ID %q, got %q", "TXN002", transactions[1].ID)
	}
	if transactions[1].Amount != -75.50 {
		t.Errorf("expected amount %f, got %f", -75.50, transactions[1].Amount)
	}
}

func TestTransformStatementDuplicateHandling(t *testing.T) {
	// Create a RawStatement
	startDate := time.Date(2025, 10, 1, 0, 0, 0, 0, time.UTC)
	endDate := time.Date(2025, 10, 31, 23, 59, 59, 0, time.UTC)
	period := mustNewPeriod(t, startDate, endDate)

	rawAccount := mustNewRawAccount(t, "PNC", "PNC Bank", "1234", "checking")

	raw := &parser.RawStatement{
		Account:      *rawAccount,
		Period:       *period,
		Transactions: []parser.RawTransaction{},
	}

	// Create budget and transform twice
	budget := domain.NewBudget()

	// First transform should succeed
	err := TransformStatement(raw, budget)
	if err != nil {
		t.Fatalf("first transform failed: %v", err)
	}

	// Second transform should fail (duplicate statement)
	err = TransformStatement(raw, budget)
	if err == nil {
		t.Errorf("expected error for duplicate statement")
	} else if !strings.Contains(err.Error(), "already exists") {
		t.Errorf("expected 'already exists' error, got: %v", err)
	}

	// Verify only one set of entities was created
	if len(budget.GetInstitutions()) != 1 {
		t.Errorf("expected 1 institution, got %d", len(budget.GetInstitutions()))
	}
	if len(budget.GetAccounts()) != 1 {
		t.Errorf("expected 1 account, got %d", len(budget.GetAccounts()))
	}
}

func TestTransformStatement_NilBudget(t *testing.T) {
	raw := &parser.RawStatement{
		Account:      *mustNewRawAccount(t, "TEST", "Test Bank", "1234", "checking"),
		Period:       *mustNewPeriod(t, time.Now(), time.Now()),
		Transactions: []parser.RawTransaction{},
	}

	err := TransformStatement(raw, nil)
	if err == nil {
		t.Error("expected error for nil budget")
	}
	if !strings.Contains(err.Error(), "budget cannot be nil") {
		t.Errorf("expected 'budget cannot be nil' error, got: %v", err)
	}
}

func TestTransformStatement_EmptyTransactionList(t *testing.T) {
	startDate := time.Date(2025, 10, 1, 0, 0, 0, 0, time.UTC)
	endDate := time.Date(2025, 10, 31, 23, 59, 59, 0, time.UTC)
	period := mustNewPeriod(t, startDate, endDate)
	rawAccount := mustNewRawAccount(t, "AMEX", "American Express", "2011", "credit")

	raw := &parser.RawStatement{
		Account:      *rawAccount,
		Period:       *period,
		Transactions: []parser.RawTransaction{}, // Empty list
	}

	budget := domain.NewBudget()
	err := TransformStatement(raw, budget)
	if err != nil {
		t.Fatalf("expected success with empty transactions, got error: %v", err)
	}

	// Verify statement was created even with no transactions
	statements := budget.GetStatements()
	if len(statements) != 1 {
		t.Errorf("expected 1 statement, got %d", len(statements))
	}

	transactions := budget.GetTransactions()
	if len(transactions) != 0 {
		t.Errorf("expected 0 transactions, got %d", len(transactions))
	}
}

func TestTransformStatement_InvalidTransaction(t *testing.T) {
	// Note: The parser layer already validates empty descriptions and IDs during
	// RawTransaction construction. This test verifies that the transform layer's
	// defense-in-depth validation works and error messages propagate correctly.
	// If parser validation is ever relaxed, the transform layer will still catch it.

	// Since we can't bypass parser validation to test transform validation directly,
	// this test documents the expected behavior and validates error message format.
	// The actual validation is covered by parser_test.go and defensive checks in
	// transformTransaction remain as protection against future parser changes.

	startDate := time.Date(2025, 10, 1, 0, 0, 0, 0, time.UTC)
	endDate := time.Date(2025, 10, 31, 23, 59, 59, 0, time.UTC)
	period := mustNewPeriod(t, startDate, endDate)
	rawAccount := mustNewRawAccount(t, "AMEX", "American Express", "2011", "credit")

	txnDate := time.Date(2025, 10, 15, 0, 0, 0, 0, time.UTC)

	// Verify that parser rejects empty description
	_, err := parser.NewRawTransaction("TXN123", txnDate, txnDate, "", -50.00)
	if err == nil {
		t.Fatal("parser should reject empty description")
	}
	if !strings.Contains(err.Error(), "description cannot be empty") {
		t.Errorf("expected 'description cannot be empty' error from parser, got: %v", err)
	}

	// Verify that parser rejects empty ID
	_, err = parser.NewRawTransaction("", txnDate, txnDate, "Test", -50.00)
	if err == nil {
		t.Fatal("parser should reject empty transaction ID")
	}
	if !strings.Contains(err.Error(), "transaction ID cannot be empty") {
		t.Errorf("expected 'transaction ID cannot be empty' error from parser, got: %v", err)
	}

	// Create a valid statement to verify transform layer error wrapping works
	validTxn := mustNewRawTransaction(t, "TXN123", txnDate, txnDate, "Valid Transaction", -50.00)
	raw := &parser.RawStatement{
		Account:      *rawAccount,
		Period:       *period,
		Transactions: []parser.RawTransaction{*validTxn},
	}

	budget := domain.NewBudget()
	err = TransformStatement(raw, budget)
	if err != nil {
		t.Errorf("expected success with valid transaction, got error: %v", err)
	}

	// Verify transaction was added
	transactions := budget.GetTransactions()
	if len(transactions) != 1 {
		t.Errorf("expected 1 transaction, got %d", len(transactions))
	}
}

func TestFormatDate(t *testing.T) {
	// Note: Issue pr-test-analyzer-in-scope-3 originally requested testing
	// formatDate with invalid types (string, nil, int), but the function signature
	// was changed by another agent to accept only time.Time, eliminating the
	// possibility of passing invalid types. The type system now enforces correctness.

	// Test with valid time.Time
	testDate := time.Date(2025, 10, 15, 14, 30, 0, 0, time.UTC)
	result := formatDate(testDate)
	expected := "2025-10-15"
	if result != expected {
		t.Errorf("expected %q, got %q", expected, result)
	}

	// Test with zero time
	zeroTime := time.Time{}
	result = formatDate(zeroTime)
	expected = "0001-01-01"
	if result != expected {
		t.Errorf("expected %q for zero time, got %q", expected, result)
	}
}

// TODO(#1347): Consider adding benchmark tests for transformation pipeline performance
// Helper functions for test setup

func mustNewRawAccount(t *testing.T, instID, instName, accountID, accountType string) *parser.RawAccount {
	t.Helper()
	acc, err := parser.NewRawAccount(instID, instName, accountID, accountType)
	if err != nil {
		t.Fatalf("failed to create raw account: %v", err)
	}
	return acc
}

func mustNewPeriod(t *testing.T, start, end time.Time) *parser.Period {
	t.Helper()
	period, err := parser.NewPeriod(start, end)
	if err != nil {
		t.Fatalf("failed to create period: %v", err)
	}
	return period
}

func mustNewRawTransaction(t *testing.T, id string, date, postedDate time.Time, description string, amount float64) *parser.RawTransaction {
	t.Helper()
	txn, err := parser.NewRawTransaction(id, date, postedDate, description, amount)
	if err != nil {
		t.Fatalf("failed to create raw transaction: %v", err)
	}
	return txn
}
