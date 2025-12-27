package daemon

import (
	"errors"
	"fmt"
	"strings"

	"github.com/commons-systems/tmux-tui/internal/debug"
)

// TODO(#280): Add tests for FromWireFormat edge cases - see PR review for #273
// Protocol v2: Type-safe message structs with internal encapsulation

// copyStringMap creates a shallow copy of a string map to prevent external mutation.
// Returns an empty (non-nil) map if input is nil.
func copyStringMap(m map[string]string) map[string]string {
	result := make(map[string]string, len(m))
	for k, v := range m {
		result[k] = v
	}
	return result
}

//
// DESIGN RATIONALE:
//   - Private fields ensure immutability and encapsulation
//   - Constructors validate required fields at creation time
//   - ToWireFormat() converts to v1 Message for JSON serialization
//   - FromWireFormat() converts from v1 Message after JSON deserialization
//   - Wire protocol unchanged (v1 Message remains the serialization format)
//
// MIGRATION PATH:
//   - v1 Message (protocol.go): Wire format for JSON serialization
//   - v2 structs (this file): Type-safe internal representation
//   - Conversion at boundaries: server/client construct v2, convert to/from v1 for I/O
//
// BACKWARD COMPATIBILITY:
//   - Wire protocol unchanged - clients see no difference
//   - Internal refactoring only - compile-time safety improvements

// MessageV2 is the base interface for all protocol v2 messages
type MessageV2 interface {
	// MessageType returns the message type constant (e.g., MsgTypeHello)
	MessageType() string

	// SeqNumber returns the sequence number for ordering/gap detection
	SeqNumber() uint64

	// ToWireFormat converts to v1 Message for JSON serialization
	ToWireFormat() Message
}

// Constructor Validation Pattern:
// All message constructors follow a pattern of preserving the original input value
// (e.g., originalClientID := clientID) before trimming whitespace. If validation
// fails, the original value is logged via debug.Log() to aid troubleshooting.
//
// Why this matters: Whitespace in IDs often indicates bugs like:
// - String concatenation errors: "client-" + " 123" instead of "client-123"
// - Template rendering issues: reading " {{.ID}} " with extra spaces
// - File parsing problems: trailing newlines from file reads
//
// When you see MESSAGE_VALIDATION_FAILED logs, check the original=%q value
// for unexpected whitespace and fix the caller's string construction logic.
//
// Example debug log output:
//   MESSAGE_VALIDATION_FAILED type=hello reason=empty_client_id original="  \n"
//   MESSAGE_VALIDATION_FAILED type=alert_change reason=empty_pane_id original=" "

// 1. HelloMessageV2 represents a client connection greeting
type HelloMessageV2 struct {
	seqNum   uint64
	clientID string
}

// NewHelloMessage creates a validated HelloMessage.
// Returns error if clientID is empty after trimming whitespace.
func NewHelloMessage(seqNum uint64, clientID string) (*HelloMessageV2, error) {
	originalClientID := clientID
	clientID = strings.TrimSpace(clientID)
	if clientID == "" {
		debug.Log("MESSAGE_VALIDATION_FAILED type=hello reason=empty_client_id original=%q", originalClientID)
		return nil, errors.New("client_id required")
	}
	return &HelloMessageV2{seqNum: seqNum, clientID: clientID}, nil
}

func (m *HelloMessageV2) MessageType() string { return MsgTypeHello }
func (m *HelloMessageV2) SeqNumber() uint64   { return m.seqNum }
func (m *HelloMessageV2) ToWireFormat() Message {
	return Message{
		Type:     MsgTypeHello,
		SeqNum:   m.seqNum,
		ClientID: m.clientID,
	}
}

// ClientID returns the client identifier
func (m *HelloMessageV2) ClientID() string { return m.clientID }

// 2. FullStateMessageV2 represents complete alert state snapshot
type FullStateMessageV2 struct {
	seqNum          uint64
	alerts          map[string]string
	blockedBranches map[string]string
}

// NewFullStateMessage creates a validated FullStateMessage.
// Alerts and blockedBranches can be nil or empty maps (represents no active state).
// Map keys and values are not currently validated (see TODO #519).
// TODO(#519): Add validation for empty/whitespace-only keys in maps (should reject).
// TODO(#519): Clarify empty value semantics:
//   - alerts map: Does empty value mean "alert cleared" or "invalid state"?
//   - blockedBranches map: Does empty value mean "branch exists but blocks nothing" or error?
//
// Current behavior: Empty values are accepted and preserved in state, which may
// lead to ambiguous state representation. Define explicit semantics before adding validation.
// FIXME: This is known-bad behavior that should be addressed before production use.
func NewFullStateMessage(seqNum uint64, alerts, blockedBranches map[string]string) (*FullStateMessageV2, error) {
	return &FullStateMessageV2{
		seqNum:          seqNum,
		alerts:          copyStringMap(alerts),
		blockedBranches: copyStringMap(blockedBranches),
	}, nil
}

