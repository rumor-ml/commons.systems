package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"cloud.google.com/go/storage"
	"github.com/commons-systems/filesync"
	"github.com/commons-systems/filesync/print"
	"github.com/google/uuid"
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
) (*SyncHandlers, error) {
	if gcsClient == nil {
		return nil, fmt.Errorf("gcsClient is required")
	}
	if bucket == "" {
		return nil, fmt.Errorf("bucket is required")
	}
	if fsClient == nil {
		return nil, fmt.Errorf("fsClient is required")
	}
	if sessionStore == nil {
		return nil, fmt.Errorf("sessionStore is required")
	}
	if fileStore == nil {
		return nil, fmt.Errorf("fileStore is required")
	}
	if registry == nil {
		return nil, fmt.Errorf("registry is required")
	}
	if hub == nil {
		return nil, fmt.Errorf("hub is required")
	}

	return &SyncHandlers{
		gcsClient:    gcsClient,
		bucket:       bucket,
		fsClient:     fsClient,
		sessionStore: sessionStore,
		fileStore:    fileStore,
		registry:     registry,
		hub:          hub,
	}, nil
}

// StartSyncRequest represents the request to start a sync
type StartSyncRequest struct {
	Directory  string   `json:"directory"`
	Extensions []string `json:"extensions"`
}

// StartSyncResponse represents the response from starting a sync
type StartSyncResponse struct {
	SessionID string `json:"sessionId"`
	Status    string `json:"status"`
}

