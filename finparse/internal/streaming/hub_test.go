package streaming

import (
	"context"
	"sync"
	"testing"
	"time"
)

// TestSingleClientReceivesAllEvents tests that a single client receives all broadcast events
func TestSingleClientReceivesAllEvents(t *testing.T) {
	ctx := context.Background()
	hub := NewStreamHub()
	sessionID := "test-session-1"

	// Register a client
	client := hub.Register(ctx, sessionID)

	// Broadcast multiple events
	events := []SSEEvent{
		NewProgressEvent(ProgressEvent{FileID: "file1", Processed: 1, Total: 10}),
		NewProgressEvent(ProgressEvent{FileID: "file1", Processed: 5, Total: 10}),
		NewProgressEvent(ProgressEvent{FileID: "file1", Processed: 10, Total: 10}),
	}

	for _, event := range events {
		hub.Broadcast(sessionID, event)
	}

	// Verify client receives all events
	received := 0
	timeout := time.After(2 * time.Second)
	for received < len(events) {
		select {
		case event := <-client.Events:
			received++
			if event.Type != EventTypeProgress {
				t.Errorf("Expected EventTypeProgress, got %s", event.Type)
			}
		case <-timeout:
			t.Fatalf("Timeout waiting for events. Received %d/%d", received, len(events))
		}
	}

	// Cleanup
	hub.Unregister(sessionID, client)
}

// TestMultipleClientsReceiveSameEvents tests that multiple clients all receive the same events
func TestMultipleClientsReceiveSameEvents(t *testing.T) {
	ctx := context.Background()
	hub := NewStreamHub()
	sessionID := "test-session-2"

	// Register multiple clients
	numClients := 3
	clients := make([]*Client, numClients)
	for i := 0; i < numClients; i++ {
		clients[i] = hub.Register(ctx, sessionID)
	}

	// Broadcast an event
	testEvent := NewProgressEvent(ProgressEvent{FileID: "file1", Processed: 5, Total: 10})
	hub.Broadcast(sessionID, testEvent)

	// Verify all clients receive the event
	var wg sync.WaitGroup
	wg.Add(numClients)
	for i, client := range clients {
		go func(idx int, c *Client) {
			defer wg.Done()
			select {
			case event := <-c.Events:
				if event.Type != EventTypeProgress {
					t.Errorf("Client %d: Expected EventTypeProgress, got %s", idx, event.Type)
				}
			case <-time.After(2 * time.Second):
				t.Errorf("Client %d: Timeout waiting for event", idx)
			}
		}(i, client)
	}

	wg.Wait()

	// Cleanup
	for _, client := range clients {
		hub.Unregister(sessionID, client)
	}
}

// TestLateJoiningClient tests that a client joining late only receives events after registration
func TestLateJoiningClient(t *testing.T) {
	ctx := context.Background()
	hub := NewStreamHub()
	sessionID := "test-session-3"

	// Register first client
	client1 := hub.Register(ctx, sessionID)

	// Broadcast event before second client joins
	earlyEvent := NewProgressEvent(ProgressEvent{FileID: "file1", Processed: 1, Total: 10})
	hub.Broadcast(sessionID, earlyEvent)

	// Wait for event to be processed by client1 to ensure it's out of the pipeline
	select {
	case <-client1.Events:
		// Client1 got early event
	case <-time.After(1 * time.Second):
		t.Fatal("Client1: Timeout waiting for early event")
	}

	// Now register second client (after early event has been consumed)
	client2 := hub.Register(ctx, sessionID)

	// Broadcast event after second client joins
	lateEvent := NewProgressEvent(ProgressEvent{FileID: "file1", Processed: 5, Total: 10})
	hub.Broadcast(sessionID, lateEvent)

	// Client1 should receive the late event
	select {
	case <-client1.Events:
		// Got late event
	case <-time.After(1 * time.Second):
		t.Error("Client1: Timeout waiting for late event")
	}

	// Client2 should only receive the late event
	select {
	case <-client2.Events:
		// Got late event
	case <-time.After(1 * time.Second):
		t.Error("Client2: Timeout waiting for late event")
	}

	// Client2 should NOT have any more events in queue
	select {
	case <-client2.Events:
		t.Error("Client2: Received unexpected event (should only have received one)")
	case <-time.After(100 * time.Millisecond):
		// Expected - no more events available
	}

	// Cleanup
	hub.Unregister(sessionID, client1)
	hub.Unregister(sessionID, client2)
}

