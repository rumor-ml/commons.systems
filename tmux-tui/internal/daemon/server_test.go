package daemon

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// TestLoadBlockedBranches_MissingFile tests loading when file doesn't exist
func TestLoadBlockedBranches_MissingFile(t *testing.T) {
	// Use non-existent path
	nonExistentPath := "/tmp/test-blocked-branches-nonexistent.json"

	// Ensure file doesn't exist
	os.Remove(nonExistentPath)

	branches, err := loadBlockedBranches(nonExistentPath)
	if err != nil {
		t.Fatalf("loadBlockedBranches should not error on missing file: %v", err)
	}

	if branches == nil {
		t.Fatal("Expected non-nil map")
	}

	if len(branches) != 0 {
		t.Errorf("Expected empty map, got %d entries", len(branches))
	}
}

// TestLoadBlockedBranches_EmptyFile tests loading from empty JSON file
func TestLoadBlockedBranches_EmptyFile(t *testing.T) {
	// Create temp directory
	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "blocked-branches.json")

	// Write empty JSON object
	if err := os.WriteFile(filePath, []byte("{}"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	branches, err := loadBlockedBranches(filePath)
	if err != nil {
		t.Fatalf("loadBlockedBranches failed: %v", err)
	}

	if len(branches) != 0 {
		t.Errorf("Expected empty map from {}, got %d entries", len(branches))
	}
}

// TestLoadBlockedBranches_ValidData tests loading valid blocked branches
func TestLoadBlockedBranches_ValidData(t *testing.T) {
	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "blocked-branches.json")

	// Write test data
	testData := map[string]string{
		"feature-1": "main",
		"feature-2": "develop",
	}
	data, err := json.Marshal(testData)
	if err != nil {
		t.Fatalf("Failed to marshal test data: %v", err)
	}

	if err := os.WriteFile(filePath, data, 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	branches, err := loadBlockedBranches(filePath)
	if err != nil {
		t.Fatalf("loadBlockedBranches failed: %v", err)
	}

	if len(branches) != 2 {
		t.Errorf("Expected 2 branches, got %d", len(branches))
	}

	if branches["feature-1"] != "main" {
		t.Errorf("Expected feature-1 blocked by main, got %s", branches["feature-1"])
	}

	if branches["feature-2"] != "develop" {
		t.Errorf("Expected feature-2 blocked by develop, got %s", branches["feature-2"])
	}
}

// TestLoadBlockedBranches_CorruptedJSON tests handling of malformed JSON
func TestLoadBlockedBranches_CorruptedJSON(t *testing.T) {
	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "blocked-branches.json")

	// Write invalid JSON
	invalidJSON := []byte(`{"feature-1": "main", invalid}`)
	if err := os.WriteFile(filePath, invalidJSON, 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	_, err := loadBlockedBranches(filePath)
	if err == nil {
		t.Fatal("Expected error when loading corrupted JSON")
	}

	// Error should mention unmarshaling
	if err.Error() == "" {
		t.Error("Error message should not be empty")
	}
}

// TestSaveBlockedBranches_Success tests successful save
func TestSaveBlockedBranches_Success(t *testing.T) {
	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "blocked-branches.json")

	// Create daemon with test data
	daemon := &AlertDaemon{
		blockedBranches: map[string]string{
			"feature-1": "main",
			"feature-2": "develop",
		},
		blockedPath: filePath,
	}

	// Save
	if err := daemon.saveBlockedBranches(); err != nil {
		t.Fatalf("saveBlockedBranches failed: %v", err)
	}

	// Verify file exists and contains correct data
	data, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("Failed to read saved file: %v", err)
	}

	var loaded map[string]string
	if err := json.Unmarshal(data, &loaded); err != nil {
		t.Fatalf("Failed to unmarshal saved data: %v", err)
	}

	if len(loaded) != 2 {
		t.Errorf("Expected 2 entries in saved file, got %d", len(loaded))
	}

	if loaded["feature-1"] != "main" {
		t.Errorf("Expected feature-1: main, got %s", loaded["feature-1"])
	}
}