// StartSync handles POST /api/sync/start
func (h *SyncHandlers) StartSync(w http.ResponseWriter, r *http.Request) {
	authInfo, ok := middleware.GetAuth(r)
	if !ok {
		log.Printf("ERROR: StartSync - unauthorized access attempt")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Parse form data instead of JSON
	if err := r.ParseForm(); err != nil {
		log.Printf("ERROR: StartSync for user %s - failed to parse form: %v", authInfo.UserID, err)
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	req := StartSyncRequest{
		Directory:  r.FormValue("directory"),
		Extensions: r.Form["extensions"],
	}

	if req.Directory == "" {
		log.Printf("ERROR: StartSync for user %s - directory is required", authInfo.UserID)
		http.Error(w, "directory is required", http.StatusBadRequest)
		return
	}

	// Prepare discovery options for custom extensions
	var discoveryOpts []filesync.DiscoveryOption
	if len(req.Extensions) > 0 {
		discoveryOpts = []filesync.DiscoveryOption{
			filesync.WithExtensions(req.Extensions...),
		}
	}

	// Create pipeline with custom extensions
	pipeline, err := print.NewPrintPipeline(r.Context(), h.gcsClient, h.fsClient.Client, h.bucket, discoveryOpts)
	if err != nil {
		log.Printf("ERROR: StartSync for user %s - failed to create pipeline: %v", authInfo.UserID, err)
		http.Error(w, fmt.Sprintf("Failed to create pipeline: %v", err), http.StatusInternalServerError)
		return
	}

	// Create cancellable context with Background (not tied to HTTP request)
	ctx, cancel := context.WithCancel(context.Background())

	// Generate session ID upfront and create progress channel
	sessionID := uuid.New().String()
	progressCh := make(chan filesync.Progress, 100)

	// Start streaming BEFORE pipeline - streaming infrastructure ready first
	if err := h.hub.StartSession(ctx, sessionID, progressCh); err != nil {
		cancel()
		log.Printf("ERROR: StartSync for user %s - failed to start streaming: %v", authInfo.UserID, err)
		http.Error(w, fmt.Sprintf("Failed to start streaming: %v", err), http.StatusInternalServerError)
		return
	}

	// NOW run extraction asynchronously - events will be captured
	resultCh, err := pipeline.RunExtractionAsyncWithSession(ctx, req.Directory, authInfo.UserID, sessionID, progressCh)
	if err != nil {
		cancel()
		close(progressCh)            // Close progress channel to prevent leak
		h.hub.StopSession(sessionID) // Clean up streaming on error
		log.Printf("ERROR: StartSync for user %s - failed to start extraction: %v", authInfo.UserID, err)
		http.Error(w, fmt.Sprintf("Failed to start extraction: %v", err), http.StatusInternalServerError)
		return
	}

	// Clean up when extraction completes
	go func() {
		defer func() {
			if r := recover(); r != nil {
				streaming.HandlePanic(r, "sync cleanup")
			}
		}()

		result, ok := <-resultCh
		if !ok {
			log.Printf("ERROR: Result channel closed unexpectedly for session %s without sending result", sessionID)

			// Update session to failed state
			session, err := h.sessionStore.Get(r.Context(), sessionID)
			if err != nil {
				log.Printf("ERROR: Failed to retrieve session %s for cleanup: %v", sessionID, err)
			} else {
				now := time.Now()
				session.Status = filesync.SessionStatusFailed
				session.CompletedAt = &now
				if updateErr := h.sessionStore.Update(r.Context(), session); updateErr != nil {
					log.Printf("ERROR: Failed to update session %s to failed state: %v", sessionID, updateErr)
				}
			}

			// Send error to connected clients
			h.hub.SendErrorToClients(sessionID,
				"Extraction pipeline ended unexpectedly. Please contact support if this persists.",
				"error")

			// Clean up resources
			close(progressCh)
			cancel()
			h.registry.Remove(sessionID) // Add this cleanup
			return
		}

		if result == nil {
			log.Printf("ERROR: Received nil result from extraction pipeline")
			// Send error to connected clients
			h.hub.SendErrorToClients(sessionID,
				"Extraction pipeline returned invalid result. Please try again.",
				"error")
			close(progressCh)
			cancel()
			return
		}

		close(progressCh) // Signal forwarder to stop
		cancel()
		h.registry.Remove(result.SessionID)
	}()

	// Register running session
	h.registry.Register(sessionID, &RunningSession{
		SessionID:  sessionID,
		Cancel:     cancel,
		ProgressCh: progressCh,
	})

	// Return HTML partial for HTMX swap
	w.Header().Set("Content-Type", "text/html")
	w.WriteHeader(http.StatusAccepted)
	if err := partials.SyncMonitor(sessionID).Render(r.Context(), w); err != nil {
		log.Printf("ERROR: StartSync - failed to render monitor: %v", err)
		http.Error(w, "Failed to render monitor", http.StatusInternalServerError)
		return
	}
}

// GetSession handles GET /api/sync/{id}
func (h *SyncHandlers) GetSession(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")

	// Get authenticated user
	authInfo, ok := middleware.GetAuth(r)
	if !ok {
		log.Printf("ERROR: GetSession for session %s - unauthorized access attempt", sessionID)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	session, err := h.sessionStore.Get(r.Context(), sessionID)
	if err != nil {
		log.Printf("ERROR: GetSession for user %s, session %s - session not found: %v", authInfo.UserID, sessionID, err)
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	// Verify ownership
	if session.UserID != authInfo.UserID {
		log.Printf("ERROR: GetSession - user %s attempted to access session %s owned by %s", authInfo.UserID, sessionID, session.UserID)
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(session)
}

// CancelSync handles POST /api/sync/{id}/cancel
func (h *SyncHandlers) CancelSync(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")

	// Get authenticated user
	authInfo, ok := middleware.GetAuth(r)
	if !ok {
		log.Printf("ERROR: CancelSync for session %s - unauthorized access attempt", sessionID)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Retrieve session from store
	session, err := h.sessionStore.Get(r.Context(), sessionID)
	if err != nil {
		log.Printf("ERROR: CancelSync for user %s, session %s - session not found: %v", authInfo.UserID, sessionID, err)
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	// Verify session ownership
	if session.UserID != authInfo.UserID {
		log.Printf("ERROR: CancelSync - user %s attempted to cancel session %s owned by %s", authInfo.UserID, sessionID, session.UserID)
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	running, ok := h.registry.Get(sessionID)
	if !ok {
		log.Printf("ERROR: CancelSync for user %s, session %s - session not running", authInfo.UserID, sessionID)
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

	authInfo, ok := middleware.GetAuth(r)
	if !ok {
		log.Printf("ERROR: ApproveFile for file %s - unauthorized access attempt", fileID)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Get file to find its session
	file, err := h.fileStore.Get(r.Context(), fileID)
	if err != nil {
		log.Printf("ERROR: ApproveFile for user %s, file %s - file not found: %v", authInfo.UserID, fileID, err)
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	// Verify ownership via session
	session, err := h.sessionStore.Get(r.Context(), file.SessionID)
	if err != nil {
		log.Printf("ERROR: ApproveFile for user %s, file %s, session %s - session not found: %v", authInfo.UserID, fileID, file.SessionID, err)
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	if session.UserID != authInfo.UserID {
		log.Printf("ERROR: ApproveFile - user %s attempted to approve file %s in session %s owned by %s", authInfo.UserID, fileID, file.SessionID, session.UserID)
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	// Create pipeline (we need it for approval)
	pipeline, err := print.NewPrintPipeline(r.Context(), h.gcsClient, h.fsClient.Client, h.bucket, nil)
	if err != nil {
		log.Printf("ERROR: ApproveFile for user %s, file %s - failed to create pipeline: %v", authInfo.UserID, fileID, err)
		http.Error(w, fmt.Sprintf("Failed to create pipeline: %v", err), http.StatusInternalServerError)
		return
	}

	// Approve and upload
	_, err = pipeline.ApproveAndUpload(r.Context(), file.SessionID, []string{fileID})
	if err != nil {
		operation := "approve_and_upload"
		stage := "unknown"
		if strings.Contains(err.Error(), "normalize") {
			stage = "normalize"
		} else if strings.Contains(err.Error(), "upload") {
			stage = "upload"
		} else if strings.Contains(err.Error(), "update") {
			stage = "update"
		}
		log.Printf("ERROR: %s operation failed for user %s, file %s, session %s - Stage: %s, Error: %v",
			operation, authInfo.UserID, fileID, file.SessionID, stage, err)
		http.Error(w, fmt.Sprintf("Failed to %s file (stage: %s): %v", operation, stage, err),
			http.StatusInternalServerError)
		return
	}

	// Get updated file from store
	updatedFile, err := h.fileStore.Get(r.Context(), fileID)
	if err != nil {
		log.Printf("ERROR: ApproveFile for user %s, file %s - failed to get updated file: %v", authInfo.UserID, fileID, err)
		http.Error(w, fmt.Sprintf("Failed to get updated file: %v", err), http.StatusInternalServerError)
		return
	}

	// Render HTML partial with OOB swap (replacing existing row)
	w.Header().Set("Content-Type", "text/html")
	if err := partials.FileRow(updatedFile, true).Render(r.Context(), w); err != nil {
		log.Printf("ERROR: ApproveFile for user %s, file %s - failed to render partial: %v", authInfo.UserID, fileID, err)
		http.Error(w, fmt.Sprintf("Failed to render partial: %v", err), http.StatusInternalServerError)
		return
	}
}

// ApproveAll handles POST /api/sync/{id}/approve-all
func (h *SyncHandlers) ApproveAll(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")

	// Get authenticated user
	authInfo, ok := middleware.GetAuth(r)
	if !ok {
		log.Printf("ERROR: ApproveAll for session %s - unauthorized access attempt", sessionID)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Retrieve session from store
	session, err := h.sessionStore.Get(r.Context(), sessionID)
	if err != nil {
		log.Printf("ERROR: ApproveAll for user %s, session %s - session not found: %v", authInfo.UserID, sessionID, err)
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	// Verify session ownership
	if session.UserID != authInfo.UserID {
		log.Printf("ERROR: ApproveAll - user %s attempted to approve all in session %s owned by %s", authInfo.UserID, sessionID, session.UserID)
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	// Create pipeline
	pipeline, err := print.NewPrintPipeline(r.Context(), h.gcsClient, h.fsClient.Client, h.bucket, nil)
	if err != nil {
		log.Printf("ERROR: ApproveAll for user %s, session %s - failed to create pipeline: %v", authInfo.UserID, sessionID, err)
		http.Error(w, fmt.Sprintf("Failed to create pipeline: %v", err), http.StatusInternalServerError)
		return
	}

	// Approve all (triggers async uploads, SSE will handle updates)
	_, err = pipeline.ApproveAllAndUpload(r.Context(), sessionID)
	if err != nil {
		log.Printf("ERROR: ApproveAll for user %s, session %s - failed to approve all files: %v", authInfo.UserID, sessionID, err)
		http.Error(w, fmt.Sprintf("Failed to approve all files: %v", err), http.StatusInternalServerError)
		return
	}

	// Return success message HTML
	w.Header().Set("Content-Type", "text/html")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`<div class="p-4 bg-success-muted border border-success rounded-lg"><p class="text-success font-medium">Approving all files... uploads in progress</p></div>`))
}

// UploadSelected handles POST /api/sync/{id}/upload-selected
func (h *SyncHandlers) UploadSelected(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")

	// Authenticate user and verify session ownership
	authInfo, ok := middleware.GetAuth(r)
	if !ok {
		log.Printf("ERROR: UploadSelected for session %s - unauthorized access attempt", sessionID)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	session, err := h.sessionStore.Get(r.Context(), sessionID)
	if err != nil || session.UserID != authInfo.UserID {
		log.Printf("ERROR: UploadSelected for user %s, session %s - session not found or forbidden: %v", authInfo.UserID, sessionID, err)
		http.Error(w, "Session not found or forbidden", http.StatusForbidden)
		return
	}

	// Parse form to get selected file IDs
	if err := r.ParseForm(); err != nil {
		log.Printf("ERROR: UploadSelected for user %s, session %s - failed to parse form: %v", authInfo.UserID, sessionID, err)
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	fileIDs := r.Form["file-ids"]
	if len(fileIDs) == 0 {
		log.Printf("ERROR: UploadSelected for user %s, session %s - no files selected", authInfo.UserID, sessionID)
		http.Error(w, "No files selected", http.StatusBadRequest)
		return
	}

	// Create pipeline and upload selected files
	pipeline, err := print.NewPrintPipeline(r.Context(), h.gcsClient, h.fsClient.Client, h.bucket, nil)
	if err != nil {
		log.Printf("ERROR: UploadSelected for user %s, session %s - failed to create pipeline: %v", authInfo.UserID, sessionID, err)
		http.Error(w, fmt.Sprintf("Failed to create pipeline: %v", err), http.StatusInternalServerError)
		return
	}

	// REUSE existing ApproveAndUpload method - it already accepts file ID arrays!
	_, err = pipeline.ApproveAndUpload(r.Context(), sessionID, fileIDs)
	if err != nil {
		log.Printf("ERROR: UploadSelected for user %s, session %s - failed to upload files: %v", authInfo.UserID, sessionID, err)
		http.Error(w, fmt.Sprintf("Failed to upload files: %v", err), http.StatusInternalServerError)
		return
	}

	// Return success message
	w.Header().Set("Content-Type", "text/html")
	fileWord := "file"
	if len(fileIDs) > 1 {
		fileWord = "files"
	}
	fmt.Fprintf(w, `<div class="p-4 bg-success-muted border border-success rounded-lg">
		<p class="text-success font-medium">Uploading %d %s...</p>
	</div>`, len(fileIDs), fileWord)
}

// RejectFile handles POST /api/files/{id}/reject
func (h *SyncHandlers) RejectFile(w http.ResponseWriter, r *http.Request) {
	fileID := r.PathValue("id")

	authInfo, ok := middleware.GetAuth(r)
	if !ok {
		log.Printf("ERROR: RejectFile for file %s - unauthorized access attempt", fileID)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Get file to find its session
	file, err := h.fileStore.Get(r.Context(), fileID)
	if err != nil {
		log.Printf("ERROR: RejectFile for user %s, file %s - file not found: %v", authInfo.UserID, fileID, err)
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	// Verify ownership via session
	session, err := h.sessionStore.Get(r.Context(), file.SessionID)
	if err != nil {
		log.Printf("ERROR: RejectFile for user %s, file %s, session %s - session not found: %v", authInfo.UserID, fileID, file.SessionID, err)
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	if session.UserID != authInfo.UserID {
		log.Printf("ERROR: RejectFile - user %s attempted to reject file %s in session %s owned by %s", authInfo.UserID, fileID, file.SessionID, session.UserID)
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	// Create pipeline
	pipeline, err := print.NewPrintPipeline(r.Context(), h.gcsClient, h.fsClient.Client, h.bucket, nil)
	if err != nil {
		log.Printf("ERROR: RejectFile for user %s, file %s - failed to create pipeline: %v", authInfo.UserID, fileID, err)
		http.Error(w, fmt.Sprintf("Failed to create pipeline: %v", err), http.StatusInternalServerError)
		return
	}

	// Reject file
	if err := pipeline.RejectFiles(r.Context(), file.SessionID, []string{fileID}); err != nil {
		log.Printf("ERROR: RejectFile for user %s, file %s - failed to reject file: %v", authInfo.UserID, fileID, err)
		http.Error(w, fmt.Sprintf("Failed to reject file: %v", err), http.StatusInternalServerError)
		return
	}

	// Get updated file from store
	updatedFile, err := h.fileStore.Get(r.Context(), fileID)
	if err != nil {
		log.Printf("ERROR: RejectFile for user %s, file %s - failed to get updated file: %v", authInfo.UserID, fileID, err)
		http.Error(w, fmt.Sprintf("Failed to get updated file: %v", err), http.StatusInternalServerError)
		return
	}

	// Render HTML partial with OOB swap (replacing existing row)
	w.Header().Set("Content-Type", "text/html")
	if err := partials.FileRow(updatedFile, true).Render(r.Context(), w); err != nil {
		log.Printf("ERROR: RejectFile for user %s, file %s - failed to render partial: %v", authInfo.UserID, fileID, err)
		http.Error(w, fmt.Sprintf("Failed to render partial: %v", err), http.StatusInternalServerError)
		return
	}
}

// TrashFile handles POST /api/files/{id}/trash
func (h *SyncHandlers) TrashFile(w http.ResponseWriter, r *http.Request) {
	fileID := r.PathValue("id")

	// Get authenticated user
	authInfo, ok := middleware.GetAuth(r)
	if !ok {
		log.Printf("ERROR: TrashFile for file %s - unauthorized access attempt", fileID)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Get file to find its session
	file, err := h.fileStore.Get(r.Context(), fileID)
	if err != nil {
		log.Printf("ERROR: TrashFile for user %s, file %s - file not found: %v", authInfo.UserID, fileID, err)
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	// Verify ownership via session
	session, err := h.sessionStore.Get(r.Context(), file.SessionID)
	if err != nil {
		log.Printf("ERROR: TrashFile for user %s, file %s, session %s - session not found: %v", authInfo.UserID, fileID, file.SessionID, err)
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	if session.UserID != authInfo.UserID {
		log.Printf("ERROR: TrashFile - user %s attempted to trash file %s in session %s owned by %s", authInfo.UserID, fileID, file.SessionID, session.UserID)
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	// Create pipeline
	pipeline, err := print.NewPrintPipeline(r.Context(), h.gcsClient, h.fsClient.Client, h.bucket, nil)
	if err != nil {
		log.Printf("ERROR: TrashFile for user %s, file %s - failed to create pipeline: %v", authInfo.UserID, fileID, err)
		http.Error(w, fmt.Sprintf("Failed to create pipeline: %v", err), http.StatusInternalServerError)
		return
	}

	// Trash file
	if err := pipeline.TrashFiles(r.Context(), file.SessionID, []string{fileID}); err != nil {
		log.Printf("ERROR: TrashFile for user %s, file %s - failed to trash file: %v", authInfo.UserID, fileID, err)
		http.Error(w, fmt.Sprintf("Failed to trash file: %v", err), http.StatusInternalServerError)
		return
	}

	// Return empty response - HTMX will swap out the element, SSE update will handle removal
	w.Header().Set("Content-Type", "text/html")
	w.WriteHeader(http.StatusOK)
}

// TrashAll handles POST /api/sync/{id}/trash-all
func (h *SyncHandlers) TrashAll(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")

	// Get authenticated user
	authInfo, ok := middleware.GetAuth(r)
	if !ok {
		log.Printf("ERROR: TrashAll for session %s - unauthorized access attempt", sessionID)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Retrieve session from store
	session, err := h.sessionStore.Get(r.Context(), sessionID)
	if err != nil {
		log.Printf("ERROR: TrashAll for user %s, session %s - session not found: %v", authInfo.UserID, sessionID, err)
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	// Verify session ownership
	if session.UserID != authInfo.UserID {
		log.Printf("ERROR: TrashAll - user %s attempted to trash all in session %s owned by %s", authInfo.UserID, sessionID, session.UserID)
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	// Get all uploaded/skipped files
	files, err := h.fileStore.ListBySession(r.Context(), sessionID)
	if err != nil {
		log.Printf("ERROR: TrashAll for user %s, session %s - failed to list files: %v", authInfo.UserID, sessionID, err)
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
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`<div class="p-4 bg-text-tertiary border border-bg-hover rounded-lg"><p class="text-text-secondary font-medium">No files to trash</p></div>`))
		return
	}

	// Create pipeline
	pipeline, err := print.NewPrintPipeline(r.Context(), h.gcsClient, h.fsClient.Client, h.bucket, nil)
	if err != nil {
		log.Printf("ERROR: TrashAll for user %s, session %s - failed to create pipeline: %v", authInfo.UserID, sessionID, err)
		http.Error(w, fmt.Sprintf("Failed to create pipeline: %v", err), http.StatusInternalServerError)
		return
	}

	// Trash all
	if err := pipeline.TrashFiles(r.Context(), sessionID, fileIDs); err != nil {
		log.Printf("ERROR: TrashAll for user %s, session %s - failed to trash files: %v", authInfo.UserID, sessionID, err)
		http.Error(w, fmt.Sprintf("Failed to trash files: %v", err), http.StatusInternalServerError)
		return
	}

	// Return success message HTML (SSE will handle individual file removals)
	w.Header().Set("Content-Type", "text/html")
	w.WriteHeader(http.StatusOK)

	// Proper pluralization
	fileWord := "file"
	if len(fileIDs) > 1 {
		fileWord = "files"
	}

	// Return message with OOB swap directive to target #trash-message
	successMsg := fmt.Sprintf(`<div id="trash-message" hx-swap-oob="true" class="mt-4 p-4 bg-success-muted border border-success rounded-lg"><p class="text-success font-medium">Trashed %d %s</p></div>`, len(fileIDs), fileWord)
	w.Write([]byte(successMsg))
}

// RetryFile handles POST /api/files/{id}/retry
func (h *SyncHandlers) RetryFile(w http.ResponseWriter, r *http.Request) {
	// Get authenticated user
	authInfo, ok := middleware.GetAuth(r)
	if !ok {
		log.Printf("ERROR: RetryFile - unauthorized access attempt")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	fileID := r.PathValue("id")
	if fileID == "" {
		log.Printf("ERROR: RetryFile for user %s - missing file ID", authInfo.UserID)
		http.Error(w, "File ID is required", http.StatusBadRequest)
		return
	}

	// Get file to verify ownership
	file, err := h.fileStore.Get(r.Context(), fileID)
	if err != nil {
		log.Printf("ERROR: RetryFile for user %s - file %s not found: %v", authInfo.UserID, fileID, err)
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	// Get session to verify ownership
	session, err := h.sessionStore.Get(r.Context(), file.SessionID)
	if err != nil {
		log.Printf("ERROR: RetryFile for user %s - session not found: %v", authInfo.UserID, err)
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	if session.UserID != authInfo.UserID {
		log.Printf("ERROR: RetryFile - user %s attempted to retry file from session owned by %s", authInfo.UserID, session.UserID)
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	// Get the active session from registry (just to verify it's active)
	_, ok = h.registry.Get(file.SessionID)
	if !ok {
		log.Printf("ERROR: RetryFile for user %s - session %s not active", authInfo.UserID, file.SessionID)
		http.Error(w, "Session not active", http.StatusBadRequest)
		return
	}

	// Retry the file by re-extracting metadata
	ctx := context.WithoutCancel(r.Context())
	go func() {
		defer func() {
			if r := recover(); r != nil {
				streaming.HandlePanic(r, "retry file")
			}
		}()
		log.Printf("INFO: Retrying file %s for user %s", fileID, authInfo.UserID)

		// Update file status to extracting
		file.Status = filesync.FileStatusExtracting
		file.Error = ""
		if err := h.fileStore.Update(ctx, file); err != nil {
			log.Printf("ERROR: Failed to update file %s status: %v", fileID, err)
			return
		}

		// Use extractor to re-extract the file
		fileInfo := filesync.FileInfo{Path: file.LocalPath}
		extractor := print.NewDefaultExtractor()

		// Consume progress updates to prevent blocking
		progressChan := make(chan filesync.Progress)
		go func() {
			for range progressChan {
				// Drain progress updates
			}
		}()
		defer close(progressChan)

		extractedMetadata, err := extractor.Extract(ctx, fileInfo, progressChan)

		if err != nil {
			file.Status = filesync.FileStatusError
			file.Error = fmt.Sprintf("Retry failed: %v", err)
			log.Printf("ERROR: Retry extraction failed for file %s: %v", fileID, err)

			// Notify connected clients of retry failure
			h.hub.SendErrorToClients(file.SessionID,
				fmt.Sprintf("Failed to retry file %s: %v", file.LocalPath, err),
				"warning") // Warning severity - expected user action
		} else {
			file.Status = filesync.FileStatusExtracted
			// Convert ExtractedMetadata to FileMetadata
			file.Metadata = filesync.FileMetadata{
				Title:       extractedMetadata.Title,
				Author:      "", // Print metadata doesn't have author directly
				ISBN:        "",
				Publisher:   "",
				PublishDate: "",
				Extra:       make(map[string]string),
			}
			// Copy any raw fields to Extra
			if extractedMetadata.Raw != nil {
				for k, v := range extractedMetadata.Raw {
					if str, ok := v.(string); ok {
						file.Metadata.Extra[k] = str
					}
				}
			}
			file.Error = ""
			log.Printf("INFO: Successfully retried file %s", fileID)
		}

		if updateErr := h.fileStore.Update(ctx, file); updateErr != nil {
			log.Printf("ERROR: Failed to update file %s after retry: %v", fileID, updateErr)
			// Also notify about store update failure
			h.hub.SendErrorToClients(file.SessionID,
				fmt.Sprintf("File %s retry completed but failed to save: %v", file.LocalPath, updateErr),
				"error") // Error severity - unexpected system issue
		}
	}()

	// Return updated file row HTML with OOB swap (replacing existing row)
	w.Header().Set("Content-Type", "text/html")
	// Create a copy for rendering to avoid race condition
	displayFile := *file
	displayFile.Status = filesync.FileStatusExtracting // Show extracting state immediately
	displayFile.Error = ""
	if err := partials.FileRow(&displayFile, true).Render(r.Context(), w); err != nil {
		log.Printf("ERROR: RetryFile for user %s, file %s - failed to render: %v", authInfo.UserID, fileID, err)
		http.Error(w, "Failed to render response", http.StatusInternalServerError)
		return
	}
}

// HistoryPartial handles GET /partials/sync/history
func (h *SyncHandlers) HistoryPartial(w http.ResponseWriter, r *http.Request) {
	// Get authenticated user
	authInfo, ok := middleware.GetAuth(r)
	if !ok {
		log.Printf("ERROR: HistoryPartial - unauthorized access attempt")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Get user's sessions
	sessions, err := h.sessionStore.List(r.Context(), authInfo.UserID)
	if err != nil {
		log.Printf("ERROR: HistoryPartial for user %s - failed to list sessions: %v", authInfo.UserID, err)
		http.Error(w, fmt.Sprintf("Failed to list sessions: %v", err), http.StatusInternalServerError)
		return
	}

	// Render partial
	partials.SyncHistory(sessions).Render(r.Context(), w)
}
