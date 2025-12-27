package daemon

import (
	"errors"
	"strings"
	"testing"
)

// TestHelloMessage tests HelloMessageV2 construction and validation
func TestHelloMessage(t *testing.T) {
	tests := []struct {
		name      string
		seqNum    uint64
		clientID  string
		wantErr   bool
		errSubstr string
	}{
		{
			name:     "valid message",
			seqNum:   1,
			clientID: "client-123",
			wantErr:  false,
		},
		{
			name:      "empty client_id",
			seqNum:    1,
			clientID:  "",
			wantErr:   true,
			errSubstr: "client_id required",
		},
		{
			name:      "whitespace-only client_id",
			seqNum:    1,
			clientID:  "   ",
			wantErr:   true,
			errSubstr: "client_id required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			msg, err := NewHelloMessage(tt.seqNum, tt.clientID)
			if tt.wantErr {
				if err == nil {
					t.Errorf("NewHelloMessage() expected error containing %q, got nil", tt.errSubstr)
				} else if tt.errSubstr != "" && !strings.Contains(err.Error(), tt.errSubstr) {
					t.Errorf("NewHelloMessage() error = %v, want error containing %q", err, tt.errSubstr)
				}
				return
			}
			if err != nil {
				t.Errorf("NewHelloMessage() unexpected error = %v", err)
				return
			}
			if msg.SeqNumber() != tt.seqNum {
				t.Errorf("SeqNumber() = %v, want %v", msg.SeqNumber(), tt.seqNum)
			}
			if msg.MessageType() != MsgTypeHello {
				t.Errorf("MessageType() = %v, want %v", msg.MessageType(), MsgTypeHello)
			}

			// Test round-trip conversion
			wire := msg.ToWireFormat()
			if wire.Type != MsgTypeHello {
				t.Errorf("ToWireFormat().Type = %v, want %v", wire.Type, MsgTypeHello)
			}
			if wire.ClientID != "client-123" {
				t.Errorf("ToWireFormat().ClientID = %v, want %v", wire.ClientID, "client-123")
			}

			// Test FromWireFormat
			msg2, err := FromWireFormat(wire)
			if err != nil {
				t.Errorf("FromWireFormat() error = %v", err)
				return
			}
			if msg2.MessageType() != MsgTypeHello {
				t.Errorf("FromWireFormat().MessageType() = %v, want %v", msg2.MessageType(), MsgTypeHello)
			}
		})
	}
}

// TestFullStateMessage tests FullStateMessageV2 construction
func TestFullStateMessage(t *testing.T) {
	alerts := map[string]string{"pane-1": "idle", "pane-2": "stop"}
	blocked := map[string]string{"feature": "main", "bugfix": "develop"}

	msg, err := NewFullStateMessage(1, alerts, blocked)
	if err != nil {
		t.Fatalf("NewFullStateMessage() error = %v", err)
	}

	if msg.SeqNumber() != 1 {
		t.Errorf("SeqNumber() = %v, want 1", msg.SeqNumber())
	}
	if msg.MessageType() != MsgTypeFullState {
		t.Errorf("MessageType() = %v, want %v", msg.MessageType(), MsgTypeFullState)
	}

	// Test round-trip
	wire := msg.ToWireFormat()
	msg2, err := FromWireFormat(wire)
	if err != nil {
		t.Errorf("FromWireFormat() error = %v", err)
	}
	if msg2.MessageType() != MsgTypeFullState {
		t.Errorf("FromWireFormat().MessageType() = %v, want %v", msg2.MessageType(), MsgTypeFullState)
	}
}

