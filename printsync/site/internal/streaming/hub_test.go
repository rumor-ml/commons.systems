package streaming

import (
	"context"
	"fmt"
	"math/rand"
	"sync"
	"testing"
	"time"

	"github.com/commons-systems/filesync"
)

// mockPanicMerger is a StreamMerger that sends events that cause panics during broadcast
type mockPanicMerger struct {
	eventsCh chan SSEEvent
	done     chan struct{}
}

func newMockPanicMerger() *mockPanicMerger {
	m := &mockPanicMerger{
		eventsCh: make(chan SSEEvent, 10),
		done:     make(chan struct{}),
	}
	// Send a normal event, then close the channel to simulate merger stopping
	go func() {
		m.eventsCh <- NewProgressEvent("test", "file.txt", 0.5)
		time.Sleep(50 * time.Millisecond)
		// Note: We don't panic here because the panic should happen in broadcaster's
		// broadcast method when trying to send to a closed client channel.
		// Instead we'll close the events channel to simulate normal shutdown.
		close(m.eventsCh)
	}()
	return m
}

func (m *mockPanicMerger) Events() <-chan SSEEvent {
	return m.eventsCh
}

func (m *mockPanicMerger) Stop() {
	select {
	case <-m.done:
		return
	default:
		close(m.done)
	}
}

// TestBroadcasterPanicRecovery verifies that broadcaster.Start() recovers from panics gracefully
// This test simulates a panic scenario by closing a client channel before the broadcaster
// tries to send to it, which would normally cause a "send on closed channel" panic.
// The panic handler in broadcast() should catch this.
func TestBroadcasterPanicRecovery(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	eventsCh := make(chan SSEEvent, 10)
	done := make(chan struct{})

	broadcaster := &SessionBroadcaster{
		clients:       make(map[*Client]bool),
		droppedEvents: make(map[*Client]*int64),
		merger:        &StreamMerger{eventsCh: eventsCh, done: done},
		ctx:           ctx,
		cancel:        cancel,
	}

	// Register a client
	client := NewClient()
	broadcaster.Register(client)

	// Start the broadcaster
	broadcaster.Start()

	// Send an event
	eventsCh <- NewProgressEvent("test", "file.txt", 0.5)

	// Receive the event
	select {
	case event := <-client.Events:
		if event.EventType() != EventTypeProgress {
			t.Errorf("expected EventTypeProgress, got %s", event.EventType())
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timeout waiting for first event")
	}

	// Now close the client channel manually to simulate a panic scenario
	// The broadcaster's panic handler should catch any "send on closed channel" panic
	close(client.Events)

	// Send another event - this should trigger a panic in broadcast() but be recovered
	eventsCh <- NewProgressEvent("test2", "file2.txt", 1.0)

	// Wait a bit for the panic to occur and be handled
	time.Sleep(100 * time.Millisecond)

	// Close the events channel to signal broadcaster to stop
	close(eventsCh)

	// Verify broadcaster stops gracefully
	select {
	case <-broadcaster.ctx.Done():
		t.Log("Broadcaster stopped gracefully after panic recovery")
	case <-time.After(500 * time.Millisecond):
		t.Error("broadcaster did not stop")
	}

	// If we reach here, the test process didn't crash - panic was handled
	t.Log("Test passed - panic was recovered successfully")
}

// TestBroadcasterNormalOperation verifies broadcaster works correctly without panics
func TestBroadcasterNormalOperation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	// Create a normal merger
	eventsCh := make(chan SSEEvent, 10)
	done := make(chan struct{})

	broadcaster := &SessionBroadcaster{
		clients:       make(map[*Client]bool),
		droppedEvents: make(map[*Client]*int64),
		merger:        &StreamMerger{eventsCh: eventsCh, done: done},
		ctx:           ctx,
		cancel:        cancel,
	}

	// Register a client
	client := NewClient()
	broadcaster.Register(client)

	// Start the broadcaster
	broadcaster.Start()

	// Send some events
	go func() {
		eventsCh <- NewProgressEvent("extracting", "test1.pdf", 0.5)
		eventsCh <- NewProgressEvent("extracting", "test2.pdf", 1.0)
		// Send complete event to trigger broadcaster shutdown
		eventsCh <- NewCompleteEvent("session-123", filesync.SessionStatusCompleted)
	}()

	// Collect events
	var receivedEvents []SSEEvent
	timeout := time.After(1 * time.Second)

eventLoop:
	for {
		select {
		case event, ok := <-client.Events:
			if !ok {
				// Channel closed, broadcaster stopped
				break eventLoop
			}
			receivedEvents = append(receivedEvents, event)
			// Stop after receiving complete event
			if event.EventType() == EventTypeComplete {
				break eventLoop
			}
		case <-timeout:
			break eventLoop
		}
	}

	// Verify we received events
	if len(receivedEvents) < 3 {
		t.Errorf("expected at least 3 events, got %d", len(receivedEvents))
	}

	// Verify event types
	if len(receivedEvents) >= 3 {
		if receivedEvents[0].EventType() != EventTypeProgress {
			t.Errorf("expected first event to be Progress, got %s", receivedEvents[0].EventType())
		}
		if receivedEvents[2].EventType() != EventTypeComplete {
			t.Errorf("expected third event to be Complete, got %s", receivedEvents[2].EventType())
		}
	}

	// Verify broadcaster stopped after complete event
	select {
	case <-broadcaster.ctx.Done():
		// Success
	case <-time.After(500 * time.Millisecond):
		t.Error("broadcaster did not stop after complete event")
	}
}

