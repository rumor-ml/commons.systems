package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	"github.com/rumor-ml/commons.systems/finparse/internal/firestore"
	"github.com/rumor-ml/commons.systems/finparse/internal/middleware"
)

// FirestoreClient interface for dependency injection
type FirestoreClient interface {
	GetTransactions(ctx context.Context, userID string) ([]*firestore.Transaction, error)
	GetStatements(ctx context.Context, userID string) ([]*firestore.Statement, error)
	GetAccounts(ctx context.Context, userID string) ([]*firestore.Account, error)
	GetInstitutions(ctx context.Context, userID string) ([]*firestore.Institution, error)
}

// APIHandler handles API requests
type APIHandler struct {
	fsClient FirestoreClient
}

// NewAPIHandler creates a new API handler
func NewAPIHandler(fsClient FirestoreClient) *APIHandler {
	return &APIHandler{fsClient: fsClient}
}

// GetTransactions handles GET /api/transactions
func (h *APIHandler) GetTransactions(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	transactions, err := h.fsClient.GetTransactions(r.Context(), userID)
	if err != nil {
		http.Error(w, "Failed to fetch transactions", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(transactions); err != nil {
		log.Printf("ERROR: Failed to encode transactions for user %s: %v", userID, err)
		return
	}
}

// GetStatements handles GET /api/statements
func (h *APIHandler) GetStatements(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	statements, err := h.fsClient.GetStatements(r.Context(), userID)
	if err != nil {
		http.Error(w, "Failed to fetch statements", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(statements); err != nil {
		log.Printf("ERROR: Failed to encode statements for user %s: %v", userID, err)
		return
	}
}

// GetAccounts handles GET /api/accounts
func (h *APIHandler) GetAccounts(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	accounts, err := h.fsClient.GetAccounts(r.Context(), userID)
	if err != nil {
		http.Error(w, "Failed to fetch accounts", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(accounts); err != nil {
		log.Printf("ERROR: Failed to encode accounts for user %s: %v", userID, err)
		return
	}
}

// GetInstitutions handles GET /api/institutions
func (h *APIHandler) GetInstitutions(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	institutions, err := h.fsClient.GetInstitutions(r.Context(), userID)
	if err != nil {
		http.Error(w, "Failed to fetch institutions", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(institutions); err != nil {
		log.Printf("ERROR: Failed to encode institutions for user %s: %v", userID, err)
		return
	}
}
