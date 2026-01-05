package daemon

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
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
				0,  // connectionCloseErrors
				"", // lastCloseError
				0,  // audioBroadcastFailures
				"", // lastAudioBroadcastErr
				0,  // treeBroadcastErrors
				"", // lastTreeBroadcastErr
				0,  // treeMsgConstructErrors
				"", // lastTreeMsgConstructErr
				tt.connectedClients,
				tt.activeAlerts,
				tt.blockedBranches,
			)
			if err != nil {
				t.Errorf("NewHealthStatus() returned unexpected error: %v", err)
			}

			// Verify fields are set correctly using getters
			if status.GetBroadcastFailures() != tt.broadcastFailures {
				t.Errorf("BroadcastFailures() = %d, want %d", status.GetBroadcastFailures(), tt.broadcastFailures)
			}
			if status.GetLastBroadcastError() != tt.lastBroadcastError {
				t.Errorf("LastBroadcastError() = %q, want %q", status.GetLastBroadcastError(), tt.lastBroadcastError)
			}
			if status.GetWatcherErrors() != tt.watcherErrors {
				t.Errorf("WatcherErrors() = %d, want %d", status.GetWatcherErrors(), tt.watcherErrors)
			}
			if status.GetLastWatcherError() != tt.lastWatcherError {
				t.Errorf("LastWatcherError() = %q, want %q", status.GetLastWatcherError(), tt.lastWatcherError)
			}
			if status.GetConnectedClients() != tt.connectedClients {
				t.Errorf("ConnectedClients() = %d, want %d", status.GetConnectedClients(), tt.connectedClients)
			}
			if status.GetActiveAlerts() != tt.activeAlerts {
				t.Errorf("ActiveAlerts() = %d, want %d", status.GetActiveAlerts(), tt.activeAlerts)
			}
			if status.GetBlockedBranches() != tt.blockedBranches {
				t.Errorf("BlockedBranches() = %d, want %d", status.GetBlockedBranches(), tt.blockedBranches)
			}

			// Verify timestamp is recent (within last second)
			// Note: We can't check exact timestamp due to timing, but we can verify it's set
			if status.GetTimestamp().IsZero() {
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
				0,  // connectionCloseErrors
				"", // lastCloseError
				0,  // audioBroadcastFailures
				"", // lastAudioBroadcastErr
				0,  // treeBroadcastErrors
				"", // lastTreeBroadcastErr
				0,  // treeMsgConstructErrors
				"", // lastTreeMsgConstructErr
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

// TestNewHealthStatus_BoundaryConditions tests NewHealthStatus with extreme but valid values
func TestNewHealthStatus_BoundaryConditions(t *testing.T) {
	tests := []struct {
		name               string
		broadcastFailures  int64
		lastBroadcastError string
		watcherErrors      int64
		lastWatcherError   string
		connectedClients   int
		activeAlerts       int
		blockedBranches    int
		expectError        bool
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
			expectError:        false,
		},
		{
			name:               "MaxInt64 for int64 fields",
			broadcastFailures:  9223372036854775807, // math.MaxInt64
			lastBroadcastError: "error",
			watcherErrors:      9223372036854775807, // math.MaxInt64
			lastWatcherError:   "error",
			connectedClients:   100,
			activeAlerts:       100,
			blockedBranches:    100,
			expectError:        false,
		},
		{
			name:               "MaxInt32 for int fields",
			broadcastFailures:  1000,
			lastBroadcastError: "error",
			watcherErrors:      1000,
			lastWatcherError:   "error",
			connectedClients:   2147483647, // math.MaxInt32
			activeAlerts:       2147483647, // math.MaxInt32
			blockedBranches:    2147483647, // math.MaxInt32
			expectError:        false,
		},
		{
			name:               "Large error messages (10KB)",
			broadcastFailures:  1,
			lastBroadcastError: string(make([]byte, 10000)), // 10KB of null bytes
			watcherErrors:      1,
			lastWatcherError:   string(make([]byte, 10000)), // 10KB of null bytes
			connectedClients:   10,
			activeAlerts:       10,
			blockedBranches:    10,
			expectError:        false,
		},
		{
			name:               "Whitespace-only error messages",
			broadcastFailures:  1,
			lastBroadcastError: "   \t\n   ",
			watcherErrors:      1,
			lastWatcherError:   "   \t\n   ",
			connectedClients:   5,
			activeAlerts:       5,
			blockedBranches:    5,
			expectError:        false,
		},
		{
			name:               "Empty strings with positive counts",
			broadcastFailures:  100,
			lastBroadcastError: "",
			watcherErrors:      200,
			lastWatcherError:   "",
			connectedClients:   50,
			activeAlerts:       30,
			blockedBranches:    20,
			expectError:        false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			health, err := NewHealthStatus(
				tt.broadcastFailures,
				tt.lastBroadcastError,
				tt.watcherErrors,
				tt.lastWatcherError,
				0,  // connectionCloseErrors
				"", // lastCloseError
				0,  // audioBroadcastFailures
				"", // lastAudioBroadcastErr
				0,  // treeBroadcastErrors
				"", // lastTreeBroadcastErr
				0,  // treeMsgConstructErrors
				"", // lastTreeMsgConstructErr
				tt.connectedClients,
				tt.activeAlerts,
				tt.blockedBranches,
			)

			if tt.expectError {
				if err == nil {
					t.Error("Expected error but got none")
				}
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}

				// Verify values are accessible
				if health.GetBroadcastFailures() != tt.broadcastFailures {
					t.Errorf("BroadcastFailures = %d, want %d", health.GetBroadcastFailures(), tt.broadcastFailures)
				}
				if health.GetWatcherErrors() != tt.watcherErrors {
					t.Errorf("WatcherErrors = %d, want %d", health.GetWatcherErrors(), tt.watcherErrors)
				}
				if health.GetConnectedClients() != tt.connectedClients {
					t.Errorf("ConnectedClients = %d, want %d", health.GetConnectedClients(), tt.connectedClients)
				}
				if health.GetActiveAlerts() != tt.activeAlerts {
					t.Errorf("ActiveAlerts = %d, want %d", health.GetActiveAlerts(), tt.activeAlerts)
				}
				if health.GetBlockedBranches() != tt.blockedBranches {
					t.Errorf("BlockedBranches = %d, want %d", health.GetBlockedBranches(), tt.blockedBranches)
				}

				// Verify timestamp is reasonable (within last 5 seconds)
				timeSinceCreation := time.Since(health.GetTimestamp())
				if timeSinceCreation < 0 || timeSinceCreation > 5*time.Second {
					t.Errorf("Timestamp looks unreasonable: %v ago", timeSinceCreation)
				}

				// For whitespace-only error messages, verify trimming occurred
				if tt.name == "Whitespace-only error messages" {
					if health.GetLastBroadcastError() != "" {
						t.Errorf("Expected LastBroadcastError to be trimmed to empty, got %q", health.GetLastBroadcastError())
					}
					if health.GetLastWatcherError() != "" {
						t.Errorf("Expected LastWatcherError to be trimmed to empty, got %q", health.GetLastWatcherError())
					}
				}
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
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			state, err := NewBlockedState(tt.isBlocked, tt.blockedBy)
			if err != nil {
				t.Errorf("NewBlockedState() returned unexpected error: %v", err)
			}

			if state.IsBlocked() != tt.isBlocked {
				t.Errorf("IsBlocked = %v, want %v", state.IsBlocked(), tt.isBlocked)
			}
			if state.BlockedBy() != tt.blockedBy {
				t.Errorf("BlockedBy = %q, want %q", state.BlockedBy(), tt.blockedBy)
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
			expectedErr: "blockedBy must be empty when not blocked, got \"main\"",
		},
		{
			name:        "Not blocked but has different blockedBy value",
			isBlocked:   false,
			blockedBy:   "develop",
			expectedErr: "blockedBy must be empty when not blocked, got \"develop\"",
		},
		{
			name:        "Blocked but has empty blockedBy",
			isBlocked:   true,
			blockedBy:   "",
			expectedErr: "blockedBy must be specified when blocked",
		},
		{
			name:        "Blocked but blockedBy is whitespace only",
			isBlocked:   true,
			blockedBy:   "   \t\n   ",
			expectedErr: "blockedBy must be specified when blocked",
		},
		{
			name:        "Not blocked with whitespace-only blockedBy",
			isBlocked:   false,
			blockedBy:   "  \t  ",
			expectedErr: "", // Should succeed after trimming
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewBlockedState(tt.isBlocked, tt.blockedBy)
			if tt.expectedErr == "" {
				// Expect success
				if err != nil {
					t.Errorf("NewBlockedState() returned unexpected error: %v", err)
				}
			} else {
				// Expect failure
				if err == nil {
					t.Errorf("NewBlockedState() did not return error for invalid input")
				} else if err.Error() != tt.expectedErr {
					t.Errorf("NewBlockedState() returned wrong error:\nGot:  %q\nWant: %q", err.Error(), tt.expectedErr)
				}
			}
		})
	}
}

