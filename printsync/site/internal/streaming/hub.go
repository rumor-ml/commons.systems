package streaming

import (
	"context"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/commons-systems/filesync"
)

// Client represents a connected SSE client
type Client struct {
	Events chan SSEEvent
}

// NewClient creates a new SSE client
func NewClient() *Client {
	return &Client{
		Events: make(chan SSEEvent, 10),
	}
}

// SessionBroadcaster broadcasts events to multiple clients for a single session
type SessionBroadcaster struct {
	mu            sync.RWMutex
	clients       map[*Client]bool
	droppedEvents map[*Client]*int64 // Track dropped events per client (pointer for atomic ops)
	merger        *StreamMerger
	ctx           context.Context
	cancel        context.CancelFunc
}

// NewSessionBroadcaster creates a new session broadcaster
func NewSessionBroadcaster(ctx context.Context, merger *StreamMerger) *SessionBroadcaster {
	ctx, cancel := context.WithCancel(ctx)
	return &SessionBroadcaster{
		clients:       make(map[*Client]bool),
		droppedEvents: make(map[*Client]*int64),
		merger:        merger,
		ctx:           ctx,
		cancel:        cancel,
	}
}

// Register adds a client to the broadcaster
func (b *SessionBroadcaster) Register(client *Client) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.clients[client] = true
	var zero int64
	b.droppedEvents[client] = &zero
}

// Unregister removes a client from the broadcaster
func (b *SessionBroadcaster) Unregister(client *Client) {
	if client == nil {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if _, ok := b.clients[client]; ok {
		delete(b.clients, client)
		delete(b.droppedEvents, client)
		close(client.Events)
	}
}

// ClientCount returns the number of connected clients
func (b *SessionBroadcaster) ClientCount() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.clients)
}

// Stop stops the broadcaster and cleans up resources
func (b *SessionBroadcaster) Stop() {
	b.cancel()
	b.merger.Stop()
}

// Start starts broadcasting events from the merger to all clients
func (b *SessionBroadcaster) Start() {
	go func() {
		// Recover from panics to prevent server crash
		defer func() {
			if r := recover(); r != nil {
				HandlePanic(r, "broadcaster Start")
			}
		}()
		defer b.Stop()
		for {
			select {
			case <-b.ctx.Done():
				return
			case event, ok := <-b.merger.Events():
				if !ok {
					return
				}
				b.broadcast(event)

				// If this is a complete event, stop the broadcaster after a short delay
				// to allow final events to be sent
				if event.Type == EventTypeComplete {
					time.Sleep(100 * time.Millisecond)
					return
				}
			}
		}
	}()
}

// broadcast sends an event to all registered clients
func (b *SessionBroadcaster) broadcast(event SSEEvent) {
	// Recover from panic if client channel was closed during iteration
	defer func() {
		if r := recover(); r != nil {
			HandlePanic(r, "broadcast")
		}
	}()

	b.mu.RLock()
	defer b.mu.RUnlock()
	for client := range b.clients {
		select {
		case client.Events <- event:
			// Successfully sent
		default:
			// Client's channel is full, skip this event
			if droppedPtr := b.droppedEvents[client]; droppedPtr != nil {
				dropped := atomic.AddInt64(droppedPtr, 1)
				log.Printf("WARNING: Dropped event %s for slow client - Total dropped: %d",
					event.Type, dropped)

				// Circuit breaker: disconnect client after N drops
				if dropped >= 100 {
					log.Printf("ERROR: Disconnecting slow client after %d dropped events", dropped)

					// Send terminal error event before disconnecting
					terminalError := NewErrorEvent(
						fmt.Sprintf("Connection too slow - disconnecting after %d dropped events. Please refresh to reconnect.", dropped),
						"error",
					)

					// Try to send the error event (best effort, non-blocking)
					select {
					case client.Events <- terminalError:
						log.Printf("INFO: Sent terminal error event to slow client before disconnect")
					default:
						log.Printf("WARNING: Could not send terminal error to slow client - channel still full")
					}

					// Small delay to allow error event to be processed before disconnect
					time.Sleep(50 * time.Millisecond)

					go b.Unregister(client) // Async to avoid deadlock
				}
			}
		}
	}
}

// StreamHub manages broadcasters for multiple sessions
type StreamHub struct {
	mu           sync.RWMutex
	broadcasters map[string]*SessionBroadcaster
	sessionStore filesync.SessionStore
	fileStore    filesync.FileStore
}

