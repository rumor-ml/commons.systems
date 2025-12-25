package daemon

import (
	"fmt"
	"math"
	"strings"
	"sync"
	"testing"
)

// TODO(#518): Add test for HealthStatus field validation with negative values
// TODO(#519): Add test for FullStateMessage with empty string map keys/values
// TODO(#520): Add test for sequence number wraparound from MaxUint64 to 0
// TODO(#521): Add test for FromWireFormat with extraneous fields populated
// TODO(#523): Add exhaustiveness test for FromWireFormat message type handling

// TestFromWireFormat_MalformedMessages verifies that FromWireFormat returns
// appropriate errors for malformed input messages.
func TestFromWireFormat_MalformedMessages(t *testing.T) {
	tests := []struct {
		name          string
		wire          Message
		expectError   bool
		errorContains string
	}{
		// Missing type field
		{
			name:          "missing_type",
			wire:          Message{SeqNum: 42},
			expectError:   true,
			errorContains: "type",
		},
		// Missing required fields for specific message types
		{
			name: "hello_missing_client_id",
			wire: Message{
				Type:   MsgTypeHello,
				SeqNum: 42,
			},
			expectError:   true,
			errorContains: "client_id",
		},
		{
			name: "alert_change_missing_pane_id",
			wire: Message{
				Type:      MsgTypeAlertChange,
				SeqNum:    42,
				EventType: "event1",
			},
			expectError:   true,
			errorContains: "pane_id",
		},
		{
			name: "alert_change_missing_event_type",
			wire: Message{
				Type:   MsgTypeAlertChange,
				SeqNum: 42,
				PaneID: "pane1",
			},
			expectError:   true,
			errorContains: "event_type",
		},
		{
			name: "pane_focus_missing_active_pane_id",
			wire: Message{
				Type:   MsgTypePaneFocus,
				SeqNum: 42,
			},
			expectError:   true,
			errorContains: "active_pane_id",
		},
		{
			name: "block_branch_missing_branch",
			wire: Message{
				Type:          MsgTypeBlockBranch,
				SeqNum:        42,
				BlockedBranch: "branch2",
			},
			expectError:   true,
			errorContains: "branch",
		},
		{
			name: "block_branch_missing_blocked_branch",
			wire: Message{
				Type:   MsgTypeBlockBranch,
				SeqNum: 42,
				Branch: "branch1",
			},
			expectError:   true,
			errorContains: "blocked_branch",
		},
		{
			name: "unblock_branch_missing_branch",
			wire: Message{
				Type:   MsgTypeUnblockBranch,
				SeqNum: 42,
			},
			expectError:   true,
			errorContains: "branch",
		},
		{
			name: "block_change_missing_branch",
			wire: Message{
				Type:    MsgTypeBlockChange,
				SeqNum:  42,
				Blocked: true,
			},
			expectError:   true,
			errorContains: "branch",
		},
		{
			name: "block_change_blocked_true_but_no_blocked_branch",
			wire: Message{
				Type:    MsgTypeBlockChange,
				SeqNum:  42,
				Branch:  "branch1",
				Blocked: true,
			},
			expectError:   true,
			errorContains: "blocked_branch",
		},
		{
			name: "query_blocked_state_missing_branch",
			wire: Message{
				Type:   MsgTypeQueryBlockedState,
				SeqNum: 42,
			},
			expectError:   true,
			errorContains: "branch",
		},
		{
			name: "blocked_state_response_missing_branch",
			wire: Message{
				Type:      MsgTypeBlockedStateResponse,
				SeqNum:    42,
				IsBlocked: true,
			},
			expectError:   true,
			errorContains: "branch",
		},
		{
			name: "health_response_missing_health_status",
			wire: Message{
				Type:   MsgTypeHealthResponse,
				SeqNum: 42,
			},
			expectError:   true,
			errorContains: "health_status",
		},
		{
			name: "sync_warning_missing_original_msg_type",
			wire: Message{
				Type:   MsgTypeSyncWarning,
				SeqNum: 42,
				Error:  "error",
			},
			expectError:   true,
			errorContains: "original_msg_type",
		},
		{
			name: "persistence_error_empty_error",
			wire: Message{
				Type:   MsgTypePersistenceError,
				SeqNum: 42,
				Error:  "", // Empty error messages are now rejected for better diagnostics
			},
			expectError:   true,
			errorContains: "error_msg required",
		},
		{
			name: "audio_error_empty_error",
			wire: Message{
				Type:   MsgTypeAudioError,
				SeqNum: 42,
				Error:  "", // Empty error messages are now rejected for better diagnostics
			},
			expectError:   true,
			errorContains: "error_msg required",
		},
		{
			name: "show_block_picker_missing_pane_id",
			wire: Message{
				Type:   MsgTypeShowBlockPicker,
				SeqNum: 42,
			},
			expectError:   true,
			errorContains: "pane_id",
		},
		// Whitespace-only fields
		{
			name: "hello_whitespace_client_id",
			wire: Message{
				Type:     MsgTypeHello,
				SeqNum:   42,
				ClientID: "   ",
			},
			expectError:   true,
			errorContains: "client_id",
		},
		{
			name: "alert_change_whitespace_pane_id",
			wire: Message{
				Type:      MsgTypeAlertChange,
				SeqNum:    42,
				PaneID:    "\t\n ",
				EventType: "event1",
			},
			expectError:   true,
			errorContains: "pane_id",
		},
		{
			name: "block_branch_whitespace_branch",
			wire: Message{
				Type:          MsgTypeBlockBranch,
				SeqNum:        42,
				Branch:        "  ",
				BlockedBranch: "branch2",
			},
			expectError:   true,
			errorContains: "branch",
		},
		// Valid messages (edge cases that should work)
		{
			name: "ping_minimal",
			wire: Message{
				Type:   MsgTypePing,
				SeqNum: 0,
			},
			expectError: false,
		},
		{
			name: "pong_minimal",
			wire: Message{
				Type:   MsgTypePong,
				SeqNum: 0,
			},
			expectError: false,
		},
		{
			name: "full_state_empty_maps",
			wire: Message{
				Type:            MsgTypeFullState,
				SeqNum:          42,
				Alerts:          map[string]string{},
				BlockedBranches: map[string]string{},
			},
			expectError: false,
		},
		{
			name: "sync_warning_empty_error",
			wire: Message{
				Type:            MsgTypeSyncWarning,
				SeqNum:          42,
				OriginalMsgType: "alert_change",
				Error:           "", // Error field may be empty - FromWireFormat accepts empty strings
			},
			expectError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			msg, err := FromWireFormat(tt.wire)
			if tt.expectError {
				if err == nil {
					t.Errorf("Expected error containing %q, got nil", tt.errorContains)
				} else if !strings.Contains(err.Error(), tt.errorContains) {
					t.Errorf("Expected error containing %q, got %v", tt.errorContains, err)
				}
			} else {
				if err != nil {
					t.Errorf("Expected no error, got %v", err)
				}
				if msg == nil {
					t.Error("Expected message, got nil")
				}
			}
		})
	}
}