// TestUnregisteredClientStopsReceivingEvents tests that unregistered clients stop receiving events
func TestUnregisteredClientStopsReceivingEvents(t *testing.T) {
	ctx := context.Background()
	hub := NewStreamHub()
	sessionID := "test-session-4"

	// Register client
	client := hub.Register(ctx, sessionID)

	// Broadcast first event
	event1 := NewProgressEvent(ProgressEvent{FileID: "file1", Processed: 1, Total: 10})
	hub.Broadcast(sessionID, event1)

	// Receive first event
	select {
	case <-client.Events:
		// Got event
	case <-time.After(1 * time.Second):
		t.Fatal("Timeout waiting for first event")
	}

	// Unregister client
	hub.Unregister(sessionID, client)

	// Broadcast second event (after unregister)
	event2 := NewProgressEvent(ProgressEvent{FileID: "file1", Processed: 5, Total: 10})
	hub.Broadcast(sessionID, event2)

	// Client channel should be closed, verify by reading
	select {
	case _, ok := <-client.Events:
		if ok {
			t.Error("Client channel should be closed after unregister, but received an event")
		}
		// Expected: channel is closed
	case <-time.After(100 * time.Millisecond):
		t.Error("Expected client channel to be closed immediately after unregister")
	}
}

// TestBroadcasterCleanupWhenLastClientDisconnects tests that broadcaster cleans up when last client disconnects
func TestBroadcasterCleanupWhenLastClientDisconnects(t *testing.T) {
	ctx := context.Background()
	hub := NewStreamHub()
	sessionID := "test-session-5"

	// Register multiple clients
	client1 := hub.Register(ctx, sessionID)
	client2 := hub.Register(ctx, sessionID)

	// Verify broadcaster exists
	if !hub.IsRunning(sessionID) {
		t.Fatal("Broadcaster should be running after client registration")
	}

	// Unregister first client
	hub.Unregister(sessionID, client1)

	// Broadcaster should still exist (client2 still connected)
	if !hub.IsRunning(sessionID) {
		t.Error("Broadcaster should still be running with one client connected")
	}

	// Unregister last client
	hub.Unregister(sessionID, client2)

	// Broadcaster should be cleaned up
	if hub.IsRunning(sessionID) {
		t.Error("Broadcaster should be cleaned up after last client disconnects")
	}
}

// TestEventChannelOverflowBehavior tests that event channel overflow drops events without panic
func TestEventChannelOverflowBehavior(t *testing.T) {
	ctx := context.Background()
	broadcaster := NewSessionBroadcaster(ctx)
	client := NewClient()
	broadcaster.Register(client)
	broadcaster.Start()

	// Fill the broadcaster's event channel (capacity 100)
	for i := 0; i < 150; i++ {
		broadcaster.Broadcast(NewProgressEvent(ProgressEvent{FileID: "file1", Processed: i, Total: 150}))
	}

	// Give broadcaster time to process some events
	time.Sleep(100 * time.Millisecond)

	// Should not panic - verify by continuing execution
	// The broadcaster should have dropped some events but still be functional
	finalEvent := NewCompleteEvent(nil)
	broadcaster.Broadcast(finalEvent)

	// Cleanup
	broadcaster.Unregister(client)
	broadcaster.Stop()
}

// TestClientChannelOverflowBehavior tests that slow clients don't block other clients
func TestClientChannelOverflowBehavior(t *testing.T) {
	ctx := context.Background()
	hub := NewStreamHub()
	sessionID := "test-session-6"

	// Register two clients
	fastClient := hub.Register(ctx, sessionID)
	slowClient := hub.Register(ctx, sessionID)

	// Don't read from slowClient (simulating slow consumer)
	// Fill slowClient's channel (capacity 10)
	for i := 0; i < 20; i++ {
		hub.Broadcast(sessionID, NewProgressEvent(ProgressEvent{FileID: "file1", Processed: i, Total: 20}))
		time.Sleep(10 * time.Millisecond) // Give broadcaster time to process
	}

	// Fast client should still receive events despite slow client blocking
	received := 0
	timeout := time.After(2 * time.Second)
drainLoop:
	for {
		select {
		case <-fastClient.Events:
			received++
		case <-timeout:
			break drainLoop
		case <-time.After(100 * time.Millisecond):
			// No more events available
			break drainLoop
		}
	}

	if received == 0 {
		t.Error("Fast client should receive some events even when slow client blocks")
	}

	// Cleanup
	hub.Unregister(sessionID, fastClient)
	hub.Unregister(sessionID, slowClient)
}