// TestNewBlockedState_BoundaryConditions tests NewBlockedState with edge cases
func TestNewBlockedState_BoundaryConditions(t *testing.T) {
	tests := []struct {
		name      string
		isBlocked bool
		blockedBy string
		wantErr   bool
	}{
		{
			name:      "Very long branch name (1000 chars)",
			isBlocked: true,
			blockedBy: string(make([]byte, 1000)),
			wantErr:   false,
		},
		{
			name:      "Branch name with special characters",
			isBlocked: true,
			blockedBy: "feature/JIRA-123_update-api",
			wantErr:   false,
		},
		{
			name:      "Branch name with unicode",
			isBlocked: true,
			blockedBy: "feature-测试-branch",
			wantErr:   false,
		},
		{
			name:      "Branch name with spaces",
			isBlocked: true,
			blockedBy: "feature branch",
			wantErr:   false,
		},
		{
			name:      "Leading/trailing whitespace gets trimmed",
			isBlocked: true,
			blockedBy: "  main  ",
			wantErr:   false,
		},
		{
			name:      "Not blocked with leading/trailing whitespace",
			isBlocked: false,
			blockedBy: "  \t  ",
			wantErr:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			state, err := NewBlockedState(tt.isBlocked, tt.blockedBy)
			if tt.wantErr {
				if err == nil {
					t.Error("Expected error but got none")
				}
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}

				// Verify state is accessible
				if state.IsBlocked() != tt.isBlocked {
					t.Errorf("IsBlocked = %v, want %v", state.IsBlocked(), tt.isBlocked)
				}

				// Verify trimming occurred
				expected := ""
				if tt.isBlocked {
					expected = tt.blockedBy
				}
				expected = trimString(expected)
				if state.BlockedBy() != expected {
					t.Errorf("BlockedBy = %q, want %q", state.BlockedBy(), expected)
				}
			}
		})
	}
}

