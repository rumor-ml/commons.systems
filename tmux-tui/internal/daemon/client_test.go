package daemon

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"sync"
	"testing"
	"time"
)

// mockConn implements net.Conn for testing
type mockConn struct {
	reader     io.Reader
	writer     io.Writer
	localAddr  net.Addr
	remoteAddr net.Addr
	closed     bool
	closeMu    sync.Mutex
}

func (m *mockConn) Read(b []byte) (n int, err error) {
	return m.reader.Read(b)
}

func (m *mockConn) Write(b []byte) (n int, err error) {
	return m.writer.Write(b)
}

func (m *mockConn) Close() error {
	m.closeMu.Lock()
	defer m.closeMu.Unlock()
	m.closed = true
	return nil
}

func (m *mockConn) LocalAddr() net.Addr                { return m.localAddr }
func (m *mockConn) RemoteAddr() net.Addr               { return m.remoteAddr }
func (m *mockConn) SetDeadline(t time.Time) error      { return nil }
func (m *mockConn) SetReadDeadline(t time.Time) error  { return nil }
func (m *mockConn) SetWriteDeadline(t time.Time) error { return nil }

// mockAddr implements net.Addr for testing
type mockAddr struct {
	network string
	address string
}

func (m *mockAddr) Network() string { return m.network }
func (m *mockAddr) String() string  { return m.address }

// TestQueryBlockedState_Success tests the happy path for querying blocked state
func TestQueryBlockedState_Success(t *testing.T) {
	// Create a pipe for bidirectional communication
	clientReader, serverWriter := io.Pipe()
	serverReader, clientWriter := io.Pipe()

	client := &DaemonClient{
		clientID: "test-client",
		conn: &mockConn{
			reader:     clientReader,
			writer:     clientWriter,
			localAddr:  &mockAddr{"unix", "/tmp/test.sock"},
			remoteAddr: &mockAddr{"unix", "/tmp/test.sock"},
		},
		encoder:        json.NewEncoder(clientWriter),
		decoder:        json.NewDecoder(clientReader),
		eventCh:        make(chan Message, 100),
		done:           make(chan struct{}),
		lastPong:       time.Now(),
		queryResponses: make(map[string]chan Message),
	}

	// Start receive goroutine
	go client.receive()

	// Simulate server sending response
	go func() {
		decoder := json.NewDecoder(serverReader)
		encoder := json.NewEncoder(serverWriter)

		// Read the query message
		var queryMsg Message
		if err := decoder.Decode(&queryMsg); err != nil {
			t.Logf("Server decode error: %v", err)
			return
		}

		// Send response
		response := Message{
			Type:          MsgTypeBlockedStateResponse,
			Branch:        queryMsg.Branch,
			IsBlocked:     true,
			BlockedBranch: "main",
		}
		if err := encoder.Encode(response); err != nil {
			t.Logf("Server encode error: %v", err)
		}
	}()

	// Query blocked state
	blockedBy, isBlocked, err := client.QueryBlockedState("feature-branch")
	if err != nil {
		t.Fatalf("QueryBlockedState failed: %v", err)
	}

	if !isBlocked {
		t.Error("Expected branch to be blocked")
	}

	if blockedBy != "main" {
		t.Errorf("Expected blockedBy=main, got %s", blockedBy)
	}

	// Verify no events were lost (eventCh should be empty)
	select {
	case msg := <-client.eventCh:
		t.Errorf("Unexpected message in eventCh: %+v", msg)
	default:
		// Good - channel is empty
	}
}

// TestQueryBlockedState_Timeout tests timeout behavior
func TestQueryBlockedState_Timeout(t *testing.T) {
	// Create a pipe but don't send any response
	clientReader, serverWriter := io.Pipe()
	serverReader, clientWriter := io.Pipe()

	client := &DaemonClient{
		clientID: "test-client",
		conn: &mockConn{
			reader:     clientReader,
			writer:     clientWriter,
			localAddr:  &mockAddr{"unix", "/tmp/test.sock"},
			remoteAddr: &mockAddr{"unix", "/tmp/test.sock"},
		},
		encoder:        json.NewEncoder(clientWriter),
		decoder:        json.NewDecoder(clientReader),
		eventCh:        make(chan Message, 100),
		done:           make(chan struct{}),
		lastPong:       time.Now(),
		queryResponses: make(map[string]chan Message),
	}

	// Start receive goroutine
	go client.receive()

	// Read query message from server side but don't send any response (to trigger timeout)
	go func() {
		decoder := json.NewDecoder(serverReader)
		var queryMsg Message
		decoder.Decode(&queryMsg) // Drain the query to prevent pipe blocking
		// Don't send any response - this will cause timeout
		serverWriter.Close() // Close to prevent receive() from blocking
	}()

	// Query should timeout after 2 seconds
	start := time.Now()
	_, _, err := client.QueryBlockedState("feature-branch")
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("Expected timeout error")
	}

	if elapsed < 2*time.Second {
		t.Errorf("Timeout occurred too quickly: %v", elapsed)
	}

	if elapsed > 3*time.Second {
		t.Errorf("Timeout took too long: %v", elapsed)
	}
}