// NewStreamHub creates a new stream hub
func NewStreamHub(sessionStore filesync.SessionStore, fileStore filesync.FileStore) (*StreamHub, error) {
	if sessionStore == nil {
		return nil, fmt.Errorf("sessionStore is required")
	}
	if fileStore == nil {
		return nil, fmt.Errorf("fileStore is required")
	}

	return &StreamHub{
		broadcasters: make(map[string]*SessionBroadcaster),
		sessionStore: sessionStore,
		fileStore:    fileStore,
	}, nil
}

// Register registers a client for a session and returns the client
func (h *StreamHub) Register(ctx context.Context, sessionID string) *Client {
	h.mu.Lock()
	defer h.mu.Unlock()

	client := NewClient()

	// Get or create broadcaster for this session
	broadcaster, exists := h.broadcasters[sessionID]
	if !exists {
		// Broadcaster will be started when StartSession is called
		merger, err := NewStreamMerger(h.sessionStore, h.fileStore)
		if err != nil {
			log.Printf("ERROR: Failed to create StreamMerger for session %s: %v", sessionID, err)
			return nil
		}
		broadcaster = NewSessionBroadcaster(ctx, merger)
		h.broadcasters[sessionID] = broadcaster
	}

	broadcaster.Register(client)
	return client
}

// Unregister removes a client from a session
func (h *StreamHub) Unregister(sessionID string, client *Client) {
	if client == nil {
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	broadcaster, exists := h.broadcasters[sessionID]
	if !exists {
		return
	}

	broadcaster.Unregister(client)

	// If this was the last client, clean up the broadcaster
	if broadcaster.ClientCount() == 0 {
		log.Printf("INFO: Last client disconnected from session %s, stopping broadcaster", sessionID)
		broadcaster.Stop()
		delete(h.broadcasters, sessionID)
		log.Printf("INFO: Broadcaster for session %s cleaned up", sessionID)
	}
}

// StartSession starts streaming for a session (call this when extraction begins)
func (h *StreamHub) StartSession(ctx context.Context, sessionID string, progressCh <-chan filesync.Progress) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	broadcaster, exists := h.broadcasters[sessionID]
	if !exists {
		// Create new broadcaster if it doesn't exist
		merger, err := NewStreamMerger(h.sessionStore, h.fileStore)
		if err != nil {
			log.Printf("ERROR: Failed to create StreamMerger for session %s in StartSession: %v", sessionID, err)
			return err
		}
		broadcaster = NewSessionBroadcaster(ctx, merger)
		h.broadcasters[sessionID] = broadcaster
	}

	// Start subscriptions
	if err := broadcaster.merger.StartSessionSubscription(broadcaster.ctx, sessionID); err != nil {
		return err
	}

	if err := broadcaster.merger.StartFileSubscription(broadcaster.ctx, sessionID); err != nil {
		return err
	}

	// Forward pipeline progress
	broadcaster.merger.StartProgressForwarder(broadcaster.ctx, progressCh)

	// Start broadcasting
	broadcaster.Start()

	return nil
}

// IsRunning checks if a session broadcaster exists
func (h *StreamHub) IsRunning(sessionID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	_, exists := h.broadcasters[sessionID]
	return exists
}

// StopSession stops the broadcaster for a session and removes it from the hub.
// This should be called if pipeline initialization fails after StartSession was called.
func (h *StreamHub) StopSession(sessionID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if broadcaster, exists := h.broadcasters[sessionID]; exists {
		broadcaster.Stop()
		delete(h.broadcasters, sessionID)
	}
}

// SendErrorToClients sends an error event to all connected clients for a session.
// This is thread-safe and non-blocking. If the broadcaster doesn't exist or the
// event cannot be sent, it logs a warning but does not fail.
func (h *StreamHub) SendErrorToClients(sessionID string, message string, severity string) {
	h.mu.RLock()
	broadcaster, exists := h.broadcasters[sessionID]
	h.mu.RUnlock()

	if !exists {
		log.Printf("WARNING: Cannot send error to clients - no broadcaster for session %s", sessionID)
		return
	}

	errorEvent := NewErrorEvent(message, severity)

	// Send to merger's event channel (non-blocking)
	select {
	case broadcaster.merger.eventsCh <- errorEvent:
		log.Printf("INFO: Sent %s error event to clients for session %s", severity, sessionID)
	case <-broadcaster.ctx.Done():
		log.Printf("WARNING: Could not send error event - broadcaster context done for session %s", sessionID)
	default:
		log.Printf("WARNING: Could not send error event - merger channel full for session %s", sessionID)
	}
}