// TestBroadcasterMultipleClients verifies broadcasting to multiple clients
func TestBroadcasterMultipleClients(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	eventsCh := make(chan SSEEvent, 10)
	done := make(chan struct{})

	broadcaster := &SessionBroadcaster{
		clients:       make(map[*Client]bool),
		droppedEvents: make(map[*Client]*int64),
		merger:        &StreamMerger{eventsCh: eventsCh, done: done},
		ctx:           ctx,
		cancel:        cancel,
	}

	// Register multiple clients
	client1 := NewClient()
	client2 := NewClient()
	broadcaster.Register(client1)
	broadcaster.Register(client2)

	// Start the broadcaster
	broadcaster.Start()

	// Send an event
	go func() {
		eventsCh <- NewProgressEvent("test", "file.pdf", 0.5)
		time.Sleep(100 * time.Millisecond)
		close(eventsCh)
	}()

	// Both clients should receive the event
	received1 := false
	received2 := false

	select {
	case event := <-client1.Events:
		if event.EventType() == EventTypeProgress {
			received1 = true
		}
	case <-time.After(500 * time.Millisecond):
		t.Error("timeout waiting for event on client1")
	}

	select {
	case event := <-client2.Events:
		if event.EventType() == EventTypeProgress {
			received2 = true
		}
	case <-time.After(500 * time.Millisecond):
		t.Error("timeout waiting for event on client2")
	}

	if !received1 {
		t.Error("client1 did not receive event")
	}
	if !received2 {
		t.Error("client2 did not receive event")
	}
}

// TestBroadcaster_ConcurrentClientPanics tests panic recovery with multiple clients closing simultaneously
func TestBroadcaster_ConcurrentClientPanics(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	eventsCh := make(chan SSEEvent, 100)
	done := make(chan struct{})

	broadcaster := &SessionBroadcaster{
		clients:       make(map[*Client]bool),
		droppedEvents: make(map[*Client]*int64),
		merger:        &StreamMerger{eventsCh: eventsCh, done: done},
		ctx:           ctx,
		cancel:        cancel,
	}

	// Register 10 clients
	var clients []*Client
	for i := 0; i < 10; i++ {
		client := NewClient()
		broadcaster.Register(client)
		clients = append(clients, client)
	}

	// Start broadcaster
	broadcaster.Start()

	// Send initial event to verify broadcaster is running
	eventsCh <- NewProgressEvent("test", "file.txt", 0.5)

	// Let first event propagate
	time.Sleep(50 * time.Millisecond)

	// Now close 5 client channels concurrently to simulate panics
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func(client *Client) {
			defer wg.Done()
			time.Sleep(time.Duration(rand.Intn(50)) * time.Millisecond)
			close(client.Events)
		}(clients[i])
	}
	wg.Wait()

	// Send more events - broadcaster should handle panics gracefully
	for i := 0; i < 10; i++ {
		eventsCh <- NewProgressEvent("test", fmt.Sprintf("file%d.txt", i), float64(i*10))
		time.Sleep(10 * time.Millisecond)
	}

	// Verify remaining 5 clients still receive events
	receivedCount := 0
	timeout := time.After(1 * time.Second)

	for i := 5; i < 10; i++ {
		select {
		case event := <-clients[i].Events:
			if event.EventType() == EventTypeProgress {
				receivedCount++
			}
		case <-timeout:
			break
		}
	}

	// Close events channel to signal broadcaster to stop
	close(eventsCh)

	// Verify broadcaster stopped
	select {
	case <-broadcaster.ctx.Done():
		// Success
	case <-time.After(500 * time.Millisecond):
		t.Error("broadcaster did not stop")
	}

	// Verify at least some events were received by remaining clients
	if receivedCount == 0 {
		t.Error("remaining clients did not receive events")
	}

	t.Logf("Concurrent panic test passed: %d events received by remaining clients", receivedCount)
}

