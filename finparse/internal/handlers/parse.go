package handlers

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/rumor-ml/commons.systems/finparse/internal/firestore"
	"github.com/rumor-ml/commons.systems/finparse/internal/middleware"
	"github.com/rumor-ml/commons.systems/finparse/internal/pipeline"
	"github.com/rumor-ml/commons.systems/finparse/internal/streaming"
)

// ParseHandlers handles parse-related requests
type ParseHandlers struct {
	fsClient *firestore.Client
	hub      *streaming.StreamHub
	pipeline *pipeline.Pipeline
}

// NewParseHandlers creates a new parse handlers instance
func NewParseHandlers(fsClient *firestore.Client, hub *streaming.StreamHub) *ParseHandlers {
	pipe := pipeline.NewPipeline(fsClient, hub)
	return &ParseHandlers{
		fsClient: fsClient,
		hub:      hub,
		pipeline: pipe,
	}
}

// StartParse handles POST /api/parse/start
func (h *ParseHandlers) StartParse(w http.ResponseWriter, r *http.Request) {
	// Get authenticated user
	authInfo, ok := middleware.GetAuth(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Parse multipart form (max 100MB)
	if err := r.ParseMultipartForm(100 << 20); err != nil {
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	// Get uploaded files
	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		http.Error(w, "No files uploaded", http.StatusBadRequest)
		return
	}

	// Create parse session
	sessionID := uuid.New().String()
	session := &firestore.ParseSession{
		ID:        sessionID,
		UserID:    authInfo.UserID,
		Status:    "processing",
		FileCount: len(files),
		Stats:     make(map[string]interface{}),
		CreatedAt: time.Now(),
	}

	if err := h.fsClient.CreateParseSession(r.Context(), session); err != nil {
		log.Printf("ERROR: Failed to create parse session: %v", err)
		http.Error(w, "Failed to create session", http.StatusInternalServerError)
		return
	}

	// Save uploaded files temporarily and start parsing in background
	go func() {
		ctx := context.Background()
		filePaths := make([]string, 0, len(files))

		// Save files temporarily
		for _, fileHeader := range files {
			file, err := fileHeader.Open()
			if err != nil {
				log.Printf("ERROR: Failed to open uploaded file: %v", err)
				continue
			}
			defer file.Close()

			// Save to temp location
			tmpPath := fmt.Sprintf("/tmp/%s-%s", sessionID, fileHeader.Filename)
			// Note: In production, properly handle file saves
			filePaths = append(filePaths, tmpPath)
		}

		// Process files
		if err := h.pipeline.ProcessFiles(ctx, sessionID, filePaths, authInfo.UserID); err != nil {
			log.Printf("ERROR: Failed to process files: %v", err)
			session.Status = "error"
			session.Error = err.Error()
			h.fsClient.UpdateParseSession(ctx, session)
			return
		}

		// Update session as completed
		now := time.Now()
		session.Status = "completed"
		session.CompletedAt = &now
		h.fsClient.UpdateParseSession(ctx, session)

		// Broadcast completion
		h.hub.Broadcast(sessionID, streaming.SSEEvent{
			Type: streaming.EventTypeComplete,
			Data: map[string]string{"status": "completed"},
		})
	}()

	// Return session ID
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	fmt.Fprintf(w, `{"sessionId":"%s"}`, sessionID)
}

// CancelParse handles POST /api/parse/{id}/cancel
func (h *ParseHandlers) CancelParse(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")

	// Get authenticated user
	authInfo, ok := middleware.GetAuth(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Verify session ownership
	session, err := h.fsClient.GetParseSession(r.Context(), sessionID)
	if err != nil {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	if session.UserID != authInfo.UserID {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	// Update session status
	session.Status = "cancelled"
	if err := h.fsClient.UpdateParseSession(r.Context(), session); err != nil {
		http.Error(w, "Failed to cancel session", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"status":"cancelled"}`)
}