// TestConstructor_ExtremeValues verifies that constructors handle extreme values correctly.
func TestConstructor_ExtremeValues(t *testing.T) {
	t.Run("max_uint64_seqnum", func(t *testing.T) {
		msg, err := NewPingMessage(math.MaxUint64)
		if err != nil {
			t.Errorf("Unexpected error: %v", err)
		}
		if msg.SeqNumber() != math.MaxUint64 {
			t.Errorf("SeqNum = %v, want %v", msg.SeqNumber(), uint64(math.MaxUint64))
		}
	})

	t.Run("very_long_string_client_id", func(t *testing.T) {
		longID := strings.Repeat("x", 100000) // 100,000 character string (~100KB UTF-8)
		msg, err := NewHelloMessage(42, longID)
		if err != nil {
			t.Errorf("Unexpected error: %v", err)
		}
		if msg.ClientID() != longID {
			t.Error("ClientID mismatch for very long string")
		}
	})

	t.Run("unicode_in_pane_id", func(t *testing.T) {
		unicodeID := "pane-日本語-🎉-Ω"
		msg, err := NewPaneFocusMessage(42, unicodeID)
		if err != nil {
			t.Errorf("Unexpected error: %v", err)
		}
		if msg.ActivePaneID() != unicodeID {
			t.Errorf("ActivePaneID = %v, want %v", msg.ActivePaneID(), unicodeID)
		}
	})

	t.Run("special_characters_in_branch", func(t *testing.T) {
		tests := []string{
			"feature/my-branch",
			"bugfix/issue#123",
			"release/v2.0.0",
			"user@domain/branch",
			"branch_with_underscores",
			"branch-with-{braces}",
		}
		for _, branch := range tests {
			msg, err := NewUnblockBranchMessage(42, branch)
			if err != nil {
				t.Errorf("Branch %q rejected: %v", branch, err)
			}
			if msg.Branch() != branch {
				t.Errorf("Branch = %v, want %v", msg.Branch(), branch)
			}
		}
	})

	t.Run("very_large_map", func(t *testing.T) {
		largeMap := make(map[string]string, 10000)
		for i := 0; i < 10000; i++ {
			largeMap[strings.Repeat("k", i%100)] = strings.Repeat("v", i%100)
		}
		msg, err := NewFullStateMessage(42, largeMap, largeMap)
		if err != nil {
			t.Errorf("Unexpected error: %v", err)
		}
		// Verify length matches original (maps should be deep copied by constructor, not referenced)
		alerts := msg.Alerts()
		if len(alerts) != len(largeMap) {
			t.Errorf("Alerts map size = %d, want %d", len(alerts), len(largeMap))
		}
	})

	t.Run("empty_optional_fields", func(t *testing.T) {
		// SyncWarning with empty error (optional field)
		msg, err := NewSyncWarningMessage(42, "alert_change", "")
		if err != nil {
			t.Errorf("Unexpected error: %v", err)
		}
		if msg.Error() != "" {
			t.Errorf("Error = %q, want empty", msg.Error())
		}
	})
}