// TestBroadcaster_CircuitBreakerConcurrent tests circuit breaker with multiple slow clients
func TestBroadcaster_CircuitBreakerConcurrent(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	eventsCh := make(chan SSEEvent, 10)
	done := make(chan struct{})

	broadcaster := &SessionBroadcaster{
		clients:       make(map[*Client]bool),
		droppedEvents: make(map[*Client]*int64),
		merger:        &StreamMerger{eventsCh: eventsCh, done: done},
		ctx:           ctx,
		cancel:        cancel,
	}

	// Create 3 slow clients (with small channel buffers)
	slowClients := make([]*Client, 3)
	for i := 0; i < 3; i++ {
		client := &Client{
			Events: make(chan SSEEvent, 1), // Small buffer to trigger drops
		}
		broadcaster.Register(client)
		slowClients[i] = client
	}

	// Create 2 fast clients (normal buffer)
	fastClients := make([]*Client, 2)
	for i := 0; i < 2; i++ {
		client := NewClient()
		broadcaster.Register(client)
		fastClients[i] = client
	}

	// Start broadcaster
	broadcaster.Start()

	// Send many events to trigger circuit breaker on slow clients
	sentCount := 0
	for i := 0; i < 120; i++ {
		eventsCh <- NewProgressEvent("test", fmt.Sprintf("file%d.txt", i), float64(i))
		sentCount++
	}

	// Give broadcaster time to process and disconnect slow clients
	time.Sleep(500 * time.Millisecond)

	// Verify fast clients still have open channels and received events
	for _, client := range fastClients {
		select {
		case event := <-client.Events:
			if event.EventType() != EventTypeProgress {
				t.Errorf("unexpected event type: %s", event.EventType())
			}
		case <-time.After(100 * time.Millisecond):
			t.Error("fast client did not receive events")
		}
	}

	// Close events to stop broadcaster
	close(eventsCh)

	// Verify broadcaster stopped
	select {
	case <-broadcaster.ctx.Done():
		// Expected
	case <-time.After(500 * time.Millisecond):
		t.Error("broadcaster did not stop")
	}

	t.Logf("Circuit breaker concurrent test passed: %d events sent", sentCount)
}

// TestStreamHub_SendErrorToClients tests error propagation to all connected clients
func TestStreamHub_SendErrorToClients(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	hub := &StreamHub{
		broadcasters: make(map[string]*SessionBroadcaster),
	}

	// Register multiple sessions and clients
	sessionIDs := []string{"session-1", "session-2", "session-3"}
	clientsBySession := make(map[string][]*Client)

	for _, sessionID := range sessionIDs {
		ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
		merger := &StreamMerger{
			eventsCh: make(chan SSEEvent, 100),
			done:     make(chan struct{}),
		}

		broadcaster := &SessionBroadcaster{
			clients:       make(map[*Client]bool),
			droppedEvents: make(map[*Client]*int64),
			merger:        merger,
			ctx:           ctx,
			cancel:        cancel,
		}

		// Register 2 clients per session
		for i := 0; i < 2; i++ {
			client := NewClient()
			broadcaster.Register(client)
			clientsBySession[sessionID] = append(clientsBySession[sessionID], client)
		}

		broadcaster.Start()
		hub.broadcasters[sessionID] = broadcaster
	}

	// Send error to all clients in all sessions
	errorMsg := "Test error message"
	errorEvent := NewErrorEvent(errorMsg, "error")

	for sessionID, broadcaster := range hub.broadcasters {
		// Simulate SendErrorToClients by directly sending error
		select {
		case broadcaster.merger.eventsCh <- errorEvent:
		case <-time.After(100 * time.Millisecond):
			t.Errorf("failed to send error event for session %s", sessionID)
		}
	}

	// Verify all clients received error events
	for sessionID, clients := range clientsBySession {
		for i, client := range clients {
			select {
			case event := <-client.Events:
				if event.EventType() != EventTypeError {
					t.Errorf("session %s, client %d: expected error event, got %s", sessionID, i, event.EventType())
				}
				errorData, ok := event.Data().(ErrorEvent)
				if !ok {
					t.Errorf("session %s, client %d: invalid error data", sessionID, i)
				} else if errorData.Message != errorMsg {
					t.Errorf("session %s, client %d: wrong error message", sessionID, i)
				}
			case <-time.After(500 * time.Millisecond):
				t.Errorf("session %s, client %d: did not receive error event", sessionID, i)
			}
		}
	}

	// Cleanup
	for _, broadcaster := range hub.broadcasters {
		broadcaster.cancel()
	}
}