func (m *FullStateMessageV2) MessageType() string { return MsgTypeFullState }
func (m *FullStateMessageV2) SeqNumber() uint64   { return m.seqNum }
func (m *FullStateMessageV2) ToWireFormat() Message {
	return Message{
		Type:            MsgTypeFullState,
		SeqNum:          m.seqNum,
		Alerts:          m.alerts,
		BlockedBranches: m.blockedBranches,
	}
}

// Alerts returns a copy of the alert state to prevent mutation
func (m *FullStateMessageV2) Alerts() map[string]string {
	return copyStringMap(m.alerts)
}

// BlockedBranches returns a copy of the blocked branches state to prevent mutation
func (m *FullStateMessageV2) BlockedBranches() map[string]string {
	return copyStringMap(m.blockedBranches)
}

// 3. AlertChangeMessageV2 represents a single alert state change
type AlertChangeMessageV2 struct {
	seqNum    uint64
	paneID    string
	eventType string
	created   bool
}

// NewAlertChangeMessage creates a validated AlertChangeMessage.
// Returns error if paneID or eventType is empty after trimming.
// TODO(#522): Add event type constants and validation for recognized event types.
// Currently any non-empty string is accepted as eventType, which allows typos
// and inconsistent casing to slip through. Define constants like:
//   - EventTypeAlert = "alert"
//   - EventTypeActivity = "activity"
//   - EventTypeSilence = "silence"
//
// Then validate eventType against this allowlist to catch bugs like:
//   - "Alert" vs "alert" (wrong casing)
//   - "alrt" vs "alert" (typo)
//   - "custom_event" (unknown type that should be added to constants first)
func NewAlertChangeMessage(seqNum uint64, paneID, eventType string, created bool) (*AlertChangeMessageV2, error) {
	originalPaneID := paneID
	originalEventType := eventType
	paneID = strings.TrimSpace(paneID)
	eventType = strings.TrimSpace(eventType)

	if paneID == "" {
		debug.Log("MESSAGE_VALIDATION_FAILED type=alert_change reason=empty_pane_id original=%q", originalPaneID)
		return nil, errors.New("pane_id required")
	}
	if eventType == "" {
		debug.Log("MESSAGE_VALIDATION_FAILED type=alert_change reason=empty_event_type original=%q", originalEventType)
		return nil, errors.New("event_type required")
	}

	return &AlertChangeMessageV2{
		seqNum:    seqNum,
		paneID:    paneID,
		eventType: eventType,
		created:   created,
	}, nil
}

func (m *AlertChangeMessageV2) MessageType() string { return MsgTypeAlertChange }
func (m *AlertChangeMessageV2) SeqNumber() uint64   { return m.seqNum }
func (m *AlertChangeMessageV2) ToWireFormat() Message {
	return Message{
		Type:      MsgTypeAlertChange,
		SeqNum:    m.seqNum,
		PaneID:    m.paneID,
		EventType: m.eventType,
		Created:   m.created,
	}
}

// PaneID returns the pane identifier
func (m *AlertChangeMessageV2) PaneID() string { return m.paneID }

// EventType returns the alert event type
func (m *AlertChangeMessageV2) EventType() string { return m.eventType }

// Created returns whether the alert was created (true) or removed (false)
func (m *AlertChangeMessageV2) Created() bool { return m.created }

// 4. PaneFocusMessageV2 represents active pane change
type PaneFocusMessageV2 struct {
	seqNum       uint64
	activePaneID string
}

// NewPaneFocusMessage creates a validated PaneFocusMessage.
// Returns error if activePaneID is empty after trimming.
func NewPaneFocusMessage(seqNum uint64, activePaneID string) (*PaneFocusMessageV2, error) {
	originalActivePaneID := activePaneID
	activePaneID = strings.TrimSpace(activePaneID)
	if activePaneID == "" {
		debug.Log("MESSAGE_VALIDATION_FAILED type=pane_focus reason=empty_active_pane_id original=%q", originalActivePaneID)
		return nil, errors.New("active_pane_id required")
	}
	return &PaneFocusMessageV2{seqNum: seqNum, activePaneID: activePaneID}, nil
}

func (m *PaneFocusMessageV2) MessageType() string { return MsgTypePaneFocus }
func (m *PaneFocusMessageV2) SeqNumber() uint64   { return m.seqNum }
func (m *PaneFocusMessageV2) ToWireFormat() Message {
	return Message{
		Type:         MsgTypePaneFocus,
		SeqNum:       m.seqNum,
		ActivePaneID: m.activePaneID,
	}
}

