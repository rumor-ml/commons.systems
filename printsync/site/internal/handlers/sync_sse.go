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

	// Get authenticated user
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

	// Set SSE headers
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
	client := h.hub.Register(r.Context(), sessionID)
	if client == nil {
		log.Printf("ERROR: StreamSession for session %s - failed to register client", sessionID)
		http.Error(w, "Failed to register SSE client", http.StatusInternalServerError)
		return
	}
	defer h.hub.Unregister(sessionID, client)

	// Send initial session state
	initialEvent := streaming.SSEEvent{
		Type:      streaming.EventTypeSession,
		Timestamp: time.Now(),
		Data: streaming.SessionEvent{
			ID:          session.ID,
			Status:      session.Status,
			Stats:       session.Stats,
			CompletedAt: session.CompletedAt,
		},
	}
	if err := h.writeSSEEventHTML(w, r.Context(), initialEvent); err != nil {
		log.Printf("ERROR: StreamSession for session %s - failed to write initial session event: %v", sessionID, err)
		return
	}

	// Send initial action buttons state
	actionsEvent := streaming.SSEEvent{
		Type:      streaming.EventTypeActions,
		Timestamp: time.Now(),
		Data: streaming.ActionsEvent{
			SessionID: session.ID,
			Stats:     session.Stats,
		},
	}
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
	progressEvent := streaming.SSEEvent{
		Type:      streaming.EventTypeProgress,
		Timestamp: time.Now(),
		Data: streaming.ProgressEvent{
			Operation:  progressOperation,
			Percentage: 0,
		},
	}
	if err := h.writeSSEEventHTML(w, r.Context(), progressEvent); err != nil {
		log.Printf("ERROR: StreamSession for session %s - failed to write initial progress event: %v", sessionID, err)
		return
	}
	flusher.Flush()

	// Get initial file list
	files, err := h.fileStore.ListBySession(r.Context(), sessionID)
	log.Printf("DEBUG: ListBySession(sessionID=%s) returned %d files, err=%v", sessionID, len(files), err)
	if err != nil {
		// Continue streaming anyway - files may arrive via subscriptions
		log.Printf("ERROR: Failed to list initial files for session %s: %v", sessionID, err)

		// Send error event to user
		errorEvent := streaming.SSEEvent{
			Type:      streaming.EventTypeError,
			Timestamp: time.Now(),
			Data: streaming.ErrorEvent{
				Message:  fmt.Sprintf("Failed to load initial file list: %v", err),
				Severity: "error",
			},
		}
		if writeErr := h.writeSSEEventHTML(w, r.Context(), errorEvent); writeErr != nil {
			log.Printf("ERROR: Failed to write error event: %v", writeErr)
			return
		}
		flusher.Flush()
	} else {
		for _, file := range files {
			fileEvent := streaming.SSEEvent{
				Type:      streaming.EventTypeFile,
				Timestamp: time.Now(),
				Data: streaming.FileEvent{
					ID:        file.ID,
					SessionID: file.SessionID,
					LocalPath: file.LocalPath,
					Status:    file.Status,
					Metadata:  file.Metadata,
					Error:     file.Error,
					IsUpdate:  false, // Initial load - will append
				},
			}
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
				log.Printf("ERROR: StreamSession for session %s - failed to write event %s: %v", sessionID, event.Type, err)
				return
			}
			flusher.Flush()

			// If this is a complete event, end the stream
			if event.Type == streaming.EventTypeComplete {
				return
			}

		case <-heartbeat.C:
			// Send heartbeat (keep as simple text)
			if _, err := fmt.Fprintf(w, "event: %s\n", streaming.EventTypeHeartbeat); err != nil {
				log.Printf("ERROR: Heartbeat write failed for session %s: %v", sessionID, err)
				return
			}
			if _, err := fmt.Fprintf(w, "data: {\"status\":\"alive\"}\n\n"); err != nil {
				log.Printf("ERROR: Heartbeat data write failed for session %s: %v", sessionID, err)
				return
			}
			flusher.Flush()
		}
	}
}

// writeSSEEventHTML writes an SSE event with HTML partial content to the response writer
func (h *SyncHandlers) writeSSEEventHTML(w http.ResponseWriter, ctx context.Context, event streaming.SSEEvent) error {
	var buf bytes.Buffer

	switch event.Type {
	case streaming.EventTypeSession:
		sessionData, ok := event.Data.(streaming.SessionEvent)
		if !ok {
			return fmt.Errorf("invalid session event data type")
		}
		if err := partials.SessionStats(sessionData).Render(ctx, &buf); err != nil {
			return err
		}

		// Send action buttons as a separate SSE event (not embedded in session event)
		// This is sent immediately after the session stats event in the caller
		// No OOB swaps in SSE - each event updates its own sse-swap target

	case streaming.EventTypeActions:
		actionsData, ok := event.Data.(streaming.ActionsEvent)
		if !ok {
			return fmt.Errorf("invalid actions event data type")
		}
		if err := partials.ActionButtons(actionsData.SessionID, actionsData.Stats).Render(ctx, &buf); err != nil {
			return err
		}

	case streaming.EventTypeProgress:
		progressData, ok := event.Data.(streaming.ProgressEvent)
		if !ok {
			return fmt.Errorf("invalid progress event data type")
		}
		if err := partials.ProgressBar(progressData).Render(ctx, &buf); err != nil {
			return err
		}

	case streaming.EventTypeFile:
		fileData, ok := event.Data.(streaming.FileEvent)
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
		errorData, ok := event.Data.(streaming.ErrorEvent)
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
		return fmt.Errorf("unknown event type: %s", event.Type)
	}

	// Remove newlines for compact SSE
	html := strings.ReplaceAll(buf.String(), "\n", "")

	// Write SSE event
	if _, err := fmt.Fprintf(w, "event: %s\n", event.Type); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "data: %s\n\n", html); err != nil {
		return err
	}

	return nil
}
