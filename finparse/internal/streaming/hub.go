package streaming

import (
	"context"
	"log"
	"sync"
	"time"
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

// SessionBroadcaster broadcasts events to multiple clients for a single parse session
type SessionBroadcaster struct {
	mu      sync.RWMutex
	clients map[*Client]bool
	events  chan SSEEvent
	ctx     context.Context
	cancel  context.CancelFunc
}

// NewSessionBroadcaster creates a new session broadcaster
func NewSessionBroadcaster(ctx context.Context) *SessionBroadcaster {
	ctx, cancel := context.WithCancel(ctx)
	return &SessionBroadcaster{
		clients: make(map[*Client]bool),
		events:  make(chan SSEEvent, 100),
		ctx:     ctx,
		cancel:  cancel,
	}
}

// Register adds a client to the broadcaster
func (b *SessionBroadcaster) Register(client *Client) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.clients[client] = true
	log.Printf("INFO: Client registered, total clients: %d", len(b.clients))
}

// Unregister removes a client from the broadcaster
func (b *SessionBroadcaster) Unregister(client *Client) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if _, ok := b.clients[client]; ok {
		delete(b.clients, client)
		close(client.Events)
		log.Printf("INFO: Client unregistered, total clients: %d", len(b.clients))
	}
}

// ClientCount returns the number of connected clients
func (b *SessionBroadcaster) ClientCount() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.clients)
}

// Broadcast sends an event to all registered clients
func (b *SessionBroadcaster) Broadcast(event SSEEvent) {
	select {
	case b.events <- event:
	case <-b.ctx.Done():
	default:
		log.Printf("WARN: Event channel full, dropping event type: %s", event.Type)
	}
}

// Stop stops the broadcaster and cleans up resources
func (b *SessionBroadcaster) Stop() {
	b.cancel()
	close(b.events)
}

// Start starts broadcasting events to all clients
func (b *SessionBroadcaster) Start() {
	go func() {
		defer b.Stop()
		for {
			select {
			case <-b.ctx.Done():
				return
			case event, ok := <-b.events:
				if !ok {
					return
				}
				b.broadcastToClients(event)

				// If this is a complete or error event, stop after a short delay
				if event.Type == EventTypeComplete || event.Type == EventTypeError {
					time.Sleep(100 * time.Millisecond)
					return
				}
			}
		}
	}()
}

// broadcastToClients sends an event to all registered clients
func (b *SessionBroadcaster) broadcastToClients(event SSEEvent) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for client := range b.clients {
		select {
		case client.Events <- event:
		default:
			// Client's channel is full, skip this event
			log.Printf("WARN: Client channel full, skipping event type: %s", event.Type)
		}
	}
}

// StreamHub manages broadcasters for multiple parse sessions
type StreamHub struct {
	mu           sync.RWMutex
	broadcasters map[string]*SessionBroadcaster
}

// NewStreamHub creates a new stream hub
func NewStreamHub() *StreamHub {
	return &StreamHub{
		broadcasters: make(map[string]*SessionBroadcaster),
	}
}

// Register registers a client for a session and returns the client
func (h *StreamHub) Register(ctx context.Context, sessionID string) *Client {
	h.mu.Lock()
	defer h.mu.Unlock()

	client := NewClient()

	// Get or create broadcaster for this session
	broadcaster, exists := h.broadcasters[sessionID]
	if !exists {
		broadcaster = NewSessionBroadcaster(ctx)
		h.broadcasters[sessionID] = broadcaster
		broadcaster.Start()
		log.Printf("INFO: Created new broadcaster for session %s", sessionID)
	}

	broadcaster.Register(client)
	return client
}

// Unregister removes a client from a session
func (h *StreamHub) Unregister(sessionID string, client *Client) {
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

// Broadcast sends an event to all clients of a session
func (h *StreamHub) Broadcast(sessionID string, event SSEEvent) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	broadcaster, exists := h.broadcasters[sessionID]
	if !exists {
		log.Printf("WARN: Attempted to broadcast to non-existent session %s", sessionID)
		return
	}

	broadcaster.Broadcast(event)
}

// IsRunning checks if a session broadcaster exists
func (h *StreamHub) IsRunning(sessionID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	_, exists := h.broadcasters[sessionID]
	return exists
}
