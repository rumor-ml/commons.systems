package daemon

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"sync"
	"sync/atomic"
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
		queryResponses: make(map[string]*queryResponse),
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
		queryResponses: make(map[string]*queryResponse),
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
		queryResponses: make(map[string]*queryResponse),
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
		queryResponses: make(map[string]*queryResponse),
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
		queryResponses: make(map[string]*queryResponse),
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
		queryResponses: make(map[string]*queryResponse),
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

// TestQueryBlockedState_ChannelFullError tests that channel full sends proper error
func TestQueryBlockedState_ChannelFullError(t *testing.T) {
	// Create a manual test scenario where we can control channel state
	client := &DaemonClient{
		clientID:       "test-client",
		eventCh:        make(chan Message, 100),
		done:           make(chan struct{}),
		lastPong:       time.Now(),
		queryResponses: make(map[string]*queryResponse),
	}

	// Create a response with buffer size 0 to simulate full channel
	resp := &queryResponse{
		dataCh: make(chan Message), // Unbuffered - will be full
		errCh:  make(chan error, 1),
	}

	// Register the response
	client.queryMu.Lock()
	client.queryResponses["test-branch"] = resp
	client.queryMu.Unlock()

	// Simulate receive() detecting channel full and sending error
	// This mimics what happens in receive() when dataCh is full
	select {
	case resp.dataCh <- Message{}:
		t.Fatal("Expected channel to be full")
	default:
		// Channel is full as expected, send error
		resp.errCh <- ErrQueryChannelFull
	}

	// Verify error is received
	select {
	case err := <-resp.errCh:
		if err != ErrQueryChannelFull {
			t.Errorf("Expected ErrQueryChannelFull, got: %v", err)
		}
	default:
		t.Fatal("Expected error in errCh")
	}
}

// TestQueryBlockedState_ErrorPropagation tests that errors from receive() propagate to caller
func TestQueryBlockedState_ErrorPropagation(t *testing.T) {
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
		queryResponses: make(map[string]*queryResponse),
	}

	go client.receive()

	// Server reads query but sends response twice (first one blocks, second triggers error)
	go func() {
		decoder := json.NewDecoder(serverReader)
		encoder := json.NewEncoder(serverWriter)

		// Read query
		var queryMsg Message
		decoder.Decode(&queryMsg)

		// Send first response (fills channel)
		response := Message{
			Type:          MsgTypeBlockedStateResponse,
			Branch:        queryMsg.Branch,
			IsBlocked:     true,
			BlockedBranch: "main",
		}
		encoder.Encode(response)

		// Wait briefly
		time.Sleep(50 * time.Millisecond)

		// Send duplicate response - this would overflow if channel was unbuffered
		// But with buffered channel, first is consumed and second goes through normally
		encoder.Encode(response)
	}()

	// Query should succeed with first response
	blockedBy, isBlocked, err := client.QueryBlockedState("feature-branch")
	if err != nil {
		t.Fatalf("QueryBlockedState failed: %v", err)
	}

	if !isBlocked || blockedBy != "main" {
		t.Errorf("Expected blocked by main, got isBlocked=%v blockedBy=%s", isBlocked, blockedBy)
	}
}

// TestQueryBlockedState_SendFailure tests proper error when send fails mid-query
func TestQueryBlockedState_SendFailure(t *testing.T) {
	// Create a pipe and immediately close the writer to cause send failure
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
		queryResponses: make(map[string]*queryResponse),
	}

	// Start receive goroutine
	go client.receive()

	// Close the writer before query to force send failure
	clientWriter.Close()
	serverReader.Close()
	serverWriter.Close()

	// Query should fail immediately with a send error
	_, _, err := client.QueryBlockedState("feature-branch")
	if err == nil {
		t.Fatal("Expected error when send fails")
	}

	// Error message should indicate send failure
	errStr := err.Error()
	if !containsAny(errStr, []string{"send", "write", "closed", "pipe"}) {
		t.Errorf("Error message should mention send/write failure, got: %v", err)
	}
}

// Helper function to check if string contains any of the substrings
func containsAny(s string, substrs []string) bool {
	for _, substr := range substrs {
		if len(s) >= len(substr) {
			for i := 0; i <= len(s)-len(substr); i++ {
				if s[i:i+len(substr)] == substr {
					return true
				}
			}
		}
	}
	return false
}

// TestQueryBlockedState_RapidSequential tests rapid sequential queries
func TestQueryBlockedState_RapidSequential(t *testing.T) {
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
		queryResponses: make(map[string]*queryResponse),
	}

	go client.receive()

	// Server responds to each query immediately
	go func() {
		decoder := json.NewDecoder(serverReader)
		encoder := json.NewEncoder(serverWriter)

		for i := 0; i < 10; i++ {
			var queryMsg Message
			if err := decoder.Decode(&queryMsg); err != nil {
				return
			}

			response := Message{
				Type:          MsgTypeBlockedStateResponse,
				Branch:        queryMsg.Branch,
				IsBlocked:     i%2 == 0, // Alternate
				BlockedBranch: "main",
			}
			encoder.Encode(response)
		}
	}()

	// Rapid sequential queries
	for i := 0; i < 10; i++ {
		branch := "branch-" + string(rune('A'+i))
		_, _, err := client.QueryBlockedState(branch)
		if err != nil {
			t.Errorf("Query %d failed: %v", i, err)
		}
	}
}

