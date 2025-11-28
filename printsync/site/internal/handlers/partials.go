package handlers

import (
	"log"
	"net/http"

	"printsync/internal/middleware"
	"printsync/web/templates/partials"
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

// RenderTrashModal handles GET /partials/trash-modal
// Query params: sessionID (for trash-all), fileID (for single file), fileName
func (h *SyncHandlers) RenderTrashModal(w http.ResponseWriter, r *http.Request) {
	// Get authenticated user
	authInfo, ok := middleware.GetAuth(r)
	if !ok {
		log.Printf("ERROR: RenderTrashModal - unauthorized access attempt")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Get query parameters
	sessionID := r.URL.Query().Get("sessionID")
	fileID := r.URL.Query().Get("fileID")
	fileName := r.URL.Query().Get("fileName")

	// Verify ownership if sessionID is provided
	if sessionID != "" {
		session, err := h.sessionStore.Get(r.Context(), sessionID)
		if err != nil {
			log.Printf("ERROR: RenderTrashModal for user %s, session %s - session not found: %v", authInfo.UserID, sessionID, err)
			http.Error(w, "Session not found", http.StatusNotFound)
			return
		}

		if session.UserID != authInfo.UserID {
			log.Printf("ERROR: RenderTrashModal - user %s attempted to access session %s owned by %s", authInfo.UserID, sessionID, session.UserID)
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
	}

	// Verify ownership if fileID is provided
	if fileID != "" {
		file, err := h.fileStore.Get(r.Context(), fileID)
		if err != nil {
			log.Printf("ERROR: RenderTrashModal for user %s, file %s - file not found: %v", authInfo.UserID, fileID, err)
			http.Error(w, "File not found", http.StatusNotFound)
			return
		}

		// Verify ownership via session
		session, err := h.sessionStore.Get(r.Context(), file.SessionID)
		if err != nil {
			log.Printf("ERROR: RenderTrashModal for user %s, file %s, session %s - session not found: %v", authInfo.UserID, fileID, file.SessionID, err)
			http.Error(w, "Session not found", http.StatusNotFound)
			return
		}

		if session.UserID != authInfo.UserID {
			log.Printf("ERROR: RenderTrashModal - user %s attempted to access file %s in session %s owned by %s", authInfo.UserID, fileID, file.SessionID, session.UserID)
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
	}

	// Render the modal
	w.Header().Set("Content-Type", "text/html")
	if err := partials.TrashModal(sessionID, fileID, fileName).Render(r.Context(), w); err != nil {
		log.Printf("ERROR: RenderTrashModal for user %s - failed to render modal: %v", authInfo.UserID, err)
		http.Error(w, "Failed to render modal", http.StatusInternalServerError)
		return
	}
}
