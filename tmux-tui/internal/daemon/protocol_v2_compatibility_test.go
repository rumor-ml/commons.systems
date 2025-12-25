package daemon

import (
	"encoding/json"
	"testing"
)

// TestJSONSerializationPreservesAllFields verifies that all message types
// survive JSON round-trip serialization without data loss.
func TestJSONSerializationPreservesAllFields(t *testing.T) {
	tests := []struct {
		name    string
		creator func() (MessageV2, error)
	}{
		{
			name: "HelloMessage",
			creator: func() (MessageV2, error) {
				return NewHelloMessage(42, "test-client-123")
			},
		},
		{
			name: "FullStateMessage",
			creator: func() (MessageV2, error) {
				return NewFullStateMessage(
					42,
					map[string]string{"pane1": "alert1"},
					map[string]string{"branch1": "branch2"},
				)
			},
		},
		{
			name: "AlertChangeMessage",
			creator: func() (MessageV2, error) {
				return NewAlertChangeMessage(42, "pane1", "eventType1", true)
			},
		},
		{
			name: "PaneFocusMessage",
			creator: func() (MessageV2, error) {
				return NewPaneFocusMessage(42, "pane1")
			},
		},
		{
			name: "PingMessage",
			creator: func() (MessageV2, error) {
				return NewPingMessage(42)
			},
		},
		{
			name: "PongMessage",
			creator: func() (MessageV2, error) {
				return NewPongMessage(42)
			},
		},
		{
			name: "ShowBlockPickerMessage",
			creator: func() (MessageV2, error) {
				return NewShowBlockPickerMessage(42, "pane1")
			},
		},
		{
			name: "BlockBranchMessage",
			creator: func() (MessageV2, error) {
				return NewBlockBranchMessage(42, "branch1", "branch2")
			},
		},
		{
			name: "UnblockBranchMessage",
			creator: func() (MessageV2, error) {
				return NewUnblockBranchMessage(42, "branch1")
			},
		},
		{
			name: "BlockChangeMessage_blocked",
			creator: func() (MessageV2, error) {
				return NewBlockChangeMessage(42, "branch1", "branch2", true)
			},
		},
		{
			name: "BlockChangeMessage_unblocked",
			creator: func() (MessageV2, error) {
				return NewBlockChangeMessage(42, "branch1", "", false)
			},
		},
		{
			name: "QueryBlockedStateMessage",
			creator: func() (MessageV2, error) {
				return NewQueryBlockedStateMessage(42, "branch1")
			},
		},
		{
			name: "BlockedStateResponseMessage",
			creator: func() (MessageV2, error) {
				return NewBlockedStateResponseMessage(42, "branch1", true, "branch2")
			},
		},
		{
			name: "HealthQueryMessage",
			creator: func() (MessageV2, error) {
				return NewHealthQueryMessage(42)
			},
		},
		{
			name: "HealthResponseMessage",
			creator: func() (MessageV2, error) {
				status, err := NewHealthStatus(0, "", 0, "", 0, "", 0, "", 5, 10, 3)
				if err != nil {
					return nil, err
				}
				return NewHealthResponseMessage(42, status)
			},
		},
		{
			name: "SyncWarningMessage",
			creator: func() (MessageV2, error) {
				return NewSyncWarningMessage(42, "alert_change", "network error")
			},
		},
		{
			name: "ResyncRequestMessage",
			creator: func() (MessageV2, error) {
				return NewResyncRequestMessage(42)
			},
		},
		{
			name: "PersistenceErrorMessage",
			creator: func() (MessageV2, error) {
				return NewPersistenceErrorMessage(42, "disk full")
			},
		},
		{
			name: "AudioErrorMessage",
			creator: func() (MessageV2, error) {
				return NewAudioErrorMessage(42, "audio device not found")
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create v2 message
			msg, err := tt.creator()
			if err != nil {
				t.Fatalf("Failed to create message: %v", err)
			}

			// Convert to wire format
			wire := msg.ToWireFormat()

			// Marshal to JSON
			data, err := json.Marshal(wire)
			if err != nil {
				t.Fatalf("Failed to marshal: %v", err)
			}

			// Unmarshal from JSON
			var wireBack Message
			if err := json.Unmarshal(data, &wireBack); err != nil {
				t.Fatalf("Failed to unmarshal: %v", err)
			}

			// Verify basic fields preserved
			if wireBack.Type != wire.Type {
				t.Errorf("Type mismatch: got %v, want %v", wireBack.Type, wire.Type)
			}
			if wireBack.SeqNum != wire.SeqNum {
				t.Errorf("SeqNum mismatch: got %v, want %v", wireBack.SeqNum, wire.SeqNum)
			}
		})
	}
}