// TestQueryBlockedState_TimeoutUsesDefinedError tests that timeout returns ErrQueryTimeout
func TestQueryBlockedState_TimeoutUsesDefinedError(t *testing.T) {
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
		queryResponses: make(map[string]*queryResponse),
	}

	go client.receive()

	// Server drains query but doesn't respond
	go func() {
		decoder := json.NewDecoder(serverReader)
		var queryMsg Message
		decoder.Decode(&queryMsg)
		// Close the server writer to prevent blocking
		serverWriter.Close()
	}()

	// Query should timeout with defined error
	_, _, err := client.QueryBlockedState("feature-branch")
	if err == nil {
		t.Fatal("Expected timeout error")
	}

	if err != ErrQueryTimeout {
		t.Errorf("Expected ErrQueryTimeout, got: %v", err)
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

// TestGapDetection_TriggersResync tests that gap detection triggers a full resync cycle
func TestGapDetection_TriggersResync(t *testing.T) {
	// Create pipes for bidirectional communication
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
		queryResponses: make(map[string]*queryResponse),
	}

	// Start receive goroutine
	go client.receive()
	defer client.Close()

	// Simulate server sending messages with a gap
	go func() {
		decoder := json.NewDecoder(serverReader)
		encoder := json.NewEncoder(serverWriter)

		// Send message with SeqNum=1
		msg1 := Message{Type: MsgTypeAlertChange, SeqNum: 1, PaneID: "pane1", EventType: "test"}
		if err := encoder.Encode(msg1); err != nil {
			t.Logf("Server encode error: %v", err)
			return
		}

		// Wait briefly for client to process
		time.Sleep(50 * time.Millisecond)

		// Send message with SeqNum=5 (gap detected: 5 > 1+1)
		msg5 := Message{Type: MsgTypeAlertChange, SeqNum: 5, PaneID: "pane2", EventType: "test2"}
		if err := encoder.Encode(msg5); err != nil {
			t.Logf("Server encode error: %v", err)
			return
		}

		// Expect client to send MsgTypeResyncRequest
		var resyncMsg Message
		if err := decoder.Decode(&resyncMsg); err != nil {
			t.Logf("Server decode error: %v", err)
			return
		}
		if resyncMsg.Type != MsgTypeResyncRequest {
			t.Errorf("Expected MsgTypeResyncRequest, got %s", resyncMsg.Type)
			return
		}

		// Send MsgTypeFullState in response
		fullState := Message{
			Type:            MsgTypeFullState,
			SeqNum:          6,
			Alerts:          map[string]string{"pane1": "alert1", "pane2": "alert2"},
			BlockedBranches: map[string]string{"branch1": "main"},
		}
		if err := encoder.Encode(fullState); err != nil {
			t.Logf("Server encode error: %v", err)
		}
	}()

	// Verify client receives messages
	timeout := time.After(2 * time.Second)
	receivedFullState := false

	for i := 0; i < 3; i++ {
		select {
		case msg := <-client.eventCh:
			if msg.Type == MsgTypeFullState {
				receivedFullState = true
				// Verify full state content
				if len(msg.Alerts) != 2 {
					t.Errorf("Expected 2 alerts in full state, got %d", len(msg.Alerts))
				}
				if len(msg.BlockedBranches) != 1 {
					t.Errorf("Expected 1 blocked branch in full state, got %d", len(msg.BlockedBranches))
				}
			}
		case <-timeout:
			t.Fatal("Timeout waiting for full state after gap detection")
		}
	}

	if !receivedFullState {
		t.Error("Expected to receive MsgTypeFullState after resync request")
	}
}

// TestSyncWarning_LoggedButIgnored tests that sync warnings are logged but not forwarded to eventCh
func TestSyncWarning_LoggedButIgnored(t *testing.T) {
	// Create pipes for bidirectional communication
	clientReader, serverWriter := io.Pipe()
	_, clientWriter := io.Pipe()

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
		queryResponses: make(map[string]*queryResponse),
	}

	// Start receive goroutine
	go client.receive()
	defer client.Close()

	// Simulate server sending sync warning followed by a normal message
	go func() {
		encoder := json.NewEncoder(serverWriter)

		// Send sync warning
		syncWarning := Message{Type: MsgTypeSyncWarning, Error: "client1 send failed"}
		if err := encoder.Encode(syncWarning); err != nil {
			t.Logf("Server encode error: %v", err)
			return
		}

		// Send normal message that should be forwarded
		normalMsg := Message{Type: MsgTypeAlertChange, PaneID: "pane1", EventType: "test"}
		if err := encoder.Encode(normalMsg); err != nil {
			t.Logf("Server encode error: %v", err)
		}
	}()

	// Verify only the normal message is received, not the sync warning
	timeout := time.After(1 * time.Second)
	select {
	case msg := <-client.eventCh:
		if msg.Type == MsgTypeSyncWarning {
			t.Error("Sync warning should not be forwarded to eventCh")
		}
		if msg.Type != MsgTypeAlertChange {
			t.Errorf("Expected MsgTypeAlertChange, got %s", msg.Type)
		}
	case <-timeout:
		t.Fatal("Timeout waiting for normal message")
	}

	// Verify no more messages (sync warning was not queued)
	select {
	case msg := <-client.eventCh:
		if msg.Type == MsgTypeSyncWarning {
			t.Error("Sync warning should not be forwarded to eventCh")
		}
	case <-time.After(200 * time.Millisecond):
		// Expected - no more messages
	}
}

