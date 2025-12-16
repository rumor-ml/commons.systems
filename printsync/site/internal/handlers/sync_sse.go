package handlers

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/commons-systems/filesync"
	"printsync/internal/middleware"
	"printsync/internal/streaming"
	"printsync/web/templates/partials"
)

// StreamSession handles GET /api/sync/{id}/stream (SSE endpoint)
func (h *SyncHandlers) StreamSession(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")

	authInfo, ok := middleware.GetAuth(r)
	if !ok {
		log.Printf("ERROR: StreamSession for session %s - unauthorized access attempt", sessionID)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Verify session exists and ownership
	session, err := h.sessionStore.Get(r.Context(), sessionID)
	if err != nil {
		log.Printf("ERROR: StreamSession for user %s, session %s - session not found: %v", authInfo.UserID, sessionID, err)
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	if session.UserID != authInfo.UserID {
		log.Printf("ERROR: StreamSession - user %s attempted to stream session %s owned by %s", authInfo.UserID, sessionID, session.UserID)
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // Disable nginx buffering

	flusher, ok := w.(http.Flusher)
	if !ok {
		log.Printf("ERROR: StreamSession for user %s, session %s - streaming not supported", authInfo.UserID, sessionID)
		http.Error(w, "Streaming not supported", http.StatusInternalServerError)
		return
	}

	// Register client with hub
	client, err := h.hub.Register(r.Context(), sessionID)
	if err != nil {
		log.Printf("ERROR: Failed to register client for session %s: %v", sessionID, err)
		http.Error(w, "Failed to initialize streaming connection. Please try refreshing.", http.StatusInternalServerError)
		return
	}
	if client == nil {
		// Should not happen after signature change, but defensive
		log.Printf("ERROR: Client is nil after registration for session %s", sessionID)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	defer h.hub.Unregister(sessionID, client)

	// Send initial session state
	initialEvent := streaming.NewSessionEvent(session)
	if err := h.writeSSEEventHTML(w, r.Context(), initialEvent); err != nil {
		log.Printf("ERROR: StreamSession for session %s - failed to write initial session event: %v", sessionID, err)
		return
	}

	// Send initial action buttons state
	actionsEvent := streaming.NewActionsEvent(session.ID, session.Stats)
	if err := h.writeSSEEventHTML(w, r.Context(), actionsEvent); err != nil {
		log.Printf("ERROR: StreamSession for session %s - failed to write initial actions event: %v", sessionID, err)
		return
	}

	// Send initial progress event based on session state
	var progressOperation string
	switch session.Status {
	case filesync.SessionStatusCompleted:
		progressOperation = "Sync completed"
	case filesync.SessionStatusFailed:
		progressOperation = "Sync failed"
	case filesync.SessionStatusRunning:
		if session.Stats.Extracted > 0 {
			progressOperation = "Extracting metadata..."
		} else if session.Stats.Discovered > 0 {
			progressOperation = "Discovering files..."
		} else {
			progressOperation = "Starting..."
		}
	default:
		progressOperation = "Processing..."
	}
	progressEvent := streaming.NewProgressEvent(progressOperation, "", 0)
	if err := h.writeSSEEventHTML(w, r.Context(), progressEvent); err != nil {
		log.Printf("ERROR: StreamSession for session %s - failed to write initial progress event: %v", sessionID, err)
		return
	}
	flusher.Flush()

	files, err := h.fileStore.ListBySession(r.Context(), sessionID)
	log.Printf("DEBUG: ListBySession(sessionID=%s) returned %d files, err=%v", sessionID, len(files), err)
	if err != nil {
		// Continue streaming anyway - files may arrive via subscriptions
		log.Printf("WARNING: Failed to list initial files for session %s: %v", sessionID, err) // WARNING not ERROR

		// Send warning event to user
		errorEvent := streaming.NewErrorEvent(
			"Unable to load existing files, but new files will appear as they're processed. If this persists, try refreshing the page.",
			"warning", // warning not error
		)
		if writeErr := h.writeSSEEventHTML(w, r.Context(), errorEvent); writeErr != nil {
			log.Printf("ERROR: Failed to write error event: %v", writeErr)
			return
		}
		flusher.Flush()
	} else {
		for _, file := range files {
			fileEvent := streaming.NewFileEvent(file, false) // IsUpdate=false for initial load
			if err := h.writeSSEEventHTML(w, r.Context(), fileEvent); err != nil {
				log.Printf("ERROR: StreamSession for session %s - failed to write file event for %s: %v", sessionID, file.ID, err)
				return
			}
		}
		flusher.Flush()
	}

	// Heartbeat ticker
	heartbeat := time.NewTicker(30 * time.Second)
	defer heartbeat.Stop()

	// Stream events until client disconnects or session completes
	for {
		select {
		case <-r.Context().Done():
			// Client disconnected
			return

		case event, ok := <-client.Events:
			if !ok {
				// Channel closed, streaming ended
				log.Printf("DEBUG: StreamSession for session %s - channel closed, ending stream", sessionID)
				return
			}

			if err := h.writeSSEEventHTML(w, r.Context(), event); err != nil {
				log.Printf("ERROR: StreamSession for session %s - failed to write event %s: %v", sessionID, event.EventType(), err)
				return
			}
			flusher.Flush()

			// If this is a complete event, end the stream
			if event.EventType() == streaming.EventTypeComplete {
				return
			}

		case <-heartbeat.C:
			// Send heartbeat (keep as simple text)
			if _, err := fmt.Fprintf(w, "event: %s\n", streaming.EventTypeHeartbeat); err != nil {
				log.Printf("INFO: SSE connection closed during heartbeat for session %s (client likely disconnected): %v", sessionID, err) // INFO not ERROR
				return
			}
			if _, err := fmt.Fprintf(w, "data: {\"status\":\"alive\"}\n\n"); err != nil {
				log.Printf("INFO: SSE connection closed during heartbeat for session %s (client likely disconnected): %v", sessionID, err) // INFO not ERROR
				return
			}
			flusher.Flush()
		}
	}
}

// writeSSEEventHTML writes an SSE event with HTML partial content to the response writer
func (h *SyncHandlers) writeSSEEventHTML(w http.ResponseWriter, ctx context.Context, event streaming.SSEEvent) error {
	var buf bytes.Buffer

	switch event.EventType() {
	case streaming.EventTypeSession:
		sessionData, ok := event.Data().(streaming.SessionEvent)
		if !ok {
			return fmt.Errorf("invalid session event data type")
		}
		if err := partials.SessionStats(sessionData).Render(ctx, &buf); err != nil {
			return err
		}

		// Send action buttons as a separate SSE event (not embedded in session event).
		// Rationale: Each SSE event maps to a single sse-swap target in the HTMX frontend.
		// The session stats and action buttons target different DOM elements (#session-stats
		// and #action-buttons respectively), so they must be sent as separate events with
		// distinct event types to enable independent DOM updates via sse-swap.
		// See streaming/events.go for event type definitions.

	case streaming.EventTypeActions:
		actionsData, ok := event.Data().(streaming.ActionsEvent)
		if !ok {
			return fmt.Errorf("invalid actions event data type")
		}
		if err := partials.ActionButtons(actionsData.SessionID, actionsData.Stats).Render(ctx, &buf); err != nil {
			return err
		}

	case streaming.EventTypeProgress:
		progressData, ok := event.Data().(streaming.ProgressEvent)
		if !ok {
			return fmt.Errorf("invalid progress event data type")
		}
		if err := partials.ProgressBar(progressData).Render(ctx, &buf); err != nil {
			return err
		}

	case streaming.EventTypeFile:
		fileData, ok := event.Data().(streaming.FileEvent)
		if !ok {
			return fmt.Errorf("invalid file event data type")
		}
		// Convert FileEvent to SyncFile for rendering
		file := &filesync.SyncFile{
			ID:        fileData.ID,
			SessionID: fileData.SessionID,
			LocalPath: fileData.LocalPath,
			Status:    fileData.Status,
			Metadata:  fileData.Metadata,
			Error:     fileData.Error,
		}
		// Pass IsUpdate flag to enable conditional OOB swap
		if err := partials.FileRow(file, fileData.IsUpdate).Render(ctx, &buf); err != nil {
			return err
		}

	case streaming.EventTypeError:
		errorData, ok := event.Data().(streaming.ErrorEvent)
		if !ok {
			return fmt.Errorf("invalid error event data type")
		}

		severityClass := "error"
		if errorData.Severity == "warning" {
			severityClass = "warning"
		}

		errorHTML := fmt.Sprintf(
			`<div class="p-4 bg-%s-muted border border-%s rounded-lg">`+
				`<p class="text-%s font-medium">%s</p></div>`,
			severityClass, severityClass, severityClass, errorData.Message,
		)
		buf.WriteString(errorHTML)

	case streaming.EventTypeComplete:
		// Render completion message
		completeHTML := `<div class="p-4 bg-success-muted border border-success rounded-lg"><p class="text-success font-medium">Sync completed!</p></div>`
		buf.WriteString(completeHTML)

	default:
		return fmt.Errorf("unknown event type: %s", event.EventType())
	}

	// Remove newlines for compact SSE
	html := strings.ReplaceAll(buf.String(), "\n", "")

	// Write SSE event
	if _, err := fmt.Fprintf(w, "event: %s\n", event.EventType()); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "data: %s\n\n", html); err != nil {
		return err
	}

	return nil
}