// TestSaveBlockedBranches_PermissionDenied tests handling of write errors
func TestSaveBlockedBranches_PermissionDenied(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("Skipping permission test when running as root")
	}

	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "readonly-dir", "blocked-branches.json")

	// Create readonly directory
	readonlyDir := filepath.Join(tmpDir, "readonly-dir")
	if err := os.Mkdir(readonlyDir, 0555); err != nil {
		t.Fatalf("Failed to create readonly dir: %v", err)
	}
	defer os.Chmod(readonlyDir, 0755) // Cleanup

	daemon := &AlertDaemon{
		blockedBranches: map[string]string{"feature-1": "main"},
		blockedPath:     filePath,
	}

	// Save should fail
	err := daemon.saveBlockedBranches()
	if err == nil {
		t.Fatal("Expected error when writing to readonly directory")
	}
}

// TestSaveBlockedBranches_EmptyMap tests saving empty map
func TestSaveBlockedBranches_EmptyMap(t *testing.T) {
	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "blocked-branches.json")

	daemon := &AlertDaemon{
		blockedBranches: map[string]string{},
		blockedPath:     filePath,
	}

	if err := daemon.saveBlockedBranches(); err != nil {
		t.Fatalf("saveBlockedBranches failed: %v", err)
	}

	// Verify file contains {}
	data, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("Failed to read saved file: %v", err)
	}

	var loaded map[string]string
	if err := json.Unmarshal(data, &loaded); err != nil {
		t.Fatalf("Failed to unmarshal: %v", err)
	}

	if len(loaded) != 0 {
		t.Errorf("Expected empty map, got %d entries", len(loaded))
	}
}

// TestLoadSaveRoundtrip tests that data survives load->save->load cycle
func TestLoadSaveRoundtrip(t *testing.T) {
	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "blocked-branches.json")

	// Original data
	original := map[string]string{
		"feature-1": "main",
		"feature-2": "develop",
		"feature-3": "release",
	}

	// Save original
	daemon := &AlertDaemon{
		blockedBranches: original,
		blockedPath:     filePath,
	}
	if err := daemon.saveBlockedBranches(); err != nil {
		t.Fatalf("Initial save failed: %v", err)
	}

	// Load back
	loaded, err := loadBlockedBranches(filePath)
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	// Verify match
	if len(loaded) != len(original) {
		t.Errorf("Length mismatch: original=%d, loaded=%d", len(original), len(loaded))
	}

	for branch, blockedBy := range original {
		if loaded[branch] != blockedBy {
			t.Errorf("Mismatch for %s: original=%s, loaded=%s", branch, blockedBy, loaded[branch])
		}
	}

	// Save again
	daemon2 := &AlertDaemon{
		blockedBranches: loaded,
		blockedPath:     filePath,
	}
	if err := daemon2.saveBlockedBranches(); err != nil {
		t.Fatalf("Second save failed: %v", err)
	}

	// Load final
	final, err := loadBlockedBranches(filePath)
	if err != nil {
		t.Fatalf("Final load failed: %v", err)
	}

	// Verify still matches
	for branch, blockedBy := range original {
		if final[branch] != blockedBy {
			t.Errorf("Final mismatch for %s: original=%s, final=%s", branch, blockedBy, final[branch])
		}
	}
}

// TestBroadcast_EmptyClientList tests broadcasting with no clients
func TestBroadcast_EmptyClientList(t *testing.T) {
	daemon := &AlertDaemon{
		clients: make(map[string]*clientConnection),
	}
	daemon.lastBroadcastError.Store("")

	// Should not panic
	daemon.broadcast(Message{Type: MsgTypeAlertChange})
}

// TestBroadcast_TrackFailures tests that broadcast failures are tracked
func TestBroadcast_TrackFailures(t *testing.T) {
	daemon := &AlertDaemon{
		clients: make(map[string]*clientConnection),
	}
	daemon.lastBroadcastError.Store("")

	r, w := io.Pipe()
	w.Close() // Force failure

	daemon.clients["test-client"] = &clientConnection{
		conn:    &mockConn{reader: r, writer: w},
		encoder: json.NewEncoder(w),
	}

	initialFailures := daemon.broadcastFailures.Load()
	daemon.broadcast(Message{Type: MsgTypeAlertChange})

	if daemon.broadcastFailures.Load() <= initialFailures {
		t.Error("Expected broadcast failures to be incremented")
	}

	lastErr, _ := daemon.lastBroadcastError.Load().(string)
	if lastErr == "" {
		t.Error("Expected lastBroadcastError to be set")
	}
}