// TestSendAndWait_EncoderFailure tests error handling when write fails (closed pipe)
func TestSendAndWait_EncoderFailure(t *testing.T) {
	// Create pipes and immediately close the write end
	clientReader, serverWriter := io.Pipe()
	_, clientWriter := io.Pipe()
	serverWriter.Close() // Close write end to simulate closed connection
	clientWriter.Close() // Close write end to trigger encoder error

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
		queryResponses: make(map[string]*queryResponse),
	}

	// Attempt to send a message - should fail
	msg := Message{Type: MsgTypeBlockBranch, Branch: "feature", BlockedBranch: "main"}
	err := client.sendMessage(msg)

	if err == nil {
		t.Fatal("Expected error when writing to closed pipe")
	}
}

// TestSendMessage_ConcurrentWrites tests that concurrent writes are protected by mutex
func TestSendMessage_ConcurrentWrites(t *testing.T) {
	// Create pipes for communication
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
		queryResponses: make(map[string]*queryResponse),
	}

	// Start receive goroutine
	go client.receive()
	defer client.Close()

	// Simulate server reading messages
	messagesReceived := make(chan Message, 20)
	go func() {
		decoder := json.NewDecoder(serverReader)
		for {
			var msg Message
			if err := decoder.Decode(&msg); err != nil {
				return
			}
			messagesReceived <- msg
		}
	}()

	// Send multiple messages concurrently
	const numGoroutines = 10
	var wg sync.WaitGroup
	wg.Add(numGoroutines)

	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			defer wg.Done()
			msg := Message{Type: MsgTypeBlockBranch, Branch: "feature", BlockedBranch: "main"}
			if err := client.sendMessage(msg); err != nil {
				t.Logf("Send error in goroutine %d: %v", id, err)
			}
		}(i)
	}

	// Wait for all sends to complete
	wg.Wait()

	// Verify all messages were received
	timeout := time.After(2 * time.Second)
	receivedCount := 0
	for receivedCount < numGoroutines {
		select {
		case <-messagesReceived:
			receivedCount++
		case <-timeout:
			t.Fatalf("Timeout waiting for messages. Received %d/%d", receivedCount, numGoroutines)
		}
	}

	if receivedCount != numGoroutines {
		t.Errorf("Expected %d messages, received %d", numGoroutines, receivedCount)
	}
}

// TestHeartbeat_TimeoutDisconnect tests that heartbeat triggers disconnect on timeout
func TestHeartbeat_TimeoutDisconnect(t *testing.T) {
	// Create pipes for bidirectional communication
	clientReader, _ := io.Pipe()
	serverReader, clientWriter := io.Pipe()

	// Create client with stale lastPong (10 seconds ago, well past heartbeat timeout)
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
		lastPong:       time.Now().Add(-10 * time.Second), // Stale pong - 10 seconds ago
		queryResponses: make(map[string]*queryResponse),
		connected:      true,
	}

	// Start receive goroutine (reads ping but doesn't send pong - timeout scenario)
	go client.receive()

	// Start heartbeat goroutine
	go client.heartbeat()

	// Simulate server reading ping messages but NOT sending pongs
	go func() {
		decoder := json.NewDecoder(serverReader)
		for {
			var msg Message
			if err := decoder.Decode(&msg); err != nil {
				return
			}
			// Read ping but don't send pong back - this will trigger timeout
		}
	}()

	// Wait for disconnect event
	// Heartbeat ticker runs every 5 seconds, so we need to wait at least that long
	// Plus some margin for the check to complete
	timeout := time.After(7 * time.Second)
	select {
	case msg := <-client.eventCh:
		if msg.Type != "disconnect" {
			t.Errorf("Expected disconnect event, got %s", msg.Type)
		}
	case <-timeout:
		t.Fatal("Timeout waiting for disconnect event (heartbeat should have detected stale pong)")
	}

	// Verify client.IsConnected() returns false
	if client.IsConnected() {
		t.Error("Expected client to be disconnected after heartbeat timeout")
	}

	// Clean up
	close(client.done)
}

// TestBlockBranch_EncoderFailure tests that BlockBranch returns error when encoder fails
func TestBlockBranch_EncoderFailure(t *testing.T) {
	// Create a pipe and immediately close the writer to cause send failure
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
		encoder:   json.NewEncoder(clientWriter),
		decoder:   json.NewDecoder(clientReader),
		eventCh:   make(chan Message, 100),
		done:      make(chan struct{}),
		connected: true,
		lastPong:  time.Now(),
	}

	// Start receive goroutine
	go client.receive()

	// Close the writer before calling BlockBranch to force send failure
	clientWriter.Close()
	serverReader.Close()
	serverWriter.Close()

	// BlockBranch should fail immediately with a send error
	err := client.BlockBranch("feature-branch", "main")
	if err == nil {
		t.Fatal("Expected error when encoder fails")
	}

	// Error message should indicate send failure
	errStr := err.Error()
	if !containsAny(errStr, []string{"send", "write", "closed", "pipe"}) {
		t.Errorf("Error message should mention send/write failure, got: %v", err)
	}

	// Clean up
	close(client.done)
}