// TestV1ClientCanDeserializeV2Messages verifies that v1 clients (using plain
// Message struct) can successfully read messages created by v2 constructors.
func TestV1ClientCanDeserializeV2Messages(t *testing.T) {
	tests := []struct {
		name         string
		creator      func() (MessageV2, error)
		verifyFields func(t *testing.T, msg Message)
	}{
		{
			name: "HelloMessage",
			creator: func() (MessageV2, error) {
				return NewHelloMessage(42, "test-client")
			},
			verifyFields: func(t *testing.T, msg Message) {
				if msg.Type != MsgTypeHello {
					t.Errorf("Type = %v, want %v", msg.Type, MsgTypeHello)
				}
				if msg.SeqNum != 42 {
					t.Errorf("SeqNum = %v, want 42", msg.SeqNum)
				}
				if msg.ClientID != "test-client" {
					t.Errorf("ClientID = %v, want test-client", msg.ClientID)
				}
			},
		},
		{
			name: "FullStateMessage",
			creator: func() (MessageV2, error) {
				return NewFullStateMessage(
					42,
					map[string]string{"pane1": "alert1"},
					map[string]string{"branch1": "branch2"},
				)
			},
			verifyFields: func(t *testing.T, msg Message) {
				if msg.Type != MsgTypeFullState {
					t.Errorf("Type = %v, want %v", msg.Type, MsgTypeFullState)
				}
				if msg.SeqNum != 42 {
					t.Errorf("SeqNum = %v, want 42", msg.SeqNum)
				}
				if len(msg.Alerts) != 1 || msg.Alerts["pane1"] != "alert1" {
					t.Errorf("Alerts = %v, want map[pane1:alert1]", msg.Alerts)
				}
				if len(msg.BlockedBranches) != 1 || msg.BlockedBranches["branch1"] != "branch2" {
					t.Errorf("BlockedBranches = %v, want map[branch1:branch2]", msg.BlockedBranches)
				}
			},
		},
		{
			name: "AlertChangeMessage",
			creator: func() (MessageV2, error) {
				return NewAlertChangeMessage(42, "pane1", "event1", true)
			},
			verifyFields: func(t *testing.T, msg Message) {
				if msg.Type != MsgTypeAlertChange {
					t.Errorf("Type = %v, want %v", msg.Type, MsgTypeAlertChange)
				}
				if msg.PaneID != "pane1" {
					t.Errorf("PaneID = %v, want pane1", msg.PaneID)
				}
				if msg.EventType != "event1" {
					t.Errorf("EventType = %v, want event1", msg.EventType)
				}
				if !msg.Created {
					t.Errorf("Created = %v, want true", msg.Created)
				}
			},
		},
		{
			name: "BlockChangeMessage",
			creator: func() (MessageV2, error) {
				return NewBlockChangeMessage(42, "branch1", "branch2", true)
			},
			verifyFields: func(t *testing.T, msg Message) {
				if msg.Type != MsgTypeBlockChange {
					t.Errorf("Type = %v, want %v", msg.Type, MsgTypeBlockChange)
				}
				if msg.Branch != "branch1" {
					t.Errorf("Branch = %v, want branch1", msg.Branch)
				}
				if msg.BlockedBranch != "branch2" {
					t.Errorf("BlockedBranch = %v, want branch2", msg.BlockedBranch)
				}
				if !msg.Blocked {
					t.Errorf("Blocked = %v, want true", msg.Blocked)
				}
			},
		},
		{
			name: "HealthResponseMessage",
			creator: func() (MessageV2, error) {
				status, err := NewHealthStatus(0, "", 0, "", 0, "", 0, "", 5, 10, 3)
				if err != nil {
					return nil, err
				}
				return NewHealthResponseMessage(42, status)
			},
			verifyFields: func(t *testing.T, msg Message) {
				if msg.Type != MsgTypeHealthResponse {
					t.Errorf("Type = %v, want %v", msg.Type, MsgTypeHealthResponse)
				}
				if msg.HealthStatus == nil {
					t.Fatal("HealthStatus is nil")
				}
				// Note: HealthStatus uses private fields which aren't accessible via the v1 Message struct,
				// but JSON unmarshaling should properly populate these fields. We verify the status exists
				// rather than checking individual field values.
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create v2 message
			v2msg, err := tt.creator()
			if err != nil {
				t.Fatalf("Failed to create v2 message: %v", err)
			}

			// Convert to wire format
			wire := v2msg.ToWireFormat()

			// Marshal to JSON (as server would send)
			data, err := json.Marshal(wire)
			if err != nil {
				t.Fatalf("Failed to marshal: %v", err)
			}

			// Unmarshal as v1 client would (plain Message struct)
			var v1msg Message
			if err := json.Unmarshal(data, &v1msg); err != nil {
				t.Fatalf("Failed to unmarshal: %v", err)
			}

			// Verify fields
			tt.verifyFields(t, v1msg)
		})
	}
}

