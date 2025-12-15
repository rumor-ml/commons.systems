package daemon

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"
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