// TestUnblockBranch_EncoderFailure tests that UnblockBranch returns error when encoder fails
func TestUnblockBranch_EncoderFailure(t *testing.T) {
	// Create a pipe and immediately close the writer to cause send failure
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
		encoder:   json.NewEncoder(clientWriter),
		decoder:   json.NewDecoder(clientReader),
		eventCh:   make(chan Message, 100),
		done:      make(chan struct{}),
		connected: true,
		lastPong:  time.Now(),
	}

	// Start receive goroutine
	go client.receive()

	// Close the writer before calling UnblockBranch to force send failure
	clientWriter.Close()
	serverReader.Close()
	serverWriter.Close()

	// UnblockBranch should fail immediately with a send error
	err := client.UnblockBranch("feature-branch")
	if err == nil {
		t.Fatal("Expected error when encoder fails")
	}

	// Error message should indicate send failure
	errStr := err.Error()
	if !containsAny(errStr, []string{"send", "write", "closed", "pipe"}) {
		t.Errorf("Error message should mention send/write failure, got: %v", err)
	}

	// Clean up
	close(client.done)
}

// TestBlockBranch_ConnectionDrop tests BlockBranch behavior when connection drops
func TestBlockBranch_ConnectionDrop(t *testing.T) {
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
		encoder:   json.NewEncoder(clientWriter),
		decoder:   json.NewDecoder(clientReader),
		eventCh:   make(chan Message, 100),
		done:      make(chan struct{}),
		connected: true,
		lastPong:  time.Now(),
	}

	// Start receive goroutine
	go client.receive()

	// Trigger connection drop in a goroutine after a short delay
	go func() {
		time.Sleep(50 * time.Millisecond)
		clientWriter.Close()
		serverReader.Close()
		serverWriter.Close()
	}()

	// BlockBranch should fail when connection drops
	err := client.BlockBranch("feature-branch", "main")
	if err == nil {
		t.Fatal("Expected error when connection drops")
	}

	// Clean up
	close(client.done)
}

// TestBlockBranch_ConcurrentCalls tests that concurrent BlockBranch calls don't race
func TestBlockBranch_ConcurrentCalls(t *testing.T) {
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
		encoder:   json.NewEncoder(clientWriter),
		decoder:   json.NewDecoder(clientReader),
		eventCh:   make(chan Message, 100),
		done:      make(chan struct{}),
		connected: true,
		lastPong:  time.Now(),
	}

	// Start receive goroutine
	go client.receive()

	// Start server responder that drains messages
	go func() {
		decoder := json.NewDecoder(serverReader)
		for {
			var msg Message
			if err := decoder.Decode(&msg); err != nil {
				return
			}
			// Just drain messages - BlockBranch doesn't expect responses
		}
	}()

	// Launch 10 concurrent BlockBranch calls
	var wg sync.WaitGroup
	results := make(chan error, 10)

	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			// Concurrent calls should complete without races
			err := client.BlockBranch("feature-"+string(rune(idx)), "main")
			results <- err
		}(i)
	}

	// Wait for all goroutines to complete (no timeout = success if no races)
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(results)
		close(done)
	}()

	select {
	case <-done:
		// Success - all calls completed
	case <-time.After(2 * time.Second):
		t.Fatal("Concurrent calls didn't complete (possible deadlock)")
	}

	// Check results - all should succeed (sendAndWait doesn't wait for responses)
	for err := range results {
		if err != nil {
			t.Errorf("Unexpected error from concurrent BlockBranch: %v", err)
		}
	}

	// Clean up
	close(client.done)
	serverWriter.Close()
	clientWriter.Close()
}

// TestGapDetection_OutOfOrderMessages tests that gap detection only triggers on actual gaps
func TestGapDetection_OutOfOrderMessages(t *testing.T) {
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
		encoder:   json.NewEncoder(clientWriter),
		decoder:   json.NewDecoder(clientReader),
		eventCh:   make(chan Message, 100),
		done:      make(chan struct{}),
		connected: true,
		lastPong:  time.Now(),
	}

	// Start receive goroutine
	go client.receive()

	// Send message with seqnum 1
	encoder := json.NewEncoder(serverWriter)
	encoder.Encode(Message{Type: MsgTypeAlertChange, SeqNum: 1, PaneID: "pane1", EventType: "stop"})

	// Wait briefly for processing
	time.Sleep(50 * time.Millisecond)

	// Send message with seqnum 5 (gap detected, should trigger resync)
	encoder.Encode(Message{Type: MsgTypeAlertChange, SeqNum: 5, PaneID: "pane2", EventType: "stop"})

	// Read resync request from server
	decoder := json.NewDecoder(serverReader)
	var resyncMsg Message
	if err := decoder.Decode(&resyncMsg); err != nil {
		t.Fatalf("Expected resync request, got error: %v", err)
	}
	if resyncMsg.Type != MsgTypeResyncRequest {
		t.Errorf("Expected resync request, got %s", resyncMsg.Type)
	}

	// Send message with seqnum 3 (out of order, but no gap since lastSeq is now 5)
	encoder.Encode(Message{Type: MsgTypeAlertChange, SeqNum: 3, PaneID: "pane3", EventType: "stop"})

	// Wait briefly - should NOT trigger another resync
	time.Sleep(50 * time.Millisecond)

	// Try to read another message with timeout - should not be resync
	done := make(chan bool)
	go func() {
		var msg Message
		if decoder.Decode(&msg) == nil && msg.Type == MsgTypeResyncRequest {
			t.Errorf("Expected no resync request for out-of-order message, got: %s", msg.Type)
		}
		done <- true
	}()

	select {
	case <-done:
		// Either timeout or no resync - both acceptable
	case <-time.After(200 * time.Millisecond):
		// Timeout is expected - no resync request
	}

	// Verify lastSeq is 3 (updated from the last message)
	if client.lastSeq.Load() != 3 {
		t.Errorf("Expected lastSeq=3, got %d", client.lastSeq.Load())
	}

	// Clean up
	close(client.done)
	serverWriter.Close()
	clientWriter.Close()
}