// ActivePaneID returns the active pane identifier
func (m *PaneFocusMessageV2) ActivePaneID() string { return m.activePaneID }

// 5. BlockBranchMessageV2 represents a request to block a branch
type BlockBranchMessageV2 struct {
	seqNum        uint64
	branch        string
	blockedBranch string
}

// NewBlockBranchMessage creates a validated BlockBranchMessage.
// Returns error if branch or blockedBranch is empty after trimming.
func NewBlockBranchMessage(seqNum uint64, branch, blockedBranch string) (*BlockBranchMessageV2, error) {
	originalBranch := branch
	originalBlockedBranch := blockedBranch
	branch = strings.TrimSpace(branch)
	blockedBranch = strings.TrimSpace(blockedBranch)

	if branch == "" {
		debug.Log("MESSAGE_VALIDATION_FAILED type=block_branch reason=empty_branch original=%q", originalBranch)
		return nil, errors.New("branch required")
	}
	if blockedBranch == "" {
		debug.Log("MESSAGE_VALIDATION_FAILED type=block_branch reason=empty_blocked_branch original=%q", originalBlockedBranch)
		return nil, errors.New("blocked_branch required")
	}

	return &BlockBranchMessageV2{
		seqNum:        seqNum,
		branch:        branch,
		blockedBranch: blockedBranch,
	}, nil
}

func (m *BlockBranchMessageV2) MessageType() string { return MsgTypeBlockBranch }
func (m *BlockBranchMessageV2) SeqNumber() uint64   { return m.seqNum }
func (m *BlockBranchMessageV2) ToWireFormat() Message {
	return Message{
		Type:          MsgTypeBlockBranch,
		SeqNum:        m.seqNum,
		Branch:        m.branch,
		BlockedBranch: m.blockedBranch,
	}
}

// Branch returns the blocking branch name
func (m *BlockBranchMessageV2) Branch() string { return m.branch }

// BlockedBranch returns the branch being blocked
func (m *BlockBranchMessageV2) BlockedBranch() string { return m.blockedBranch }

// 6. UnblockBranchMessageV2 represents a request to unblock a branch
type UnblockBranchMessageV2 struct {
	seqNum uint64
	branch string
}

// NewUnblockBranchMessage creates a validated UnblockBranchMessage.
// Returns error if branch is empty after trimming.
func NewUnblockBranchMessage(seqNum uint64, branch string) (*UnblockBranchMessageV2, error) {
	originalBranch := branch
	branch = strings.TrimSpace(branch)
	if branch == "" {
		debug.Log("MESSAGE_VALIDATION_FAILED type=unblock_branch reason=empty_branch original=%q", originalBranch)
		return nil, errors.New("branch required")
	}
	return &UnblockBranchMessageV2{seqNum: seqNum, branch: branch}, nil
}

func (m *UnblockBranchMessageV2) MessageType() string { return MsgTypeUnblockBranch }
func (m *UnblockBranchMessageV2) SeqNumber() uint64   { return m.seqNum }
func (m *UnblockBranchMessageV2) ToWireFormat() Message {
	return Message{
		Type:   MsgTypeUnblockBranch,
		SeqNum: m.seqNum,
		Branch: m.branch,
	}
}

// Branch returns the branch to unblock
func (m *UnblockBranchMessageV2) Branch() string { return m.branch }

// 7. BlockChangeMessageV2 represents a block state change notification
type BlockChangeMessageV2 struct {
	seqNum        uint64
	branch        string
	blockedBranch string
	blocked       bool
}

// TODO(#328): Extract repeated conditional validation pattern (blocked=true requires blockedBranch)
// NewBlockChangeMessage creates a validated BlockChangeMessage.
// Returns error if branch is empty after trimming.
// If blocked is false, blockedBranch should be empty (will be cleared).
func NewBlockChangeMessage(seqNum uint64, branch, blockedBranch string, blocked bool) (*BlockChangeMessageV2, error) {
	originalBranch := branch
	originalBlockedBranch := blockedBranch
	branch = strings.TrimSpace(branch)
	blockedBranch = strings.TrimSpace(blockedBranch)

	if branch == "" {
		debug.Log("MESSAGE_VALIDATION_FAILED type=block_change reason=empty_branch original=%q", originalBranch)
		return nil, errors.New("branch required")
	}

	// If unblocking, blockedBranch should be empty
	if !blocked {
		blockedBranch = ""
	} else if blockedBranch == "" {
		debug.Log("MESSAGE_VALIDATION_FAILED type=block_change reason=empty_blocked_branch_when_blocked original=%q blocked=%t", originalBlockedBranch, blocked)
		return nil, errors.New("blocked_branch required when blocked is true")
	}

	return &BlockChangeMessageV2{
		seqNum:        seqNum,
		branch:        branch,
		blockedBranch: blockedBranch,
		blocked:       blocked,
	}, nil
}

