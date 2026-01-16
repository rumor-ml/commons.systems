package parser

import (
	"strings"
	"testing"
	"time"
)

// TestNewRawAccount_Valid tests successful creation of a raw account
func TestNewRawAccount_Valid(t *testing.T) {
	account, err := NewRawAccount("AMEX", "American Express", "1234", "credit")
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	if account == nil {
		t.Fatal("Expected account to be created")
	}
	if account.InstitutionID() != "AMEX" {
		t.Errorf("Expected InstitutionID 'AMEX', got: %s", account.InstitutionID())
	}
	if account.InstitutionName() != "American Express" {
		t.Errorf("Expected InstitutionName 'American Express', got: %s", account.InstitutionName())
	}
	if account.AccountID() != "1234" {
		t.Errorf("Expected AccountID '1234', got: %s", account.AccountID())
	}
	if account.AccountType() != "credit" {
		t.Errorf("Expected AccountType 'credit', got: %s", account.AccountType())
	}
}

// TestNewRawAccount_EmptyInstitutionID tests validation of empty institution ID
func TestNewRawAccount_EmptyInstitutionID(t *testing.T) {
	account, err := NewRawAccount("", "American Express", "1234", "credit")
	if err == nil {
		t.Error("Expected error for empty institution ID, got nil")
	}
	if account != nil {
		t.Error("Expected nil account for invalid input")
	}
	if err != nil && !strings.Contains(err.Error(), "institution ID cannot be empty") {
		t.Errorf("Expected 'institution ID cannot be empty' error, got: %v", err)
	}
}

// TestNewRawAccount_EmptyAccountID tests validation of empty account ID
func TestNewRawAccount_EmptyAccountID(t *testing.T) {
	account, err := NewRawAccount("AMEX", "American Express", "", "credit")
	if err == nil {
		t.Error("Expected error for empty account ID, got nil")
	}
	if account != nil {
		t.Error("Expected nil account for invalid input")
	}
	if err != nil && !strings.Contains(err.Error(), "account ID cannot be empty") {
		t.Errorf("Expected 'account ID cannot be empty' error, got: %v", err)
	}
}

// TestNewRawAccount_EmptyInstitutionNameAllowed tests that empty institution name is allowed
func TestNewRawAccount_EmptyInstitutionNameAllowed(t *testing.T) {
	account, err := NewRawAccount("AMEX", "", "1234", "credit")
	if err != nil {
		t.Fatalf("Expected no error for empty institution name, got: %v", err)
	}
	if account == nil {
		t.Fatal("Expected account to be created")
	}
	if account.InstitutionName() != "" {
		t.Errorf("Expected empty InstitutionName, got: %s", account.InstitutionName())
	}
}

// TestRawAccount_Getters tests that all getter methods work correctly
func TestRawAccount_Getters(t *testing.T) {
	account, err := NewRawAccount("C1", "Capital One", "5678", "checking")
	if err != nil {
		t.Fatalf("Setup failed: %v", err)
	}

	tests := []struct {
		name     string
		got      string
		expected string
	}{
		{"InstitutionID", account.InstitutionID(), "C1"},
		{"InstitutionName", account.InstitutionName(), "Capital One"},
		{"AccountID", account.AccountID(), "5678"},
		{"AccountType", account.AccountType(), "checking"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.got != tt.expected {
				t.Errorf("Expected %s '%s', got: %s", tt.name, tt.expected, tt.got)
			}
		})
	}
}

// TestRawAccount_SetInstitutionName tests that SetInstitutionName works correctly
func TestRawAccount_SetInstitutionName(t *testing.T) {
	account, err := NewRawAccount("PNC", "", "9999", "savings")
	if err != nil {
		t.Fatalf("Setup failed: %v", err)
	}

	if account.InstitutionName() != "" {
		t.Errorf("Expected empty initial InstitutionName, got: %s", account.InstitutionName())
	}

	account.SetInstitutionName("PNC Bank")
	if account.InstitutionName() != "PNC Bank" {
		t.Errorf("Expected InstitutionName 'PNC Bank' after set, got: %s", account.InstitutionName())
	}
}