// TestGetHealthStatus tests the health status reporting
func TestGetHealthStatus(t *testing.T) {
	daemon := &AlertDaemon{
		clients:         make(map[string]*clientConnection),
		alerts:          map[string]string{"pane1": "stop"},
		blockedBranches: map[string]string{"feature": "main"},
	}
	daemon.lastBroadcastError.Store("test error")
	daemon.broadcastFailures.Store(5)
	daemon.lastWatcherError.Store("watcher error")
	daemon.watcherErrors.Store(3)

	status := daemon.GetHealthStatus()

	if status.BroadcastFailures != 5 {
		t.Errorf("Expected 5 broadcast failures, got %d", status.BroadcastFailures)
	}

	if status.LastBroadcastError != "test error" {
		t.Errorf("Expected 'test error', got '%s'", status.LastBroadcastError)
	}

	if status.WatcherErrors != 3 {
		t.Errorf("Expected 3 watcher errors, got %d", status.WatcherErrors)
	}

	if status.LastWatcherError != "watcher error" {
		t.Errorf("Expected 'watcher error', got '%s'", status.LastWatcherError)
	}

	if status.ActiveAlerts != 1 {
		t.Errorf("Expected 1 active alert, got %d", status.ActiveAlerts)
	}

	if status.BlockedBranches != 1 {
		t.Errorf("Expected 1 blocked branch, got %d", status.BlockedBranches)
	}

	if status.ConnectedClients != 0 {
		t.Errorf("Expected 0 connected clients, got %d", status.ConnectedClients)
	}
}

// TestProtocolMessage_Serialization tests message serialization
func TestProtocolMessage_Serialization(t *testing.T) {
	tests := []struct {
		name string
		msg  Message
	}{
		{
			name: "BlockedStateResponse",
			msg: Message{
				Type:          MsgTypeBlockedStateResponse,
				Branch:        "feature",
				IsBlocked:     true,
				BlockedBranch: "main",
			},
		},
		{
			name: "PersistenceError",
			msg: Message{
				Type:  MsgTypePersistenceError,
				Error: "disk full",
			},
		},
		{
			name: "QueryBlockedState",
			msg: Message{
				Type:   MsgTypeQueryBlockedState,
				Branch: "feature",
			},
		},
		{
			name: "BlockChange",
			msg: Message{
				Type:          MsgTypeBlockChange,
				Branch:        "feature",
				BlockedBranch: "main",
				Blocked:       true,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Marshal
			data, err := json.Marshal(tt.msg)
			if err != nil {
				t.Fatalf("Marshal failed: %v", err)
			}

			// Unmarshal
			var decoded Message
			if err := json.Unmarshal(data, &decoded); err != nil {
				t.Fatalf("Unmarshal failed: %v", err)
			}

			// Verify Type is preserved
			if decoded.Type != tt.msg.Type {
				t.Errorf("Type mismatch: expected %s, got %s", tt.msg.Type, decoded.Type)
			}

			// Verify specific fields based on message type
			switch tt.msg.Type {
			case MsgTypeBlockedStateResponse:
				if decoded.Branch != tt.msg.Branch {
					t.Errorf("Branch mismatch")
				}
				if decoded.IsBlocked != tt.msg.IsBlocked {
					t.Errorf("IsBlocked mismatch")
				}
				if decoded.BlockedBranch != tt.msg.BlockedBranch {
					t.Errorf("BlockedBranch mismatch")
				}

			case MsgTypePersistenceError:
				if decoded.Error != tt.msg.Error {
					t.Errorf("Error mismatch")
				}

			case MsgTypeQueryBlockedState:
				if decoded.Branch != tt.msg.Branch {
					t.Errorf("Branch mismatch")
				}

			case MsgTypeBlockChange:
				if decoded.Blocked != tt.msg.Blocked {
					t.Errorf("Blocked mismatch")
				}
			}
		})
	}
}

