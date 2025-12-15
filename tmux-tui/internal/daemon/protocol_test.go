package daemon

import (
	"testing"
)

// TestValidateMessage_Valid tests validation of valid messages
func TestValidateMessage_Valid(t *testing.T) {
	tests := []struct {
		name string
		msg  Message
	}{
		{
			name: "Hello message",
			msg: Message{
				Type:     MsgTypeHello,
				ClientID: "test-client",
			},
		},
		{
			name: "Alert change message",
			msg: Message{
				Type:      MsgTypeAlertChange,
				PaneID:    "pane-1",
				EventType: "idle",
				Created:   true,
			},
		},
		{
			name: "Pane focus message",
			msg: Message{
				Type:         MsgTypePaneFocus,
				ActivePaneID: "pane-1",
			},
		},
		{
			name: "Show block picker message",
			msg: Message{
				Type:   MsgTypeShowBlockPicker,
				PaneID: "pane-1",
			},
		},
		{
			name: "Block branch message",
			msg: Message{
				Type:          MsgTypeBlockBranch,
				Branch:        "feature-branch",
				BlockedBranch: "main",
			},
		},
		{
			name: "Unblock branch message",
			msg: Message{
				Type:   MsgTypeUnblockBranch,
				Branch: "feature-branch",
			},
		},
		{
			name: "Query blocked state message",
			msg: Message{
				Type:   MsgTypeQueryBlockedState,
				Branch: "feature-branch",
			},
		},
		{
			name: "Blocked state response message",
			msg: Message{
				Type:          MsgTypeBlockedStateResponse,
				Branch:        "feature-branch",
				IsBlocked:     true,
				BlockedBranch: "main",
			},
		},
		{
			name: "Full state message",
			msg: Message{
				Type: MsgTypeFullState,
				Alerts: map[string]string{
					"pane-1": "idle",
				},
				BlockedBranches: map[string]string{
					"feature": "main",
				},
			},
		},
		{
			name: "Ping message",
			msg: Message{
				Type: MsgTypePing,
			},
		},
		{
			name: "Pong message",
			msg: Message{
				Type: MsgTypePong,
			},
		},
		{
			name: "Resync request message",
			msg: Message{
				Type: MsgTypeResyncRequest,
			},
		},
		{
			name: "Sync warning message",
			msg: Message{
				Type:  MsgTypeSyncWarning,
				Error: "Some clients failed to receive update",
			},
		},
		{
			name: "Persistence error message",
			msg: Message{
				Type:  MsgTypePersistenceError,
				Error: "Failed to save blocked state",
			},
		},
		{
			name: "Unknown message type (forward compatibility)",
			msg: Message{
				Type: "future_message_type",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateMessage(tt.msg)
			if err != nil {
				t.Errorf("ValidateMessage() returned error for valid message: %v", err)
			}
		})
	}
}

// TestValidateMessage_Invalid tests validation of invalid messages
func TestValidateMessage_Invalid(t *testing.T) {
	tests := []struct {
		name        string
		msg         Message
		expectedErr string
	}{
		{
			name:        "Missing type",
			msg:         Message{},
			expectedErr: "message type is required",
		},
		{
			name: "Hello message missing client_id",
			msg: Message{
				Type: MsgTypeHello,
			},
			expectedErr: "hello message requires client_id",
		},
		{
			name: "Alert change message missing pane_id",
			msg: Message{
				Type:      MsgTypeAlertChange,
				EventType: "idle",
			},
			expectedErr: "alert_change message requires pane_id",
		},
		{
			name: "Alert change message missing event_type",
			msg: Message{
				Type:   MsgTypeAlertChange,
				PaneID: "pane-1",
			},
			expectedErr: "alert_change message requires event_type",
		},
		{
			name: "Pane focus message missing active_pane_id",
			msg: Message{
				Type: MsgTypePaneFocus,
			},
			expectedErr: "pane_focus message requires active_pane_id",
		},
		{
			name: "Show block picker message missing pane_id",
			msg: Message{
				Type: MsgTypeShowBlockPicker,
			},
			expectedErr: "show_block_picker message requires pane_id",
		},
		{
			name: "Block branch message missing branch",
			msg: Message{
				Type:          MsgTypeBlockBranch,
				BlockedBranch: "main",
			},
			expectedErr: "block_branch message requires branch",
		},
		{
			name: "Block branch message missing blocked_branch",
			msg: Message{
				Type:   MsgTypeBlockBranch,
				Branch: "feature-branch",
			},
			expectedErr: "block_branch message requires blocked_branch",
		},
		{
			name: "Unblock branch message missing branch",
			msg: Message{
				Type: MsgTypeUnblockBranch,
			},
			expectedErr: "unblock_branch message requires branch",
		},
		{
			name: "Query blocked state message missing branch",
			msg: Message{
				Type: MsgTypeQueryBlockedState,
			},
			expectedErr: "query_blocked_state message requires branch",
		},
		{
			name: "Blocked state response message missing branch",
			msg: Message{
				Type:      MsgTypeBlockedStateResponse,
				IsBlocked: true,
			},
			expectedErr: "blocked_state_response message requires branch",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateMessage(tt.msg)
			if err == nil {
				t.Errorf("ValidateMessage() did not return error for invalid message")
			} else if err.Error() != tt.expectedErr {
				t.Errorf("ValidateMessage() returned wrong error:\nGot:  %q\nWant: %q", err.Error(), tt.expectedErr)
			}
		})
	}
}