// TestNewPeriod_Valid tests successful creation of a period
func TestNewPeriod_Valid(t *testing.T) {
	start := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2025, 1, 31, 23, 59, 59, 0, time.UTC)

	period, err := NewPeriod(start, end)
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	if period == nil {
		t.Fatal("Expected period to be created")
	}
	if !period.Start().Equal(start) {
		t.Errorf("Expected Start %v, got: %v", start, period.Start())
	}
	if !period.End().Equal(end) {
		t.Errorf("Expected End %v, got: %v", end, period.End())
	}
}

// TestNewPeriod_ZeroStart tests validation of zero start time
func TestNewPeriod_ZeroStart(t *testing.T) {
	end := time.Date(2025, 1, 31, 0, 0, 0, 0, time.UTC)

	period, err := NewPeriod(time.Time{}, end)
	if err == nil {
		t.Error("Expected error for zero start time, got nil")
	}
	if period != nil {
		t.Error("Expected nil period for invalid input")
	}
	if err != nil && !strings.Contains(err.Error(), "start time cannot be zero") {
		t.Errorf("Expected 'start time cannot be zero' error, got: %v", err)
	}
}

// TestNewPeriod_ZeroEnd tests validation of zero end time
func TestNewPeriod_ZeroEnd(t *testing.T) {
	start := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)

	period, err := NewPeriod(start, time.Time{})
	if err == nil {
		t.Error("Expected error for zero end time, got nil")
	}
	if period != nil {
		t.Error("Expected nil period for invalid input")
	}
	if err != nil && !strings.Contains(err.Error(), "end time cannot be zero") {
		t.Errorf("Expected 'end time cannot be zero' error, got: %v", err)
	}
}

// TestNewPeriod_StartEqualsEnd tests validation when start equals end
func TestNewPeriod_StartEqualsEnd(t *testing.T) {
	sameTime := time.Date(2025, 1, 15, 12, 0, 0, 0, time.UTC)

	period, err := NewPeriod(sameTime, sameTime)
	if err == nil {
		t.Error("Expected error when start equals end, got nil")
	}
	if period != nil {
		t.Error("Expected nil period for invalid input")
	}
	if err != nil && !strings.Contains(err.Error(), "start must be before end") {
		t.Errorf("Expected 'start must be before end' error, got: %v", err)
	}
}

// TestNewPeriod_StartAfterEnd tests validation when start is after end
func TestNewPeriod_StartAfterEnd(t *testing.T) {
	start := time.Date(2025, 1, 31, 0, 0, 0, 0, time.UTC)
	end := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)

	period, err := NewPeriod(start, end)
	if err == nil {
		t.Error("Expected error when start is after end, got nil")
	}
	if period != nil {
		t.Error("Expected nil period for invalid input")
	}
	if err != nil && !strings.Contains(err.Error(), "start must be before end") {
		t.Errorf("Expected 'start must be before end' error, got: %v", err)
	}
}

// TestPeriod_Getters tests that Start and End getters work correctly
func TestPeriod_Getters(t *testing.T) {
	start := time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2025, 2, 28, 23, 59, 59, 0, time.UTC)

	period, err := NewPeriod(start, end)
	if err != nil {
		t.Fatalf("Setup failed: %v", err)
	}

	if !period.Start().Equal(start) {
		t.Errorf("Expected Start() to return %v, got: %v", start, period.Start())
	}
	if !period.End().Equal(end) {
		t.Errorf("Expected End() to return %v, got: %v", end, period.End())
	}
}

