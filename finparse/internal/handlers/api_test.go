package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/rumor-ml/commons.systems/finparse/internal/firestore"
	"github.com/rumor-ml/commons.systems/finparse/internal/middleware"
)

// mockFirestoreClient implements a mock for testing
type mockFirestoreClient struct {
	transactions []*firestore.Transaction
	statements   []*firestore.Statement
	accounts     []*firestore.Account
	institutions []*firestore.Institution
	err          error
}

func (m *mockFirestoreClient) GetTransactions(ctx context.Context, userID string) ([]*firestore.Transaction, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.transactions, nil
}

func (m *mockFirestoreClient) GetStatements(ctx context.Context, userID string) ([]*firestore.Statement, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.statements, nil
}

func (m *mockFirestoreClient) GetAccounts(ctx context.Context, userID string) ([]*firestore.Account, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.accounts, nil
}

func (m *mockFirestoreClient) GetInstitutions(ctx context.Context, userID string) ([]*firestore.Institution, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.institutions, nil
}

// Helper to create request with userID in context
func requestWithAuth(userID string) *http.Request {
	req := httptest.NewRequest("GET", "/", nil)
	ctx := context.WithValue(req.Context(), middleware.UserIDKey, userID)
	return req.WithContext(ctx)
}

// Helper to create request without auth
func requestWithoutAuth() *http.Request {
	return httptest.NewRequest("GET", "/", nil)
}