// TestBroadcastSequenceNumbers tests that broadcast assigns monotonic sequence numbers
func TestBroadcastSequenceNumbers(t *testing.T) {
	daemon := &AlertDaemon{
		clients: make(map[string]*clientConnection),
	}
	daemon.lastBroadcastError.Store("")

	// Create successful client
	r, w := io.Pipe()
	defer r.Close()
	defer w.Close()

	daemon.clients["test-client"] = &clientConnection{
		conn:    &mockConn{reader: r, writer: w},
		encoder: json.NewEncoder(w),
	}

	// Read messages in background
	received := make(chan Message, 10)
	go func() {
		decoder := json.NewDecoder(r)
		for i := 0; i < 5; i++ {
			var msg Message
			if err := decoder.Decode(&msg); err != nil {
				break
			}
			received <- msg
		}
		close(received)
	}()

	// Broadcast 5 messages
	for i := 0; i < 5; i++ {
		daemon.broadcast(Message{Type: MsgTypeAlertChange, PaneID: "pane-1"})
	}

	// Verify sequence numbers are monotonically increasing
	lastSeq := uint64(0)
	count := 0
	for msg := range received {
		if msg.Type == MsgTypeAlertChange { // Skip sync warnings
			count++
			if msg.SeqNum <= lastSeq {
				t.Errorf("Expected monotonic sequence, got %d after %d", msg.SeqNum, lastSeq)
			}
			lastSeq = msg.SeqNum
		}
	}

	if count < 5 {
		t.Errorf("Expected at least 5 messages, got %d", count)
	}
}

// TestBroadcastPartialFailure tests that sync warning is sent on partial broadcast failure
func TestBroadcastPartialFailure(t *testing.T) {
	daemon := &AlertDaemon{
		clients: make(map[string]*clientConnection),
	}
	daemon.lastBroadcastError.Store("")

	// Create one successful client
	successR, successW := io.Pipe()
	defer successR.Close()
	defer successW.Close()

	daemon.clients["success-client"] = &clientConnection{
		conn:    &mockConn{reader: successR, writer: successW},
		encoder: json.NewEncoder(successW),
	}

	// Create one failing client (closed pipe)
	failR, failW := io.Pipe()
	failW.Close() // Force failure
	defer failR.Close()

	daemon.clients["fail-client"] = &clientConnection{
		conn:    &mockConn{reader: failR, writer: failW},
		encoder: json.NewEncoder(failW),
	}

	// Read messages from successful client in background
	received := make(chan Message, 10)
	go func() {
		decoder := json.NewDecoder(successR)
		for {
			var msg Message
			if err := decoder.Decode(&msg); err != nil {
				break
			}
			received <- msg
		}
		close(received)
	}()

	// Broadcast message (should partially fail)
	daemon.broadcast(Message{Type: MsgTypeAlertChange, PaneID: "pane-1"})

	// Verify we get both the original message and sync warning
	foundAlert := false
	foundSyncWarning := false

	timeout := time.After(2 * time.Second)
	for i := 0; i < 2; i++ {
		select {
		case msg := <-received:
			if msg.Type == MsgTypeAlertChange {
				foundAlert = true
			}
			if msg.Type == MsgTypeSyncWarning {
				foundSyncWarning = true
				if msg.Error == "" {
					t.Error("Sync warning should have error message")
				}
			}
		case <-timeout:
			t.Fatal("Timeout waiting for messages")
		}
	}

	if !foundAlert {
		t.Error("Expected alert message to be delivered to successful client")
	}

	if !foundSyncWarning {
		t.Error("Expected sync warning to be sent to successful clients")
	}
}

// TestConcurrentBroadcasts tests that sequence numbers are thread-safe
func TestConcurrentBroadcasts(t *testing.T) {
	daemon := &AlertDaemon{
		clients: make(map[string]*clientConnection),
	}
	daemon.lastBroadcastError.Store("")

	// Create a client that discards messages
	r, w := io.Pipe()
	defer r.Close()
	defer w.Close()

	daemon.clients["test-client"] = &clientConnection{
		conn:    &mockConn{reader: r, writer: w},
		encoder: json.NewEncoder(w),
	}

	// Discard messages in background
	go func() {
		decoder := json.NewDecoder(r)
		for {
			var msg Message
			if err := decoder.Decode(&msg); err != nil {
				return
			}
		}
	}()

	// Concurrent broadcasts
	var wg sync.WaitGroup
	const numGoroutines = 10
	const broadcastsPerGoroutine = 100

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < broadcastsPerGoroutine; j++ {
				daemon.broadcast(Message{Type: MsgTypeAlertChange})
			}
		}()
	}

	wg.Wait()

	// Verify sequence counter was incremented correctly (no lost increments)
	expectedSeq := uint64(numGoroutines * broadcastsPerGoroutine)
	actualSeq := daemon.seqCounter.Load()
	if actualSeq != expectedSeq {
		t.Errorf("Expected sequence counter to be %d, got %d (lost increments)", expectedSeq, actualSeq)
	}
}