func (m *BlockChangeMessageV2) MessageType() string { return MsgTypeBlockChange }
func (m *BlockChangeMessageV2) SeqNumber() uint64   { return m.seqNum }
func (m *BlockChangeMessageV2) ToWireFormat() Message {
	return Message{
		Type:          MsgTypeBlockChange,
		SeqNum:        m.seqNum,
		Branch:        m.branch,
		BlockedBranch: m.blockedBranch,
		Blocked:       m.blocked,
	}
}

// Branch returns the branch that changed block state
func (m *BlockChangeMessageV2) Branch() string { return m.branch }

// BlockedBranch returns the blocking branch (empty if unblocked)
func (m *BlockChangeMessageV2) BlockedBranch() string { return m.blockedBranch }

// Blocked returns whether the branch is now blocked
func (m *BlockChangeMessageV2) Blocked() bool { return m.blocked }

// 8. QueryBlockedStateMessageV2 represents a request to check if a branch is blocked
type QueryBlockedStateMessageV2 struct {
	seqNum uint64
	branch string
}

// NewQueryBlockedStateMessage creates a validated QueryBlockedStateMessage.
// Returns error if branch is empty after trimming.
func NewQueryBlockedStateMessage(seqNum uint64, branch string) (*QueryBlockedStateMessageV2, error) {
	originalBranch := branch
	branch = strings.TrimSpace(branch)
	if branch == "" {
		debug.Log("MESSAGE_VALIDATION_FAILED type=query_blocked_state reason=empty_branch original=%q", originalBranch)
		return nil, errors.New("branch required")
	}
	return &QueryBlockedStateMessageV2{seqNum: seqNum, branch: branch}, nil
}

func (m *QueryBlockedStateMessageV2) MessageType() string { return MsgTypeQueryBlockedState }
func (m *QueryBlockedStateMessageV2) SeqNumber() uint64   { return m.seqNum }
func (m *QueryBlockedStateMessageV2) ToWireFormat() Message {
	return Message{
		Type:   MsgTypeQueryBlockedState,
		SeqNum: m.seqNum,
		Branch: m.branch,
	}
}

// Branch returns the branch to query
func (m *QueryBlockedStateMessageV2) Branch() string { return m.branch }

// 9. BlockedStateResponseMessageV2 represents the response to a blocked state query
type BlockedStateResponseMessageV2 struct {
	seqNum        uint64
	branch        string
	isBlocked     bool
	blockedBranch string
}

// TODO(#328): Extract repeated conditional validation pattern (blocked=true requires blockedBranch)
// NewBlockedStateResponseMessage creates a validated BlockedStateResponseMessage.
// Returns error if branch is empty or if isBlocked is true but blockedBranch is empty.
func NewBlockedStateResponseMessage(seqNum uint64, branch string, isBlocked bool, blockedBranch string) (*BlockedStateResponseMessageV2, error) {
	originalBranch := branch
	originalBlockedBranch := blockedBranch
	branch = strings.TrimSpace(branch)
	blockedBranch = strings.TrimSpace(blockedBranch)

	if branch == "" {
		debug.Log("MESSAGE_VALIDATION_FAILED type=blocked_state_response reason=empty_branch original=%q", originalBranch)
		return nil, errors.New("branch required")
	}

	// If not blocked, blockedBranch should be empty
	if !isBlocked {
		blockedBranch = ""
	} else if blockedBranch == "" {
		debug.Log("MESSAGE_VALIDATION_FAILED type=blocked_state_response reason=empty_blocked_branch_when_blocked original=%q is_blocked=%t", originalBlockedBranch, isBlocked)
		return nil, errors.New("blocked_branch required when is_blocked is true")
	}

	return &BlockedStateResponseMessageV2{
		seqNum:        seqNum,
		branch:        branch,
		isBlocked:     isBlocked,
		blockedBranch: blockedBranch,
	}, nil
}

func (m *BlockedStateResponseMessageV2) MessageType() string { return MsgTypeBlockedStateResponse }
func (m *BlockedStateResponseMessageV2) SeqNumber() uint64   { return m.seqNum }
func (m *BlockedStateResponseMessageV2) ToWireFormat() Message {
	return Message{
		Type:          MsgTypeBlockedStateResponse,
		SeqNum:        m.seqNum,
		Branch:        m.branch,
		IsBlocked:     m.isBlocked,
		BlockedBranch: m.blockedBranch,
	}
}

// Branch returns the queried branch name
func (m *BlockedStateResponseMessageV2) Branch() string { return m.branch }