// TestMapImmutability verifies that FullStateMessage deep copies maps
// to prevent external mutation.
func TestMapImmutability(t *testing.T) {
	t.Run("mutate_original_map", func(t *testing.T) {
		originalAlerts := map[string]string{"pane1": "alert1"}
		originalBlocked := map[string]string{"branch1": "branch2"}

		msg, err := NewFullStateMessage(42, originalAlerts, originalBlocked)
		if err != nil {
			t.Fatalf("Failed to create message: %v", err)
		}

		originalAlerts["pane2"] = "alert2"
		originalBlocked["branch3"] = "branch4"

		alerts := msg.Alerts()
		if len(alerts) != 1 || alerts["pane1"] != "alert1" {
			t.Errorf("Message alerts mutated: %v", alerts)
		}
		blocked := msg.BlockedBranches()
		if len(blocked) != 1 || blocked["branch1"] != "branch2" {
			t.Errorf("Message blocked branches mutated: %v", blocked)
		}
	})

	t.Run("mutate_returned_map", func(t *testing.T) {
		msg, err := NewFullStateMessage(
			42,
			map[string]string{"pane1": "alert1"},
			map[string]string{"branch1": "branch2"},
		)
		if err != nil {
			t.Fatalf("Failed to create message: %v", err)
		}

		alerts := msg.Alerts()
		blocked := msg.BlockedBranches()

		alerts["pane2"] = "alert2"
		blocked["branch3"] = "branch4"

		alerts2 := msg.Alerts()
		blocked2 := msg.BlockedBranches()

		if len(alerts2) != 1 || alerts2["pane1"] != "alert1" {
			t.Errorf("Message alerts mutated via returned map: %v", alerts2)
		}
		if len(blocked2) != 1 || blocked2["branch1"] != "branch2" {
			t.Errorf("Message blocked branches mutated via returned map: %v", blocked2)
		}
	})
}