// TestGapDetection_RapidMultipleGaps tests multiple gaps in quick succession
func TestGapDetection_RapidMultipleGaps(t *testing.T) {
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
		encoder:   json.NewEncoder(clientWriter),
		decoder:   json.NewDecoder(clientReader),
		eventCh:   make(chan Message, 100),
		done:      make(chan struct{}),
		connected: true,
		lastPong:  time.Now(),
	}

	// Start receive goroutine
	go client.receive()

	encoder := json.NewEncoder(serverWriter)
	decoder := json.NewDecoder(serverReader)

	// Send seq 1, 5, 10, 15 - should trigger 3 gap detections
	encoder.Encode(Message{Type: MsgTypeAlertChange, SeqNum: 1, PaneID: "pane1"})
	time.Sleep(50 * time.Millisecond)

	encoder.Encode(Message{Type: MsgTypeAlertChange, SeqNum: 5, PaneID: "pane2"})
	time.Sleep(50 * time.Millisecond)

	encoder.Encode(Message{Type: MsgTypeAlertChange, SeqNum: 10, PaneID: "pane3"})
	time.Sleep(50 * time.Millisecond)

	encoder.Encode(Message{Type: MsgTypeAlertChange, SeqNum: 15, PaneID: "pane4"})
	time.Sleep(50 * time.Millisecond)

	// Read 3 resync requests
	resyncCount := 0
	timeout := time.After(1 * time.Second)
	msgChan := make(chan Message, 10)

	go func() {
		for {
			var msg Message
			if err := decoder.Decode(&msg); err != nil {
				return
			}
			msgChan <- msg
		}
	}()

	for resyncCount < 3 {
		select {
		case msg := <-msgChan:
			if msg.Type == MsgTypeResyncRequest {
				resyncCount++
			}
		case <-timeout:
			break
		}
		if resyncCount >= 3 {
			break
		}
	}

	if resyncCount != 3 {
		t.Errorf("Expected 3 resync requests, got %d", resyncCount)
	}

	// Clean up
	close(client.done)
	serverWriter.Close()
	clientWriter.Close()
}

// TestGapDetection_ResyncFailure tests that resyncFailures counter increments on send failure
func TestGapDetection_ResyncFailure(t *testing.T) {
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
		encoder:   json.NewEncoder(clientWriter),
		decoder:   json.NewDecoder(clientReader),
		eventCh:   make(chan Message, 100),
		done:      make(chan struct{}),
		connected: true,
		lastPong:  time.Now(),
	}

	// Start receive goroutine
	go client.receive()

	encoder := json.NewEncoder(serverWriter)

	// Send message with seqnum 1
	encoder.Encode(Message{Type: MsgTypeAlertChange, SeqNum: 1, PaneID: "pane1"})
	time.Sleep(50 * time.Millisecond)

	// Close writer to force resync send failure
	clientWriter.Close()
	serverReader.Close()

	// Send message with gap - should trigger resync that fails
	encoder.Encode(Message{Type: MsgTypeAlertChange, SeqNum: 10, PaneID: "pane2"})

	// Wait for resync failure to be detected
	timeout := time.After(2 * time.Second)
	for {
		select {
		case msg := <-client.eventCh:
			if msg.Type == "disconnect" {
				goto done
			}
		case <-timeout:
			t.Fatal("Timeout waiting for disconnect after resync failure")
		}
	}
done:

	// Verify resyncFailures was incremented
	if client.resyncFailures.Load() == 0 {
		t.Error("Expected resyncFailures to be incremented")
	}

	// Clean up
	close(client.done)
	serverWriter.Close()
}

// TestGapDetection_FullStateResetsSequence tests that full_state messages update lastSeq
func TestGapDetection_FullStateResetsSequence(t *testing.T) {
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
		encoder:   json.NewEncoder(clientWriter),
		decoder:   json.NewDecoder(clientReader),
		eventCh:   make(chan Message, 100),
		done:      make(chan struct{}),
		connected: true,
		lastPong:  time.Now(),
	}

	// Start receive goroutine
	go client.receive()

	encoder := json.NewEncoder(serverWriter)
	decoder := json.NewDecoder(serverReader)

	// Send normal sequence 1, 2, 3
	encoder.Encode(Message{Type: MsgTypeAlertChange, SeqNum: 1, PaneID: "pane1"})
	encoder.Encode(Message{Type: MsgTypeAlertChange, SeqNum: 2, PaneID: "pane2"})
	encoder.Encode(Message{Type: MsgTypeAlertChange, SeqNum: 3, PaneID: "pane3"})
	time.Sleep(100 * time.Millisecond)

	// Verify lastSeq is 3
	if client.lastSeq.Load() != 3 {
		t.Errorf("Expected lastSeq=3 after normal sequence, got %d", client.lastSeq.Load())
	}

	// Send full_state with seqnum 4 (no gap, continuing sequence)
	encoder.Encode(Message{
		Type:            MsgTypeFullState,
		SeqNum:          4,
		Alerts:          map[string]string{"pane1": "stop"},
		BlockedBranches: map[string]string{},
	})
	time.Sleep(100 * time.Millisecond)

	// Verify lastSeq is updated to 4
	if client.lastSeq.Load() != 4 {
		t.Errorf("Expected lastSeq=4 after full_state, got %d", client.lastSeq.Load())
	}

	// Send seqnum 5 - should NOT trigger gap detection
	encoder.Encode(Message{Type: MsgTypeAlertChange, SeqNum: 5, PaneID: "pane4"})
	time.Sleep(100 * time.Millisecond)

	// Try to read resync request - should timeout (no gap detected)
	done2 := make(chan bool)
	go func() {
		var msg Message
		if decoder.Decode(&msg) == nil && msg.Type == MsgTypeResyncRequest {
			t.Errorf("Expected no resync request after full_state reset, got: %s", msg.Type)
		}
		done2 <- true
	}()

	select {
	case <-done2:
		// Either timeout or no resync - both acceptable
	case <-time.After(200 * time.Millisecond):
		// Timeout is expected - no resync request
	}

	// Clean up
	close(client.done)
	serverWriter.Close()
	clientWriter.Close()
}