// IsBlocked returns whether the branch is blocked
func (m *BlockedStateResponseMessageV2) IsBlocked() bool { return m.isBlocked }

// BlockedBranch returns the blocking branch (empty if not blocked)
func (m *BlockedStateResponseMessageV2) BlockedBranch() string { return m.blockedBranch }

// 10. PingMessageV2 represents a health check request
type PingMessageV2 struct {
	seqNum uint64
}

// NewPingMessage creates a validated PingMessage.
func NewPingMessage(seqNum uint64) (*PingMessageV2, error) {
	return &PingMessageV2{seqNum: seqNum}, nil
}

func (m *PingMessageV2) MessageType() string { return MsgTypePing }
func (m *PingMessageV2) SeqNumber() uint64   { return m.seqNum }
func (m *PingMessageV2) ToWireFormat() Message {
	return Message{
		Type:   MsgTypePing,
		SeqNum: m.seqNum,
	}
}

// 11. PongMessageV2 represents a health check response
type PongMessageV2 struct {
	seqNum uint64
}

// NewPongMessage creates a validated PongMessage.
func NewPongMessage(seqNum uint64) (*PongMessageV2, error) {
	return &PongMessageV2{seqNum: seqNum}, nil
}

func (m *PongMessageV2) MessageType() string { return MsgTypePong }
func (m *PongMessageV2) SeqNumber() uint64   { return m.seqNum }
func (m *PongMessageV2) ToWireFormat() Message {
	return Message{
		Type:   MsgTypePong,
		SeqNum: m.seqNum,
	}
}

// 12. HealthQueryMessageV2 represents a request for health metrics
type HealthQueryMessageV2 struct {
	seqNum uint64
}

// NewHealthQueryMessage creates a validated HealthQueryMessage.
func NewHealthQueryMessage(seqNum uint64) (*HealthQueryMessageV2, error) {
	return &HealthQueryMessageV2{seqNum: seqNum}, nil
}

func (m *HealthQueryMessageV2) MessageType() string { return MsgTypeHealthQuery }
func (m *HealthQueryMessageV2) SeqNumber() uint64   { return m.seqNum }
func (m *HealthQueryMessageV2) ToWireFormat() Message {
	return Message{
		Type:   MsgTypeHealthQuery,
		SeqNum: m.seqNum,
	}
}

// 13. HealthResponseMessageV2 represents health metrics from the daemon
type HealthResponseMessageV2 struct {
	seqNum       uint64
	healthStatus HealthStatus
}

// NewHealthResponseMessage creates a validated HealthResponseMessage.
// TODO(#524): Add HealthStatus content validation:
// - Reject negative values for counters (activeClients, totalMessages, etc.)
// - Validate timestamp fields are not in future
// - Ensure uptime is non-negative
func NewHealthResponseMessage(seqNum uint64, healthStatus HealthStatus) (*HealthResponseMessageV2, error) {
	return &HealthResponseMessageV2{seqNum: seqNum, healthStatus: healthStatus}, nil
}

func (m *HealthResponseMessageV2) MessageType() string { return MsgTypeHealthResponse }
func (m *HealthResponseMessageV2) SeqNumber() uint64   { return m.seqNum }
func (m *HealthResponseMessageV2) ToWireFormat() Message {
	return Message{
		Type:         MsgTypeHealthResponse,
		SeqNum:       m.seqNum,
		HealthStatus: &m.healthStatus,
	}
}

// HealthStatus returns the health metrics
func (m *HealthResponseMessageV2) HealthStatus() HealthStatus { return m.healthStatus }

// 14. SyncWarningMessageV2 represents a broadcast synchronization warning
type SyncWarningMessageV2 struct {
	seqNum          uint64
	originalMsgType string
	errorMsg        string
}

// NewSyncWarningMessage creates a validated SyncWarningMessage.
// originalMsgType indicates which message type failed to sync (required).
// errorMsg provides diagnostic context about the sync failure.
// REQUIRED when:
//   - An error object is available (use err.Error())
//   - The failure reason is known (e.g., "channel full", "timeout")
//
// Empty errorMsg is rejected - sync warnings must include diagnostic context.
func NewSyncWarningMessage(seqNum uint64, originalMsgType, errorMsg string) (*SyncWarningMessageV2, error) {
	originalOriginalMsgType := originalMsgType
	originalErrorMsg := errorMsg
	originalMsgType = strings.TrimSpace(originalMsgType)
	errorMsg = strings.TrimSpace(errorMsg)

	if originalMsgType == "" {
		debug.Log("MESSAGE_VALIDATION_FAILED type=sync_warning reason=empty_original_msg_type original=%q", originalOriginalMsgType)
		return nil, errors.New("original_msg_type required")
	}

	if errorMsg == "" {
		debug.Log("MESSAGE_VALIDATION_FAILED type=sync_warning reason=empty_error_msg original=%q", originalErrorMsg)
		return nil, errors.New("error_msg required - sync warnings must include diagnostic context")
	}

	return &SyncWarningMessageV2{
		seqNum:          seqNum,
		originalMsgType: originalMsgType,
		errorMsg:        errorMsg,
	}, nil
}