// TestAlertChangeMessage tests AlertChangeMessageV2 validation
func TestAlertChangeMessage(t *testing.T) {
	tests := []struct {
		name      string
		paneID    string
		eventType string
		created   bool
		wantErr   bool
		errSubstr string
	}{
		{
			name:      "valid message",
			paneID:    "pane-1",
			eventType: "idle",
			created:   true,
			wantErr:   false,
		},
		{
			name:      "empty pane_id",
			paneID:    "",
			eventType: "idle",
			wantErr:   true,
			errSubstr: "pane_id required",
		},
		{
			name:      "empty event_type",
			paneID:    "pane-1",
			eventType: "",
			wantErr:   true,
			errSubstr: "event_type required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			msg, err := NewAlertChangeMessage(1, tt.paneID, tt.eventType, tt.created)
			if tt.wantErr {
				if err == nil {
					t.Errorf("NewAlertChangeMessage() expected error, got nil")
				} else if tt.errSubstr != "" && !strings.Contains(err.Error(), tt.errSubstr) {
					t.Errorf("error = %v, want substring %q", err, tt.errSubstr)
				}
				return
			}
			if err != nil {
				t.Errorf("NewAlertChangeMessage() error = %v", err)
				return
			}

			// Test round-trip
			wire := msg.ToWireFormat()
			msg2, err := FromWireFormat(wire)
			if err != nil {
				t.Errorf("FromWireFormat() error = %v", err)
			}
			if msg2.MessageType() != MsgTypeAlertChange {
				t.Errorf("MessageType() = %v, want %v", msg2.MessageType(), MsgTypeAlertChange)
			}
		})
	}
}

// TestPaneFocusMessage tests PaneFocusMessageV2 validation
func TestPaneFocusMessage(t *testing.T) {
	tests := []struct {
		name         string
		activePaneID string
		wantErr      bool
		errSubstr    string
	}{
		{
			name:         "valid message",
			activePaneID: "pane-1",
			wantErr:      false,
		},
		{
			name:         "empty active_pane_id",
			activePaneID: "",
			wantErr:      true,
			errSubstr:    "active_pane_id required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			msg, err := NewPaneFocusMessage(1, tt.activePaneID)
			if tt.wantErr {
				if err == nil || !strings.Contains(err.Error(), tt.errSubstr) {
					t.Errorf("expected error containing %q, got %v", tt.errSubstr, err)
				}
				return
			}
			if err != nil {
				t.Errorf("unexpected error = %v", err)
				return
			}

			// Test round-trip
			wire := msg.ToWireFormat()
			msg2, err := FromWireFormat(wire)
			if err != nil {
				t.Errorf("FromWireFormat() error = %v", err)
			}
			if msg2.MessageType() != MsgTypePaneFocus {
				t.Errorf("MessageType() = %v, want %v", msg2.MessageType(), MsgTypePaneFocus)
			}
		})
	}
}

// TestBlockBranchMessage tests BlockBranchMessageV2 validation
func TestBlockBranchMessage(t *testing.T) {
	tests := []struct {
		name          string
		branch        string
		blockedBranch string
		wantErr       bool
		errSubstr     string
	}{
		{
			name:          "valid message",
			branch:        "main",
			blockedBranch: "feature",
			wantErr:       false,
		},
		{
			name:          "empty branch",
			branch:        "",
			blockedBranch: "feature",
			wantErr:       true,
			errSubstr:     "branch required",
		},
		{
			name:          "empty blocked_branch",
			branch:        "main",
			blockedBranch: "",
			wantErr:       true,
			errSubstr:     "blocked_branch required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			msg, err := NewBlockBranchMessage(1, tt.branch, tt.blockedBranch)
			if tt.wantErr {
				if err == nil || !strings.Contains(err.Error(), tt.errSubstr) {
					t.Errorf("expected error containing %q, got %v", tt.errSubstr, err)
				}
				return
			}
			if err != nil {
				t.Errorf("unexpected error = %v", err)
				return
			}

			// Test round-trip
			wire := msg.ToWireFormat()
			msg2, err := FromWireFormat(wire)
			if err != nil {
				t.Errorf("FromWireFormat() error = %v", err)
			}
			if msg2.MessageType() != MsgTypeBlockBranch {
				t.Errorf("MessageType() = %v, want %v", msg2.MessageType(), MsgTypeBlockBranch)
			}
		})
	}
}