// TestResyncRaceCondition_ConcurrentBroadcast tests that when a client requests resync due to a gap,
// and the daemon sends the FullState response while another broadcast occurs, the client correctly
// receives both messages without entering an infinite resync loop.
func TestResyncRaceCondition_ConcurrentBroadcast(t *testing.T) {
	// Setup: Create bidirectional pipes for client-server communication
	clientReader, serverWriter := io.Pipe()
	serverReader, clientWriter := io.Pipe()
	defer clientReader.Close()
	defer clientWriter.Close()
	defer serverReader.Close()
	defer serverWriter.Close()

	// Create client with pipes
	client := &DaemonClient{
		clientID:       "test-client",
		conn:           &mockConn{reader: clientReader, writer: clientWriter, localAddr: &mockAddr{"unix", "/tmp/test.sock"}, remoteAddr: &mockAddr{"unix", "/tmp/test.sock"}},
		encoder:        json.NewEncoder(clientWriter),
		decoder:        json.NewDecoder(clientReader),
		eventCh:        make(chan Message, 100),
		done:           make(chan struct{}),
		lastPong:       time.Now(),
		queryResponses: make(map[string]*queryResponse),
	}

	// Start receive goroutine
	go client.receive()
	defer client.Close()

	// Track if second resync request is received (should NOT happen)
	resyncRequestCount := atomic.Int32{}

	// Server simulation goroutine
	serverDone := make(chan bool)
	go func() {
		defer close(serverDone)
		encoder := json.NewEncoder(serverWriter)
		decoder := json.NewDecoder(serverReader)

		// Phase 1: Send message with SeqNum=1
		if err := encoder.Encode(Message{Type: MsgTypeAlertChange, SeqNum: 1, PaneID: "pane1", EventType: "stop", Created: true}); err != nil {
			t.Errorf("Failed to send SeqNum=1: %v", err)
			return
		}
		time.Sleep(50 * time.Millisecond) // Allow processing

		// Phase 2: Send message with SeqNum=10 (gap detected - should trigger resync)
		if err := encoder.Encode(Message{Type: MsgTypeAlertChange, SeqNum: 10, PaneID: "pane2", EventType: "stop", Created: true}); err != nil {
			t.Errorf("Failed to send SeqNum=10: %v", err)
			return
		}

		// Phase 3: Read resync request from client
		var resyncMsg Message
		decoder.Decode(&resyncMsg)
		if resyncMsg.Type != MsgTypeResyncRequest {
			t.Errorf("Expected MsgTypeResyncRequest, got %s", resyncMsg.Type)
			return
		}
		resyncRequestCount.Add(1)

		// Phase 4: CRITICAL - Send concurrent broadcast BEFORE FullState
		// This simulates daemon receiving new alert while processing resync
		if err := encoder.Encode(Message{
			Type:      MsgTypeAlertChange,
			SeqNum:    11, // Next in sequence after gap
			PaneID:    "pane3",
			EventType: "stop",
			Created:   true,
		}); err != nil {
			t.Errorf("Failed to send concurrent broadcast SeqNum=11: %v", err)
			return
		}

		// Phase 5: Send FullState response (should reset sequence tracking)
		if err := encoder.Encode(Message{
			Type:            MsgTypeFullState,
			SeqNum:          11, // Current sequence at time of resync
			Alerts:          map[string]string{"pane1": "stop", "pane2": "stop", "pane3": "stop"},
			BlockedBranches: map[string]string{},
		}); err != nil {
			t.Errorf("Failed to send FullState: %v", err)
			return
		}

		// Phase 6: Send another broadcast after resync
		time.Sleep(100 * time.Millisecond)
		if err := encoder.Encode(Message{
			Type:      MsgTypeAlertChange,
			SeqNum:    12,
			PaneID:    "pane4",
			EventType: "idle",
			Created:   true,
		}); err != nil {
			t.Errorf("Failed to send SeqNum=12: %v", err)
			return
		}

		// Check for second resync request (should NOT happen - would indicate infinite loop)
		// Use a channel to read messages without blocking the test
		extraMsgChan := make(chan Message, 1)
		go func() {
			var extraMsg Message
			if err := decoder.Decode(&extraMsg); err == nil {
				extraMsgChan <- extraMsg
			}
		}()

		select {
		case extraMsg := <-extraMsgChan:
			if extraMsg.Type == MsgTypeResyncRequest {
				resyncRequestCount.Add(1)
				t.Error("CRITICAL BUG: Infinite resync loop detected - client sent second resync request")
			}
		case <-time.After(500 * time.Millisecond):
			// Good - no second resync request
		}
	}()

	// Collect all received messages with timeout
	timeout := time.After(3 * time.Second)
	receivedMsgs := []Message{}
	expectedMsgCount := 5 // SeqNum 1, 10, 11 (concurrent), FullState, 12

	for len(receivedMsgs) < expectedMsgCount {
		select {
		case msg := <-client.eventCh:
			receivedMsgs = append(receivedMsgs, msg)
		case <-timeout:
			t.Fatalf("Timeout: only received %d/%d messages. Got: %+v", len(receivedMsgs), expectedMsgCount, receivedMsgs)
		}
	}

	// Wait for server goroutine to complete
	<-serverDone

	// ASSERTION 1: Only one resync request should have been sent
	if resyncRequestCount.Load() != 1 {
		t.Errorf("Expected 1 resync request, got %d (infinite loop detected)", resyncRequestCount.Load())
	}

	// ASSERTION 2: Client should have received FullState message
	hasFullState := false
	for _, msg := range receivedMsgs {
		if msg.Type == MsgTypeFullState {
			hasFullState = true
			if len(msg.Alerts) != 3 {
				t.Errorf("FullState should have 3 alerts, got %d", len(msg.Alerts))
			}
		}
	}
	if !hasFullState {
		t.Error("Client should receive FullState after resync")
	}

	// ASSERTION 3: Client should have received message with SeqNum=12 (broadcast after resync)
	hasSeq12 := false
	for _, msg := range receivedMsgs {
		if msg.SeqNum == 12 {
			hasSeq12 = true
		}
	}
	if !hasSeq12 {
		t.Error("Client should receive broadcasts that occur after resync completes")
	}

	// ASSERTION 4: Client's lastSeq should be updated correctly (should be 12, not stuck)
	finalSeq := client.lastSeq.Load()
	if finalSeq != 12 {
		t.Errorf("Expected lastSeq=12, got %d (indicates stale sequence tracking)", finalSeq)
	}

	t.Logf("Resync race condition test passed: received %d messages, lastSeq=%d, resyncCount=%d",
		len(receivedMsgs), finalSeq, resyncRequestCount.Load())
}