// TestConcurrentClientRegistration tests that concurrent client registration is thread-safe
func TestConcurrentClientRegistration(t *testing.T) {
	ctx := context.Background()
	hub := NewStreamHub()
	sessionID := "test-session-7"

	// Concurrently register many clients
	numClients := 100
	clients := make([]*Client, numClients)
	var wg sync.WaitGroup
	wg.Add(numClients)

	for i := 0; i < numClients; i++ {
		go func(idx int) {
			defer wg.Done()
			clients[idx] = hub.Register(ctx, sessionID)
		}(i)
	}

	wg.Wait()

	// Verify all clients were registered (no panic, no corruption)
	hub.mu.RLock()
	broadcaster := hub.broadcasters[sessionID]
	hub.mu.RUnlock()

	if broadcaster == nil {
		t.Fatal("Broadcaster should exist after concurrent registrations")
	}

	clientCount := broadcaster.ClientCount()
	if clientCount != numClients {
		t.Errorf("Expected %d clients, got %d", numClients, clientCount)
	}

	// Cleanup
	for _, client := range clients {
		hub.Unregister(sessionID, client)
	}
}

// TestConcurrentClientUnregistration tests that concurrent client unregistration is thread-safe
func TestConcurrentClientUnregistration(t *testing.T) {
	ctx := context.Background()
	hub := NewStreamHub()
	sessionID := "test-session-8"

	// Register many clients
	numClients := 100
	clients := make([]*Client, numClients)
	for i := 0; i < numClients; i++ {
		clients[i] = hub.Register(ctx, sessionID)
	}

	// Concurrently unregister all clients
	var wg sync.WaitGroup
	wg.Add(numClients)

	for i := 0; i < numClients; i++ {
		go func(client *Client) {
			defer wg.Done()
			hub.Unregister(sessionID, client)
		}(clients[i])
	}

	wg.Wait()

	// Verify broadcaster was cleaned up
	if hub.IsRunning(sessionID) {
		t.Error("Broadcaster should be cleaned up after all clients unregister")
	}
}

// TestContextCancellationStopsBroadcaster tests that context cancellation stops broadcaster
func TestContextCancellationStopsBroadcaster(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	broadcaster := NewSessionBroadcaster(ctx)
	client := NewClient()
	broadcaster.Register(client)
	broadcaster.Start()

	// Broadcast an event
	event1 := NewProgressEvent(ProgressEvent{FileID: "file1", Processed: 1, Total: 10})
	broadcaster.Broadcast(event1)

	// Receive event
	select {
	case <-client.Events:
		// Got event
	case <-time.After(1 * time.Second):
		t.Fatal("Timeout waiting for event")
	}

	// Cancel context
	cancel()

	// Give broadcaster time to stop
	time.Sleep(200 * time.Millisecond)

	// Try to broadcast another event (should be ignored due to context cancellation)
	event2 := NewProgressEvent(ProgressEvent{FileID: "file1", Processed: 5, Total: 10})
	broadcaster.Broadcast(event2)

	// Client should not receive the second event (or channel should be closed)
	select {
	case _, ok := <-client.Events:
		if ok {
			t.Error("Client should not receive events after context cancellation")
		}
		// Expected: channel closed
	case <-time.After(100 * time.Millisecond):
		// Expected: no event received
	}
}

// TestCompleteEventTriggersBroadcasterShutdown tests that complete events trigger broadcaster shutdown
func TestCompleteEventTriggersBroadcasterShutdown(t *testing.T) {
	ctx := context.Background()
	broadcaster := NewSessionBroadcaster(ctx)
	client := NewClient()
	broadcaster.Register(client)
	broadcaster.Start()

	// Broadcast a complete event
	completeEvent := NewCompleteEvent(nil)
	broadcaster.Broadcast(completeEvent)

	// Client should receive the complete event
	select {
	case event := <-client.Events:
		if event.Type != EventTypeComplete {
			t.Errorf("Expected EventTypeComplete, got %s", event.Type)
		}
	case <-time.After(1 * time.Second):
		t.Fatal("Timeout waiting for complete event")
	}

	// Give broadcaster time to shut down (100ms delay in code)
	time.Sleep(200 * time.Millisecond)

	// Client channel should be closed
	select {
	case _, ok := <-client.Events:
		if ok {
			t.Error("Client channel should be closed after complete event")
		}
		// Expected: channel closed
	case <-time.After(100 * time.Millisecond):
		t.Error("Expected client channel to be closed after broadcaster shutdown")
	}
}