// TestConcurrentMessageCreation verifies thread safety of message constructors.
func TestConcurrentMessageCreation(t *testing.T) {
	const goroutines = 100
	const iterations = 100

	var wg sync.WaitGroup
	var messagesMu sync.Mutex
	messages := make([]MessageV2, 0, goroutines*iterations)
	errors := make(chan error, goroutines*iterations)

	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for i := 0; i < iterations; i++ {
				clientID := fmt.Sprintf("client-%d-%d", id, i)
				msg, err := NewHelloMessage(uint64(id*iterations+i), clientID)
				if err != nil {
					errors <- err
					continue
				}

				messagesMu.Lock()
				messages = append(messages, msg)
				messagesMu.Unlock()

				_, err = NewFullStateMessage(
					uint64(id*iterations+i),
					map[string]string{"p": "a"},
					map[string]string{"b": "c"},
				)
				if err != nil {
					errors <- err
					continue
				}

				_, err = NewBlockChangeMessage(
					uint64(id*iterations+i),
					"branch1",
					"branch2",
					true,
				)
				if err != nil {
					errors <- err
				}
			}
		}(g)
	}

	wg.Wait()
	close(errors)

	// Check for errors
	errorCount := 0
	for err := range errors {
		t.Errorf("Concurrent creation error: %v", err)
		errorCount++
		if errorCount > 10 {
			t.Fatal("Too many errors, stopping")
		}
	}

	// Verify each message has correct unique data (detect race conditions in state)
	seen := make(map[string]bool)
	messagesMu.Lock()
	defer messagesMu.Unlock()

	for _, msg := range messages {
		hello := msg.(*HelloMessageV2)
		clientID := hello.ClientID()
		if seen[clientID] {
			t.Errorf("Duplicate clientID found: %s - indicates race condition", clientID)
		}
		seen[clientID] = true
	}
}

// TestRoundTripFidelity verifies that complex messages survive wire format
// conversion without data loss.
func TestRoundTripFidelity(t *testing.T) {
	t.Run("block_change_message", func(t *testing.T) {
		original, err := NewBlockChangeMessage(42, "branch1", "branch2", true)
		if err != nil {
			t.Fatalf("Failed to create message: %v", err)
		}

		wire := original.ToWireFormat()
		converted, err := FromWireFormat(wire)
		if err != nil {
			t.Fatalf("Failed to convert: %v", err)
		}

		bc, ok := converted.(*BlockChangeMessageV2)
		if !ok {
			t.Fatalf("Expected *BlockChangeMessageV2, got %T", converted)
		}

		if bc.SeqNumber() != 42 {
			t.Errorf("SeqNum = %v, want 42", bc.SeqNumber())
		}
		if bc.Branch() != "branch1" {
			t.Errorf("Branch = %v, want branch1", bc.Branch())
		}
		if bc.BlockedBranch() != "branch2" {
			t.Errorf("BlockedBranch = %v, want branch2", bc.BlockedBranch())
		}
		if !bc.Blocked() {
			t.Errorf("Blocked = %v, want true", bc.Blocked())
		}
	})

	t.Run("full_state_message", func(t *testing.T) {
		originalAlerts := map[string]string{
			"pane1": "alert1",
			"pane2": "alert2",
			"pane3": "alert3",
		}
		originalBlocked := map[string]string{
			"branch1": "branch2",
			"branch3": "branch4",
		}

		original, err := NewFullStateMessage(42, originalAlerts, originalBlocked)
		if err != nil {
			t.Fatalf("Failed to create message: %v", err)
		}

		wire := original.ToWireFormat()
		converted, err := FromWireFormat(wire)
		if err != nil {
			t.Fatalf("Failed to convert: %v", err)
		}

		fs, ok := converted.(*FullStateMessageV2)
		if !ok {
			t.Fatalf("Expected *FullStateMessageV2, got %T", converted)
		}

		if fs.SeqNumber() != 42 {
			t.Errorf("SeqNum = %v, want 42", fs.SeqNumber())
		}

		alerts := fs.Alerts()
		if len(alerts) != len(originalAlerts) {
			t.Errorf("Alerts length = %d, want %d", len(alerts), len(originalAlerts))
		}
		for k, v := range originalAlerts {
			if alerts[k] != v {
				t.Errorf("Alerts[%s] = %v, want %v", k, alerts[k], v)
			}
		}

		blocked := fs.BlockedBranches()
		if len(blocked) != len(originalBlocked) {
			t.Errorf("BlockedBranches length = %d, want %d", len(blocked), len(originalBlocked))
		}
		for k, v := range originalBlocked {
			if blocked[k] != v {
				t.Errorf("BlockedBranches[%s] = %v, want %v", k, blocked[k], v)
			}
		}
	})

	t.Run("health_response_message", func(t *testing.T) {
		status, err := NewHealthStatus(2, "", 1, "", 0, "", 0, "", 5, 10, 3)
		if err != nil {
			t.Fatalf("Failed to create health status: %v", err)
		}

		original, err := NewHealthResponseMessage(42, status)
		if err != nil {
			t.Fatalf("Failed to create message: %v", err)
		}

		wire := original.ToWireFormat()
		converted, err := FromWireFormat(wire)
		if err != nil {
			t.Fatalf("Failed to convert: %v", err)
		}

		hr, ok := converted.(*HealthResponseMessageV2)
		if !ok {
			t.Fatalf("Expected *HealthResponseMessageV2, got %T", converted)
		}

		hs := hr.HealthStatus()
		if hs.GetConnectedClients() != 5 {
			t.Errorf("GetConnectedClients = %v, want 5", hs.GetConnectedClients())
		}
		if hs.GetActiveAlerts() != 10 {
			t.Errorf("GetActiveAlerts = %v, want 10", hs.GetActiveAlerts())
		}
		if hs.GetBlockedBranches() != 3 {
			t.Errorf("GetBlockedBranches = %v, want 3", hs.GetBlockedBranches())
		}
		if hs.GetBroadcastFailures() != 2 {
			t.Errorf("GetBroadcastFailures = %v, want 2", hs.GetBroadcastFailures())
		}
		if hs.GetWatcherErrors() != 1 {
			t.Errorf("GetWatcherErrors = %v, want 1", hs.GetWatcherErrors())
		}
	})
}

