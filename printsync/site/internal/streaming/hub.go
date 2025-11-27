package streaming

import (
	"context"
	"sync"

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
	mu      sync.RWMutex
	clients map[*Client]bool
	merger  *StreamMerger
}

// NewSessionBroadcaster creates a new session broadcaster
func NewSessionBroadcaster(merger *StreamMerger) *SessionBroadcaster {
	return &SessionBroadcaster{
		clients: make(map[*Client]bool),
		merger:  merger,
	}
}

// Register adds a client to the broadcaster
func (b *SessionBroadcaster) Register(client *Client) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.clients[client] = true
}

// Unregister removes a client from the broadcaster
func (b *SessionBroadcaster) Unregister(client *Client) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if _, ok := b.clients[client]; ok {
		delete(b.clients, client)
		close(client.Events)
	}
}

// Start starts broadcasting events from the merger to all clients
func (b *SessionBroadcaster) Start(ctx context.Context) {
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case event, ok := <-b.merger.Events():
				if !ok {
					return
				}
				b.broadcast(event)
			}
		}
	}()
}

// broadcast sends an event to all registered clients
func (b *SessionBroadcaster) broadcast(event SSEEvent) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for client := range b.clients {
		select {
		case client.Events <- event:
		default:
			// Client's channel is full, skip this event
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
func NewStreamHub(sessionStore filesync.SessionStore, fileStore filesync.FileStore) *StreamHub {
	return &StreamHub{
		broadcasters: make(map[string]*SessionBroadcaster),
		sessionStore: sessionStore,
		fileStore:    fileStore,
	}
}

// Register registers a client for a session and returns the client
func (h *StreamHub) Register(sessionID string) *Client {
	h.mu.Lock()
	defer h.mu.Unlock()

	client := NewClient()

	// Get or create broadcaster for this session
	broadcaster, exists := h.broadcasters[sessionID]
	if !exists {
		// Broadcaster will be started when StartSession is called
		merger := NewStreamMerger(h.sessionStore, h.fileStore)
		broadcaster = NewSessionBroadcaster(merger)
		h.broadcasters[sessionID] = broadcaster
	}

	broadcaster.Register(client)
	return client
}

// Unregister removes a client from a session
func (h *StreamHub) Unregister(sessionID string, client *Client) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if broadcaster, exists := h.broadcasters[sessionID]; exists {
		broadcaster.Unregister(client)
	}
}

// StartSession starts streaming for a session (call this when extraction begins)
func (h *StreamHub) StartSession(ctx context.Context, sessionID string, progressCh <-chan filesync.Progress) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	broadcaster, exists := h.broadcasters[sessionID]
	if !exists {
		// Create new broadcaster if it doesn't exist
		merger := NewStreamMerger(h.sessionStore, h.fileStore)
		broadcaster = NewSessionBroadcaster(merger)
		h.broadcasters[sessionID] = broadcaster
	}

	// Start subscriptions
	if err := broadcaster.merger.StartSessionSubscription(ctx, sessionID); err != nil {
		return err
	}

	if err := broadcaster.merger.StartFileSubscription(ctx, sessionID); err != nil {
		return err
	}

	// Forward pipeline progress
	broadcaster.merger.StartProgressForwarder(ctx, progressCh)

	// Start broadcasting
	broadcaster.Start(ctx)

	return nil
}

// IsRunning checks if a session broadcaster exists
func (h *StreamHub) IsRunning(sessionID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	_, exists := h.broadcasters[sessionID]
	return exists
}