func (m *SyncWarningMessageV2) MessageType() string { return MsgTypeSyncWarning }
func (m *SyncWarningMessageV2) SeqNumber() uint64   { return m.seqNum }
func (m *SyncWarningMessageV2) ToWireFormat() Message {
	return Message{
		Type:            MsgTypeSyncWarning,
		SeqNum:          m.seqNum,
		OriginalMsgType: m.originalMsgType,
		Error:           m.errorMsg,
	}
}

// OriginalMsgType returns the message type that failed to sync
func (m *SyncWarningMessageV2) OriginalMsgType() string { return m.originalMsgType }

// Error returns the error message (may be empty)
func (m *SyncWarningMessageV2) Error() string { return m.errorMsg }

// 15. ResyncRequestMessageV2 represents a request to resync state after detecting gaps
type ResyncRequestMessageV2 struct {
	seqNum uint64
}

// NewResyncRequestMessage creates a validated ResyncRequestMessage.
func NewResyncRequestMessage(seqNum uint64) (*ResyncRequestMessageV2, error) {
	return &ResyncRequestMessageV2{seqNum: seqNum}, nil
}

func (m *ResyncRequestMessageV2) MessageType() string { return MsgTypeResyncRequest }
func (m *ResyncRequestMessageV2) SeqNumber() uint64   { return m.seqNum }
func (m *ResyncRequestMessageV2) ToWireFormat() Message {
	return Message{
		Type:   MsgTypeResyncRequest,
		SeqNum: m.seqNum,
	}
}

// 16. PersistenceErrorMessageV2 represents a failure to save blocked state
type PersistenceErrorMessageV2 struct {
	seqNum   uint64
	errorMsg string
}

// NewPersistenceErrorMessage creates a validated PersistenceErrorMessage.
// Returns error if errorMsg is empty after trimming.
// NOTE: errorMsg is REQUIRED (changed from optional) because empty error messages
// provide no diagnostic value and make troubleshooting persistence failures impossible.
func NewPersistenceErrorMessage(seqNum uint64, errorMsg string) (*PersistenceErrorMessageV2, error) {
	errorMsg = strings.TrimSpace(errorMsg)
	if errorMsg == "" {
		return nil, errors.New("error_msg required - empty error messages provide no diagnostic value")
	}
	return &PersistenceErrorMessageV2{seqNum: seqNum, errorMsg: errorMsg}, nil
}

func (m *PersistenceErrorMessageV2) MessageType() string { return MsgTypePersistenceError }
func (m *PersistenceErrorMessageV2) SeqNumber() uint64   { return m.seqNum }
func (m *PersistenceErrorMessageV2) ToWireFormat() Message {
	return Message{
		Type:   MsgTypePersistenceError,
		SeqNum: m.seqNum,
		Error:  m.errorMsg,
	}
}

// Error returns the error message (guaranteed non-empty by constructor)
func (m *PersistenceErrorMessageV2) Error() string { return m.errorMsg }

// 17. AudioErrorMessageV2 represents a failure to play audio
type AudioErrorMessageV2 struct {
	seqNum   uint64
	errorMsg string
}

// NewAudioErrorMessage creates a validated AudioErrorMessage.
// Returns error if errorMsg is empty after trimming.
func NewAudioErrorMessage(seqNum uint64, errorMsg string) (*AudioErrorMessageV2, error) {
	errorMsg = strings.TrimSpace(errorMsg)
	if errorMsg == "" {
		return nil, errors.New("error_msg required - empty error messages provide no diagnostic value")
	}
	return &AudioErrorMessageV2{seqNum: seqNum, errorMsg: errorMsg}, nil
}

func (m *AudioErrorMessageV2) MessageType() string { return MsgTypeAudioError }
func (m *AudioErrorMessageV2) SeqNumber() uint64   { return m.seqNum }
func (m *AudioErrorMessageV2) ToWireFormat() Message {
	return Message{
		Type:   MsgTypeAudioError,
		SeqNum: m.seqNum,
		Error:  m.errorMsg,
	}
}

// Error returns the error message (guaranteed non-empty by constructor)
func (m *AudioErrorMessageV2) Error() string { return m.errorMsg }