// TestFromWireFormat_UnknownMessageType verifies error handling for unknown message types.
func TestFromWireFormat_UnknownMessageType(t *testing.T) {
	wire := Message{
		Type:   "future_message_v3",
		SeqNum: 42,
	}

	msg, err := FromWireFormat(wire)

	if err == nil {
		t.Error("Expected error for unknown message type, got nil")
	}
	if msg != nil {
		t.Errorf("Expected nil message for unknown type, got %T", msg)
	}
	if !strings.Contains(err.Error(), "unknown message type") {
		t.Errorf("Error should mention 'unknown message type', got: %v", err)
	}
	if !strings.Contains(err.Error(), "future_message_v3") {
		t.Errorf("Error should include the unknown type name, got: %v", err)
	}
}

// TestNilPointerHandling verifies that nil pointers are handled gracefully.
func TestNilPointerHandling(t *testing.T) {
	t.Run("full_state_nil_maps", func(t *testing.T) {
		// Constructors should handle nil maps gracefully
		msg, err := NewFullStateMessage(42, nil, nil)
		if err != nil {
			t.Errorf("Unexpected error: %v", err)
		}

		// Should return empty maps, not nil
		alerts := msg.Alerts()
		blocked := msg.BlockedBranches()

		if alerts == nil {
			t.Error("Alerts should be empty map, not nil")
		}
		if blocked == nil {
			t.Error("BlockedBranches should be empty map, not nil")
		}
		if len(alerts) != 0 {
			t.Errorf("Alerts should be empty, got %d entries", len(alerts))
		}
		if len(blocked) != 0 {
			t.Errorf("BlockedBranches should be empty, got %d entries", len(blocked))
		}
	})

	t.Run("wire_format_nil_health_status", func(t *testing.T) {
		wire := Message{
			Type:         MsgTypeHealthResponse,
			SeqNum:       42,
			HealthStatus: nil, // nil pointer
		}

		_, err := FromWireFormat(wire)
		if err == nil {
			t.Error("Expected error for nil HealthStatus, got nil")
		}
		if !strings.Contains(err.Error(), "health_status") {
			t.Errorf("Expected error about health_status, got %v", err)
		}
	})
}