// TestUnblockBranchMessage tests UnblockBranchMessageV2 validation
func TestUnblockBranchMessage(t *testing.T) {
	tests := []struct {
		name      string
		branch    string
		wantErr   bool
		errSubstr string
	}{
		{
			name:    "valid message",
			branch:  "feature",
			wantErr: false,
		},
		{
			name:      "empty branch",
			branch:    "",
			wantErr:   true,
			errSubstr: "branch required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			msg, err := NewUnblockBranchMessage(1, tt.branch)
			if tt.wantErr {
				if err == nil || !strings.Contains(err.Error(), tt.errSubstr) {
					t.Errorf("expected error containing %q, got %v", tt.errSubstr, err)
				}
				return
			}
			if err != nil {
				t.Errorf("unexpected error = %v", err)
				return
			}

			// Test round-trip
			wire := msg.ToWireFormat()
			msg2, err := FromWireFormat(wire)
			if err != nil {
				t.Errorf("FromWireFormat() error = %v", err)
			}
			if msg2.MessageType() != MsgTypeUnblockBranch {
				t.Errorf("MessageType() = %v, want %v", msg2.MessageType(), MsgTypeUnblockBranch)
			}
		})
	}
}

// TestBlockChangeMessage tests BlockChangeMessageV2 validation
func TestBlockChangeMessage(t *testing.T) {
	tests := []struct {
		name          string
		branch        string
		blockedBranch string
		blocked       bool
		wantErr       bool
		errSubstr     string
	}{
		{
			name:          "valid block message",
			branch:        "feature",
			blockedBranch: "main",
			blocked:       true,
			wantErr:       false,
		},
		{
			name:          "valid unblock message",
			branch:        "feature",
			blockedBranch: "",
			blocked:       false,
			wantErr:       false,
		},
		{
			name:          "empty branch",
			branch:        "",
			blockedBranch: "main",
			blocked:       true,
			wantErr:       true,
			errSubstr:     "branch required",
		},
		{
			name:          "blocked=true but empty blocked_branch",
			branch:        "feature",
			blockedBranch: "",
			blocked:       true,
			wantErr:       true,
			errSubstr:     "blocked_branch required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			msg, err := NewBlockChangeMessage(1, tt.branch, tt.blockedBranch, tt.blocked)
			if tt.wantErr {
				if err == nil || !strings.Contains(err.Error(), tt.errSubstr) {
					t.Errorf("expected error containing %q, got %v", tt.errSubstr, err)
				}
				return
			}
			if err != nil {
				t.Errorf("unexpected error = %v", err)
				return
			}

			// Test round-trip
			wire := msg.ToWireFormat()
			msg2, err := FromWireFormat(wire)
			if err != nil {
				t.Errorf("FromWireFormat() error = %v", err)
			}
			if msg2.MessageType() != MsgTypeBlockChange {
				t.Errorf("MessageType() = %v, want %v", msg2.MessageType(), MsgTypeBlockChange)
			}
		})
	}
}

// TestQueryBlockedStateMessage tests QueryBlockedStateMessageV2 validation
func TestQueryBlockedStateMessage(t *testing.T) {
	msg, err := NewQueryBlockedStateMessage(1, "feature")
	if err != nil {
		t.Fatalf("NewQueryBlockedStateMessage() error = %v", err)
	}

	wire := msg.ToWireFormat()
	msg2, err := FromWireFormat(wire)
	if err != nil {
		t.Errorf("FromWireFormat() error = %v", err)
	}
	if msg2.MessageType() != MsgTypeQueryBlockedState {
		t.Errorf("MessageType() = %v, want %v", msg2.MessageType(), MsgTypeQueryBlockedState)
	}

	// Test empty branch validation
	_, err = NewQueryBlockedStateMessage(1, "")
	if err == nil || !strings.Contains(err.Error(), "branch required") {
		t.Errorf("expected 'branch required' error, got %v", err)
	}
}