// TestPeriod_Duration tests the Duration method
func TestPeriod_Duration(t *testing.T) {
	tests := []struct {
		name             string
		start            time.Time
		end              time.Time
		expectedDuration time.Duration
	}{
		{
			name:             "One hour",
			start:            time.Date(2025, 1, 1, 10, 0, 0, 0, time.UTC),
			end:              time.Date(2025, 1, 1, 11, 0, 0, 0, time.UTC),
			expectedDuration: 1 * time.Hour,
		},
		{
			name:             "One day",
			start:            time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
			end:              time.Date(2025, 1, 2, 0, 0, 0, 0, time.UTC),
			expectedDuration: 24 * time.Hour,
		},
		{
			name:             "30 days",
			start:            time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
			end:              time.Date(2025, 1, 31, 0, 0, 0, 0, time.UTC),
			expectedDuration: 30 * 24 * time.Hour,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			period, err := NewPeriod(tt.start, tt.end)
			if err != nil {
				t.Fatalf("Setup failed: %v", err)
			}

			duration := period.Duration()
			if duration != tt.expectedDuration {
				t.Errorf("Expected Duration() %v, got: %v", tt.expectedDuration, duration)
			}
		})
	}
}

// TestPeriod_Contains tests the Contains method
func TestPeriod_Contains(t *testing.T) {
	start := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2025, 1, 31, 23, 59, 59, 0, time.UTC)

	period, err := NewPeriod(start, end)
	if err != nil {
		t.Fatalf("Setup failed: %v", err)
	}

	tests := []struct {
		name     string
		testTime time.Time
		expected bool
	}{
		{
			name:     "Before period",
			testTime: time.Date(2024, 12, 31, 23, 59, 59, 0, time.UTC),
			expected: false,
		},
		{
			name:     "At start (inclusive)",
			testTime: start,
			expected: true,
		},
		{
			name:     "Middle of period",
			testTime: time.Date(2025, 1, 15, 12, 0, 0, 0, time.UTC),
			expected: true,
		},
		{
			name:     "At end (inclusive)",
			testTime: end,
			expected: true,
		},
		{
			name:     "After period",
			testTime: time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC),
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := period.Contains(tt.testTime)
			if result != tt.expected {
				t.Errorf("Expected Contains(%v) to return %v, got: %v", tt.testTime, tt.expected, result)
			}
		})
	}
}

// TestNewRawTransaction_Valid tests successful creation of a raw transaction
func TestNewRawTransaction_Valid(t *testing.T) {
	id := "TXN123"
	date := time.Date(2025, 1, 15, 10, 30, 0, 0, time.UTC)
	postedDate := time.Date(2025, 1, 16, 0, 0, 0, 0, time.UTC)
	description := "Coffee Shop"
	amount := -5.50

	txn, err := NewRawTransaction(id, date, postedDate, description, amount)
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	if txn == nil {
		t.Fatal("Expected transaction to be created")
	}
	if txn.ID() != id {
		t.Errorf("Expected ID '%s', got: %s", id, txn.ID())
	}
	if !txn.Date().Equal(date) {
		t.Errorf("Expected Date %v, got: %v", date, txn.Date())
	}
	if !txn.PostedDate().Equal(postedDate) {
		t.Errorf("Expected PostedDate %v, got: %v", postedDate, txn.PostedDate())
	}
	if txn.Description() != description {
		t.Errorf("Expected Description '%s', got: %s", description, txn.Description())
	}
	if txn.Amount() != amount {
		t.Errorf("Expected Amount %f, got: %f", amount, txn.Amount())
	}
}

// TestNewRawTransaction_EmptyID tests validation of empty transaction ID
func TestNewRawTransaction_EmptyID(t *testing.T) {
	date := time.Date(2025, 1, 15, 0, 0, 0, 0, time.UTC)

	txn, err := NewRawTransaction("", date, date, "Description", 100.0)
	if err == nil {
		t.Error("Expected error for empty transaction ID, got nil")
	}
	if txn != nil {
		t.Error("Expected nil transaction for invalid input")
	}
	if err != nil && !strings.Contains(err.Error(), "transaction ID cannot be empty") {
		t.Errorf("Expected 'transaction ID cannot be empty' error, got: %v", err)
	}
}

// TestNewRawTransaction_ZeroDate tests validation of zero transaction date
func TestNewRawTransaction_ZeroDate(t *testing.T) {
	txn, err := NewRawTransaction("TXN123", time.Time{}, time.Time{}, "Description", 100.0)
	if err == nil {
		t.Error("Expected error for zero transaction date, got nil")
	}
	if txn != nil {
		t.Error("Expected nil transaction for invalid input")
	}
	if err != nil && !strings.Contains(err.Error(), "transaction date cannot be zero") {
		t.Errorf("Expected 'transaction date cannot be zero' error, got: %v", err)
	}
}

