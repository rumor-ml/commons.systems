package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/rumor-ml/commons.systems/budget/site/internal/firestore"
	"github.com/rumor-ml/commons.systems/budget/site/internal/middleware"
)

// APIHandler handles API requests
type APIHandler struct {
	fsClient *firestore.Client
}

// NewAPIHandler creates a new API handler
func NewAPIHandler(fsClient *firestore.Client) *APIHandler {
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
	json.NewEncoder(w).Encode(transactions)
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
	json.NewEncoder(w).Encode(statements)
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
	json.NewEncoder(w).Encode(accounts)
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
	json.NewEncoder(w).Encode(institutions)
}