// 18. ShowBlockPickerMessageV2 represents a request to show branch picker UI
type ShowBlockPickerMessageV2 struct {
	seqNum uint64
	paneID string
}

// NewShowBlockPickerMessage creates a validated ShowBlockPickerMessage.
// Returns error if paneID is empty after trimming.
func NewShowBlockPickerMessage(seqNum uint64, paneID string) (*ShowBlockPickerMessageV2, error) {
	originalPaneID := paneID
	paneID = strings.TrimSpace(paneID)
	if paneID == "" {
		debug.Log("MESSAGE_VALIDATION_FAILED type=show_block_picker reason=empty_pane_id original=%q", originalPaneID)
		return nil, errors.New("pane_id required")
	}
	return &ShowBlockPickerMessageV2{seqNum: seqNum, paneID: paneID}, nil
}

func (m *ShowBlockPickerMessageV2) MessageType() string { return MsgTypeShowBlockPicker }
func (m *ShowBlockPickerMessageV2) SeqNumber() uint64   { return m.seqNum }
func (m *ShowBlockPickerMessageV2) ToWireFormat() Message {
	return Message{
		Type:   MsgTypeShowBlockPicker,
		SeqNum: m.seqNum,
		PaneID: m.paneID,
	}
}

// PaneID returns the pane identifier
func (m *ShowBlockPickerMessageV2) PaneID() string { return m.paneID }