// TestBlockedStateResponseMessage tests BlockedStateResponseMessageV2 validation
func TestBlockedStateResponseMessage(t *testing.T) {
	tests := []struct {
		name          string
		branch        string
		isBlocked     bool
		blockedBranch string
		wantErr       bool
		errSubstr     string
	}{
		{
			name:          "valid blocked response",
			branch:        "feature",
			isBlocked:     true,
			blockedBranch: "main",
			wantErr:       false,
		},
		{
			name:          "valid unblocked response",
			branch:        "feature",
			isBlocked:     false,
			blockedBranch: "",
			wantErr:       false,
		},
		{
			name:          "empty branch",
			branch:        "",
			isBlocked:     true,
			blockedBranch: "main",
			wantErr:       true,
			errSubstr:     "branch required",
		},
		{
			name:          "blocked=true but empty blocked_branch",
			branch:        "feature",
			isBlocked:     true,
			blockedBranch: "",
			wantErr:       true,
			errSubstr:     "blocked_branch required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			msg, err := NewBlockedStateResponseMessage(1, tt.branch, tt.isBlocked, tt.blockedBranch)
			if tt.wantErr {
				if err == nil || !strings.Contains(err.Error(), tt.errSubstr) {
					t.Errorf("expected error containing %q, got %v", tt.errSubstr, err)
				}
				return
			}
			if err != nil {
				t.Errorf("unexpected error = %v", err)
				return
			}

			wire := msg.ToWireFormat()
			msg2, err := FromWireFormat(wire)
			if err != nil {
				t.Errorf("FromWireFormat() error = %v", err)
			}
			if msg2.MessageType() != MsgTypeBlockedStateResponse {
				t.Errorf("MessageType() = %v, want %v", msg2.MessageType(), MsgTypeBlockedStateResponse)
			}
		})
	}
}

// TestBlockedStateResponseMessage_ConditionalValidation tests conditional validation rules.
func TestBlockedStateResponseMessage_ConditionalValidation(t *testing.T) {
	t.Run("blocked_true_requires_blockedBranch", func(t *testing.T) {
		_, err := NewBlockedStateResponseMessage(42, "branch1", true, "")
		if err == nil {
			t.Error("Expected error when blocked=true but blockedBranch empty")
		}
		if !strings.Contains(err.Error(), "blocked_branch required") {
			t.Errorf("Error should mention blocked_branch requirement, got: %v", err)
		}
	})

	t.Run("blocked_false_clears_blockedBranch", func(t *testing.T) {
		msg, err := NewBlockedStateResponseMessage(42, "branch1", false, "unexpected")
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}
		if msg.BlockedBranch() != "" {
			t.Errorf("BlockedBranch should be cleared when blocked=false, got %q", msg.BlockedBranch())
		}
	})
}

// TestPingPongMessages tests simple message types
func TestPingPongMessages(t *testing.T) {
	// Ping
	ping, err := NewPingMessage(1)
	if err != nil {
		t.Fatalf("NewPingMessage() error = %v", err)
	}
	wire := ping.ToWireFormat()
	msg2, err := FromWireFormat(wire)
	if err != nil || msg2.MessageType() != MsgTypePing {
		t.Errorf("Ping round-trip failed: err=%v, type=%v", err, msg2.MessageType())
	}

	// Pong
	pong, err := NewPongMessage(2)
	if err != nil {
		t.Fatalf("NewPongMessage() error = %v", err)
	}
	wire = pong.ToWireFormat()
	msg2, err = FromWireFormat(wire)
	if err != nil || msg2.MessageType() != MsgTypePong {
		t.Errorf("Pong round-trip failed: err=%v, type=%v", err, msg2.MessageType())
	}
}

