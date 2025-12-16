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

// TestNewHealthStatus_Valid tests successful creation of HealthStatus
func TestNewHealthStatus_Valid(t *testing.T) {
	tests := []struct {
		name               string
		broadcastFailures  int64
		lastBroadcastError string
		watcherErrors      int64
		lastWatcherError   string
		connectedClients   int
		activeAlerts       int
		blockedBranches    int
	}{
		{
			name:               "All zeros",
			broadcastFailures:  0,
			lastBroadcastError: "",
			watcherErrors:      0,
			lastWatcherError:   "",
			connectedClients:   0,
			activeAlerts:       0,
			blockedBranches:    0,
		},
		{
			name:               "Typical healthy daemon",
			broadcastFailures:  0,
			lastBroadcastError: "",
			watcherErrors:      0,
			lastWatcherError:   "",
			connectedClients:   3,
			activeAlerts:       5,
			blockedBranches:    2,
		},
		{
			name:               "With error messages",
			broadcastFailures:  2,
			lastBroadcastError: "connection timeout",
			watcherErrors:      1,
			lastWatcherError:   "file system error",
			connectedClients:   1,
			activeAlerts:       0,
			blockedBranches:    0,
		},
		{
			name:               "Large values",
			broadcastFailures:  1000,
			lastBroadcastError: "repeated failures",
			watcherErrors:      500,
			lastWatcherError:   "system overload",
			connectedClients:   100,
			activeAlerts:       50,
			blockedBranches:    25,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, err := NewHealthStatus(
				tt.broadcastFailures,
				tt.lastBroadcastError,
				tt.watcherErrors,
				tt.lastWatcherError,
				tt.connectedClients,
				tt.activeAlerts,
				tt.blockedBranches,
			)
			if err != nil {
				t.Errorf("NewHealthStatus() returned unexpected error: %v", err)
			}

			// Verify fields are set correctly using getters
			if status.BroadcastFailures() != tt.broadcastFailures {
				t.Errorf("BroadcastFailures() = %d, want %d", status.BroadcastFailures(), tt.broadcastFailures)
			}
			if status.LastBroadcastError() != tt.lastBroadcastError {
				t.Errorf("LastBroadcastError() = %q, want %q", status.LastBroadcastError(), tt.lastBroadcastError)
			}
			if status.WatcherErrors() != tt.watcherErrors {
				t.Errorf("WatcherErrors() = %d, want %d", status.WatcherErrors(), tt.watcherErrors)
			}
			if status.LastWatcherError() != tt.lastWatcherError {
				t.Errorf("LastWatcherError() = %q, want %q", status.LastWatcherError(), tt.lastWatcherError)
			}
			if status.ConnectedClients() != tt.connectedClients {
				t.Errorf("ConnectedClients() = %d, want %d", status.ConnectedClients(), tt.connectedClients)
			}
			if status.ActiveAlerts() != tt.activeAlerts {
				t.Errorf("ActiveAlerts() = %d, want %d", status.ActiveAlerts(), tt.activeAlerts)
			}
			if status.BlockedBranches() != tt.blockedBranches {
				t.Errorf("BlockedBranches() = %d, want %d", status.BlockedBranches(), tt.blockedBranches)
			}

			// Verify timestamp is recent (within last second)
			// Note: We can't check exact timestamp due to timing, but we can verify it's set
			if status.Timestamp().IsZero() {
				t.Errorf("Timestamp() should not be zero")
			}
		})
	}
}

