package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"cloud.google.com/go/storage"
	"github.com/commons-systems/filesync"
	"github.com/commons-systems/filesync/print"
	"printsync/internal/firestore"
	"printsync/internal/middleware"
	"printsync/internal/streaming"
	"printsync/web/templates/partials"
)

// SyncHandlers handles sync-related HTTP requests
type SyncHandlers struct {
	gcsClient    *storage.Client
	bucket       string
	fsClient     *firestore.Client
	sessionStore filesync.SessionStore
	fileStore    filesync.FileStore
	registry     *SessionRegistry
	hub          *streaming.StreamHub
}

// NewSyncHandlers creates a new sync handlers instance
func NewSyncHandlers(
	gcsClient *storage.Client,
	bucket string,
	fsClient *firestore.Client,
	sessionStore filesync.SessionStore,
	fileStore filesync.FileStore,
	registry *SessionRegistry,
	hub *streaming.StreamHub,
) *SyncHandlers {
	return &SyncHandlers{
		gcsClient:    gcsClient,
		bucket:       bucket,
		fsClient:     fsClient,
		sessionStore: sessionStore,
		fileStore:    fileStore,
		registry:     registry,
		hub:          hub,
	}
}

// StartSyncRequest represents the request to start a sync
type StartSyncRequest struct {
	RootDir    string   `json:"rootDir"`
	Extensions []string `json:"extensions"`
}

// StartSyncResponse represents the response from starting a sync
type StartSyncResponse struct {
	SessionID string `json:"sessionId"`
	Status    string `json:"status"`
}

// StartSync handles POST /api/sync/start
func (h *SyncHandlers) StartSync(w http.ResponseWriter, r *http.Request) {
	// Get authenticated user
	authInfo, ok := middleware.GetAuth(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Parse request
	var req StartSyncRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.RootDir == "" {
		http.Error(w, "rootDir is required", http.StatusBadRequest)
		return
	}

	// Create pipeline
	pipeline, err := print.NewPrintPipeline(r.Context(), h.gcsClient, h.fsClient.Client, h.bucket)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to create pipeline: %v", err), http.StatusInternalServerError)
		return
	}

	// Create cancellable context
	ctx, cancel := context.WithCancel(r.Context())

	// Run extraction asynchronously
	resultCh, progressCh, err := pipeline.RunExtractionAsync(ctx, req.RootDir, authInfo.UserID)
	if err != nil {
		cancel()
		http.Error(w, fmt.Sprintf("Failed to start extraction: %v", err), http.StatusInternalServerError)
		return
	}

	// The pipeline creates the session immediately before returning channels
	// We can get the session ID by listing recent sessions for this user
	// This is a temporary workaround - ideally RunExtractionAsync should return the session ID

	// Wait a moment for the session to be created in Firestore
	time.Sleep(100 * time.Millisecond)

	sessions, err := h.sessionStore.List(ctx, authInfo.UserID)
	if err != nil || len(sessions) == 0 {
		cancel()
		http.Error(w, "Failed to get session ID", http.StatusInternalServerError)
		return
	}

	// Get the most recent session (sorted by StartedAt)
	sessionID := sessions[0].ID

	// Clean up when extraction completes
	go func() {
		result := <-resultCh
		cancel()
		h.registry.Remove(result.SessionID)
	}()

	// Register running session
	h.registry.Register(sessionID, &RunningSession{
		SessionID:  sessionID,
		Cancel:     cancel,
		ProgressCh: progressCh,
	})

	// Start streaming for this session
	if err := h.hub.StartSession(ctx, sessionID, progressCh); err != nil {
		cancel()
		h.registry.Remove(sessionID)
		http.Error(w, fmt.Sprintf("Failed to start streaming: %v", err), http.StatusInternalServerError)
		return
	}

	// Return response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(StartSyncResponse{
		SessionID: sessionID,
		Status:    "running",
	})
}