// TestSendFullState tests the sendFullState helper method
func TestSendFullState(t *testing.T) {
	daemon := &AlertDaemon{
		clients:         make(map[string]*clientConnection),
		alerts:          map[string]string{"pane-1": "stop", "pane-2": "idle"},
		blockedBranches: map[string]string{"feature": "main"},
	}
	daemon.seqCounter.Store(42) // Set a specific sequence for testing

	// Create client
	r, w := io.Pipe()
	defer r.Close()
	defer w.Close()

	client := &clientConnection{
		conn:    &mockConn{reader: r, writer: w},
		encoder: json.NewEncoder(w),
	}

	// Read response in background
	received := make(chan Message, 1)
	go func() {
		decoder := json.NewDecoder(r)
		var msg Message
		if err := decoder.Decode(&msg); err != nil {
			return
		}
		received <- msg
	}()

	// Send full state
	if err := daemon.sendFullState(client, "test-client"); err != nil {
		t.Fatalf("sendFullState failed: %v", err)
	}

	// Verify full state message
	msg := <-received
	if msg.Type != MsgTypeFullState {
		t.Errorf("Expected full_state message, got %s", msg.Type)
	}

	if msg.SeqNum != 42 {
		t.Errorf("Expected sequence 42, got %d", msg.SeqNum)
	}

	if len(msg.Alerts) != 2 {
		t.Errorf("Expected 2 alerts, got %d", len(msg.Alerts))
	}

	if len(msg.BlockedBranches) != 1 {
		t.Errorf("Expected 1 blocked branch, got %d", len(msg.BlockedBranches))
	}

	if msg.BlockedBranches["feature"] != "main" {
		t.Errorf("Expected feature blocked by main")
	}
}

// TestProtocolMessage_SeqNum tests sequence number serialization
func TestProtocolMessage_SeqNum(t *testing.T) {
	msg := Message{
		Type:   MsgTypeAlertChange,
		SeqNum: 12345,
		PaneID: "pane-1",
	}

	// Marshal
	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	// Unmarshal
	var decoded Message
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}

	if decoded.SeqNum != 12345 {
		t.Errorf("Expected SeqNum 12345, got %d", decoded.SeqNum)
	}
}

// TestProtocolMessage_SyncWarning tests sync warning message serialization
func TestProtocolMessage_SyncWarning(t *testing.T) {
	msg := Message{
		Type:   MsgTypeSyncWarning,
		SeqNum: 100,
		Error:  "1 of 3 clients failed to receive update",
	}

	// Marshal
	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	// Unmarshal
	var decoded Message
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}

	if decoded.Type != MsgTypeSyncWarning {
		t.Errorf("Expected type sync_warning, got %s", decoded.Type)
	}

	if decoded.Error == "" {
		t.Error("Expected error message in sync warning")
	}
}

// TestProtocolMessage_ResyncRequest tests resync request message serialization
func TestProtocolMessage_ResyncRequest(t *testing.T) {
	msg := Message{
		Type: MsgTypeResyncRequest,
	}

	// Marshal
	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	// Unmarshal
	var decoded Message
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}

	if decoded.Type != MsgTypeResyncRequest {
		t.Errorf("Expected type resync_request, got %s", decoded.Type)
	}
}