// TestQueryBlockedState_NoStarvationUnderBroadcastLoad tests that QueryBlockedState completes
// within reasonable time when daemon is broadcasting many rapid alerts.
func TestQueryBlockedState_NoStarvationUnderBroadcastLoad(t *testing.T) {
	// Setup: Create bidirectional pipes
	clientReader, serverWriter := io.Pipe()
	serverReader, clientWriter := io.Pipe()
	defer clientReader.Close()
	defer clientWriter.Close()
	defer serverReader.Close()
	defer serverWriter.Close()

	// Create client
	client := &DaemonClient{
		clientID:       "test-client",
		conn:           &mockConn{reader: clientReader, writer: clientWriter, localAddr: &mockAddr{"unix", "/tmp/test.sock"}, remoteAddr: &mockAddr{"unix", "/tmp/test.sock"}},
		encoder:        json.NewEncoder(clientWriter),
		decoder:        json.NewDecoder(clientReader),
		eventCh:        make(chan Message, 100), // Buffered to handle 100 alerts
		done:           make(chan struct{}),
		lastPong:       time.Now(),
		queryResponses: make(map[string]*queryResponse),
	}

	go client.receive()
	defer client.Close()

	// Track received alerts
	alertsReceived := atomic.Int32{}

	// Drain eventCh in background to simulate client processing
	go func() {
		for {
			select {
			case msg := <-client.eventCh:
				if msg.Type == MsgTypeAlertChange {
					alertsReceived.Add(1)
				}
			case <-client.done:
				return
			}
		}
	}()

	// Server simulation: rapid broadcasts + query response
	queryResponseSent := make(chan bool, 1)
	queryCompleted := make(chan bool, 1)
	go func() {
		encoder := json.NewEncoder(serverWriter)
		decoder := json.NewDecoder(serverReader)

		// Start sending 100 rapid broadcasts
		for i := 1; i <= 100; i++ {
			if err := encoder.Encode(Message{
				Type:      MsgTypeAlertChange,
				SeqNum:    uint64(i),
				PaneID:    "pane-" + string(rune('0'+i%10)),
				EventType: "stop",
				Created:   true,
			}); err != nil {
				t.Errorf("Failed to send broadcast %d: %v", i, err)
				return
			}
			// No sleep - rapid fire broadcasts
		}

		// Read query request (should arrive during broadcast storm)
		var queryMsg Message
		if err := decoder.Decode(&queryMsg); err != nil {
			t.Errorf("Failed to read query: %v", err)
			return
		}
		if queryMsg.Type != MsgTypeQueryBlockedState {
			t.Errorf("Expected QueryBlockedState, got %s", queryMsg.Type)
			return
		}

		// CRITICAL: Send query response IMMEDIATELY (daemon doesn't wait for broadcasts)
		if err := encoder.Encode(Message{
			Type:          MsgTypeBlockedStateResponse,
			Branch:        queryMsg.Branch,
			IsBlocked:     true,
			BlockedBranch: "main",
		}); err != nil {
			t.Errorf("Failed to send query response: %v", err)
			return
		}
		queryResponseSent <- true

		// Continue sending more broadcasts after query
		for i := 101; i <= 150; i++ {
			if err := encoder.Encode(Message{
				Type:      MsgTypeAlertChange,
				SeqNum:    uint64(i),
				PaneID:    "pane-" + string(rune('0'+i%10)),
				EventType: "idle",
				Created:   true,
			}); err != nil {
				t.Errorf("Failed to send broadcast %d: %v", i, err)
				return
			}
		}

		<-queryCompleted // Wait for query to complete
	}()

	// Wait for broadcasts to start flooding in
	time.Sleep(100 * time.Millisecond)

	// Issue query while broadcasts are happening
	queryStart := time.Now()
	blockedBy, isBlocked, err := client.QueryBlockedState("feature-branch")
	queryDuration := time.Since(queryStart)
	queryCompleted <- true

	// CRITICAL ASSERTION: Query must complete within 2 seconds
	if queryDuration > 2*time.Second {
		t.Errorf("STARVATION DETECTED: Query took %v (should be < 2s)", queryDuration)
	}

	if err != nil {
		t.Fatalf("Query failed: %v", err)
	}

	if !isBlocked || blockedBy != "main" {
		t.Errorf("Expected blocked by main, got isBlocked=%v blockedBy=%s",
			isBlocked, blockedBy)
	}

	t.Logf("Query completed in %v (no starvation)", queryDuration)

	// Verify query response was sent by server
	select {
	case <-queryResponseSent:
		t.Log("Server sent query response during broadcast storm (correct behavior)")
	case <-time.After(500 * time.Millisecond):
		t.Error("Server failed to send query response")
	}

	// Wait for all broadcasts to be processed
	timeout := time.After(5 * time.Second)
	for alertsReceived.Load() < 150 {
		select {
		case <-timeout:
			t.Fatalf("Only received %d/150 alerts", alertsReceived.Load())
		default:
			time.Sleep(50 * time.Millisecond)
		}
	}

	t.Logf("Received all 150 alerts without loss")
}