// GetSession handles GET /api/sync/{id}
func (h *SyncHandlers) GetSession(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")

	session, err := h.sessionStore.Get(r.Context(), sessionID)
	if err != nil {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(session)
}

// CancelSync handles POST /api/sync/{id}/cancel
func (h *SyncHandlers) CancelSync(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")

	running, ok := h.registry.Get(sessionID)
	if !ok {
		http.Error(w, "Session not running", http.StatusNotFound)
		return
	}

	// Cancel the context
	running.Cancel()

	// Remove from registry
	h.registry.Remove(sessionID)

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"cancelled"}`))
}

// ApproveFile handles POST /api/files/{id}/approve
func (h *SyncHandlers) ApproveFile(w http.ResponseWriter, r *http.Request) {
	fileID := r.PathValue("id")

	// Get file to find its session
	file, err := h.fileStore.Get(r.Context(), fileID)
	if err != nil {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	// Create pipeline (we need it for approval)
	pipeline, err := print.NewPrintPipeline(r.Context(), h.gcsClient, h.fsClient.Client, h.bucket)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to create pipeline: %v", err), http.StatusInternalServerError)
		return
	}

	// Approve and upload
	result, err := pipeline.ApproveAndUpload(r.Context(), file.SessionID, []string{fileID})
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to approve file: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// ApproveAll handles POST /api/sync/{id}/approve-all
func (h *SyncHandlers) ApproveAll(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")

	// Create pipeline
	pipeline, err := print.NewPrintPipeline(r.Context(), h.gcsClient, h.fsClient.Client, h.bucket)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to create pipeline: %v", err), http.StatusInternalServerError)
		return
	}

	// Approve all
	result, err := pipeline.ApproveAllAndUpload(r.Context(), sessionID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to approve all files: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// RejectFile handles POST /api/files/{id}/reject
func (h *SyncHandlers) RejectFile(w http.ResponseWriter, r *http.Request) {
	fileID := r.PathValue("id")

	// Get file to find its session
	file, err := h.fileStore.Get(r.Context(), fileID)
	if err != nil {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	// Create pipeline
	pipeline, err := print.NewPrintPipeline(r.Context(), h.gcsClient, h.fsClient.Client, h.bucket)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to create pipeline: %v", err), http.StatusInternalServerError)
		return
	}

	// Reject file
	if err := pipeline.RejectFiles(r.Context(), file.SessionID, []string{fileID}); err != nil {
		http.Error(w, fmt.Sprintf("Failed to reject file: %v", err), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"rejected"}`))
}

// TrashFile handles POST /api/files/{id}/trash
func (h *SyncHandlers) TrashFile(w http.ResponseWriter, r *http.Request) {
	fileID := r.PathValue("id")

	// Get file to find its session
	file, err := h.fileStore.Get(r.Context(), fileID)
	if err != nil {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	// Create pipeline
	pipeline, err := print.NewPrintPipeline(r.Context(), h.gcsClient, h.fsClient.Client, h.bucket)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to create pipeline: %v", err), http.StatusInternalServerError)
		return
	}

	// Trash file
	if err := pipeline.TrashFiles(r.Context(), file.SessionID, []string{fileID}); err != nil {
		http.Error(w, fmt.Sprintf("Failed to trash file: %v", err), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"trashed"}`))
}

// TrashAll handles POST /api/sync/{id}/trash-all
func (h *SyncHandlers) TrashAll(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")

	// Get all uploaded/skipped files
	files, err := h.fileStore.ListBySession(r.Context(), sessionID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to list files: %v", err), http.StatusInternalServerError)
		return
	}

	var fileIDs []string
	for _, file := range files {
		if file.Status == filesync.FileStatusUploaded || file.Status == filesync.FileStatusSkipped {
			fileIDs = append(fileIDs, file.ID)
		}
	}

	if len(fileIDs) == 0 {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"no files to trash"}`))
		return
	}

	// Create pipeline
	pipeline, err := print.NewPrintPipeline(r.Context(), h.gcsClient, h.fsClient.Client, h.bucket)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to create pipeline: %v", err), http.StatusInternalServerError)
		return
	}

	// Trash all
	if err := pipeline.TrashFiles(r.Context(), sessionID, fileIDs); err != nil {
		http.Error(w, fmt.Sprintf("Failed to trash files: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "trashed",
		"count":   len(fileIDs),
	})
}

// HistoryPartial handles GET /partials/sync/history
func (h *SyncHandlers) HistoryPartial(w http.ResponseWriter, r *http.Request) {
	// Get authenticated user
	authInfo, ok := middleware.GetAuth(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Get user's sessions
	sessions, err := h.sessionStore.List(r.Context(), authInfo.UserID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to list sessions: %v", err), http.StatusInternalServerError)
		return
	}

	// Render partial
	partials.SyncHistory(sessions).Render(r.Context(), w)
}