// TestQueryBlockedState_WrongBranchResponse tests that responses for different branches are ignored
func TestQueryBlockedState_WrongBranchResponse(t *testing.T) {
	clientReader, serverWriter := io.Pipe()
	serverReader, clientWriter := io.Pipe()

	client := &DaemonClient{
		clientID: "test-client",
		conn: &mockConn{
			reader:     clientReader,
			writer:     clientWriter,
			localAddr:  &mockAddr{"unix", "/tmp/test.sock"},
			remoteAddr: &mockAddr{"unix", "/tmp/test.sock"},
		},
		encoder:        json.NewEncoder(clientWriter),
		decoder:        json.NewDecoder(clientReader),
		eventCh:        make(chan Message, 100),
		done:           make(chan struct{}),
		lastPong:       time.Now(),
		queryResponses: make(map[string]chan Message),
	}

	go client.receive()

	// Simulate server sending wrong branch response, then correct one
	go func() {
		decoder := json.NewDecoder(serverReader)
		encoder := json.NewEncoder(serverWriter)

		// Read query
		var queryMsg Message
		decoder.Decode(&queryMsg)

		// Send response for WRONG branch first
		wrongResponse := Message{
			Type:          MsgTypeBlockedStateResponse,
			Branch:        "different-branch",
			IsBlocked:     true,
			BlockedBranch: "main",
		}
		encoder.Encode(wrongResponse)

		// Then send correct response
		time.Sleep(100 * time.Millisecond)
		correctResponse := Message{
			Type:          MsgTypeBlockedStateResponse,
			Branch:        queryMsg.Branch,
			IsBlocked:     false,
			BlockedBranch: "",
		}
		encoder.Encode(correctResponse)
	}()

	// Query should wait for correct branch response
	blockedBy, isBlocked, err := client.QueryBlockedState("feature-branch")
	if err != nil {
		t.Fatalf("QueryBlockedState failed: %v", err)
	}

	if isBlocked {
		t.Error("Expected branch to not be blocked (correct response)")
	}

	if blockedBy != "" {
		t.Errorf("Expected empty blockedBy, got %s", blockedBy)
	}
}

// TestQueryBlockedState_NoEventLoss tests that other events are not lost during query
func TestQueryBlockedState_NoEventLoss(t *testing.T) {
	clientReader, serverWriter := io.Pipe()
	serverReader, clientWriter := io.Pipe()

	client := &DaemonClient{
		clientID: "test-client",
		conn: &mockConn{
			reader:     clientReader,
			writer:     clientWriter,
			localAddr:  &mockAddr{"unix", "/tmp/test.sock"},
			remoteAddr: &mockAddr{"unix", "/tmp/test.sock"},
		},
		encoder:        json.NewEncoder(clientWriter),
		decoder:        json.NewDecoder(clientReader),
		eventCh:        make(chan Message, 100),
		done:           make(chan struct{}),
		lastPong:       time.Now(),
		queryResponses: make(map[string]chan Message),
	}

	go client.receive()

	// Simulate server sending alert and focus change messages during query
	go func() {
		decoder := json.NewDecoder(serverReader)
		encoder := json.NewEncoder(serverWriter)

		// Read query
		var queryMsg Message
		decoder.Decode(&queryMsg)

		// Send alert change message (should NOT be lost!)
		alertMsg := Message{
			Type:      MsgTypeAlertChange,
			PaneID:    "pane-1",
			EventType: "stop",
			Created:   true,
		}
		encoder.Encode(alertMsg)

		// Send pane focus message (should NOT be lost!)
		focusMsg := Message{
			Type:         MsgTypePaneFocus,
			ActivePaneID: "pane-2",
		}
		encoder.Encode(focusMsg)

		// Finally send the query response
		response := Message{
			Type:          MsgTypeBlockedStateResponse,
			Branch:        queryMsg.Branch,
			IsBlocked:     false,
			BlockedBranch: "",
		}
		encoder.Encode(response)
	}()

	// Query blocked state
	_, _, err := client.QueryBlockedState("feature-branch")
	if err != nil {
		t.Fatalf("QueryBlockedState failed: %v", err)
	}

	// Verify alert and focus messages were NOT lost
	receivedAlert := false
	receivedFocus := false

	timeout := time.After(1 * time.Second)
	for i := 0; i < 2; i++ {
		select {
		case msg := <-client.eventCh:
			if msg.Type == MsgTypeAlertChange {
				receivedAlert = true
			}
			if msg.Type == MsgTypePaneFocus {
				receivedFocus = true
			}
		case <-timeout:
			t.Fatal("Timeout waiting for events")
		}
	}

	if !receivedAlert {
		t.Error("Alert message was lost during query")
	}

	if !receivedFocus {
		t.Error("Focus message was lost during query")
	}
}