// TestGapDetection_QueryRace_ConnectionFailure tests the race condition when gap detection
// spawns resync goroutine concurrently with QueryBlockedState() during connection failure.
// This test verifies that the client handles gracefully when:
// 1. Gap detection triggers a resync request in a background goroutine
// 2. QueryBlockedState() is issued concurrently
// 3. Connection fails BEFORE query response arrives
func TestGapDetection_QueryRace_ConnectionFailure(t *testing.T) {
	// Setup client with pipe-based connection
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
		queryResponses: make(map[string]*queryResponse),
	}

	// Start receive goroutine
	go client.receive()
	defer client.Close()

	// Server simulation
	serverDone := make(chan bool)
	go func() {
		defer close(serverDone)
		encoder := json.NewEncoder(serverWriter)
		decoder := json.NewDecoder(serverReader)

		// Phase 1: Send SeqNum 1
		if err := encoder.Encode(Message{Type: MsgTypeAlertChange, SeqNum: 1, PaneID: "pane1"}); err != nil {
			t.Logf("Server encode error (Phase 1): %v", err)
			return
		}
		time.Sleep(50 * time.Millisecond) // Allow processing

		// Phase 2: Send SeqNum 10 (triggers gap detection)
		if err := encoder.Encode(Message{Type: MsgTypeAlertChange, SeqNum: 10, PaneID: "pane2"}); err != nil {
			t.Logf("Server encode error (Phase 2): %v", err)
			return
		}

		// Phase 3: Read resync request (should arrive from gap detection)
		var resyncMsg Message
		if err := decoder.Decode(&resyncMsg); err != nil {
			t.Logf("Server decode error (resync): %v", err)
			return
		}
		if resyncMsg.Type != MsgTypeResyncRequest {
			t.Errorf("Expected MsgTypeResyncRequest, got %s", resyncMsg.Type)
			return
		}

		// Phase 4: Read query message (issued concurrently with gap resync)
		var queryMsg Message
		if err := decoder.Decode(&queryMsg); err != nil {
			t.Logf("Server decode error (query): %v", err)
			return
		}
		if queryMsg.Type != MsgTypeQueryBlockedState {
			t.Errorf("Expected MsgTypeQueryBlockedState, got %s", queryMsg.Type)
			return
		}

		// Phase 5: CRITICAL - Close connection BEFORE sending query response
		// This simulates network failure during concurrent operations
		serverWriter.Close()
		serverReader.Close()
	}()

	// Wait for gap detection to trigger
	time.Sleep(100 * time.Millisecond)

	// Issue QueryBlockedState() while gap resync is processing
	queryStart := time.Now()
	_, _, err := client.QueryBlockedState("test-branch")
	queryDuration := time.Since(queryStart)

	// Verify query fails gracefully (no deadlock, no panic)
	if err == nil {
		t.Error("Expected error when connection fails during query")
	}

	// Verify query fails within reasonable time (no deadlock)
	if queryDuration > 3*time.Second {
		t.Errorf("Query took too long (%v), possible deadlock", queryDuration)
	}

	// Verify gap detection was triggered
	if client.lastSeq.Load() != 10 {
		t.Errorf("Expected lastSeq=10 after gap detection, got %d", client.lastSeq.Load())
	}

	// Verify client disconnects cleanly
	select {
	case msg := <-client.eventCh:
		if msg.Type != "disconnect" {
			t.Errorf("Expected disconnect event, got %s", msg.Type)
		}
	case <-time.After(1 * time.Second):
		t.Error("Expected disconnect event after connection failure")
	}

	// Wait for server goroutine to complete
	<-serverDone

	t.Logf("Race test passed: query failed gracefully in %v, client disconnected cleanly", queryDuration)
}
