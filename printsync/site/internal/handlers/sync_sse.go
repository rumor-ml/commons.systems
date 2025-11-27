package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"printsync/internal/streaming"
)

// StreamSession handles GET /api/sync/{id}/stream (SSE endpoint)
func (h *SyncHandlers) StreamSession(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")

	// Verify session exists
	session, err := h.sessionStore.Get(r.Context(), sessionID)
	if err != nil {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // Disable nginx buffering

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming not supported", http.StatusInternalServerError)
		return
	}

	// Register client with hub
	client := h.hub.Register(sessionID)
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
	if err := writeSSEEvent(w, initialEvent); err != nil {
		return
	}
	flusher.Flush()

	// Get initial file list
	files, err := h.fileStore.ListBySession(r.Context(), sessionID)
	if err == nil {
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
			if err := writeSSEEvent(w, fileEvent); err != nil {
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
				return
			}

			if err := writeSSEEvent(w, event); err != nil {
				return
			}
			flusher.Flush()

			// If this is a complete event, end the stream
			if event.Type == streaming.EventTypeComplete {
				return
			}

		case <-heartbeat.C:
			// Send heartbeat
			heartbeatEvent := streaming.SSEEvent{
				Type:      streaming.EventTypeHeartbeat,
				Timestamp: time.Now(),
				Data:      map[string]string{"status": "alive"},
			}
			if err := writeSSEEvent(w, heartbeatEvent); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// writeSSEEvent writes an SSE event to the response writer
func writeSSEEvent(w http.ResponseWriter, event streaming.SSEEvent) error {
	// Marshal data to JSON
	data, err := json.Marshal(event.Data)
	if err != nil {
		return err
	}

	// Write event
	if _, err := fmt.Fprintf(w, "event: %s\n", event.Type); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "data: %s\n\n", data); err != nil {
		return err
	}

	return nil
}