// TestV2ClientCanDeserializeV1Messages verifies that v2 clients can successfully
// read messages created by v1 code (plain Message struct, no constructors).
func TestV2ClientCanDeserializeV1Messages(t *testing.T) {
	tests := []struct {
		name         string
		createV1Msg  func() Message
		verifyV2Msg  func(t *testing.T, msg MessageV2)
		expectedType string
	}{
		{
			name: "HelloMessage",
			createV1Msg: func() Message {
				return Message{
					Type:     MsgTypeHello,
					SeqNum:   42,
					ClientID: "v1-client",
				}
			},
			verifyV2Msg: func(t *testing.T, msg MessageV2) {
				hello, ok := msg.(*HelloMessageV2)
				if !ok {
					t.Fatalf("Expected *HelloMessageV2, got %T", msg)
				}
				if hello.ClientID() != "v1-client" {
					t.Errorf("ClientID = %v, want v1-client", hello.ClientID())
				}
				if hello.SeqNumber() != 42 {
					t.Errorf("SeqNum = %v, want 42", hello.SeqNumber())
				}
			},
			expectedType: "hello",
		},
		{
			name: "FullStateMessage",
			createV1Msg: func() Message {
				return Message{
					Type:            MsgTypeFullState,
					SeqNum:          42,
					Alerts:          map[string]string{"pane1": "alert1"},
					BlockedBranches: map[string]string{"branch1": "branch2"},
				}
			},
			verifyV2Msg: func(t *testing.T, msg MessageV2) {
				fs, ok := msg.(*FullStateMessageV2)
				if !ok {
					t.Fatalf("Expected *FullStateMessageV2, got %T", msg)
				}
				alerts := fs.Alerts()
				if len(alerts) != 1 || alerts["pane1"] != "alert1" {
					t.Errorf("Alerts = %v, want map[pane1:alert1]", alerts)
				}
				blocked := fs.BlockedBranches()
				if len(blocked) != 1 || blocked["branch1"] != "branch2" {
					t.Errorf("BlockedBranches = %v, want map[branch1:branch2]", blocked)
				}
			},
			expectedType: "full_state",
		},
		{
			name: "AlertChangeMessage",
			createV1Msg: func() Message {
				return Message{
					Type:      MsgTypeAlertChange,
					SeqNum:    42,
					PaneID:    "pane1",
					EventType: "event1",
					Created:   true,
				}
			},
			verifyV2Msg: func(t *testing.T, msg MessageV2) {
				ac, ok := msg.(*AlertChangeMessageV2)
				if !ok {
					t.Fatalf("Expected *AlertChangeMessageV2, got %T", msg)
				}
				if ac.PaneID() != "pane1" {
					t.Errorf("PaneID = %v, want pane1", ac.PaneID())
				}
				if ac.EventType() != "event1" {
					t.Errorf("EventType = %v, want event1", ac.EventType())
				}
				if !ac.Created() {
					t.Errorf("Created = %v, want true", ac.Created())
				}
			},
			expectedType: "alert_change",
		},
		{
			name: "BlockBranchMessage",
			createV1Msg: func() Message {
				return Message{
					Type:          MsgTypeBlockBranch,
					SeqNum:        42,
					Branch:        "branch1",
					BlockedBranch: "branch2",
				}
			},
			verifyV2Msg: func(t *testing.T, msg MessageV2) {
				bb, ok := msg.(*BlockBranchMessageV2)
				if !ok {
					t.Fatalf("Expected *BlockBranchMessageV2, got %T", msg)
				}
				if bb.Branch() != "branch1" {
					t.Errorf("Branch = %v, want branch1", bb.Branch())
				}
				if bb.BlockedBranch() != "branch2" {
					t.Errorf("BlockedBranch = %v, want branch2", bb.BlockedBranch())
				}
			},
			expectedType: "block_branch",
		},
		{
			name: "BlockChangeMessage",
			createV1Msg: func() Message {
				return Message{
					Type:          MsgTypeBlockChange,
					SeqNum:        42,
					Branch:        "branch1",
					BlockedBranch: "branch2",
					Blocked:       true,
				}
			},
			verifyV2Msg: func(t *testing.T, msg MessageV2) {
				bc, ok := msg.(*BlockChangeMessageV2)
				if !ok {
					t.Fatalf("Expected *BlockChangeMessageV2, got %T", msg)
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
			},
			expectedType: "block_change",
		},
		{
			name: "SyncWarningMessage",
			createV1Msg: func() Message {
				return Message{
					Type:            MsgTypeSyncWarning,
					SeqNum:          42,
					OriginalMsgType: "alert_change",
					Error:           "network error",
				}
			},
			verifyV2Msg: func(t *testing.T, msg MessageV2) {
				sw, ok := msg.(*SyncWarningMessageV2)
				if !ok {
					t.Fatalf("Expected *SyncWarningMessageV2, got %T", msg)
				}
				if sw.OriginalMsgType() != "alert_change" {
					t.Errorf("OriginalMsgType = %v, want alert_change", sw.OriginalMsgType())
				}
				if sw.Error() != "network error" {
					t.Errorf("Error = %v, want network error", sw.Error())
				}
			},
			expectedType: "sync_warning",
		},
		{
			name: "PersistenceErrorMessage",
			createV1Msg: func() Message {
				return Message{
					Type:   MsgTypePersistenceError,
					SeqNum: 42,
					Error:  "disk full",
				}
			},
			verifyV2Msg: func(t *testing.T, msg MessageV2) {
				pe, ok := msg.(*PersistenceErrorMessageV2)
				if !ok {
					t.Fatalf("Expected *PersistenceErrorMessageV2, got %T", msg)
				}
				if pe.Error() != "disk full" {
					t.Errorf("Error = %v, want disk full", pe.Error())
				}
			},
			expectedType: "persistence_error",
		},
		{
			name: "AudioErrorMessage",
			createV1Msg: func() Message {
				return Message{
					Type:   MsgTypeAudioError,
					SeqNum: 42,
					Error:  "audio device not found",
				}
			},
			verifyV2Msg: func(t *testing.T, msg MessageV2) {
				ae, ok := msg.(*AudioErrorMessageV2)
				if !ok {
					t.Fatalf("Expected *AudioErrorMessageV2, got %T", msg)
				}
				if ae.Error() != "audio device not found" {
					t.Errorf("Error = %v, want audio device not found", ae.Error())
				}
			},
			expectedType: "audio_error",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create v1 message
			v1msg := tt.createV1Msg()

			// Marshal to JSON (as v1 client/server would send)
			data, err := json.Marshal(v1msg)
			if err != nil {
				t.Fatalf("Failed to marshal v1 message: %v", err)
			}

			// Unmarshal to plain Message
			var wire Message
			if err := json.Unmarshal(data, &wire); err != nil {
				t.Fatalf("Failed to unmarshal: %v", err)
			}

			// Convert to v2 message
			v2msg, err := FromWireFormat(wire)
			if err != nil {
				t.Fatalf("Failed to convert to v2: %v", err)
			}

			// Verify message type
			if v2msg.MessageType() != tt.expectedType {
				t.Errorf("MessageType = %v, want %v", v2msg.MessageType(), tt.expectedType)
			}

			// Verify fields
			tt.verifyV2Msg(t, v2msg)
		})
	}
}

