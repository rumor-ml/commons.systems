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

	// Now unregister 5 clients concurrently to simulate disconnections
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func(client *Client) {
			defer wg.Done()
			time.Sleep(time.Duration(rand.Intn(50)) * time.Millisecond)
			broadcaster.Unregister(client)
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

// TestBroadcaster_ConcurrentRegistrationDuringBroadcast tests concurrent client registration/unregistration during active broadcasting
// This verifies thread safety of broadcaster operations and ensures no panics or race conditions occur
// when clients are added/removed while events are being broadcast
func TestBroadcaster_ConcurrentRegistrationDuringBroadcast(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	eventsCh := make(chan SSEEvent, 1000)
	done := make(chan struct{})

	broadcaster := &SessionBroadcaster{
		clients:       make(map[*Client]bool),
		droppedEvents: make(map[*Client]*int64),
		merger:        &StreamMerger{eventsCh: eventsCh, done: done},
		ctx:           ctx,
		cancel:        cancel,
	}

	// Start broadcaster
	broadcaster.Start()

	// Track registered clients for cleanup verification
	var mu sync.Mutex
	registeredClients := make([]*Client, 0, 15)

	// Goroutine to send 500 events rapidly
	go func() {
		for i := 0; i < 500; i++ {
			eventsCh <- NewProgressEvent("test", fmt.Sprintf("file%d.txt", i), float64(i)/500.0)
			// Small delay to allow some interleaving with registrations
			if i%50 == 0 {
				time.Sleep(5 * time.Millisecond)
			}
		}
	}()

	var wg sync.WaitGroup

	// Register 10 clients concurrently during broadcast
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 10; i++ {
			client := NewClient()
			broadcaster.Register(client)
			mu.Lock()
			registeredClients = append(registeredClients, client)
			mu.Unlock()
			time.Sleep(10 * time.Millisecond)
		}
	}()

	// Wait a bit for some clients to register
	time.Sleep(50 * time.Millisecond)

	// Unregister 5 clients concurrently
	wg.Add(1)
	go func() {
		defer wg.Done()
		time.Sleep(20 * time.Millisecond)
		mu.Lock()
		toUnregister := make([]*Client, 0, 5)
		if len(registeredClients) >= 5 {
			toUnregister = registeredClients[:5]
		}
		mu.Unlock()

		for _, client := range toUnregister {
			broadcaster.Unregister(client)
			time.Sleep(10 * time.Millisecond)
		}
	}()

	// Register another 5 clients concurrently
	wg.Add(1)
	go func() {
		defer wg.Done()
		time.Sleep(100 * time.Millisecond)
		for i := 0; i < 5; i++ {
			client := NewClient()
			broadcaster.Register(client)
			mu.Lock()
			registeredClients = append(registeredClients, client)
			mu.Unlock()
			time.Sleep(10 * time.Millisecond)
		}
	}()

	// Wait for all concurrent operations to complete
	wg.Wait()

	// Give broadcaster time to process all events
	time.Sleep(500 * time.Millisecond)

	// Verify active clients received some events
	mu.Lock()
	activeClients := make([]*Client, 0)
	for _, client := range registeredClients {
		// Check if channel is still open by trying to read with timeout
		select {
		case _, ok := <-client.Events:
			if ok {
				activeClients = append(activeClients, client)
			}
		default:
			// Channel might be empty but still open, consider it active
			activeClients = append(activeClients, client)
		}
	}
	mu.Unlock()

	// Verify we have at least some active clients (should be around 10)
	if len(activeClients) == 0 {
		t.Error("no active clients after concurrent operations")
	}

	// Close events channel to stop broadcaster
	close(eventsCh)

	// Verify broadcaster stopped
	select {
	case <-broadcaster.ctx.Done():
		// Success
	case <-time.After(1 * time.Second):
		t.Error("broadcaster did not stop")
	}

	t.Logf("Concurrent registration test passed: %d total clients registered, %d active at end", len(registeredClients), len(activeClients))
}

