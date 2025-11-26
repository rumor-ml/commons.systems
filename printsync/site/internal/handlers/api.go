package handlers

import (
	"encoding/json"
	"net/http"
)

func (h *PageHandlers) DataAPI(w http.ResponseWriter, r *http.Request) {
	// Example: fetch data from Firestore for React islands
	data := map[string]interface{}{
		"labels": []string{"Jan", "Feb", "Mar", "Apr", "May"},
		"values": []int{10, 20, 15, 30, 25},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}
