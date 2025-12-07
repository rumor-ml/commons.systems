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
	flusher.Flush()

	// Get initial file list
	files, err := h.fileStore.ListBySession(r.Context(), sessionID)
	if err != nil {
		// Continue streaming anyway - files may arrive via subscriptions
		log.Printf("ERROR: Failed to list initial files for session %s: %v", sessionID, err)
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
				return
			}
			if _, err := fmt.Fprintf(w, "data: {\"status\":\"alive\"}\n\n"); err != nil {
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
		if err := partials.FileRow(file).Render(ctx, &buf); err != nil {
			return err
		}

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