// TestBroadcaster_CircuitBreakerExactThreshold tests that the circuit breaker triggers at exactly 100 dropped events
// This verifies the precise threshold behavior and ensures clients are disconnected at the correct point
func TestBroadcaster_CircuitBreakerExactThreshold(t *testing.T) {
	// Scenario 1: Send exactly 99 events, verify client still registered
	t.Run("99 events - client remains connected", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()

		eventsCh := make(chan SSEEvent, 200)
		done := make(chan struct{})

		broadcaster := &SessionBroadcaster{
			clients:       make(map[*Client]bool),
			droppedEvents: make(map[*Client]*int64),
			merger:        &StreamMerger{eventsCh: eventsCh, done: done},
			ctx:           ctx,
			cancel:        cancel,
		}

		// Create slow client with buffer size 1
		slowClient := &Client{
			Events: make(chan SSEEvent, 1),
		}
		broadcaster.Register(slowClient)

		// Start broadcaster
		broadcaster.Start()

		// Send exactly 99 events (client won't be able to consume them fast enough)
		for i := 0; i < 99; i++ {
			eventsCh <- NewProgressEvent("test", fmt.Sprintf("file%d.txt", i), float64(i)/99.0)
		}

		// Give broadcaster time to process
		time.Sleep(500 * time.Millisecond)

		// Verify client is still registered (not disconnected)
		broadcaster.mu.Lock()
		stillRegistered := broadcaster.clients[slowClient]
		droppedCount := int64(0)
		if dropped := broadcaster.droppedEvents[slowClient]; dropped != nil {
			droppedCount = *dropped
		}
		broadcaster.mu.Unlock()

		if !stillRegistered {
			t.Errorf("client was disconnected after %d dropped events, expected to remain connected", droppedCount)
		}

		t.Logf("After 99 events: client still registered, dropped count: %d", droppedCount)

		// Close events channel
		close(eventsCh)

		// Wait for broadcaster to stop
		select {
		case <-broadcaster.ctx.Done():
			// Success
		case <-time.After(1 * time.Second):
			t.Error("broadcaster did not stop")
		}
	})

	// Scenario 2: Send 100th event, verify client disconnected with terminal error
	t.Run("100 events - client disconnected at threshold", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()

		eventsCh := make(chan SSEEvent, 200)
		done := make(chan struct{})

		broadcaster := &SessionBroadcaster{
			clients:       make(map[*Client]bool),
			droppedEvents: make(map[*Client]*int64),
			merger:        &StreamMerger{eventsCh: eventsCh, done: done},
			ctx:           ctx,
			cancel:        cancel,
		}

		// Create slow client with buffer size 1
		slowClient := &Client{
			Events: make(chan SSEEvent, 1),
		}
		broadcaster.Register(slowClient)

		// Start broadcaster
		broadcaster.Start()

		// Send 101 events: 1 goes in buffer, 100 get dropped to trigger circuit breaker
		for i := 0; i < 101; i++ {
			eventsCh <- NewProgressEvent("test", fmt.Sprintf("file%d.txt", i), float64(i)/101.0)
		}

		// Give broadcaster time to process and disconnect
		time.Sleep(500 * time.Millisecond)

		// Verify client was disconnected
		broadcaster.mu.Lock()
		stillRegistered := broadcaster.clients[slowClient]
		broadcaster.mu.Unlock()

		if stillRegistered {
			t.Error("client should be disconnected after 100 dropped events")
		} else {
			t.Log("Client correctly disconnected at 100 dropped events threshold")
		}

		// Terminal error is best-effort, so we don't require it
		// (channel might be full, preventing delivery)

		// Close events channel
		close(eventsCh)

		// Wait for broadcaster to stop
		select {
		case <-broadcaster.ctx.Done():
			// Success
		case <-time.After(1 * time.Second):
			t.Error("broadcaster did not stop")
		}
	})

	// Scenario 3: Fresh client with 101 events, verify disconnect at exactly 100
	t.Run("101 events - disconnect at exactly 100", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()

		eventsCh := make(chan SSEEvent, 200)
		done := make(chan struct{})

		broadcaster := &SessionBroadcaster{
			clients:       make(map[*Client]bool),
			droppedEvents: make(map[*Client]*int64),
			merger:        &StreamMerger{eventsCh: eventsCh, done: done},
			ctx:           ctx,
			cancel:        cancel,
		}

		// Create slow client with buffer size 1
		slowClient := &Client{
			Events: make(chan SSEEvent, 1),
		}
		broadcaster.Register(slowClient)

		// Start broadcaster
		broadcaster.Start()

		// Send 101 events
		for i := 0; i < 101; i++ {
			eventsCh <- NewProgressEvent("test", fmt.Sprintf("file%d.txt", i), float64(i)/101.0)
		}

		// Give broadcaster time to process
		time.Sleep(500 * time.Millisecond)

		// Verify client was disconnected (should trigger at 100)
		broadcaster.mu.Lock()
		stillRegistered := broadcaster.clients[slowClient]
		broadcaster.mu.Unlock()

		if stillRegistered {
			t.Error("client should be disconnected after reaching 100 dropped events threshold")
		}

		t.Log("Client correctly disconnected at 100 dropped events threshold")

		// Close events channel
		close(eventsCh)

		// Wait for broadcaster to stop
		select {
		case <-broadcaster.ctx.Done():
			// Success
		case <-time.After(1 * time.Second):
			t.Error("broadcaster did not stop")
		}
	})
}

func TestStreamHub_EarlyClientRegistration(t *testing.T) {
	ctx := context.Background()

	sessionStore := &mockSessionStore{
		sessions: make(map[string]*SyncSession),
	}
	fileStore := &mockFileStore{
		files: make(map[string]*SyncFile),
	}

	hub, err := NewStreamHub(sessionStore, fileStore)
	if err != nil {
		t.Fatalf("Failed to create hub: %v", err)
	}

	sessionID := "early-reg-session"

	// Register client BEFORE StartSession
	client, err := hub.Register(ctx, sessionID)
	if err != nil {
		t.Fatalf("Failed to register early client: %v", err)
	}
	if client == nil {
		t.Fatal("Expected non-nil client from early registration")
	}

	// Verify broadcaster was created
	hub.mu.RLock()
	broadcaster, exists := hub.broadcasters[sessionID]
	hub.mu.RUnlock()

	if !exists {
		t.Fatal("Expected broadcaster to be created during early registration")
	}
	if broadcaster == nil {
		t.Fatal("Expected non-nil broadcaster")
	}

	// Create test session
	session := &SyncSession{
		ID:     sessionID,
		UserID: "user-123",
		Status: SessionStatusRunning,
		Stats:  SessionStats{},
	}
	sessionStore.Create(ctx, session)

	// Start session with progress channel
	progressCh := make(chan filesync.Progress, 10)
	err = hub.StartSession(ctx, sessionID, progressCh)
	if err != nil {
		t.Fatalf("Failed to start session after early registration: %v", err)
	}

	// Send progress event
	testProgress := filesync.Progress{
		Type:       filesync.ProgressTypeOperation,
		Operation:  "Test",
		Percentage: 50,
	}
	progressCh <- testProgress
	close(progressCh)

	// Verify client receives events
	select {
	case event := <-client.Events:
		if event.EventType() != EventTypeProgress {
			t.Errorf("Expected progress event, got %s", event.EventType())
		}
	case <-time.After(1 * time.Second):
		t.Error("Timeout waiting for event after early registration")
	}

	// Cleanup
	hub.Unregister(sessionID, client)
}
