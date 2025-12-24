package daemon

import (
	"math"
	"strings"
	"sync"
	"testing"
)

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
			errorContains: "client_id required",
		},
		{
			name: "alert_change_missing_pane_id",
			wire: Message{
				Type:      MsgTypeAlertChange,
				SeqNum:    42,
				EventType: "event1",
			},
			expectError:   true,
			errorContains: "pane_id required",
		},
		{
			name: "alert_change_missing_event_type",
			wire: Message{
				Type:   MsgTypeAlertChange,
				SeqNum: 42,
				PaneID: "pane1",
			},
			expectError:   true,
			errorContains: "event_type required",
		},
		{
			name: "pane_focus_missing_active_pane_id",
			wire: Message{
				Type:   MsgTypePaneFocus,
				SeqNum: 42,
			},
			expectError:   true,
			errorContains: "active_pane_id required",
		},
		{
			name: "block_branch_missing_branch",
			wire: Message{
				Type:          MsgTypeBlockBranch,
				SeqNum:        42,
				BlockedBranch: "branch2",
			},
			expectError:   true,
			errorContains: "branch required",
		},
		{
			name: "block_branch_missing_blocked_branch",
			wire: Message{
				Type:   MsgTypeBlockBranch,
				SeqNum: 42,
				Branch: "branch1",
			},
			expectError:   true,
			errorContains: "blocked_branch required",
		},
		{
			name: "unblock_branch_missing_branch",
			wire: Message{
				Type:   MsgTypeUnblockBranch,
				SeqNum: 42,
			},
			expectError:   true,
			errorContains: "branch required",
		},
		{
			name: "block_change_missing_branch",
			wire: Message{
				Type:    MsgTypeBlockChange,
				SeqNum:  42,
				Blocked: true,
			},
			expectError:   true,
			errorContains: "branch required",
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
			errorContains: "blocked_branch required",
		},
		{
			name: "query_blocked_state_missing_branch",
			wire: Message{
				Type:   MsgTypeQueryBlockedState,
				SeqNum: 42,
			},
			expectError:   true,
			errorContains: "branch required",
		},
		{
			name: "blocked_state_response_missing_branch",
			wire: Message{
				Type:      MsgTypeBlockedStateResponse,
				SeqNum:    42,
				IsBlocked: true,
			},
			expectError:   true,
			errorContains: "branch required",
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
			errorContains: "original_msg_type required",
		},
		{
			name: "persistence_error_empty_error",
			wire: Message{
				Type:   MsgTypePersistenceError,
				SeqNum: 42,
				Error:  "", // Error field is optional for these messages
			},
			expectError: false, // Empty error is allowed
		},
		{
			name: "audio_error_empty_error",
			wire: Message{
				Type:   MsgTypeAudioError,
				SeqNum: 42,
				Error:  "", // Error field is optional for these messages
			},
			expectError: false, // Empty error is allowed
		},
		{
			name: "show_block_picker_missing_pane_id",
			wire: Message{
				Type:   MsgTypeShowBlockPicker,
				SeqNum: 42,
			},
			expectError:   true,
			errorContains: "pane_id required",
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
			errorContains: "client_id required",
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
			errorContains: "pane_id required",
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
			errorContains: "branch required",
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
				Error:           "", // Error is optional
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
		longID := strings.Repeat("x", 100000) // 100KB string
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
		// Verify length (maps should be copied)
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

		// Mutate original maps
		originalAlerts["pane2"] = "alert2"
		originalBlocked["branch3"] = "branch4"

		// Verify message unchanged
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

		// Get maps
		alerts := msg.Alerts()
		blocked := msg.BlockedBranches()

		// Mutate returned maps
		alerts["pane2"] = "alert2"
		blocked["branch3"] = "branch4"

		// Verify message unchanged by getting maps again
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
	errors := make(chan error, goroutines*iterations)

	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for i := 0; i < iterations; i++ {
				// Create various message types concurrently
				_, err := NewHelloMessage(uint64(id*iterations+i), "client")
				if err != nil {
					errors <- err
					continue
				}

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
}

// TestRoundTripFidelity verifies that complex messages survive wire format
// conversion without data loss.
func TestRoundTripFidelity(t *testing.T) {
	t.Run("block_change_message", func(t *testing.T) {
		original, err := NewBlockChangeMessage(42, "branch1", "branch2", true)
		if err != nil {
			t.Fatalf("Failed to create message: %v", err)
		}

		// Convert to wire and back
		wire := original.ToWireFormat()
		converted, err := FromWireFormat(wire)
		if err != nil {
			t.Fatalf("Failed to convert: %v", err)
		}

		// Verify type
		bc, ok := converted.(*BlockChangeMessageV2)
		if !ok {
			t.Fatalf("Expected *BlockChangeMessageV2, got %T", converted)
		}

		// Verify all fields
		if bc.SeqNumber() != 42 {
			t.Errorf("SeqNum = %v, want 42", bc.SeqNumber())
		}
		if bc.Branch() != "branch1" {
			t.Errorf("Branch = %v, want branch1", bc.Branch())
		}
		if bc.BlockedBranch() != "branch2" {
			t.Errorf("BlockedBranch = %v, want branch2", bc.BlockedBranch())
		}
		if bc.Blocked() != true {
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

		// Convert to wire and back
		wire := original.ToWireFormat()
		converted, err := FromWireFormat(wire)
		if err != nil {
			t.Fatalf("Failed to convert: %v", err)
		}

		// Verify type
		fs, ok := converted.(*FullStateMessageV2)
		if !ok {
			t.Fatalf("Expected *FullStateMessageV2, got %T", converted)
		}

		// Verify all fields
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
		status, err := NewHealthStatus(100, 5, 10, 3, 2, 1, 0)
		if err != nil {
			t.Fatalf("Failed to create health status: %v", err)
		}

		original, err := NewHealthResponseMessage(42, status)
		if err != nil {
			t.Fatalf("Failed to create message: %v", err)
		}

		// Convert to wire and back
		wire := original.ToWireFormat()
		converted, err := FromWireFormat(wire)
		if err != nil {
			t.Fatalf("Failed to convert: %v", err)
		}

		// Verify type
		hr, ok := converted.(*HealthResponseMessageV2)
		if !ok {
			t.Fatalf("Expected *HealthResponseMessageV2, got %T", converted)
		}

		// Verify health status fields via getters
		hs := hr.HealthStatus()
		if hs.UptimeSeconds() != 100 {
			t.Errorf("UptimeSeconds = %v, want 100", hs.UptimeSeconds())
		}
		if hs.ConnectedClients() != 5 {
			t.Errorf("ConnectedClients = %v, want 5", hs.ConnectedClients())
		}
		if hs.ActiveAlerts() != 10 {
			t.Errorf("ActiveAlerts = %v, want 10", hs.ActiveAlerts())
		}
		if hs.BlockedBranches() != 3 {
			t.Errorf("BlockedBranches = %v, want 3", hs.BlockedBranches())
		}
		if hs.BroadcastFailures() != 2 {
			t.Errorf("BroadcastFailures = %v, want 2", hs.BroadcastFailures())
		}
		if hs.WatcherErrors() != 1 {
			t.Errorf("WatcherErrors = %v, want 1", hs.WatcherErrors())
		}
		if hs.PersistenceErrors() != 0 {
			t.Errorf("PersistenceErrors = %v, want 0", hs.PersistenceErrors())
		}
	})
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