// TestGetTransactions_Success verifies successful authenticated request
func TestGetTransactions_Success(t *testing.T) {
	mockClient := &mockFirestoreClient{
		transactions: []*firestore.Transaction{
			{
				ID:          "txn-1",
				UserID:      "user-123",
				Date:        "2024-01-15",
				Description: "Test transaction",
				Amount:      100.50,
				Category:    "groceries",
				CreatedAt:   time.Now(),
			},
		},
	}

	handler := NewAPIHandler(mockClient)
	req := requestWithAuth("user-123")
	w := httptest.NewRecorder()

	handler.GetTransactions(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	if contentType := w.Header().Get("Content-Type"); contentType != "application/json" {
		t.Errorf("Expected Content-Type application/json, got %s", contentType)
	}

	var result []*firestore.Transaction
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if len(result) != 1 {
		t.Errorf("Expected 1 transaction, got %d", len(result))
	}

	if result[0].ID != "txn-1" {
		t.Errorf("Expected transaction ID txn-1, got %s", result[0].ID)
	}
}

// TestGetTransactions_Unauthorized verifies 401 when userID missing
func TestGetTransactions_Unauthorized(t *testing.T) {
	mockClient := &mockFirestoreClient{}
	handler := NewAPIHandler(mockClient)
	req := requestWithoutAuth()
	w := httptest.NewRecorder()

	handler.GetTransactions(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", w.Code)
	}
}

// TestGetTransactions_FirestoreError verifies 500 on Firestore error
func TestGetTransactions_FirestoreError(t *testing.T) {
	mockClient := &mockFirestoreClient{
		err: fmt.Errorf("firestore connection failed"),
	}

	handler := NewAPIHandler(mockClient)
	req := requestWithAuth("user-123")
	w := httptest.NewRecorder()

	handler.GetTransactions(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("Expected status 500, got %d", w.Code)
	}
}

// TestGetTransactions_EmptyResult verifies empty array for no transactions
func TestGetTransactions_EmptyResult(t *testing.T) {
	mockClient := &mockFirestoreClient{
		transactions: []*firestore.Transaction{},
	}

	handler := NewAPIHandler(mockClient)
	req := requestWithAuth("user-123")
	w := httptest.NewRecorder()

	handler.GetTransactions(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var result []*firestore.Transaction
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if len(result) != 0 {
		t.Errorf("Expected empty array, got %d items", len(result))
	}
}

// TestGetStatements_Success verifies successful authenticated request
func TestGetStatements_Success(t *testing.T) {
	mockClient := &mockFirestoreClient{
		statements: []*firestore.Statement{
			{
				ID:        "stmt-1",
				UserID:    "user-123",
				AccountID: "acc-1",
				StartDate: "2024-01-01",
				EndDate:   "2024-01-31",
				CreatedAt: time.Now(),
			},
		},
	}

	handler := NewAPIHandler(mockClient)
	req := requestWithAuth("user-123")
	w := httptest.NewRecorder()

	handler.GetStatements(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	if contentType := w.Header().Get("Content-Type"); contentType != "application/json" {
		t.Errorf("Expected Content-Type application/json, got %s", contentType)
	}

	var result []*firestore.Statement
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if len(result) != 1 {
		t.Errorf("Expected 1 statement, got %d", len(result))
	}
}

// TestGetStatements_Unauthorized verifies 401 when userID missing
func TestGetStatements_Unauthorized(t *testing.T) {
	mockClient := &mockFirestoreClient{}
	handler := NewAPIHandler(mockClient)
	req := requestWithoutAuth()
	w := httptest.NewRecorder()

	handler.GetStatements(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", w.Code)
	}
}

// TestGetStatements_FirestoreError verifies 500 on Firestore error
func TestGetStatements_FirestoreError(t *testing.T) {
	mockClient := &mockFirestoreClient{
		err: fmt.Errorf("firestore query failed"),
	}

	handler := NewAPIHandler(mockClient)
	req := requestWithAuth("user-123")
	w := httptest.NewRecorder()

	handler.GetStatements(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("Expected status 500, got %d", w.Code)
	}
}

// TestGetAccounts_Success verifies successful authenticated request
func TestGetAccounts_Success(t *testing.T) {
	mockClient := &mockFirestoreClient{
		accounts: []*firestore.Account{
			{
				ID:            "acc-1",
				UserID:        "user-123",
				InstitutionID: "inst-1",
				Name:          "Checking",
				Type:          "checking",
				CreatedAt:     time.Now(),
			},
		},
	}

	handler := NewAPIHandler(mockClient)
	req := requestWithAuth("user-123")
	w := httptest.NewRecorder()

	handler.GetAccounts(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	if contentType := w.Header().Get("Content-Type"); contentType != "application/json" {
		t.Errorf("Expected Content-Type application/json, got %s", contentType)
	}

	var result []*firestore.Account
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if len(result) != 1 {
		t.Errorf("Expected 1 account, got %d", len(result))
	}
}

// TestGetAccounts_Unauthorized verifies 401 when userID missing
func TestGetAccounts_Unauthorized(t *testing.T) {
	mockClient := &mockFirestoreClient{}
	handler := NewAPIHandler(mockClient)
	req := requestWithoutAuth()
	w := httptest.NewRecorder()

	handler.GetAccounts(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", w.Code)
	}
}

// TestGetAccounts_FirestoreError verifies 500 on Firestore error
func TestGetAccounts_FirestoreError(t *testing.T) {
	mockClient := &mockFirestoreClient{
		err: fmt.Errorf("firestore query failed"),
	}

	handler := NewAPIHandler(mockClient)
	req := requestWithAuth("user-123")
	w := httptest.NewRecorder()

	handler.GetAccounts(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("Expected status 500, got %d", w.Code)
	}
}

// TestGetInstitutions_Success verifies successful authenticated request
func TestGetInstitutions_Success(t *testing.T) {
	mockClient := &mockFirestoreClient{
		institutions: []*firestore.Institution{
			{
				ID:        "inst-1",
				UserID:    "user-123",
				Name:      "Bank of Test",
				CreatedAt: time.Now(),
			},
		},
	}

	handler := NewAPIHandler(mockClient)
	req := requestWithAuth("user-123")
	w := httptest.NewRecorder()

	handler.GetInstitutions(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	if contentType := w.Header().Get("Content-Type"); contentType != "application/json" {
		t.Errorf("Expected Content-Type application/json, got %s", contentType)
	}

	var result []*firestore.Institution
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if len(result) != 1 {
		t.Errorf("Expected 1 institution, got %d", len(result))
	}
}

// TestGetInstitutions_Unauthorized verifies 401 when userID missing
func TestGetInstitutions_Unauthorized(t *testing.T) {
	mockClient := &mockFirestoreClient{}
	handler := NewAPIHandler(mockClient)
	req := requestWithoutAuth()
	w := httptest.NewRecorder()

	handler.GetInstitutions(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", w.Code)
	}
}

// TestGetInstitutions_FirestoreError verifies 500 on Firestore error
func TestGetInstitutions_FirestoreError(t *testing.T) {
	mockClient := &mockFirestoreClient{
		err: fmt.Errorf("firestore query failed"),
	}

	handler := NewAPIHandler(mockClient)
	req := requestWithAuth("user-123")
	w := httptest.NewRecorder()

	handler.GetInstitutions(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("Expected status 500, got %d", w.Code)
	}
}