// TestHandleClient_PongSendFailure tests that client is removed on pong send failure
func TestHandleClient_PongSendFailure(t *testing.T) {
	tmpDir := t.TempDir()
	blockedPath := filepath.Join(tmpDir, "blocked-branches.json")

	// Create daemon
	daemon := &AlertDaemon{
		clients:         make(map[string]*clientConnection),
		alerts:          make(map[string]string),
		blockedBranches: make(map[string]string),
		blockedPath:     blockedPath,
	}
	daemon.lastBroadcastError.Store("")

	// Create pipe for client communication
	clientReader, serverWriter := io.Pipe()
	serverReader, clientWriter := io.Pipe()

	// Simulate client connection
	conn := &mockConn{
		reader: serverReader,
		writer: serverWriter,
	}

	// Start handleClient in background
	go daemon.handleClient(conn)

	// Send hello message
	encoder := json.NewEncoder(clientWriter)
	helloMsg := Message{
		Type:     MsgTypeHello,
		ClientID: "test-client",
	}
	if err := encoder.Encode(helloMsg); err != nil {
		t.Fatalf("Failed to send hello: %v", err)
	}

	// Read full state message
	decoder := json.NewDecoder(clientReader)
	var fullStateMsg Message
	if err := decoder.Decode(&fullStateMsg); err != nil {
		t.Fatalf("Failed to receive full state: %v", err)
	}

	if fullStateMsg.Type != MsgTypeFullState {
		t.Errorf("Expected full_state, got %s", fullStateMsg.Type)
	}

	// Verify client is registered
	daemon.clientsMu.RLock()
	_, exists := daemon.clients["test-client"]
	daemon.clientsMu.RUnlock()

	if !exists {
		t.Fatal("Client should be registered after hello")
	}

	// Close server writer to cause pong send failure
	serverWriter.Close()

	// Send ping message (pong response will fail to send)
	pingMsg := Message{Type: MsgTypePing}
	if err := encoder.Encode(pingMsg); err != nil {
		t.Fatalf("Failed to send ping: %v", err)
	}

	// Wait for daemon to process ping and fail pong send
	// handleClient should remove the client and exit
	time.Sleep(200 * time.Millisecond)

	// Verify client was removed from daemon.clients map
	daemon.clientsMu.RLock()
	_, stillExists := daemon.clients["test-client"]
	clientCount := len(daemon.clients)
	daemon.clientsMu.RUnlock()

	if stillExists {
		t.Error("Client should be removed after pong send failure")
	}

	if clientCount != 0 {
		t.Errorf("Expected 0 clients, got %d", clientCount)
	}

	// Clean up
	clientWriter.Close()
	clientReader.Close()
	serverReader.Close()
}

// TestBroadcast_FailedClientRemoval verifies that failed clients are removed from the map
func TestBroadcast_FailedClientRemoval(t *testing.T) {
	daemon := &AlertDaemon{
		clients: make(map[string]*clientConnection),
	}
	daemon.lastBroadcastError.Store("")

	// Create one successful client
	successR, successW := io.Pipe()
	defer successR.Close()
	defer successW.Close()

	daemon.clients["success-client"] = &clientConnection{
		conn:    &mockConn{reader: successR, writer: successW},
		encoder: json.NewEncoder(successW),
	}

	// Create one failing client (closed writer)
	failR, failW := io.Pipe()
	failW.Close() // Force failure
	defer failR.Close()

	daemon.clients["failed-client"] = &clientConnection{
		conn:    &mockConn{reader: failR, writer: failW},
		encoder: json.NewEncoder(failW),
	}

	// Verify we start with 2 clients
	if len(daemon.clients) != 2 {
		t.Fatalf("Expected 2 clients initially, got %d", len(daemon.clients))
	}

	// Read messages from successful client in background
	received := make(chan Message, 10)
	go func() {
		decoder := json.NewDecoder(successR)
		for {
			var msg Message
			if err := decoder.Decode(&msg); err != nil {
				break
			}
			received <- msg
		}
		close(received)
	}()

	// Broadcast a message
	daemon.broadcast(Message{Type: MsgTypeAlertChange, PaneID: "pane1", EventType: "stop", Created: true})

	// Wait for messages to be received
	timeout := time.After(2 * time.Second)
	messageCount := 0
	for {
		select {
		case _, ok := <-received:
			if !ok {
				goto done
			}
			messageCount++
			if messageCount >= 2 {
				// Expect 2 messages: alert change + sync warning
				goto done
			}
		case <-timeout:
			goto done
		}
	}
done:

	// Verify failed client was removed
	if len(daemon.clients) != 1 {
		t.Errorf("Expected 1 client after broadcast (failed removed), got %d", len(daemon.clients))
	}

	// Verify the successful client remains
	if _, exists := daemon.clients["success-client"]; !exists {
		t.Error("Expected success-client to remain in map")
	}

	// Verify the failed client was removed
	if _, exists := daemon.clients["failed-client"]; exists {
		t.Error("Expected failed-client to be removed from map")
	}

	// Verify broadcast failures were tracked
	if daemon.broadcastFailures.Load() == 0 {
		t.Error("Expected broadcast failures to be incremented")
	}
}