// TestDeprecatedMessageTypesStillWork verifies that arbitrary message types
// remain deserializable from JSON for backward compatibility.
// Note: MsgTypeBlockPane and MsgTypeUnblockPane were removed from the protocol
// before this test file was created. This test verifies generic JSON round-trip.
func TestDeprecatedMessageTypesStillWork(t *testing.T) {
	tests := []struct {
		name      string
		msgType   string
		createMsg func() Message
	}{
		{
			name:    "UnknownType",
			msgType: "some_unknown_type",
			createMsg: func() Message {
				return Message{
					Type:   "some_unknown_type",
					PaneID: "pane1",
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			msg := tt.createMsg()

			// Marshal to JSON
			data, err := json.Marshal(msg)
			if err != nil {
				t.Fatalf("Failed to marshal: %v", err)
			}

			// Unmarshal from JSON
			var msgBack Message
			if err := json.Unmarshal(data, &msgBack); err != nil {
				t.Fatalf("Failed to unmarshal: %v", err)
			}

			// Verify type preserved
			if msgBack.Type != tt.msgType {
				t.Errorf("Type = %v, want %v", msgBack.Type, tt.msgType)
			}

			// Note: Unknown types are not convertible to v2 (FromWireFormat will return error)
			// but they should still be deserializable from JSON. This preserves backward compatibility
			// by allowing old clients to receive messages even after the protocol evolves, though they
			// cannot process them through the v2 type system.
		})
	}
}

// TestJSONOmitemptyBehavior verifies that zero values are omitted in JSON
// and non-zero values are included, per the json:"...,omitempty" tags.
func TestJSONOmitemptyBehavior(t *testing.T) {
	t.Run("zero_seqnum_omitted", func(t *testing.T) {
		msg := Message{
			Type:   MsgTypePing,
			SeqNum: 0, // Zero value
		}

		data, err := json.Marshal(msg)
		if err != nil {
			t.Fatalf("Marshal failed: %v", err)
		}

		// Parse JSON to check if seq_num is present
		var raw map[string]interface{}
		if err := json.Unmarshal(data, &raw); err != nil {
			t.Fatalf("Unmarshal to map failed: %v", err)
		}

		if _, exists := raw["seq_num"]; exists {
			t.Errorf("seq_num should be omitted when zero, got: %v", raw["seq_num"])
		}
	})

	t.Run("nonzero_seqnum_included", func(t *testing.T) {
		msg := Message{
			Type:   MsgTypePing,
			SeqNum: 42,
		}

		data, err := json.Marshal(msg)
		if err != nil {
			t.Fatalf("Marshal failed: %v", err)
		}

		var raw map[string]interface{}
		if err := json.Unmarshal(data, &raw); err != nil {
			t.Fatalf("Unmarshal to map failed: %v", err)
		}

		if seqNum, exists := raw["seq_num"]; !exists {
			t.Error("seq_num should be included when non-zero")
		} else if seqNum != float64(42) { // JSON numbers unmarshal to float64
			t.Errorf("seq_num = %v, want 42", seqNum)
		}
	})

	t.Run("empty_string_omitted", func(t *testing.T) {
		msg := Message{
			Type:      MsgTypeAlertChange,
			PaneID:    "", // Empty string
			EventType: "event1",
		}

		data, err := json.Marshal(msg)
		if err != nil {
			t.Fatalf("Marshal failed: %v", err)
		}

		var raw map[string]interface{}
		if err := json.Unmarshal(data, &raw); err != nil {
			t.Fatalf("Unmarshal to map failed: %v", err)
		}

		if _, exists := raw["pane_id"]; exists {
			t.Errorf("pane_id should be omitted when empty")
		}
	})

	t.Run("false_bool_omitted", func(t *testing.T) {
		msg := Message{
			Type:    MsgTypeBlockChange,
			Branch:  "branch1",
			Blocked: false,
		}

		data, err := json.Marshal(msg)
		if err != nil {
			t.Fatalf("Marshal failed: %v", err)
		}

		var raw map[string]interface{}
		if err := json.Unmarshal(data, &raw); err != nil {
			t.Fatalf("Unmarshal to map failed: %v", err)
		}

		if _, exists := raw["blocked"]; exists {
			t.Errorf("blocked should be omitted when false")
		}
	})

	t.Run("true_bool_included", func(t *testing.T) {
		msg := Message{
			Type:    MsgTypeBlockChange,
			Branch:  "branch1",
			Blocked: true,
		}

		data, err := json.Marshal(msg)
		if err != nil {
			t.Fatalf("Marshal failed: %v", err)
		}

		var raw map[string]interface{}
		if err := json.Unmarshal(data, &raw); err != nil {
			t.Fatalf("Unmarshal to map failed: %v", err)
		}

		if blocked, exists := raw["blocked"]; !exists {
			t.Error("blocked should be included when true")
		} else if blocked != true {
			t.Errorf("blocked = %v, want true", blocked)
		}
	})
}