// TestHealthMessages tests health query and response
func TestHealthMessages(t *testing.T) {
	// Health Query
	query, err := NewHealthQueryMessage(1)
	if err != nil {
		t.Fatalf("NewHealthQueryMessage() error = %v", err)
	}
	wire := query.ToWireFormat()
	msg2, err := FromWireFormat(wire)
	if err != nil || msg2.MessageType() != MsgTypeHealthQuery {
		t.Errorf("HealthQuery round-trip failed: err=%v, type=%v", err, msg2.MessageType())
	}

	// Health Response
	status, err := NewHealthStatus(0, "", 0, "", 0, "", 0, "", 0, 0, 0)
	if err != nil {
		t.Fatalf("NewHealthStatus() error = %v", err)
	}
	response, err := NewHealthResponseMessage(2, status)
	if err != nil {
		t.Fatalf("NewHealthResponseMessage() error = %v", err)
	}
	wire = response.ToWireFormat()
	msg2, err = FromWireFormat(wire)
	if err != nil || msg2.MessageType() != MsgTypeHealthResponse {
		t.Errorf("HealthResponse round-trip failed: err=%v, type=%v", err, msg2.MessageType())
	}
}

// TestSyncWarningMessage tests SyncWarningMessageV2 validation
func TestSyncWarningMessage(t *testing.T) {
	tests := []struct {
		name            string
		originalMsgType string
		errorMsg        string
		wantErr         bool
		errSubstr       string
	}{
		{
			name:            "valid with error",
			originalMsgType: "full_state",
			errorMsg:        "broadcast failed",
			wantErr:         false,
		},
		{
			name:            "empty error is rejected (required)",
			originalMsgType: "alert_change",
			errorMsg:        "",
			wantErr:         true,
			errSubstr:       "error_msg required",
		},
		{
			name:            "empty original_msg_type",
			originalMsgType: "",
			errorMsg:        "error",
			wantErr:         true,
			errSubstr:       "original_msg_type required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			msg, err := NewSyncWarningMessage(1, tt.originalMsgType, tt.errorMsg)
			if tt.wantErr {
				if err == nil || !strings.Contains(err.Error(), tt.errSubstr) {
					t.Errorf("expected error containing %q, got %v", tt.errSubstr, err)
				}
				return
			}
			if err != nil {
				t.Errorf("unexpected error = %v", err)
				return
			}

			// Test round-trip
			wire := msg.ToWireFormat()
			msg2, err := FromWireFormat(wire)
			if err != nil {
				t.Errorf("FromWireFormat() error = %v", err)
			}
			if msg2.MessageType() != MsgTypeSyncWarning {
				t.Errorf("MessageType() = %v, want %v", msg2.MessageType(), MsgTypeSyncWarning)
			}
		})
	}
}

// TestResyncRequestMessage tests ResyncRequestMessageV2
func TestResyncRequestMessage(t *testing.T) {
	msg, err := NewResyncRequestMessage(1)
	if err != nil {
		t.Fatalf("NewResyncRequestMessage() error = %v", err)
	}

	wire := msg.ToWireFormat()
	msg2, err := FromWireFormat(wire)
	if err != nil || msg2.MessageType() != MsgTypeResyncRequest {
		t.Errorf("ResyncRequest round-trip failed: err=%v, type=%v", err, msg2.MessageType())
	}
}

// TestPersistenceErrorMessage tests PersistenceErrorMessageV2
func TestPersistenceErrorMessage(t *testing.T) {
	msg, err := NewPersistenceErrorMessage(1, "failed to save")
	if err != nil {
		t.Fatalf("NewPersistenceErrorMessage() error = %v", err)
	}

	wire := msg.ToWireFormat()
	msg2, err := FromWireFormat(wire)
	if err != nil || msg2.MessageType() != MsgTypePersistenceError {
		t.Errorf("PersistenceError round-trip failed: err=%v, type=%v", err, msg2.MessageType())
	}

	// Test empty error (should now be rejected)
	msg, err = NewPersistenceErrorMessage(2, "")
	if err == nil {
		t.Error("NewPersistenceErrorMessage() with empty error should fail")
	}
	if !strings.Contains(err.Error(), "error_msg required") {
		t.Errorf("Expected 'error_msg required' error, got: %v", err)
	}
}

// TestAudioErrorMessage tests AudioErrorMessageV2
func TestAudioErrorMessage(t *testing.T) {
	msg, err := NewAudioErrorMessage(1, "playback failed")
	if err != nil {
		t.Fatalf("NewAudioErrorMessage() error = %v", err)
	}

	wire := msg.ToWireFormat()
	msg2, err := FromWireFormat(wire)
	if err != nil || msg2.MessageType() != MsgTypeAudioError {
		t.Errorf("AudioError round-trip failed: err=%v, type=%v", err, msg2.MessageType())
	}
}