// TestBroadcast_MemoryLeakPrevention tests that many failed clients don't cause memory leaks
func TestBroadcast_MemoryLeakPrevention(t *testing.T) {
	daemon := &AlertDaemon{
		clients: make(map[string]*clientConnection),
	}
	daemon.lastBroadcastError.Store("")

	// Create 100 clients - 50 successful, 50 will fail
	successfulReaders := make([]*io.PipeReader, 0, 50)
	successfulWriters := make([]*io.PipeWriter, 0, 50)

	for i := 0; i < 100; i++ {
		r, w := io.Pipe()
		clientID := "client-" + string(rune(i))

		if i%2 == 0 {
			// Even numbered clients: close writer to force failure
			w.Close()
			defer r.Close()
		} else {
			// Odd numbered clients: keep open for success
			successfulReaders = append(successfulReaders, r)
			successfulWriters = append(successfulWriters, w)
		}

		daemon.clients[clientID] = &clientConnection{
			conn:    &mockConn{reader: r, writer: w},
			encoder: json.NewEncoder(w),
		}
	}

	// Verify we start with 100 clients
	if len(daemon.clients) != 100 {
		t.Fatalf("Expected 100 clients initially, got %d", len(daemon.clients))
	}

	// Start goroutines to drain messages from successful clients
	var wg sync.WaitGroup
	for _, r := range successfulReaders {
		wg.Add(1)
		go func(reader *io.PipeReader) {
			defer wg.Done()
			decoder := json.NewDecoder(reader)
			for {
				var msg Message
				if err := decoder.Decode(&msg); err != nil {
					return
				}
			}
		}(r)
	}

	// Broadcast a message
	daemon.broadcast(Message{Type: MsgTypeAlertChange, PaneID: "pane1", EventType: "stop", Created: true})

	// Give time for messages to be sent
	time.Sleep(100 * time.Millisecond)

	// Verify only successful clients remain (50 failed should be removed)
	if len(daemon.clients) != 50 {
		t.Errorf("Expected 50 clients after broadcast (50 failed removed), got %d", len(daemon.clients))
	}

	// Verify broadcast failures were tracked
	if daemon.broadcastFailures.Load() != 50 {
		t.Errorf("Expected 50 broadcast failures, got %d", daemon.broadcastFailures.Load())
	}

	// Broadcast again - all remaining clients should succeed
	daemon.broadcast(Message{Type: MsgTypeAlertChange, PaneID: "pane2", EventType: "stop", Created: true})

	// Give time for messages to be sent
	time.Sleep(100 * time.Millisecond)

	// Still 50 clients (no new failures)
	if len(daemon.clients) != 50 {
		t.Errorf("Expected 50 clients after second broadcast, got %d", len(daemon.clients))
	}

	// Clean up
	for _, w := range successfulWriters {
		w.Close()
	}
	for _, r := range successfulReaders {
		r.Close()
	}
	wg.Wait()
}