// FromWireFormat converts a v1 Message to a type-safe v2 message.
// Returns error if the message is invalid or has missing required fields.
// TODO(#521): Add validation for extraneous fields to catch message construction bugs.
// Example: HelloMessage with unexpected 'Alerts' field should be rejected to detect
// mismatched message type/content.
// TODO(#523): Add exhaustiveness test to ensure all message types are handled.
// Test should fail at compile-time or test-time when new message types are added
// but not handled in FromWireFormat switch.
func FromWireFormat(msg Message) (MessageV2, error) {
	// Validate first
	if err := ValidateMessage(msg); err != nil {
		return nil, fmt.Errorf("invalid wire message: %w", err)
	}

	switch msg.Type {
	case MsgTypeHello:
		v2msg, err := NewHelloMessage(msg.SeqNum, msg.ClientID)
		if err != nil {
			return nil, fmt.Errorf("invalid %s message (seqNum=%d, clientID=%q): %w",
				MsgTypeHello, msg.SeqNum, msg.ClientID, err)
		}
		return v2msg, nil

	case MsgTypeFullState:
		v2msg, err := NewFullStateMessage(msg.SeqNum, msg.Alerts, msg.BlockedBranches)
		if err != nil {
			return nil, fmt.Errorf("invalid %s message (seqNum=%d): %w", MsgTypeFullState, msg.SeqNum, err)
		}
		return v2msg, nil

	case MsgTypeAlertChange:
		v2msg, err := NewAlertChangeMessage(msg.SeqNum, msg.PaneID, msg.EventType, msg.Created)
		if err != nil {
			return nil, fmt.Errorf("invalid %s message (seqNum=%d, paneID=%q, eventType=%q): %w",
				MsgTypeAlertChange, msg.SeqNum, msg.PaneID, msg.EventType, err)
		}
		return v2msg, nil

	case MsgTypePaneFocus:
		v2msg, err := NewPaneFocusMessage(msg.SeqNum, msg.ActivePaneID)
		if err != nil {
			return nil, fmt.Errorf("invalid %s message (seqNum=%d, activePaneID=%q): %w",
				MsgTypePaneFocus, msg.SeqNum, msg.ActivePaneID, err)
		}
		return v2msg, nil

	case MsgTypeBlockBranch:
		v2msg, err := NewBlockBranchMessage(msg.SeqNum, msg.Branch, msg.BlockedBranch)
		if err != nil {
			return nil, fmt.Errorf("invalid %s message (seqNum=%d, branch=%q, blockedBranch=%q): %w",
				MsgTypeBlockBranch, msg.SeqNum, msg.Branch, msg.BlockedBranch, err)
		}
		return v2msg, nil

	case MsgTypeUnblockBranch:
		v2msg, err := NewUnblockBranchMessage(msg.SeqNum, msg.Branch)
		if err != nil {
			return nil, fmt.Errorf("invalid %s message (seqNum=%d, branch=%q): %w",
				MsgTypeUnblockBranch, msg.SeqNum, msg.Branch, err)
		}
		return v2msg, nil

	case MsgTypeBlockChange:
		v2msg, err := NewBlockChangeMessage(msg.SeqNum, msg.Branch, msg.BlockedBranch, msg.Blocked)
		if err != nil {
			return nil, fmt.Errorf("invalid %s message (seqNum=%d, branch=%q, blocked=%t): %w",
				MsgTypeBlockChange, msg.SeqNum, msg.Branch, msg.Blocked, err)
		}
		return v2msg, nil

	case MsgTypeQueryBlockedState:
		v2msg, err := NewQueryBlockedStateMessage(msg.SeqNum, msg.Branch)
		if err != nil {
			return nil, fmt.Errorf("invalid %s message (seqNum=%d, branch=%q): %w",
				MsgTypeQueryBlockedState, msg.SeqNum, msg.Branch, err)
		}
		return v2msg, nil

	case MsgTypeBlockedStateResponse:
		v2msg, err := NewBlockedStateResponseMessage(msg.SeqNum, msg.Branch, msg.IsBlocked, msg.BlockedBranch)
		if err != nil {
			return nil, fmt.Errorf("invalid %s message (seqNum=%d, branch=%q, isBlocked=%t): %w",
				MsgTypeBlockedStateResponse, msg.SeqNum, msg.Branch, msg.IsBlocked, err)
		}
		return v2msg, nil

	case MsgTypePing:
		v2msg, err := NewPingMessage(msg.SeqNum)
		if err != nil {
			return nil, fmt.Errorf("invalid %s message (seqNum=%d): %w", MsgTypePing, msg.SeqNum, err)
		}
		return v2msg, nil

	case MsgTypePong:
		v2msg, err := NewPongMessage(msg.SeqNum)
		if err != nil {
			return nil, fmt.Errorf("invalid %s message (seqNum=%d): %w", MsgTypePong, msg.SeqNum, err)
		}
		return v2msg, nil

	case MsgTypeHealthQuery:
		v2msg, err := NewHealthQueryMessage(msg.SeqNum)
		if err != nil {
			return nil, fmt.Errorf("invalid %s message (seqNum=%d): %w", MsgTypeHealthQuery, msg.SeqNum, err)
		}
		return v2msg, nil

	case MsgTypeHealthResponse:
		if msg.HealthStatus == nil {
			return nil, fmt.Errorf("invalid %s message (seqNum=%d): health_response requires health_status",
				MsgTypeHealthResponse, msg.SeqNum)
		}
		v2msg, err := NewHealthResponseMessage(msg.SeqNum, *msg.HealthStatus)
		if err != nil {
			return nil, fmt.Errorf("invalid %s message (seqNum=%d): %w", MsgTypeHealthResponse, msg.SeqNum, err)
		}
		return v2msg, nil

	case MsgTypeSyncWarning:
		v2msg, err := NewSyncWarningMessage(msg.SeqNum, msg.OriginalMsgType, msg.Error)
		if err != nil {
			return nil, fmt.Errorf("invalid %s message (seqNum=%d, originalMsgType=%q): %w",
				MsgTypeSyncWarning, msg.SeqNum, msg.OriginalMsgType, err)
		}
		return v2msg, nil

	case MsgTypeResyncRequest:
		v2msg, err := NewResyncRequestMessage(msg.SeqNum)
		if err != nil {
			return nil, fmt.Errorf("invalid %s message (seqNum=%d): %w", MsgTypeResyncRequest, msg.SeqNum, err)
		}
		return v2msg, nil

	case MsgTypePersistenceError:
		v2msg, err := NewPersistenceErrorMessage(msg.SeqNum, msg.Error)
		if err != nil {
			return nil, fmt.Errorf("invalid %s message (seqNum=%d, error=%q): %w",
				MsgTypePersistenceError, msg.SeqNum, msg.Error, err)
		}
		return v2msg, nil

	case MsgTypeAudioError:
		v2msg, err := NewAudioErrorMessage(msg.SeqNum, msg.Error)
		if err != nil {
			return nil, fmt.Errorf("invalid %s message (seqNum=%d, error=%q): %w",
				MsgTypeAudioError, msg.SeqNum, msg.Error, err)
		}
		return v2msg, nil

	case MsgTypeShowBlockPicker:
		v2msg, err := NewShowBlockPickerMessage(msg.SeqNum, msg.PaneID)
		if err != nil {
			return nil, fmt.Errorf("invalid %s message (seqNum=%d, paneID=%q): %w",
				MsgTypeShowBlockPicker, msg.SeqNum, msg.PaneID, err)
		}
		return v2msg, nil

	default:
		debug.Log("MESSAGE_TYPE_UNKNOWN type=%q seq=%d reason=not_in_switch_statement",
			msg.Type, msg.SeqNum)
		// TODO(#536): Upgrade to high-severity logging with Sentry integration once logError infrastructure exists
		// Unknown message types indicate version skew or corruption - should be monitored in production
		return nil, fmt.Errorf("unknown message type %q (seq=%d) - may indicate client/server version mismatch or message corruption",
			msg.Type, msg.SeqNum)
	}
}