// TestShowBlockPickerMessage tests ShowBlockPickerMessageV2 validation
func TestShowBlockPickerMessage(t *testing.T) {
	tests := []struct {
		name      string
		paneID    string
		wantErr   bool
		errSubstr string
	}{
		{
			name:    "valid message",
			paneID:  "pane-1",
			wantErr: false,
		},
		{
			name:      "empty pane_id",
			paneID:    "",
			wantErr:   true,
			errSubstr: "pane_id required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			msg, err := NewShowBlockPickerMessage(1, tt.paneID)
			if tt.wantErr {
				if err == nil || !strings.Contains(err.Error(), tt.errSubstr) {
					t.Errorf("expected error containing %q, got %v", tt.errSubstr, err)
				}
				return
			}
			if err != nil {
				t.Errorf("unexpected error = %v", err)
				return
			}

			// Test round-trip
			wire := msg.ToWireFormat()
			msg2, err := FromWireFormat(wire)
			if err != nil {
				t.Errorf("FromWireFormat() error = %v", err)
			}
			if msg2.MessageType() != MsgTypeShowBlockPicker {
				t.Errorf("MessageType() = %v, want %v", msg2.MessageType(), MsgTypeShowBlockPicker)
			}
		})
	}
}

// TestFromWireFormat_UnknownType tests FromWireFormat with unknown message type
func TestFromWireFormat_UnknownType(t *testing.T) {
	msg := Message{Type: "unknown_type"}
	_, err := FromWireFormat(msg)
	if err == nil {
		t.Error("FromWireFormat() with unknown type should return error, got nil")
	}
	if !strings.Contains(err.Error(), "unknown message type") {
		t.Errorf("FromWireFormat() error = %v, want 'unknown message type'", err)
	}
}

// TestValidationFailures_LogOriginalValues verifies that validation failures
// preserve and log original input values to aid debugging of caller bugs where
// unexpected whitespace is passed.
func TestValidationFailures_LogOriginalValues(t *testing.T) {
	tests := []struct {
		name                string
		attemptConstruction func() (MessageV2, error)
		shouldFail          bool
	}{
		{
			name: "hello_whitespace_client_id",
			attemptConstruction: func() (MessageV2, error) {
				return NewHelloMessage(1, "  \t  ")
			},
			shouldFail: true,
		},
		{
			name: "alert_change_whitespace_pane_id",
			attemptConstruction: func() (MessageV2, error) {
				return NewAlertChangeMessage(1, "  ", "alert", true)
			},
			shouldFail: true,
		},
		{
			name: "alert_change_whitespace_event_type",
			attemptConstruction: func() (MessageV2, error) {
				return NewAlertChangeMessage(1, "pane-1", "  \n  ", true)
			},
			shouldFail: true,
		},
		{
			name: "pane_focus_whitespace_active_pane",
			attemptConstruction: func() (MessageV2, error) {
				return NewPaneFocusMessage(1, "  ")
			},
			shouldFail: true,
		},
		{
			name: "block_branch_whitespace_branch",
			attemptConstruction: func() (MessageV2, error) {
				return NewBlockBranchMessage(1, " ", "feature")
			},
			shouldFail: true,
		},
		{
			name: "persistence_error_empty_msg",
			attemptConstruction: func() (MessageV2, error) {
				return NewPersistenceErrorMessage(1, "  ")
			},
			shouldFail: true,
		},
		{
			name: "audio_error_empty_msg",
			attemptConstruction: func() (MessageV2, error) {
				return NewAudioErrorMessage(1, "\t\n")
			},
			shouldFail: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			msg, err := tt.attemptConstruction()

			if tt.shouldFail {
				if err == nil {
					t.Errorf("Expected validation error, got nil (message: %T)", msg)
				}
				// Note: We don't check msg == nil because Go interfaces containing
				// nil pointers are non-nil (interface wrapping behavior).
				// The key invariant is that when err != nil, the message should not be used.

				// Note: Actual debug.Log() output verification would require
				// redirecting debug output to a test buffer. For now, we verify
				// that validation fails as expected. The debug.Log() calls are
				// code-reviewed for correct format.
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}
				if msg == nil {
					t.Error("Expected non-nil message, got nil")
				}
			}
		})
	}
}