// TestNewRawTransaction_EmptyDescription tests validation of empty description
func TestNewRawTransaction_EmptyDescription(t *testing.T) {
	date := time.Date(2025, 1, 15, 0, 0, 0, 0, time.UTC)

	txn, err := NewRawTransaction("TXN123", date, date, "", 100.0)
	if err == nil {
		t.Error("Expected error for empty description, got nil")
	}
	if txn != nil {
		t.Error("Expected nil transaction for invalid input")
	}
	if err != nil && !strings.Contains(err.Error(), "description cannot be empty") {
		t.Errorf("Expected 'description cannot be empty' error, got: %v", err)
	}
}

// TestNewRawTransaction_PostedDateDefault tests that posted date defaults to transaction date when zero
func TestNewRawTransaction_PostedDateDefault(t *testing.T) {
	date := time.Date(2025, 1, 15, 10, 30, 0, 0, time.UTC)

	txn, err := NewRawTransaction("TXN123", date, time.Time{}, "Description", 100.0)
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	if txn == nil {
		t.Fatal("Expected transaction to be created")
	}
	if !txn.PostedDate().Equal(date) {
		t.Errorf("Expected PostedDate to default to Date %v, got: %v", date, txn.PostedDate())
	}
}

// TestRawTransaction_Getters tests that all getter methods work correctly
func TestRawTransaction_Getters(t *testing.T) {
	id := "TXN456"
	date := time.Date(2025, 1, 20, 14, 0, 0, 0, time.UTC)
	postedDate := time.Date(2025, 1, 21, 0, 0, 0, 0, time.UTC)
	description := "Grocery Store"
	amount := -75.25

	txn, err := NewRawTransaction(id, date, postedDate, description, amount)
	if err != nil {
		t.Fatalf("Setup failed: %v", err)
	}

	if txn.ID() != id {
		t.Errorf("Expected ID() '%s', got: %s", id, txn.ID())
	}
	if !txn.Date().Equal(date) {
		t.Errorf("Expected Date() %v, got: %v", date, txn.Date())
	}
	if !txn.PostedDate().Equal(postedDate) {
		t.Errorf("Expected PostedDate() %v, got: %v", postedDate, txn.PostedDate())
	}
	if txn.Description() != description {
		t.Errorf("Expected Description() '%s', got: %s", description, txn.Description())
	}
	if txn.Amount() != amount {
		t.Errorf("Expected Amount() %f, got: %f", amount, txn.Amount())
	}
	if txn.Type() != "" {
		t.Errorf("Expected Type() to be empty initially, got: %s", txn.Type())
	}
	if txn.Memo() != "" {
		t.Errorf("Expected Memo() to be empty initially, got: %s", txn.Memo())
	}
}

// TestRawTransaction_SetTypeAndMemo tests that SetType and SetMemo work correctly
func TestRawTransaction_SetTypeAndMemo(t *testing.T) {
	date := time.Date(2025, 1, 20, 0, 0, 0, 0, time.UTC)
	txn, err := NewRawTransaction("TXN789", date, date, "Test Transaction", 50.0)
	if err != nil {
		t.Fatalf("Setup failed: %v", err)
	}

	// Test initial state
	if txn.Type() != "" {
		t.Errorf("Expected initial Type to be empty, got: %s", txn.Type())
	}
	if txn.Memo() != "" {
		t.Errorf("Expected initial Memo to be empty, got: %s", txn.Memo())
	}

	// Test SetType
	txn.SetType("DEBIT")
	if txn.Type() != "DEBIT" {
		t.Errorf("Expected Type 'DEBIT' after SetType, got: %s", txn.Type())
	}

	// Test SetMemo
	txn.SetMemo("Monthly subscription")
	if txn.Memo() != "Monthly subscription" {
		t.Errorf("Expected Memo 'Monthly subscription' after SetMemo, got: %s", txn.Memo())
	}
}
