package handlers

import (
	"encoding/json"
	"net/http"
)

// HealthResponse represents the health check response
type HealthResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
}

// HealthCheck handles GET /health
func HealthCheck(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(HealthResponse{
		Status:  "ok",
		Service: "budget-api",
	})
}