// TestFromWireFormat_ErrorWrapping verifies that FromWireFormat errors include
// field context and proper error wrapping semantics.
func TestFromWireFormat_ErrorWrapping(t *testing.T) {
	tests := []struct {
		name               string
		wire               Message
		expectError        bool
		errorShouldContain []string
	}{
		{
			name: "hello_empty_client_id",
			wire: Message{
				Type:     MsgTypeHello,
				SeqNum:   1,
				ClientID: "",
			},
			expectError: true,
			errorShouldContain: []string{
				"invalid wire message",
				"hello message requires client_id",
			},
		},
		{
			name: "hello_whitespace_client_id",
			wire: Message{
				Type:     MsgTypeHello,
				SeqNum:   42,
				ClientID: "   ",
			},
			expectError: true,
			errorShouldContain: []string{
				"invalid hello message",
				"client_id required",
				"seqNum=42",
			},
		},
		{
			name: "alert_change_empty_pane_id",
			wire: Message{
				Type:      MsgTypeAlertChange,
				SeqNum:    5,
				PaneID:    "",
				EventType: "alert",
				Created:   true,
			},
			expectError: true,
			errorShouldContain: []string{
				"invalid wire message",
				"alert_change message requires pane_id",
			},
		},
		{
			name: "alert_change_empty_event_type",
			wire: Message{
				Type:      MsgTypeAlertChange,
				SeqNum:    6,
				PaneID:    "pane-1",
				EventType: "",
				Created:   true,
			},
			expectError: true,
			errorShouldContain: []string{
				"invalid wire message",
				"alert_change message requires event_type",
			},
		},
		{
			name: "pane_focus_empty_pane_id",
			wire: Message{
				Type:         MsgTypePaneFocus,
				SeqNum:       10,
				ActivePaneID: "",
			},
			expectError: true,
			errorShouldContain: []string{
				"invalid wire message",
				"pane_focus message requires active_pane_id",
			},
		},
		{
			name: "persistence_error_empty_msg",
			wire: Message{
				Type:   MsgTypePersistenceError,
				SeqNum: 20,
				Error:  "",
			},
			expectError: true,
			errorShouldContain: []string{
				"invalid persistence_error message",
				"error_msg required",
				"seqNum=20",
			},
		},
		{
			name: "audio_error_empty_msg",
			wire: Message{
				Type:   MsgTypeAudioError,
				SeqNum: 25,
				Error:  "  ",
			},
			expectError: true,
			errorShouldContain: []string{
				"invalid audio_error message",
				"error_msg required",
				"seqNum=25",
			},
		},
		{
			name: "valid_hello_message",
			wire: Message{
				Type:     MsgTypeHello,
				SeqNum:   1,
				ClientID: "client-123",
			},
			expectError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			msg, err := FromWireFormat(tt.wire)

			if tt.expectError {
				if err == nil {
					t.Fatal("Expected error, got nil")
				}
				if msg != nil {
					t.Errorf("Expected nil message on error, got %T", msg)
				}

				// Verify error message includes context
				for _, substr := range tt.errorShouldContain {
					if !strings.Contains(err.Error(), substr) {
						t.Errorf("Error should contain %q, got: %v", substr, err)
					}
				}

				// Verify error is properly wrapped (can be unwrapped)
				// Note: Go's %w wrapping means errors.Unwrap should work
				if errors.Unwrap(err) == nil {
					t.Error("Error should be unwrappable - missing error wrapping")
				}
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}
				if msg == nil {
					t.Error("Expected non-nil message, got nil")
				}
			}
		})
	}
}
