package streaming

import (
	"context"
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
		if event.Type != EventTypeProgress {
			t.Errorf("expected EventTypeProgress, got %s", event.Type)
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
			if event.Type == EventTypeComplete {
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
		if receivedEvents[0].Type != EventTypeProgress {
			t.Errorf("expected first event to be Progress, got %s", receivedEvents[0].Type)
		}
		if receivedEvents[2].Type != EventTypeComplete {
			t.Errorf("expected third event to be Complete, got %s", receivedEvents[2].Type)
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
		if event.Type == EventTypeProgress {
			received1 = true
		}
	case <-time.After(500 * time.Millisecond):
		t.Error("timeout waiting for event on client1")
	}

	select {
	case event := <-client2.Events:
		if event.Type == EventTypeProgress {
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
