package streaming

import (
	"context"
	"fmt"
	"sync"
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
	mu      sync.RWMutex
	clients map[*Client]bool
	merger  *StreamMerger
	ctx     context.Context
	cancel  context.CancelFunc
}

// NewSessionBroadcaster creates a new session broadcaster
func NewSessionBroadcaster(ctx context.Context, merger *StreamMerger) *SessionBroadcaster {
	ctx, cancel := context.WithCancel(ctx)
	return &SessionBroadcaster{
		clients: make(map[*Client]bool),
		merger:  merger,
		ctx:     ctx,
		cancel:  cancel,
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
func (h *StreamHub) Register(sessionID string) *Client {
	h.mu.Lock()
	defer h.mu.Unlock()

	client := NewClient()

	// Get or create broadcaster for this session
	broadcaster, exists := h.broadcasters[sessionID]
	if !exists {
		// Broadcaster will be started when StartSession is called
		merger, err := NewStreamMerger(h.sessionStore, h.fileStore)
		if err != nil {
			// This should never happen since we validate stores in NewStreamHub
			// But we return nil to prevent panic
			return nil
		}
		broadcaster = NewSessionBroadcaster(context.Background(), merger)
		h.broadcasters[sessionID] = broadcaster
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
		broadcaster.Stop()
		delete(h.broadcasters, sessionID)
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
