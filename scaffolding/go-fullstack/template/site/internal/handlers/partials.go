package handlers

import (
	"net/http"

	"{{APP_NAME}}/web/templates/partials"
)

func (h *PageHandlers) ItemsPartial(w http.ResponseWriter, r *http.Request) {
	// Example: fetch items from Firestore
	items := []string{"Item 1", "Item 2", "Item 3"}

	partials.ItemsList(items).Render(r.Context(), w)
}

func (h *PageHandlers) CreateItem(w http.ResponseWriter, r *http.Request) {
	// Example: create item in Firestore
	if err := r.ParseForm(); err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	itemName := r.FormValue("name")
	// Save to Firestore here...

	// Return updated list
	items := []string{"Item 1", "Item 2", "Item 3", itemName}
	partials.ItemsList(items).Render(r.Context(), w)
}