// TestQueryBlockedState_ClientClosed tests behavior when client closes during query
func TestQueryBlockedState_ClientClosed(t *testing.T) {
	clientReader, _ := io.Pipe()
	serverReader, clientWriter := io.Pipe()

	client := &DaemonClient{
		clientID: "test-client",
		conn: &mockConn{
			reader:     clientReader,
			writer:     clientWriter,
			localAddr:  &mockAddr{"unix", "/tmp/test.sock"},
			remoteAddr: &mockAddr{"unix", "/tmp/test.sock"},
		},
		encoder:        json.NewEncoder(clientWriter),
		decoder:        json.NewDecoder(clientReader),
		eventCh:        make(chan Message, 100),
		done:           make(chan struct{}),
		lastPong:       time.Now(),
		queryResponses: make(map[string]chan Message),
	}

	go client.receive()

	// Drain query message from server side to prevent pipe blocking
	go func() {
		decoder := json.NewDecoder(serverReader)
		var queryMsg Message
		decoder.Decode(&queryMsg) // Drain the query to prevent pipe blocking
		// Don't send any response - client will close before we would respond
	}()

	// Close client after short delay
	go func() {
		time.Sleep(100 * time.Millisecond)
		close(client.done)
	}()

	// Query should return error when client closes
	_, _, err := client.QueryBlockedState("feature-branch")
	if err == nil {
		t.Fatal("Expected error when client closes")
	}

	if err.Error() != "client closed" {
		t.Errorf("Expected 'client closed' error, got: %v", err)
	}
}

// TestQueryBlockedState_ConcurrentQueries tests multiple simultaneous queries
func TestQueryBlockedState_ConcurrentQueries(t *testing.T) {
	clientReader, serverWriter := io.Pipe()
	serverReader, clientWriter := io.Pipe()

	client := &DaemonClient{
		clientID: "test-client",
		conn: &mockConn{
			reader:     clientReader,
			writer:     clientWriter,
			localAddr:  &mockAddr{"unix", "/tmp/test.sock"},
			remoteAddr: &mockAddr{"unix", "/tmp/test.sock"},
		},
		encoder:        json.NewEncoder(clientWriter),
		decoder:        json.NewDecoder(clientReader),
		eventCh:        make(chan Message, 100),
		done:           make(chan struct{}),
		lastPong:       time.Now(),
		queryResponses: make(map[string]chan Message),
	}

	go client.receive()

	// Simulate server handling multiple queries
	go func() {
		decoder := json.NewDecoder(serverReader)
		encoder := json.NewEncoder(serverWriter)

		// Track queries received
		queries := make(map[string]bool)
		queryMu := sync.Mutex{}

		// Read and respond to queries
		for i := 0; i < 3; i++ {
			var queryMsg Message
			if err := decoder.Decode(&queryMsg); err != nil {
				return
			}

			queryMu.Lock()
			queries[queryMsg.Branch] = true
			queryMu.Unlock()

			// Send response
			response := Message{
				Type:          MsgTypeBlockedStateResponse,
				Branch:        queryMsg.Branch,
				IsBlocked:     queryMsg.Branch == "branch-2", // Only branch-2 is blocked
				BlockedBranch: "main",
			}
			encoder.Encode(response)
		}
	}()

	// Launch concurrent queries
	var wg sync.WaitGroup
	results := make(map[string]bool)
	resultsMu := sync.Mutex{}

	for i := 1; i <= 3; i++ {
		wg.Add(1)
		branchName := "branch-" + string(rune('0'+i))
		go func(branch string) {
			defer wg.Done()
			_, isBlocked, err := client.QueryBlockedState(branch)
			if err != nil {
				t.Logf("Query for %s failed: %v", branch, err)
				return
			}
			resultsMu.Lock()
			results[branch] = isBlocked
			resultsMu.Unlock()
		}(branchName)
	}

	wg.Wait()

	// Verify all queries completed
	if len(results) != 3 {
		t.Errorf("Expected 3 results, got %d", len(results))
	}

	// Verify branch-2 is blocked, others are not
	if !results["branch-2"] {
		t.Error("Expected branch-2 to be blocked")
	}
	if results["branch-1"] || results["branch-3"] {
		t.Error("Expected branch-1 and branch-3 to not be blocked")
	}
}

// TestConnectWithRetry_Success tests successful connection with retries
func TestConnectWithRetry_Success(t *testing.T) {
	// This would require mocking the dial function, which is complex
	// For now, we'll skip this test as it requires refactoring Connect() to accept a dialer
	t.Skip("Requires refactoring Connect() to accept injectable dialer")
}

// TestConnectWithRetry_ContextCancellation tests context cancellation during retry
func TestConnectWithRetry_ContextCancellation(t *testing.T) {
	client := NewDaemonClient()

	// Create context that cancels immediately
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := client.ConnectWithRetry(ctx, 5)
	if err == nil {
		t.Fatal("Expected error due to context cancellation")
	}
}