// TestErrorEventTriggersBroadcasterShutdown tests that error events trigger broadcaster shutdown
func TestErrorEventTriggersBroadcasterShutdown(t *testing.T) {
	ctx := context.Background()
	broadcaster := NewSessionBroadcaster(ctx)
	client := NewClient()
	broadcaster.Register(client)
	broadcaster.Start()

	// Broadcast an error event
	errorEvent := NewErrorEvent(ErrorEvent{Message: "Test error"})
	broadcaster.Broadcast(errorEvent)

	// Client should receive the error event
	select {
	case event := <-client.Events:
		if event.Type != EventTypeError {
			t.Errorf("Expected EventTypeError, got %s", event.Type)
		}
	case <-time.After(1 * time.Second):
		t.Fatal("Timeout waiting for error event")
	}

	// Give broadcaster time to shut down (100ms delay in code)
	time.Sleep(200 * time.Millisecond)

	// Client channel should be closed
	select {
	case _, ok := <-client.Events:
		if ok {
			t.Error("Client channel should be closed after error event")
		}
		// Expected: channel closed
	case <-time.After(100 * time.Millisecond):
		t.Error("Expected client channel to be closed after broadcaster shutdown")
	}
}

// TestBroadcastToNonExistentSession tests that broadcasting to non-existent session logs warning but doesn't panic
func TestBroadcastToNonExistentSession(t *testing.T) {
	hub := NewStreamHub()
	sessionID := "non-existent-session"

	// This should not panic, just log a warning
	hub.Broadcast(sessionID, NewProgressEvent(ProgressEvent{FileID: "file1", Processed: 1, Total: 10}))

	// Verify broadcaster doesn't exist
	if hub.IsRunning(sessionID) {
		t.Error("Broadcaster should not exist for non-existent session")
	}
}

// TestConcurrentBroadcastAndRegistration tests concurrent broadcasting and client registration
func TestConcurrentBroadcastAndRegistration(t *testing.T) {
	ctx := context.Background()
	hub := NewStreamHub()
	sessionID := "test-session-9"

	var wg sync.WaitGroup

	// Start broadcasting events
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 50; i++ {
			hub.Broadcast(sessionID, NewProgressEvent(ProgressEvent{FileID: "file1", Processed: i, Total: 50}))
			time.Sleep(10 * time.Millisecond)
		}
	}()

	// Concurrently register clients
	numClients := 10
	clients := make([]*Client, numClients)
	for i := 0; i < numClients; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			time.Sleep(time.Duration(idx*20) * time.Millisecond) // Stagger registrations
			clients[idx] = hub.Register(ctx, sessionID)
		}(i)
	}

	wg.Wait()

	// All clients should be registered without panic
	hub.mu.RLock()
	broadcaster := hub.broadcasters[sessionID]
	hub.mu.RUnlock()

	if broadcaster == nil {
		t.Fatal("Broadcaster should exist")
	}

	// Cleanup
	for _, client := range clients {
		if client != nil {
			hub.Unregister(sessionID, client)
		}
	}
}

// TestCriticalEventDelivery tests that critical events (Complete, Error) try harder to be delivered
func TestCriticalEventDelivery(t *testing.T) {
	ctx := context.Background()
	hub := NewStreamHub()
	sessionID := "test-session-10"

	// Register a client
	client := hub.Register(ctx, sessionID)

	// Broadcast a critical error event
	errorEvent := NewErrorEvent(ErrorEvent{Message: "Critical error"})
	hub.Broadcast(sessionID, errorEvent)

	// Client should receive the error event
	select {
	case event := <-client.Events:
		if event.Type != EventTypeError {
			t.Errorf("Expected EventTypeError, got %s", event.Type)
		}
		data, ok := event.ErrorData()
		if !ok {
			t.Error("Failed to extract error data")
		}
		if data.Message != "Critical error" {
			t.Errorf("Expected message 'Critical error', got '%s'", data.Message)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Timeout waiting for critical error event")
	}

	// Cleanup (note: error event should have triggered shutdown)
	time.Sleep(200 * time.Millisecond)
	hub.Unregister(sessionID, client)
}