// TestConcurrentBlockUnblock_SameBranch tests concurrent block/unblock operations
// on the same branch to verify state consistency and persistence integrity
func TestConcurrentBlockUnblock_SameBranch(t *testing.T) {
	tmpDir := t.TempDir()
	blockedPath := filepath.Join(tmpDir, "blocked-branches.json")

	// Create daemon
	daemon := &AlertDaemon{
		clients:         make(map[string]*clientConnection),
		alerts:          make(map[string]string),
		blockedBranches: make(map[string]string),
		blockedPath:     blockedPath,
	}
	daemon.lastBroadcastError.Store("")

	// Create two pipe-based client connections
	// Client 1 will repeatedly block the branch
	client1Reader, server1Writer := io.Pipe()
	server1Reader, client1Writer := io.Pipe()
	defer client1Reader.Close()
	defer client1Writer.Close()
	defer server1Reader.Close()
	defer server1Writer.Close()

	client1Conn := &mockConn{
		reader: server1Reader,
		writer: server1Writer,
	}

	// Client 2 will repeatedly unblock the branch
	client2Reader, server2Writer := io.Pipe()
	server2Reader, client2Writer := io.Pipe()
	defer client2Reader.Close()
	defer client2Writer.Close()
	defer server2Reader.Close()
	defer server2Writer.Close()

	client2Conn := &mockConn{
		reader: server2Reader,
		writer: server2Writer,
	}

	// Start handleClient for both clients in background
	go daemon.handleClient(client1Conn)
	go daemon.handleClient(client2Conn)

	// Send hello messages from both clients
	encoder1 := json.NewEncoder(client1Writer)
	encoder2 := json.NewEncoder(client2Writer)

	if err := encoder1.Encode(Message{Type: MsgTypeHello, ClientID: "blocker-client"}); err != nil {
		t.Fatalf("Failed to send hello from client1: %v", err)
	}
	if err := encoder2.Encode(Message{Type: MsgTypeHello, ClientID: "unblocker-client"}); err != nil {
		t.Fatalf("Failed to send hello from client2: %v", err)
	}

	// Read full state messages from both clients
	decoder1 := json.NewDecoder(client1Reader)
	decoder2 := json.NewDecoder(client2Reader)

	var fullState1, fullState2 Message
	if err := decoder1.Decode(&fullState1); err != nil {
		t.Fatalf("Failed to receive full state on client1: %v", err)
	}
	if err := decoder2.Decode(&fullState2); err != nil {
		t.Fatalf("Failed to receive full state on client2: %v", err)
	}

	// Track broadcasts received by each client
	client1Broadcasts := make(chan Message, 100)
	client2Broadcasts := make(chan Message, 100)
	stopReading := make(chan struct{})

	// Background goroutine to read broadcasts from client1
	go func() {
		for {
			select {
			case <-stopReading:
				return
			default:
				var msg Message
				if err := decoder1.Decode(&msg); err != nil {
					return
				}
				if msg.Type == MsgTypeBlockChange {
					select {
					case client1Broadcasts <- msg:
					case <-stopReading:
						return
					}
				}
			}
		}
	}()

	// Background goroutine to read broadcasts from client2
	go func() {
		for {
			select {
			case <-stopReading:
				return
			default:
				var msg Message
				if err := decoder2.Decode(&msg); err != nil {
					return
				}
				if msg.Type == MsgTypeBlockChange {
					select {
					case client2Broadcasts <- msg:
					case <-stopReading:
						return
					}
				}
			}
		}
	}()

	// Goroutine 1: Repeatedly block the branch
	const numOperations = 20
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < numOperations; i++ {
			blockMsg := Message{
				Type:          MsgTypeBlockBranch,
				Branch:        "test-branch",
				BlockedBranch: "main",
			}
			if err := encoder1.Encode(blockMsg); err != nil {
				return
			}
			time.Sleep(5 * time.Millisecond) // Small delay between operations
		}
	}()

	// Goroutine 2: Repeatedly unblock the branch
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < numOperations; i++ {
			unblockMsg := Message{
				Type:   MsgTypeUnblockBranch,
				Branch: "test-branch",
			}
			if err := encoder2.Encode(unblockMsg); err != nil {
				return
			}
			time.Sleep(5 * time.Millisecond) // Small delay between operations
		}
	}()

	// Wait for all operations to complete
	wg.Wait()

	// Give daemon time to process final messages
	time.Sleep(100 * time.Millisecond)

	// Stop reading broadcasts
	close(stopReading)

	// Verify final state consistency
	daemon.blockedMu.RLock()
	inMemoryBlocked := daemon.blockedBranches["test-branch"]
	inMemoryIsBlocked := (inMemoryBlocked != "")
	daemon.blockedMu.RUnlock()

	// Load from persistence file
	persistedBranches, err := loadBlockedBranches(blockedPath)
	if err != nil {
		t.Fatalf("Failed to load persistence file: %v", err)
	}

	persistedBlocked := persistedBranches["test-branch"]
	persistedIsBlocked := (persistedBlocked != "")

	// Verify in-memory matches disk
	if inMemoryIsBlocked != persistedIsBlocked {
		t.Errorf("State mismatch: in-memory blocked=%v, persisted blocked=%v",
			inMemoryIsBlocked, persistedIsBlocked)
	}

	if inMemoryIsBlocked && inMemoryBlocked != persistedBlocked {
		t.Errorf("Blocked-by mismatch: in-memory=%s, persisted=%s",
			inMemoryBlocked, persistedBlocked)
	}

	// Verify no JSON corruption
	data, err := os.ReadFile(blockedPath)
	if err != nil {
		t.Fatalf("Failed to read persistence file: %v", err)
	}

	var jsonCheck map[string]string
	if err := json.Unmarshal(data, &jsonCheck); err != nil {
		t.Errorf("Persistence file is corrupted (invalid JSON): %v", err)
	}

	// Verify both clients received broadcasts
	client1Count := len(client1Broadcasts)
	client2Count := len(client2Broadcasts)

	if client1Count == 0 {
		t.Error("Client 1 should have received block_change broadcasts")
	}
	if client2Count == 0 {
		t.Error("Client 2 should have received block_change broadcasts")
	}

	t.Logf("Test completed: in-memory blocked=%v, persisted blocked=%v, client1 broadcasts=%d, client2 broadcasts=%d",
		inMemoryIsBlocked, persistedIsBlocked, client1Count, client2Count)
}