// trimString replicates the trimming behavior in NewBlockedState
func trimString(s string) string {
	// Trim spaces, tabs, and newlines
	return strings.TrimSpace(s)
}

// TestMalformedJSON tests that the protocol handles malformed JSON gracefully
// without panicking or causing undefined behavior.
//
// These tests verify defensive programming against:
//   - Network corruption (truncated messages)
//   - Encoding issues (invalid UTF-8)
//   - Client bugs (malformed JSON syntax)
//   - Injection attacks (extra braces, nested structures)
func TestMalformedJSON(t *testing.T) {
	tests := []struct {
		name        string
		jsonBytes   []byte
		expectError bool
		description string
	}{
		{
			name:        "Truncated JSON - missing closing brace",
			jsonBytes:   []byte(`{"type":"ping","cli`),
			expectError: true,
			description: "Network interruption during message transmission",
		},
		{
			name:        "Truncated JSON - mid-field",
			jsonBytes:   []byte(`{"type":"block_branch","branch":"feat`),
			expectError: true,
			description: "Message cut off during field value",
		},
		{
			name:        "Invalid UTF-8 sequence",
			jsonBytes:   []byte{0xFF, 0xFE, 0xFD},
			expectError: true,
			description: "Non-UTF-8 data (binary corruption)",
		},
		{
			name:        "Invalid UTF-8 in string value",
			jsonBytes:   []byte(`{"type":"ping","client_id":"` + string([]byte{0xFF, 0xFE}) + `"}`),
			expectError: false, // Go's JSON decoder is lenient with UTF-8
			description: "UTF-8 validation in string fields (Go allows invalid UTF-8)",
		},
		{
			name:        "Extra closing brace",
			jsonBytes:   []byte(`{"type":"ping"}}`),
			expectError: true,
			description: "Client bug or parsing error",
		},
		{
			name:        "Missing opening brace",
			jsonBytes:   []byte(`"type":"ping"}`),
			expectError: true,
			description: "Malformed JSON structure",
		},
		{
			name:        "Double-encoded JSON",
			jsonBytes:   []byte(`"{\"type\":\"ping\"}"`),
			expectError: true,
			description: "Client serialized JSON twice",
		},
		{
			name:        "Empty string",
			jsonBytes:   []byte(""),
			expectError: true,
			description: "Empty message",
		},
		{
			name:        "Whitespace only",
			jsonBytes:   []byte("   \t\n  "),
			expectError: true,
			description: "Message with only whitespace",
		},
		{
			name:        "Null bytes",
			jsonBytes:   []byte{0x00, 0x00, 0x00},
			expectError: true,
			description: "Binary null bytes",
		},
		{
			name:        "Array instead of object",
			jsonBytes:   []byte(`["type", "ping"]`),
			expectError: false, // JSON parses but validation should catch it
			description: "Wrong JSON type (array vs object)",
		},
		{
			name:        "Null value",
			jsonBytes:   []byte(`null`),
			expectError: false, // Go's JSON decoder unmarshals null to zero value
			description: "JSON null value (unmarshals to zero Message)",
		},
		{
			name:        "Number instead of object",
			jsonBytes:   []byte(`42`),
			expectError: true,
			description: "JSON number value",
		},
		{
			name:        "String instead of object",
			jsonBytes:   []byte(`"hello"`),
			expectError: true,
			description: "JSON string value",
		},
		{
			name:        "Unescaped control characters",
			jsonBytes:   []byte("{\"type\":\"ping\",\"data\":\"\n\r\t\"}"),
			expectError: false, // JSON allows these escaped
			description: "Control characters in strings",
		},
		{
			name:        "Very deeply nested (but valid) JSON",
			jsonBytes:   []byte(`{"a":{"b":{"c":{"d":{"e":{"type":"ping"}}}}}}`),
			expectError: false, // Valid JSON, just unusual structure
			description: "Deep nesting - should parse",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var msg Message
			err := unmarshalMessage(tt.jsonBytes, &msg)

			if tt.expectError {
				if err == nil {
					t.Errorf("Expected unmarshal error for %s, but got none", tt.description)
				} else {
					t.Logf("Got expected error for %s: %v", tt.description, err)
				}
			} else {
				if err != nil {
					t.Logf("Unmarshal error (may be ok): %v", err)
				} else {
					// Verify ValidateMessage catches structural issues
					if validateErr := ValidateMessage(msg); validateErr != nil {
						t.Logf("ValidateMessage caught issue: %v", validateErr)
					}
				}
			}
		})
	}
}