// TestNewHealthStatus_Invalid tests validation errors
func TestNewHealthStatus_Invalid(t *testing.T) {
	tests := []struct {
		name               string
		broadcastFailures  int64
		lastBroadcastError string
		watcherErrors      int64
		lastWatcherError   string
		connectedClients   int
		activeAlerts       int
		blockedBranches    int
		expectedErr        string
	}{
		{
			name:               "Negative broadcastFailures",
			broadcastFailures:  -1,
			lastBroadcastError: "",
			watcherErrors:      0,
			lastWatcherError:   "",
			connectedClients:   0,
			activeAlerts:       0,
			blockedBranches:    0,
			expectedErr:        "broadcastFailures must be non-negative, got -1",
		},
		{
			name:               "Negative watcherErrors",
			broadcastFailures:  0,
			lastBroadcastError: "",
			watcherErrors:      -5,
			lastWatcherError:   "",
			connectedClients:   0,
			activeAlerts:       0,
			blockedBranches:    0,
			expectedErr:        "watcherErrors must be non-negative, got -5",
		},
		{
			name:               "Negative connectedClients",
			broadcastFailures:  0,
			lastBroadcastError: "",
			watcherErrors:      0,
			lastWatcherError:   "",
			connectedClients:   -10,
			activeAlerts:       0,
			blockedBranches:    0,
			expectedErr:        "connectedClients must be non-negative, got -10",
		},
		{
			name:               "Negative activeAlerts",
			broadcastFailures:  0,
			lastBroadcastError: "",
			watcherErrors:      0,
			lastWatcherError:   "",
			connectedClients:   0,
			activeAlerts:       -3,
			blockedBranches:    0,
			expectedErr:        "activeAlerts must be non-negative, got -3",
		},
		{
			name:               "Negative blockedBranches",
			broadcastFailures:  0,
			lastBroadcastError: "",
			watcherErrors:      0,
			lastWatcherError:   "",
			connectedClients:   0,
			activeAlerts:       0,
			blockedBranches:    -7,
			expectedErr:        "blockedBranches must be non-negative, got -7",
		},
		{
			name:               "Multiple negative values (first error wins)",
			broadcastFailures:  -1,
			lastBroadcastError: "",
			watcherErrors:      -2,
			lastWatcherError:   "",
			connectedClients:   -3,
			activeAlerts:       -4,
			blockedBranches:    -5,
			expectedErr:        "broadcastFailures must be non-negative, got -1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewHealthStatus(
				tt.broadcastFailures,
				tt.lastBroadcastError,
				tt.watcherErrors,
				tt.lastWatcherError,
				tt.connectedClients,
				tt.activeAlerts,
				tt.blockedBranches,
			)
			if err == nil {
				t.Errorf("NewHealthStatus() did not return error for invalid input")
			} else if err.Error() != tt.expectedErr {
				t.Errorf("NewHealthStatus() returned wrong error:\nGot:  %q\nWant: %q", err.Error(), tt.expectedErr)
			}
		})
	}
}

// TestNewBlockedState_Valid tests successful creation of BlockedState
func TestNewBlockedState_Valid(t *testing.T) {
	tests := []struct {
		name      string
		isBlocked bool
		blockedBy string
	}{
		{
			name:      "Not blocked with empty blockedBy",
			isBlocked: false,
			blockedBy: "",
		},
		{
			name:      "Blocked by main",
			isBlocked: true,
			blockedBy: "main",
		},
		{
			name:      "Blocked by develop",
			isBlocked: true,
			blockedBy: "develop",
		},
		{
			name:      "Blocked with empty blockedBy (valid but unusual)",
			isBlocked: true,
			blockedBy: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			state, err := NewBlockedState(tt.isBlocked, tt.blockedBy)
			if err != nil {
				t.Errorf("NewBlockedState() returned unexpected error: %v", err)
			}

			if state.IsBlocked != tt.isBlocked {
				t.Errorf("IsBlocked = %v, want %v", state.IsBlocked, tt.isBlocked)
			}
			if state.BlockedBy != tt.blockedBy {
				t.Errorf("BlockedBy = %q, want %q", state.BlockedBy, tt.blockedBy)
			}
		})
	}
}

// TestNewBlockedState_Invalid tests validation errors
func TestNewBlockedState_Invalid(t *testing.T) {
	tests := []struct {
		name        string
		isBlocked   bool
		blockedBy   string
		expectedErr string
	}{
		{
			name:        "Not blocked but has blockedBy value",
			isBlocked:   false,
			blockedBy:   "main",
			expectedErr: "blockedBy must be empty when isBlocked is false, got \"main\"",
		},
		{
			name:        "Not blocked but has different blockedBy value",
			isBlocked:   false,
			blockedBy:   "develop",
			expectedErr: "blockedBy must be empty when isBlocked is false, got \"develop\"",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewBlockedState(tt.isBlocked, tt.blockedBy)
			if err == nil {
				t.Errorf("NewBlockedState() did not return error for invalid input")
			} else if err.Error() != tt.expectedErr {
				t.Errorf("NewBlockedState() returned wrong error:\nGot:  %q\nWant: %q", err.Error(), tt.expectedErr)
			}
		})
	}
}
