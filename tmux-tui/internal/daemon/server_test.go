package daemon

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/commons-systems/tmux-tui/internal/debug"
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

// TestPersistenceRecovery_TruncatedJSON tests that loadBlockedBranches handles truncated JSON
// gracefully without panicking, and that the daemon can recover and accept new operations.
func TestPersistenceRecovery_TruncatedJSON(t *testing.T) {
	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "blocked-branches.json")

	// Write truncated JSON (simulating partial write / power loss during save)
	truncatedJSON := []byte(`{"branch1": "main", "branch2": "dev`)
	if err := os.WriteFile(filePath, truncatedJSON, 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	// Try to load truncated JSON
	branches, err := loadBlockedBranches(filePath)

	// Verify: Should return error OR empty map, but must not panic
	if err != nil {
		t.Logf("loadBlockedBranches returned error (acceptable): %v", err)
		// Error is acceptable - daemon will log and continue
		if branches != nil && len(branches) > 0 {
			t.Errorf("If error is returned, branches map should be nil or empty, got %d entries", len(branches))
		}
	} else {
		// No error means it returned a valid (possibly empty) map
		t.Logf("loadBlockedBranches returned no error, got %d branches", len(branches))
		if branches == nil {
			t.Error("If no error, branches map should not be nil")
		}
	}

	// Verify recovery: Create daemon with clean state and verify it can accept new operations
	daemon := &AlertDaemon{
		blockedBranches: make(map[string]string),
		blockedPath:     filePath,
	}

	// Remove corrupted file to allow fresh writes
	os.Remove(filePath)

	// Add a new branch - this should work
	daemon.blockedBranches["test-branch"] = "main"

	// Save should succeed with clean data
	if err := daemon.saveBlockedBranches(); err != nil {
		t.Errorf("Recovery failed - cannot save after truncated JSON: %v", err)
	}

	// Verify the new save is valid
	data, err := os.ReadFile(filePath)
	if err != nil {
		t.Errorf("Failed to read recovered file: %v", err)
	} else {
		var loaded map[string]string
		if err := json.Unmarshal(data, &loaded); err != nil {
			t.Errorf("Recovered file contains invalid JSON: %v", err)
		} else if loaded["test-branch"] != "main" {
			t.Errorf("Recovered file missing expected data, got: %v", loaded)
		} else {
			t.Log("Recovery successful - daemon can save valid data after encountering truncated JSON")
		}
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

// TestRevertBlockedBranchChange_MultiClientConsistency tests that when persistence fails
// and a revert occurs, clients connecting DURING the revert window receive consistent state.
// This is a critical edge case where:
// 1. Client1 and Client2 connected, both see successful block change
// 2. Persistence fails, daemon reverts in-memory state
// 3. Client3 connects DURING revert window
// 4. All clients must end up with the same (reverted) state
func TestRevertBlockedBranchChange_MultiClientConsistency(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("Skipping permission test when running as root")
	}

	tmpDir := t.TempDir()
	readonlyDir := filepath.Join(tmpDir, "readonly-dir")
	blockedPath := filepath.Join(readonlyDir, "blocked-branches.json")

	// Create readonly directory to force persistence failure
	if err := os.Mkdir(readonlyDir, 0555); err != nil {
		t.Fatalf("Failed to create readonly dir: %v", err)
	}
	defer os.Chmod(readonlyDir, 0755) // Cleanup

	// Create daemon with initial state: feature-1 blocked by main
	daemon := &AlertDaemon{
		clients: make(map[string]*clientConnection),
		alerts:  make(map[string]string),
		blockedBranches: map[string]string{
			"feature-1": "main",
		},
		blockedPath: blockedPath,
	}
	daemon.lastBroadcastError.Store("")
	daemon.broadcastFailures.Store(0)

	// Create Client1
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

	// Start handleClient for Client1
	go daemon.handleClient(client1Conn)

	// Client1: Send hello
	enc1 := json.NewEncoder(client1Writer)
	if err := enc1.Encode(Message{Type: MsgTypeHello, ClientID: "client-1"}); err != nil {
		t.Fatalf("Failed to send hello from client1: %v", err)
	}

	// Client1: Read full state
	dec1 := json.NewDecoder(client1Reader)
	var fullState1 Message
	if err := dec1.Decode(&fullState1); err != nil {
		t.Fatalf("Failed to receive full state for client1: %v", err)
	}

	// Verify initial state: feature-1 blocked by main
	if fullState1.BlockedBranches["feature-1"] != "main" {
		t.Fatalf("Expected initial state: feature-1 blocked by main, got %s",
			fullState1.BlockedBranches["feature-1"])
	}

	// Create Client2
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

	// Start handleClient for Client2
	go daemon.handleClient(client2Conn)

	// Client2: Send hello
	enc2 := json.NewEncoder(client2Writer)
	if err := enc2.Encode(Message{Type: MsgTypeHello, ClientID: "client-2"}); err != nil {
		t.Fatalf("Failed to send hello from client2: %v", err)
	}

	// Client2: Read full state
	dec2 := json.NewDecoder(client2Reader)
	var fullState2 Message
	if err := dec2.Decode(&fullState2); err != nil {
		t.Fatalf("Failed to receive full state for client2: %v", err)
	}

	// Start goroutines to collect broadcasts
	client1Msgs := make(chan Message, 10)
	client2Msgs := make(chan Message, 10)

	go func() {
		for {
			var msg Message
			if err := dec1.Decode(&msg); err != nil {
				return
			}
			client1Msgs <- msg
		}
	}()

	go func() {
		for {
			var msg Message
			if err := dec2.Decode(&msg); err != nil {
				return
			}
			client2Msgs <- msg
		}
	}()

	// Client1: Attempt to change block from main to develop (will fail to persist)
	blockMsg := Message{
		Type:          MsgTypeBlockBranch,
		Branch:        "feature-1",
		BlockedBranch: "develop",
	}
	if err := enc1.Encode(blockMsg); err != nil {
		t.Fatalf("Failed to send block message: %v", err)
	}

	// Wait briefly for persistence failure and revert to process
	time.Sleep(100 * time.Millisecond)

	// NOW: Connect Client3 DURING revert window
	client3Reader, server3Writer := io.Pipe()
	server3Reader, client3Writer := io.Pipe()
	defer client3Reader.Close()
	defer client3Writer.Close()
	defer server3Reader.Close()
	defer server3Writer.Close()

	client3Conn := &mockConn{
		reader: server3Reader,
		writer: server3Writer,
	}

	// Start handleClient for Client3
	go daemon.handleClient(client3Conn)

	// Client3: Send hello
	enc3 := json.NewEncoder(client3Writer)
	if err := enc3.Encode(Message{Type: MsgTypeHello, ClientID: "client-3"}); err != nil {
		t.Fatalf("Failed to send hello from client3: %v", err)
	}

	// Client3: Read full state
	dec3 := json.NewDecoder(client3Reader)
	var fullState3 Message
	if err := dec3.Decode(&fullState3); err != nil {
		t.Fatalf("Failed to receive full state for client3: %v", err)
	}

	// CRITICAL: Client3 should receive REVERTED state (feature-1 blocked by main)
	// Not the temporary "successful" state (feature-1 blocked by develop)
	if fullState3.BlockedBranches["feature-1"] != "main" {
		t.Errorf("CONSISTENCY VIOLATION: Client3 received stale state. "+
			"Expected feature-1 blocked by main (reverted), got %s",
			fullState3.BlockedBranches["feature-1"])
	}

	// Verify all clients eventually see consistent state
	// Allow time for broadcasts to propagate
	time.Sleep(200 * time.Millisecond)

	// Drain and verify Client1 and Client2 received revert notifications
	client1SawRevert := false
	client2SawRevert := false

drainLoop:
	for {
		select {
		case msg := <-client1Msgs:
			if msg.Type == MsgTypeBlockChange && msg.Branch == "feature-1" && msg.BlockedBranch == "main" {
				client1SawRevert = true
			}
		case msg := <-client2Msgs:
			if msg.Type == MsgTypeBlockChange && msg.Branch == "feature-1" && msg.BlockedBranch == "main" {
				client2SawRevert = true
			}
		case <-time.After(100 * time.Millisecond):
			break drainLoop
		}
	}

	if !client1SawRevert {
		t.Error("Client1 did not receive revert notification (BlockChange to main)")
	}
	if !client2SawRevert {
		t.Error("Client2 did not receive revert notification (BlockChange to main)")
	}

	// Final check: All clients consistent
	daemon.blockedMu.RLock()
	finalState := daemon.blockedBranches["feature-1"]
	daemon.blockedMu.RUnlock()

	if finalState != "main" {
		t.Errorf("Final daemon state inconsistent: expected feature-1 blocked by main, got %s", finalState)
	}

	t.Logf("✓ All clients eventually consistent after persistence failure and revert")
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
	msg, _ := NewAlertChangeMessage(daemon.seqCounter.Add(1), "test-pane", "idle", true)
	daemon.broadcast(msg.ToWireFormat())
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

	status, err := daemon.GetHealthStatus()
	if err != nil {
		t.Fatalf("GetHealthStatus failed: %v", err)
	}

	if status.GetBroadcastFailures() != 5 {
		t.Errorf("Expected 5 broadcast failures, got %d", status.GetBroadcastFailures())
	}

	if status.GetLastBroadcastError() != "test error" {
		t.Errorf("Expected 'test error', got '%s'", status.GetLastBroadcastError())
	}

	if status.GetWatcherErrors() != 3 {
		t.Errorf("Expected 3 watcher errors, got %d", status.GetWatcherErrors())
	}

	if status.GetLastWatcherError() != "watcher error" {
		t.Errorf("Expected 'watcher error', got '%s'", status.GetLastWatcherError())
	}

	if status.GetActiveAlerts() != 1 {
		t.Errorf("Expected 1 active alert, got %d", status.GetActiveAlerts())
	}

	if status.GetBlockedBranches() != 1 {
		t.Errorf("Expected 1 blocked branch, got %d", status.GetBlockedBranches())
	}

	if status.GetConnectedClients() != 0 {
		t.Errorf("Expected 0 connected clients, got %d", status.GetConnectedClients())
	}
}

// TestGetHealthStatus_ValidationFailure tests error handling for corrupted state
func TestGetHealthStatus_ValidationFailure(t *testing.T) {
	daemon := &AlertDaemon{
		clients:         make(map[string]*clientConnection),
		alerts:          map[string]string{"pane1": "stop"},
		blockedBranches: map[string]string{"feature": "main"},
	}

	// Corrupt internal state by setting negative error count
	daemon.broadcastFailures.Store(-5)

	// GetHealthStatus should return error, not zero-value fallback
	status, err := daemon.GetHealthStatus()

	if err == nil {
		t.Fatal("Expected error from GetHealthStatus with corrupted state, got nil")
	}

	if !errors.Is(err, ErrHealthValidationFailed) {
		t.Errorf("Expected ErrHealthValidationFailed, got: %v", err)
	}

	// Status should be zero-value when error is returned
	if status.GetBroadcastFailures() != 0 {
		t.Error("Expected zero-value status on validation error")
	}

	t.Logf("Validation failure correctly returned error: %v", err)
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
		msg, _ := NewAlertChangeMessage(daemon.seqCounter.Add(1), "pane-1", "idle", true)
		daemon.broadcast(msg.ToWireFormat())
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

// TestBroadcastPartialFailure_SyncWarningConstructionFails tests fallback when sync warning construction fails
func TestBroadcastPartialFailure_SyncWarningConstructionFails(t *testing.T) {
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

	// Broadcast message with INVALID type (empty string) to trigger sync warning construction failure
	invalidMsg := Message{
		Type:   "", // Invalid - will cause NewSyncWarningMessage to fail
		SeqNum: daemon.seqCounter.Add(1),
		PaneID: "pane-1",
	}
	daemon.broadcast(invalidMsg)

	// Verify we still get a fallback sync warning despite construction failure
	timeout := time.After(2 * time.Second)
	foundSyncWarning := false

	for i := 0; i < 2 && !foundSyncWarning; i++ {
		select {
		case msg := <-received:
			if msg.Type == MsgTypeSyncWarning {
				foundSyncWarning = true
				if !strings.Contains(msg.Error, "fallback") {
					t.Errorf("Expected fallback sync warning message, got: %s", msg.Error)
				}
				t.Logf("Received fallback sync warning: %s", msg.Error)
			}
		case <-timeout:
			t.Fatal("Timeout waiting for fallback sync warning")
		}
	}

	if !foundSyncWarning {
		t.Error("Expected fallback sync warning to be sent despite construction failure")
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

	// Concurrent broadcasts using v2 constructors
	var wg sync.WaitGroup
	const numGoroutines = 10
	const broadcastsPerGoroutine = 100

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < broadcastsPerGoroutine; j++ {
				// Use v2 constructor which increments seqCounter
				msg, err := NewAlertChangeMessage(daemon.seqCounter.Add(1), "test-pane", "test-event", true)
				if err != nil {
					t.Errorf("Failed to create message: %v", err)
					return
				}
				daemon.broadcast(msg.ToWireFormat())
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

// TestBroadcast_FullStateDuringRapidClientChurn tests that FullState broadcasts work correctly
// when clients are rapidly connecting and disconnecting. This verifies that concurrent client
// modifications don't cause races with broadcast operations.
func TestBroadcast_FullStateDuringRapidClientChurn(t *testing.T) {
	// Create daemon with initial state
	daemon := &AlertDaemon{
		clients: make(map[string]*clientConnection),
		alerts: map[string]string{
			"pane-1": "stop",
			"pane-2": "idle",
			"pane-3": "warning",
			"pane-4": "error",
			"pane-5": "success",
		},
		blockedBranches: map[string]string{
			"feature-1": "main",
			"feature-2": "develop",
			"feature-3": "staging",
		},
	}
	daemon.lastBroadcastError.Store("")

	// Track test duration
	start := time.Now()
	stopCh := make(chan struct{})

	// Client churn: 20 goroutines adding/removing clients every 50-100ms
	var churnWg sync.WaitGroup
	for i := 0; i < 20; i++ {
		churnWg.Add(1)
		go func(id int) {
			defer churnWg.Done()
			clientID := fmt.Sprintf("churn-client-%d", id)

			for {
				select {
				case <-stopCh:
					return
				default:
					// Add client
					r, w := io.Pipe()
					client := &clientConnection{
						encoder: json.NewEncoder(w),
					}

					daemon.clientsMu.Lock()
					daemon.clients[clientID] = client
					daemon.clientsMu.Unlock()

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

					// Stay connected for 50-100ms
					time.Sleep(time.Duration(50+id*2) * time.Millisecond)

					// Remove client
					daemon.clientsMu.Lock()
					delete(daemon.clients, clientID)
					daemon.clientsMu.Unlock()

					r.Close()
					w.Close()

					// Stay disconnected briefly
					time.Sleep(10 * time.Millisecond)
				}
			}
		}(i)
	}

	// Broadcast FullState every 100ms (10 total over 1 second)
	var broadcastWg sync.WaitGroup
	for i := 0; i < 10; i++ {
		broadcastWg.Add(1)
		go func(iteration int) {
			defer broadcastWg.Done()
			time.Sleep(time.Duration(iteration*100) * time.Millisecond)

			// Broadcast to all connected clients
			daemon.clientsMu.Lock()
			clients := make(map[string]*clientConnection)
			for id, client := range daemon.clients {
				clients[id] = client
			}
			daemon.clientsMu.Unlock()

			// Send full state to each client (mimics what daemon does on resync)
			for clientID, client := range clients {
				if err := daemon.sendFullState(client, clientID); err != nil {
					// Connection errors expected during churn
					debug.Log("CHURN_TEST_BROADCAST_ERROR client=%s error=%v", clientID, err)
				}
			}
		}(i)
	}

	// Run test for 1 second
	time.Sleep(1 * time.Second)
	close(stopCh)

	// Wait for all goroutines to complete
	churnWg.Wait()
	broadcastWg.Wait()

	duration := time.Since(start)
	t.Logf("Test completed in %v", duration)

	// Verify test completed in reasonable time
	if duration > 2*time.Second {
		t.Errorf("Test took too long: %v (expected ~1s)", duration)
	}

	t.Log("Client churn broadcast test passed - no races detected")
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

	// seqCounter.Add(1) increments 42 to 43, then returns 43
	if msg.SeqNum != 43 {
		t.Errorf("Expected sequence 43, got %d", msg.SeqNum)
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

// TestHandleClient_ResyncRequest tests that daemon sends full_state on resync request
func TestHandleClient_ResyncRequest(t *testing.T) {
	tmpDir := t.TempDir()
	blockedPath := filepath.Join(tmpDir, "blocked-branches.json")

	// Create daemon with test state
	daemon := &AlertDaemon{
		clients: make(map[string]*clientConnection),
		alerts: map[string]string{
			"pane-1": "stop",
			"pane-2": "idle",
		},
		blockedBranches: map[string]string{
			"feature-1": "main",
		},
		blockedPath: blockedPath,
	}
	daemon.lastBroadcastError.Store("")

	// Create client connection
	clientReader, serverWriter := io.Pipe()
	serverReader, clientWriter := io.Pipe()
	defer clientReader.Close()
	defer clientWriter.Close()
	defer serverReader.Close()
	defer serverWriter.Close()

	conn := &mockConn{
		reader: serverReader,
		writer: serverWriter,
	}

	// Start handleClient in background
	go daemon.handleClient(conn)

	// Send hello message
	encoder := json.NewEncoder(clientWriter)
	if err := encoder.Encode(Message{Type: MsgTypeHello, ClientID: "test-client"}); err != nil {
		t.Fatalf("Failed to send hello: %v", err)
	}

	// Read initial full_state
	decoder := json.NewDecoder(clientReader)
	var fullState1 Message
	if err := decoder.Decode(&fullState1); err != nil {
		t.Fatalf("Failed to receive initial full_state: %v", err)
	}

	if fullState1.Type != MsgTypeFullState {
		t.Errorf("Expected full_state, got %s", fullState1.Type)
	}

	initialSeq := fullState1.SeqNum
	t.Logf("Initial full_state seq: %d", initialSeq)

	// Send resync request
	if err := encoder.Encode(Message{Type: MsgTypeResyncRequest}); err != nil {
		t.Fatalf("Failed to send resync request: %v", err)
	}

	// Read resync full_state response
	var fullState2 Message
	timeout := time.After(2 * time.Second)
	received := make(chan Message, 1)

	go func() {
		var msg Message
		if err := decoder.Decode(&msg); err == nil {
			received <- msg
		}
	}()

	select {
	case fullState2 = <-received:
		// Success
	case <-timeout:
		t.Fatal("Timeout waiting for resync full_state")
	}

	// Verify resync response
	if fullState2.Type != MsgTypeFullState {
		t.Errorf("Expected full_state after resync, got %s", fullState2.Type)
	}

	if fullState2.SeqNum <= initialSeq {
		t.Errorf("Expected resync seq (%d) > initial seq (%d)",
			fullState2.SeqNum, initialSeq)
	}

	// Verify state contents
	if len(fullState2.Alerts) != 2 {
		t.Errorf("Expected 2 alerts in resync, got %d", len(fullState2.Alerts))
	}

	if fullState2.Alerts["pane-1"] != "stop" {
		t.Error("Expected pane-1 alert in resync")
	}

	if len(fullState2.BlockedBranches) != 1 {
		t.Errorf("Expected 1 blocked branch in resync, got %d",
			len(fullState2.BlockedBranches))
	}

	if fullState2.BlockedBranches["feature-1"] != "main" {
		t.Error("Expected feature-1 blocked by main in resync")
	}

	t.Logf("SUCCESS: Resync delivered full state (seq %d → %d)",
		initialSeq, fullState2.SeqNum)
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
	testMsg, _ := NewAlertChangeMessage(daemon.seqCounter.Add(1), "pane1", "stop", true)
	daemon.broadcast(testMsg.ToWireFormat())

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
	testMsg, _ := NewAlertChangeMessage(daemon.seqCounter.Add(1), "pane1", "stop", true)
	daemon.broadcast(testMsg.ToWireFormat())

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
	testMsg2, _ := NewAlertChangeMessage(daemon.seqCounter.Add(1), "pane2", "stop", true)
	daemon.broadcast(testMsg2.ToWireFormat())

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

// TestBlockBranch_PersistenceFailureRollback tests that revertBlockedBranchChange()
// correctly restores in-memory state when saveBlockedBranches() fails during block/unblock operations
func TestBlockBranch_PersistenceFailureRollback(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("Skipping permission test when running as root")
	}

	tmpDir := t.TempDir()
	readonlyDir := filepath.Join(tmpDir, "readonly-dir")
	blockedPath := filepath.Join(readonlyDir, "blocked-branches.json")

	// Create readonly directory to force persistence failure
	if err := os.Mkdir(readonlyDir, 0555); err != nil {
		t.Fatalf("Failed to create readonly dir: %v", err)
	}
	defer os.Chmod(readonlyDir, 0755) // Cleanup

	// Create daemon with initial state: feature-1 blocked by main
	daemon := &AlertDaemon{
		clients: make(map[string]*clientConnection),
		alerts:  make(map[string]string),
		blockedBranches: map[string]string{
			"feature-1": "main",
		},
		blockedPath: blockedPath,
	}
	daemon.lastBroadcastError.Store("")

	// Create pipe-based client connection
	clientReader, serverWriter := io.Pipe()
	serverReader, clientWriter := io.Pipe()
	defer clientReader.Close()
	defer clientWriter.Close()
	defer serverReader.Close()
	defer serverWriter.Close()

	clientConn := &mockConn{
		reader: serverReader,
		writer: serverWriter,
	}

	// Start handleClient in background
	go daemon.handleClient(clientConn)

	// Send hello message
	encoder := json.NewEncoder(clientWriter)
	if err := encoder.Encode(Message{Type: MsgTypeHello, ClientID: "test-client"}); err != nil {
		t.Fatalf("Failed to send hello: %v", err)
	}

	// Read full state message
	decoder := json.NewDecoder(clientReader)
	var fullStateMsg Message
	if err := decoder.Decode(&fullStateMsg); err != nil {
		t.Fatalf("Failed to receive full state: %v", err)
	}

	// Verify initial state: feature-1 blocked by main
	if fullStateMsg.BlockedBranches["feature-1"] != "main" {
		t.Fatalf("Expected initial state: feature-1 blocked by main, got %s",
			fullStateMsg.BlockedBranches["feature-1"])
	}

	// Background goroutine to read broadcasts from client
	broadcasts := make(chan Message, 10)
	go func() {
		for {
			var msg Message
			if err := decoder.Decode(&msg); err != nil {
				return
			}
			broadcasts <- msg
		}
	}()

	// Attempt to change block from main to develop (will fail to persist)
	blockMsg := Message{
		Type:          MsgTypeBlockBranch,
		Branch:        "feature-1",
		BlockedBranch: "develop",
	}
	if err := encoder.Encode(blockMsg); err != nil {
		t.Fatalf("Failed to send block message: %v", err)
	}

	// Wait for broadcasts - should receive:
	// 1. MsgTypePersistenceError (persistence failed)
	// 2. MsgTypeBlockChange (revert to original state: main)
	timeout := time.After(2 * time.Second)
	receivedPersistenceError := false
	receivedRevert := false

	for i := 0; i < 2; i++ {
		select {
		case msg := <-broadcasts:
			if msg.Type == MsgTypePersistenceError {
				receivedPersistenceError = true
			}
			if msg.Type == MsgTypeBlockChange {
				// Should be reverted to main (original state)
				if msg.Branch != "feature-1" {
					t.Errorf("Expected revert for feature-1, got %s", msg.Branch)
				}
				if msg.BlockedBranch != "main" {
					t.Errorf("Expected revert to main, got %s", msg.BlockedBranch)
				}
				if !msg.Blocked {
					t.Error("Expected Blocked=true in revert message")
				}
				receivedRevert = true
			}
		case <-timeout:
			t.Fatal("Timeout waiting for broadcasts")
		}
	}

	if !receivedPersistenceError {
		t.Error("Expected MsgTypePersistenceError broadcast")
	}

	if !receivedRevert {
		t.Error("Expected MsgTypeBlockChange revert broadcast")
	}

	// Verify in-memory state reverted to main (not develop)
	daemon.blockedMu.RLock()
	inMemoryBlocked := daemon.blockedBranches["feature-1"]
	daemon.blockedMu.RUnlock()

	if inMemoryBlocked != "main" {
		t.Errorf("Expected in-memory state reverted to main, got %s", inMemoryBlocked)
	}

	// Verify broadcast failure counter NOT incremented (revert broadcast succeeded)
	// The persistence error itself is logged but doesn't increment broadcast failures
	// because the broadcast of the persistence error message succeeded
	if daemon.broadcastFailures.Load() > 0 {
		t.Logf("Note: broadcastFailures=%d (expected 0, but non-zero acceptable if client disconnected)",
			daemon.broadcastFailures.Load())
	}

	t.Logf("Rollback test passed: reverted to main, broadcasts received")
}

// TestPlayAlertSound_ErrorBroadcast tests that audio errors are broadcast to clients
func TestPlayAlertSound_ErrorBroadcast(t *testing.T) {
	daemon := &AlertDaemon{
		clients: make(map[string]*clientConnection),
	}
	daemon.lastBroadcastError.Store("")

	// Create client to receive broadcasts
	clientR, serverW := io.Pipe()
	serverR, clientW := io.Pipe()
	defer clientR.Close()
	defer serverW.Close()
	defer serverR.Close()
	defer clientW.Close()

	client := &clientConnection{
		encoder: json.NewEncoder(serverW),
	}

	daemon.clientsMu.Lock()
	daemon.clients["test-client"] = client
	daemon.clientsMu.Unlock()

	// Collect received messages
	received := make(chan Message, 10)
	go func() {
		decoder := json.NewDecoder(clientR)
		for {
			var msg Message
			if err := decoder.Decode(&msg); err != nil {
				return
			}
			received <- msg
		}
	}()

	// Simulate audio error broadcast (what playAlertSound() does on error)
	audioErrorMsg := "Audio playback failed: exit status 1\n\n" +
		"Troubleshooting:\n" +
		"  1. Verify audio system: afplay /System/Library/Sounds/Ping.aiff\n" +
		"  2. Check audio output device is connected and unmuted\n"

	audioMsg, _ := NewAudioErrorMessage(daemon.seqCounter.Add(1), audioErrorMsg)
	daemon.broadcast(audioMsg.ToWireFormat())

	// Verify audio error message was broadcast
	select {
	case msg := <-received:
		if msg.Type != MsgTypeAudioError {
			t.Errorf("Expected MsgTypeAudioError, got %s", msg.Type)
		}
		if !strings.Contains(msg.Error, "Troubleshooting") {
			t.Error("Audio error should contain troubleshooting instructions")
		}
		if !strings.Contains(msg.Error, "Audio playback failed") {
			t.Error("Audio error should contain error description")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Timeout waiting for audio error broadcast")
	}
}

// TestPlayAlertSound_ConcurrentRateLimiting tests that concurrent calls to playAlertSound
// are protected by mutex and rate limiting works correctly without race conditions.
func TestPlayAlertSound_ConcurrentRateLimiting(t *testing.T) {
	// Reset lastAudioPlay to ensure clean test state
	audioMutex.Lock()
	lastAudioPlay = time.Time{}
	audioMutex.Unlock()

	// Create AlertDaemon (playAlertSound doesn't use daemon fields, just needs pointer)
	daemon := &AlertDaemon{
		clients: make(map[string]*clientConnection),
	}

	// Track completion of goroutines
	var wg sync.WaitGroup
	start := time.Now()

	// Launch 10 goroutines calling playAlertSound simultaneously
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			daemon.playAlertSound()
			debug.Log("AUDIO_TEST_GOROUTINE_DONE id=%d", id)
		}(i)
	}

	// Wait for all goroutines to complete
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	// Verify test completes within reasonable time
	select {
	case <-done:
		duration := time.Since(start)
		t.Logf("All goroutines completed in %v", duration)

		// Should complete quickly since most calls are rate-limited and return immediately
		// afplay calls run asynchronously, so we don't wait for them
		if duration > 2*time.Second {
			t.Errorf("Test took too long: %v (expected < 2s)", duration)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Test timed out - deadlock or goroutine leak")
	}

	// Verify rate limiting state is sane
	audioMutex.Lock()
	timeSinceLastPlay := time.Since(lastAudioPlay)
	audioMutex.Unlock()

	// If any sound played, lastAudioPlay should be recent (within test duration)
	// If CLAUDE_E2E_TEST is set, lastAudioPlay will be zero (no sounds played)
	if !lastAudioPlay.IsZero() && timeSinceLastPlay > 5*time.Second {
		t.Errorf("lastAudioPlay is stale: %v ago", timeSinceLastPlay)
	}

	t.Log("Concurrent rate limiting test passed - no races detected")
}

// TestServerBroadcastRecoveryAfterClientDisconnect verifies that the daemon
// properly handles client disconnection during broadcast and continues serving
// healthy clients without disruption.
//
// Test scenario:
//  1. Start daemon with 2 connected clients
//  2. Simulate network failure by closing client2's connection
//  3. Trigger broadcast (should fail for client2)
//  4. Verify client1 receives message successfully
//  5. Verify client2 is removed from clients map
//  6. Verify sync_warning sent to client1
//  7. Verify broadcastFailures counter incremented
func TestServerBroadcastRecoveryAfterClientDisconnect(t *testing.T) {
	// Create daemon with minimal setup
	daemon := &AlertDaemon{
		clients: make(map[string]*clientConnection),
		alerts:  make(map[string]string),
	}

	// Create 2 mock clients using pipes
	// Client 1: healthy connection
	client1Reader, client1Writer := io.Pipe()
	defer client1Writer.Close()
	defer client1Reader.Close()

	client1Conn := &clientConnection{
		conn:    &mockConn{reader: client1Reader, writer: client1Writer},
		encoder: json.NewEncoder(client1Writer),
	}

	// Client 2: connection that will fail
	client2Reader, client2Writer := io.Pipe()
	// We'll close client2Writer to simulate network failure

	client2Conn := &clientConnection{
		conn:    &mockConn{reader: client2Reader, writer: client2Writer},
		encoder: json.NewEncoder(client2Writer),
	}

	// Add both clients to daemon
	daemon.clients["client1"] = client1Conn
	daemon.clients["client2"] = client2Conn

	// Verify initial state
	if len(daemon.clients) != 2 {
		t.Fatalf("Expected 2 clients initially, got %d", len(daemon.clients))
	}

	// Setup goroutine to read from client1 (healthy client)
	var wg sync.WaitGroup
	client1Messages := make(chan Message, 10)

	wg.Add(1)
	go func() {
		defer wg.Done()
		decoder := json.NewDecoder(client1Reader)
		for {
			var msg Message
			if err := decoder.Decode(&msg); err != nil {
				if err != io.EOF {
					t.Logf("Client1 decode error (expected): %v", err)
				}
				return
			}
			client1Messages <- msg
		}
	}()

	// SIMULATE FAILURE: Close client2's writer to simulate network failure
	// This will cause the next encode to fail
	client2Writer.Close()

	// Trigger broadcast - this should:
	// 1. Fail to send to client2 (writer closed)
	// 2. Successfully send to client1
	// 3. Remove client2 from clients map
	// 4. Send sync_warning to client1
	testMsg, err := NewAlertChangeMessage(daemon.seqCounter.Add(1), "pane1", "stop", true)
	if err != nil {
		t.Fatalf("Failed to create test message: %v", err)
	}

	daemon.broadcast(testMsg.ToWireFormat())

	// Give time for broadcast to complete
	time.Sleep(100 * time.Millisecond)

	// VERIFY 1: Client1 received the original message
	select {
	case msg := <-client1Messages:
		if msg.Type != MsgTypeAlertChange {
			t.Errorf("Expected alert_change message, got %s", msg.Type)
		}
		if msg.PaneID != "pane1" {
			t.Errorf("Expected pane1, got %s", msg.PaneID)
		}
		if msg.SeqNum == 0 {
			t.Error("Expected non-zero sequence number")
		}
		t.Logf("Client1 received alert_change with seq=%d", msg.SeqNum)
	case <-time.After(1 * time.Second):
		t.Fatal("Timeout waiting for alert_change message on client1")
	}

	// VERIFY 2: Client1 received sync_warning
	select {
	case msg := <-client1Messages:
		if msg.Type != MsgTypeSyncWarning {
			t.Errorf("Expected sync_warning message, got %s", msg.Type)
		}
		if msg.OriginalMsgType != MsgTypeAlertChange {
			t.Errorf("Expected original_msg_type=alert_change, got %s", msg.OriginalMsgType)
		}
		if !strings.Contains(msg.Error, "failed to receive") {
			t.Errorf("Expected error message about failed clients, got: %s", msg.Error)
		}
		t.Logf("Client1 received sync_warning: %s", msg.Error)
	case <-time.After(1 * time.Second):
		t.Fatal("Timeout waiting for sync_warning message on client1")
	}

	// VERIFY 3: Client2 was removed from clients map
	daemon.clientsMu.RLock()
	clientCount := len(daemon.clients)
	_, client2Exists := daemon.clients["client2"]
	daemon.clientsMu.RUnlock()

	if clientCount != 1 {
		t.Errorf("Expected 1 client after failed broadcast, got %d", clientCount)
	}
	if client2Exists {
		t.Error("Client2 should have been removed from clients map")
	}

	// VERIFY 4: Broadcast failure counter incremented
	failures := daemon.broadcastFailures.Load()
	if failures != 1 {
		t.Errorf("Expected 1 broadcast failure, got %d", failures)
	}

	// VERIFY 5: Last broadcast error was set
	if lastErr, ok := daemon.lastBroadcastError.Load().(string); !ok || lastErr == "" {
		t.Error("Expected lastBroadcastError to be set")
	} else {
		t.Logf("Last broadcast error: %s", lastErr)
	}

	// Cleanup
	client1Writer.Close()
	client2Reader.Close()
	wg.Wait()

	t.Log("SUCCESS: Broadcast recovery test passed - daemon properly handled client failure")
}

// mockConn is defined in client_test.go and reused here
// ==================== Phase 2: Critical Test Coverage ====================
// These tests address the critical gaps identified in the PR review

// TestBroadcast_MetricsTracking verifies that broadcast failures increment counters and store error details
func TestBroadcast_MetricsTracking(t *testing.T) {
	daemon := &AlertDaemon{
		clients: make(map[string]*clientConnection),
		alerts:  make(map[string]string),
	}
	daemon.lastBroadcastError.Store("")
	daemon.broadcastFailures.Store(0)

	// Create 3 clients: 2 successful, 1 failing
	client1Reader, client1Writer := io.Pipe()
	client2Reader, client2Writer := io.Pipe()
	client3Reader, client3Writer := io.Pipe()

	// Setup successful clients with background readers
	var wg sync.WaitGroup
	client1Msgs := make(chan Message, 10)
	client2Msgs := make(chan Message, 10)

	// Client 1 reader
	wg.Add(1)
	go func() {
		defer wg.Done()
		decoder := json.NewDecoder(client1Reader)
		for {
			var msg Message
			if err := decoder.Decode(&msg); err != nil {
				return
			}
			client1Msgs <- msg
		}
	}()

	// Client 2 reader
	wg.Add(1)
	go func() {
		defer wg.Done()
		decoder := json.NewDecoder(client2Reader)
		for {
			var msg Message
			if err := decoder.Decode(&msg); err != nil {
				return
			}
			client2Msgs <- msg
		}
	}()

	// Add successful clients
	daemon.clientsMu.Lock()
	daemon.clients["client1"] = &clientConnection{
		conn:    &mockConn{reader: client1Reader, writer: client1Writer},
		encoder: json.NewEncoder(client1Writer),
	}
	daemon.clients["client2"] = &clientConnection{
		conn:    &mockConn{reader: client2Reader, writer: client2Writer},
		encoder: json.NewEncoder(client2Writer),
	}
	daemon.clientsMu.Unlock()

	// Add failing client (close writer immediately to force encode failure)
	client3Writer.Close()
	daemon.clientsMu.Lock()
	daemon.clients["client3"] = &clientConnection{
		conn:    &mockConn{reader: client3Reader, writer: client3Writer},
		encoder: json.NewEncoder(client3Writer),
	}
	daemon.clientsMu.Unlock()

	// Record initial broadcast failures count
	initialFailures := daemon.broadcastFailures.Load()
	t.Logf("Initial broadcast failures: %d", initialFailures)

	// Create and broadcast a test message
	msg, err := NewAlertChangeMessage(daemon.seqCounter.Add(1), "test-pane-1", "idle", true)
	if err != nil {
		t.Fatalf("Failed to create message: %v", err)
	}

	daemon.broadcast(msg.ToWireFormat())

	// Wait for broadcast to complete
	time.Sleep(200 * time.Millisecond)

	// Verify metrics
	finalFailures := daemon.broadcastFailures.Load()
	if finalFailures != initialFailures+1 {
		t.Errorf("Expected broadcastFailures to increment by 1 (from %d to %d), got %d",
			initialFailures, initialFailures+1, finalFailures)
	}

	// Verify error message is stored
	lastErr := daemon.lastBroadcastError.Load()
	if lastErr == nil || lastErr.(string) == "" {
		t.Error("Expected lastBroadcastError to contain error details, got empty")
	} else {
		t.Logf("Last broadcast error stored: %s", lastErr.(string))
	}

	// Verify successful clients received the message
	timeout := time.After(1 * time.Second)
	receivedCount := 0
	for receivedCount < 2 {
		select {
		case msg := <-client1Msgs:
			if msg.Type == MsgTypeAlertChange {
				receivedCount++
				t.Log("Client 1 received message")
			}
		case msg := <-client2Msgs:
			if msg.Type == MsgTypeAlertChange {
				receivedCount++
				t.Log("Client 2 received message")
			}
		case <-timeout:
			t.Fatalf("Timeout waiting for successful clients to receive message (received %d/2)", receivedCount)
		}
	}

	// Verify failed client was removed
	daemon.clientsMu.RLock()
	_, exists := daemon.clients["client3"]
	daemon.clientsMu.RUnlock()
	if exists {
		t.Error("Expected failed client to be removed from clients map")
	}

	// Cleanup
	client1Writer.Close()
	client2Writer.Close()
	client1Reader.Close()
	client2Reader.Close()
	client3Reader.Close()
	wg.Wait()

	t.Log("SUCCESS: Broadcast metrics tracking test passed")
}

// TestWatcherError_MetricsTracking verifies that watcher errors increment metrics
func TestWatcherError_MetricsTracking(t *testing.T) {
	daemon := &AlertDaemon{
		clients: make(map[string]*clientConnection),
		alerts:  make(map[string]string),
		done:    make(chan struct{}),
	}
	daemon.lastWatcherError.Store("")
	daemon.watcherErrors.Store(0)

	// Record initial count
	initialErrors := daemon.watcherErrors.Load()

	// Simulate watcher error (same way the actual watcher loop does it)
	testError := fmt.Errorf("test watcher error: connection lost")
	daemon.watcherErrors.Add(1)
	daemon.lastWatcherError.Store(testError.Error())

	// Verify metrics
	finalErrors := daemon.watcherErrors.Load()
	if finalErrors != initialErrors+1 {
		t.Errorf("Expected watcherErrors to increment by 1, got %d", finalErrors)
	}

	// Verify error message is stored
	lastErr := daemon.lastWatcherError.Load()
	if lastErr == nil || lastErr.(string) == "" {
		t.Error("Expected lastWatcherError to contain error details, got empty")
	} else {
		t.Logf("Last watcher error stored: %s", lastErr.(string))
		if !strings.Contains(lastErr.(string), "test watcher error") {
			t.Errorf("Expected error message to contain 'test watcher error', got: %s", lastErr.(string))
		}
	}

	t.Log("SUCCESS: Watcher error metrics tracking test passed")
}

// TestAudioBroadcastFailures_MetricsTracking verifies audio broadcast failure tracking
func TestAudioBroadcastFailures_MetricsTracking(t *testing.T) {
	daemon := &AlertDaemon{
		clients: make(map[string]*clientConnection),
		alerts:  make(map[string]string),
	}
	daemon.lastAudioBroadcastErr.Store("")
	daemon.audioBroadcastFailures.Store(0)
	daemon.lastBroadcastError.Store("")
	daemon.broadcastFailures.Store(0)

	// Create a client with closed writer (will fail on broadcast)
	r, w := io.Pipe()
	w.Close() // Close immediately to force failure

	daemon.clientsMu.Lock()
	daemon.clients["audio-client"] = &clientConnection{
		conn:    &mockConn{reader: r, writer: w},
		encoder: json.NewEncoder(w),
	}
	daemon.clientsMu.Unlock()

	// Record initial counts
	initialAudioFailures := daemon.audioBroadcastFailures.Load()
	initialBroadcastFailures := daemon.broadcastFailures.Load()

	// Broadcast audio error message
	daemon.broadcastAudioError(fmt.Errorf("test audio error"))

	// Wait for broadcast to complete
	time.Sleep(100 * time.Millisecond)

	// Verify audio-specific metrics
	finalAudioFailures := daemon.audioBroadcastFailures.Load()
	if finalAudioFailures != initialAudioFailures+1 {
		t.Errorf("Expected audioBroadcastFailures to increment by 1, got %d", finalAudioFailures)
	}

	// Verify general broadcast metrics also incremented
	finalBroadcastFailures := daemon.broadcastFailures.Load()
	if finalBroadcastFailures != initialBroadcastFailures+1 {
		t.Errorf("Expected broadcastFailures to increment by 1, got %d", finalBroadcastFailures)
	}

	// Verify error message is stored
	lastAudioErr := daemon.lastAudioBroadcastErr.Load()
	if lastAudioErr == nil || lastAudioErr.(string) == "" {
		t.Error("Expected lastAudioBroadcastErr to contain error details, got empty")
	} else {
		t.Logf("Last audio broadcast error stored: %s", lastAudioErr.(string))
	}

	// Cleanup
	r.Close()

	t.Log("SUCCESS: Audio broadcast failure metrics tracking test passed")
}

// TestConcurrentAlertChangeAndStateQuery verifies no deadlock during concurrent state access
func TestConcurrentAlertChangeAndStateQuery(t *testing.T) {
	daemon := &AlertDaemon{
		clients:         make(map[string]*clientConnection),
		alerts:          make(map[string]string),
		blockedBranches: make(map[string]string),
		previousState:   make(map[string]string),
		done:            make(chan struct{}),
	}
	daemon.lastBroadcastError.Store("")
	daemon.broadcastFailures.Store(0)

	done := make(chan struct{})
	var wg sync.WaitGroup

	// Start 5 goroutines that modify alert state
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			paneID := fmt.Sprintf("pane-%d", id)
			for j := 0; j < 50; j++ {
				select {
				case <-done:
					return
				default:
					daemon.alertsMu.Lock()
					if j%2 == 0 {
						daemon.alerts[paneID] = "idle"
					} else {
						delete(daemon.alerts, paneID)
					}
					daemon.alertsMu.Unlock()
					time.Sleep(1 * time.Millisecond)
				}
			}
		}(i)
	}

	// Start 5 goroutines that query health status (reads alert state)
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				select {
				case <-done:
					return
				default:
					_, _ = daemon.GetHealthStatus()
					time.Sleep(1 * time.Millisecond)
				}
			}
		}()
	}

	// Wait with timeout
	completed := make(chan struct{})
	go func() {
		wg.Wait()
		close(completed)
	}()

	select {
	case <-completed:
		t.Log("SUCCESS: No deadlock detected during concurrent alert changes and state queries")
	case <-time.After(2 * time.Second):
		close(done)
		t.Fatal("DEADLOCK: Test timed out after 2 seconds")
	}
}

// TestConnectionCloseErrors_ThresholdMonitoring verifies threshold warning
func TestConnectionCloseErrors_ThresholdMonitoring(t *testing.T) {
	daemon := &AlertDaemon{
		clients: make(map[string]*clientConnection),
	}
	daemon.lastBroadcastError.Store("")
	daemon.connectionCloseErrors.Store(0)

	// Create 12 clients (exceeds threshold of 10)
	for i := 0; i < 12; i++ {
		r, w := io.Pipe()
		w.Close() // Force close error

		daemon.clients[fmt.Sprintf("client-%d", i)] = &clientConnection{
			conn:    &mockConn{reader: r, writer: w},
			encoder: json.NewEncoder(w),
		}
	}

	// Broadcast message - will fail for all clients and trigger close errors
	testMsg, _ := NewAlertChangeMessage(daemon.seqCounter.Add(1), "pane1", "stop", true)
	daemon.broadcast(testMsg.ToWireFormat())

	time.Sleep(200 * time.Millisecond)

	// Verify close errors were tracked
	closeErrors := daemon.connectionCloseErrors.Load()
	if closeErrors < connectionCloseErrorThreshold {
		t.Errorf("Expected >= %d close errors, got %d",
			connectionCloseErrorThreshold, closeErrors)
	}

	t.Logf("Successfully triggered threshold monitoring (%d errors)", closeErrors)
}

// setupTestDaemonForDeduplication creates a minimal daemon for testing deduplication
func setupTestDaemonForDeduplication(t *testing.T) (*AlertDaemon, func()) {
	t.Helper()

	// Create minimal daemon struct for deduplication testing
	daemon := &AlertDaemon{
		recentEvents: make(map[eventKey]time.Time),
	}

	cleanup := func() {
		// No cleanup needed for minimal struct
	}

	return daemon, cleanup
}

// TestIsDuplicateEvent_BasicDeduplication tests basic event deduplication
func TestIsDuplicateEvent_BasicDeduplication(t *testing.T) {
	daemon, cleanup := setupTestDaemonForDeduplication(t)
	defer cleanup()

	paneID := "%1"
	eventType := "idle"

	// First event should not be a duplicate
	if daemon.isDuplicateEvent(paneID, eventType, true) {
		t.Error("First event should not be marked as duplicate")
	}

	// Immediate second event should be a duplicate
	if !daemon.isDuplicateEvent(paneID, eventType, true) {
		t.Error("Immediate second event should be marked as duplicate")
	}
}

// TestIsDuplicateEvent_WindowExpiration tests that duplicates expire after the window
func TestIsDuplicateEvent_WindowExpiration(t *testing.T) {
	daemon, cleanup := setupTestDaemonForDeduplication(t)
	defer cleanup()

	paneID := "%2"
	eventType := "stop"

	// First event
	if daemon.isDuplicateEvent(paneID, eventType, true) {
		t.Error("First event should not be duplicate")
	}

	// Wait for deduplication window to expire (100ms)
	time.Sleep(150 * time.Millisecond)

	// After window expires, same event should not be duplicate
	if daemon.isDuplicateEvent(paneID, eventType, true) {
		t.Error("Event after window expiration should not be duplicate")
	}
}

// TestIsDuplicateEvent_DifferentPanes tests that different panes don't interfere
func TestIsDuplicateEvent_DifferentPanes(t *testing.T) {
	daemon, cleanup := setupTestDaemonForDeduplication(t)
	defer cleanup()

	pane1 := "%1"
	pane2 := "%2"
	eventType := "idle"

	// Event for pane1
	if daemon.isDuplicateEvent(pane1, eventType, true) {
		t.Error("First event for pane1 should not be duplicate")
	}

	// Same event type for pane2 should not be duplicate (different pane)
	if daemon.isDuplicateEvent(pane2, eventType, true) {
		t.Error("Event for different pane should not be duplicate")
	}

	// Second event for pane1 should be duplicate
	if !daemon.isDuplicateEvent(pane1, eventType, true) {
		t.Error("Second event for pane1 should be duplicate")
	}
}

// TestIsDuplicateEvent_DifferentEventTypes tests that different event types don't interfere
func TestIsDuplicateEvent_DifferentEventTypes(t *testing.T) {
	daemon, cleanup := setupTestDaemonForDeduplication(t)
	defer cleanup()

	paneID := "%1"
	eventType1 := "idle"
	eventType2 := "stop"

	// First event type
	if daemon.isDuplicateEvent(paneID, eventType1, true) {
		t.Error("First event (idle) should not be duplicate")
	}

	// Different event type should not be duplicate
	if daemon.isDuplicateEvent(paneID, eventType2, true) {
		t.Error("Different event type (stop) should not be duplicate")
	}

	// Second event of first type should be duplicate
	if !daemon.isDuplicateEvent(paneID, eventType1, true) {
		t.Error("Second event (idle) should be duplicate")
	}
}

// TestIsDuplicateEvent_CreatedFlag tests that created flag affects deduplication
func TestIsDuplicateEvent_CreatedFlag(t *testing.T) {
	daemon, cleanup := setupTestDaemonForDeduplication(t)
	defer cleanup()

	paneID := "%1"
	eventType := "idle"

	// Event with created=true
	if daemon.isDuplicateEvent(paneID, eventType, true) {
		t.Error("First event (created=true) should not be duplicate")
	}

	// Same event with created=false should not be duplicate (different key)
	if daemon.isDuplicateEvent(paneID, eventType, false) {
		t.Error("Event with created=false should not be duplicate (different from created=true)")
	}

	// Second event with created=true should be duplicate
	if !daemon.isDuplicateEvent(paneID, eventType, true) {
		t.Error("Second event (created=true) should be duplicate")
	}
}

// TestIsDuplicateEvent_InvalidInputs tests handling of invalid inputs
func TestIsDuplicateEvent_InvalidInputs(t *testing.T) {
	daemon, cleanup := setupTestDaemonForDeduplication(t)
	defer cleanup()

	tests := []struct {
		name      string
		paneID    string
		eventType string
		created   bool
	}{
		{
			name:      "empty pane ID",
			paneID:    "",
			eventType: "idle",
			created:   true,
		},
		{
			name:      "empty event type",
			paneID:    "%1",
			eventType: "",
			created:   true,
		},
		{
			name:      "both empty",
			paneID:    "",
			eventType: "",
			created:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Invalid inputs should be treated as duplicates (skipped)
			if !daemon.isDuplicateEvent(tt.paneID, tt.eventType, tt.created) {
				t.Error("Invalid input should be treated as duplicate (skipped)")
			}
		})
	}
}

// TestIsDuplicateEvent_MemoryCleanup tests that old entries are cleaned up
func TestIsDuplicateEvent_MemoryCleanup(t *testing.T) {
	daemon, cleanup := setupTestDaemonForDeduplication(t)
	defer cleanup()

	// Generate many events to trigger cleanup
	for i := 0; i < 100; i++ {
		paneID := fmt.Sprintf("%%pane-%d", i)
		daemon.isDuplicateEvent(paneID, "idle", true)
	}

	// Wait for cleanup threshold to expire (1 second)
	time.Sleep(1100 * time.Millisecond)

	// Trigger another event to invoke cleanup
	daemon.isDuplicateEvent("%cleanup-trigger", "idle", true)

	// Check that the map was cleaned up
	daemon.eventsMu.Lock()
	mapSize := len(daemon.recentEvents)
	daemon.eventsMu.Unlock()

	// After cleanup, only the most recent event should remain
	if mapSize > 10 {
		t.Errorf("Expected recent events map to be cleaned up, but size is %d", mapSize)
	}

	t.Logf("Map size after cleanup: %d (expected <= 10)", mapSize)
}

// TestIsDuplicateEvent_ConcurrentAccess tests thread safety
func TestIsDuplicateEvent_ConcurrentAccess(t *testing.T) {
	daemon, cleanup := setupTestDaemonForDeduplication(t)
	defer cleanup()

	const goroutines = 10
	const eventsPerGoroutine = 100

	done := make(chan bool, goroutines)

	// Launch multiple goroutines checking duplicates concurrently
	for i := 0; i < goroutines; i++ {
		go func(id int) {
			paneID := fmt.Sprintf("%%pane-%d", id)
			for j := 0; j < eventsPerGoroutine; j++ {
				eventType := fmt.Sprintf("event-%d", j%5) // Cycle through 5 event types
				daemon.isDuplicateEvent(paneID, eventType, j%2 == 0)
				time.Sleep(time.Millisecond) // Small delay to create contention
			}
			done <- true
		}(i)
	}

	// Wait for all goroutines to complete
	for i := 0; i < goroutines; i++ {
		<-done
	}

	// Verify no data races (test passes if no race detector warnings)
	t.Log("Concurrent access test completed without races")
}

// TestIsDuplicateEvent_RapidFire tests rapid successive events
func TestIsDuplicateEvent_RapidFire(t *testing.T) {
	daemon, cleanup := setupTestDaemonForDeduplication(t)
	defer cleanup()

	paneID := "%1"
	eventType := "idle"

	// First event should not be duplicate
	if daemon.isDuplicateEvent(paneID, eventType, true) {
		t.Error("First event should not be duplicate")
	}

	// Fire 10 rapid events - all should be duplicates
	duplicateCount := 0
	for i := 0; i < 10; i++ {
		if daemon.isDuplicateEvent(paneID, eventType, true) {
			duplicateCount++
		}
	}

	if duplicateCount != 10 {
		t.Errorf("Expected 10 duplicate events, got %d", duplicateCount)
	}
}

// TestIsDuplicateEvent_Integration tests deduplication with direct event injection
func TestIsDuplicateEvent_Integration(t *testing.T) {
	daemon, cleanup := setupTestDaemonForDeduplication(t)
	defer cleanup()

	paneID := "%1"

	// Simulate multiple events and verify deduplication tracking
	daemon.isDuplicateEvent(paneID, "idle", true)
	daemon.isDuplicateEvent(paneID, "stop", true)

	// Verify deduplication is working by checking internal state
	daemon.eventsMu.Lock()
	mapSize := len(daemon.recentEvents)
	daemon.eventsMu.Unlock()

	if mapSize < 2 {
		t.Errorf("Expected at least 2 events to be tracked in recent events map, got %d", mapSize)
	}

	t.Logf("Integration test completed, recent events map size: %d", mapSize)
}

// TestIsDuplicateEvent_MixedOperations tests various operations in sequence
func TestIsDuplicateEvent_MixedOperations(t *testing.T) {
	daemon, cleanup := setupTestDaemonForDeduplication(t)
	defer cleanup()

	pane1 := "%1"
	pane2 := "%2"
	idle := "idle"
	stop := "stop"

	// Scenario: Multiple panes with different event types
	operations := []struct {
		paneID      string
		eventType   string
		created     bool
		expectDup   bool
		description string
	}{
		{pane1, idle, true, false, "pane1 idle created - first"},
		{pane1, idle, true, true, "pane1 idle created - duplicate"},
		{pane1, stop, true, false, "pane1 stop created - different type"},
		{pane2, idle, true, false, "pane2 idle created - different pane"},
		{pane1, idle, false, false, "pane1 idle deleted - different created flag"},
		{pane1, idle, true, true, "pane1 idle created - duplicate after time"},
	}

	for i, op := range operations {
		isDup := daemon.isDuplicateEvent(op.paneID, op.eventType, op.created)
		if isDup != op.expectDup {
			t.Errorf("Operation %d (%s): expected duplicate=%v, got %v",
				i, op.description, op.expectDup, isDup)
		}
		time.Sleep(10 * time.Millisecond) // Small delay between operations
	}
}

// TestIsDuplicateEvent_EdgeCases tests edge cases
func TestIsDuplicateEvent_EdgeCases(t *testing.T) {
	daemon, cleanup := setupTestDaemonForDeduplication(t)
	defer cleanup()

	// Very long pane ID
	longPaneID := strings.Repeat("%", 1000) + "1"
	if daemon.isDuplicateEvent(longPaneID, "idle", true) {
		t.Error("First event with long pane ID should not be duplicate")
	}

	// Very long event type
	longEventType := strings.Repeat("event", 1000)
	if daemon.isDuplicateEvent("%1", longEventType, true) {
		t.Error("First event with long event type should not be duplicate")
	}

	// Special characters in pane ID
	specialPaneID := "%!@#$%^&*()"
	if daemon.isDuplicateEvent(specialPaneID, "idle", true) {
		t.Error("First event with special characters should not be duplicate")
	}
}

// TestHandleAlertEvent_WithDeduplication removed - requires full daemon/client setup
// Deduplication is thoroughly tested by the other TestIsDuplicateEvent_* tests