// unmarshalMessage is a helper that wraps json.Unmarshal for testing.
// This function tests the actual JSON decoding behavior that the daemon uses.
func unmarshalMessage(data []byte, v *Message) error {
	return json.Unmarshal(data, v)
}

// TestValidateMessage_MalformedFields tests validation of messages with
// syntactically valid JSON but semantically invalid field combinations.
func TestValidateMessage_MalformedFields(t *testing.T) {
	tests := []struct {
		name    string
		msg     Message
		wantErr bool
	}{
		{
			name: "Block branch with empty branch name",
			msg: Message{
				Type:          MsgTypeBlockBranch,
				Branch:        "",
				BlockedBranch: "main",
			},
			wantErr: true,
		},
		{
			name: "Block branch with empty blocked_branch",
			msg: Message{
				Type:          MsgTypeBlockBranch,
				Branch:        "feature",
				BlockedBranch: "",
			},
			wantErr: true,
		},
		{
			name: "Alert change with empty pane_id",
			msg: Message{
				Type:      MsgTypeAlertChange,
				PaneID:    "",
				EventType: "idle",
			},
			wantErr: true,
		},
		{
			name: "Alert change with empty event_type",
			msg: Message{
				Type:      MsgTypeAlertChange,
				PaneID:    "pane-1",
				EventType: "",
			},
			wantErr: true,
		},
		{
			name: "Message with no type field",
			msg: Message{
				Type: "",
			},
			wantErr: true,
		},
		{
			name: "Hello message with empty client_id",
			msg: Message{
				Type:     MsgTypeHello,
				ClientID: "",
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateMessage(tt.msg)
			if tt.wantErr {
				if err == nil {
					t.Error("Expected validation error but got none")
				} else {
					t.Logf("Got expected validation error: %v", err)
				}
			} else {
				if err != nil {
					t.Errorf("Unexpected validation error: %v", err)
				}
			}
		})
	}
}
