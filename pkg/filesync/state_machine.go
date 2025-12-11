package filesync

import "fmt"

// StateTransition represents a valid state transition
type StateTransition struct {
	From FileStatus
	To   FileStatus
}

// validTransitions defines all valid state transitions in the file sync workflow
var validTransitions = map[StateTransition]bool{
	// Initial extraction flow
	{FileStatusPending, FileStatusExtracting}:   true,
	{FileStatusExtracting, FileStatusExtracted}: true,
	{FileStatusExtracting, FileStatusError}:     true,

	// User approval/rejection from extracted state
	{FileStatusExtracted, FileStatusUploading}: true,
	{FileStatusExtracted, FileStatusRejected}:  true,

	// Upload flow
	{FileStatusUploading, FileStatusUploaded}: true,
	{FileStatusUploading, FileStatusSkipped}:  true,
	{FileStatusUploading, FileStatusError}:    true,

	// Trash operations (can trash uploaded or skipped files)
	{FileStatusUploaded, FileStatusTrashed}: true,
	{FileStatusSkipped, FileStatusTrashed}:  true,

	// Error recovery - can retry from error state
	{FileStatusError, FileStatusPending}:    true,
	{FileStatusError, FileStatusExtracting}: true,
	{FileStatusError, FileStatusUploading}:  true,
}

// ValidateTransition checks if a state transition is valid
func ValidateTransition(from, to FileStatus) error {
	transition := StateTransition{From: from, To: to}
	if !validTransitions[transition] {
		return fmt.Errorf("invalid state transition from %s to %s", from, to)
	}
	return nil
}

// CanTrash checks if a file can be trashed from its current state
func CanTrash(status FileStatus) bool {
	return status == FileStatusUploaded || status == FileStatusSkipped
}

// CanReject checks if a file can be rejected from its current state
func CanReject(status FileStatus) bool {
	return status == FileStatusExtracted
}

// CanApprove checks if a file can be approved from its current state
func CanApprove(status FileStatus) bool {
	return status == FileStatusExtracted
}

// CanRetry checks if a file can be retried from its current state
func CanRetry(status FileStatus) bool {
	return status == FileStatusError
}

// IsTerminalState checks if a status is a terminal state (no further transitions)
func IsTerminalState(status FileStatus) bool {
	return status == FileStatusTrashed || status == FileStatusRejected
}

// CanTransitionTo checks if a file can transition to a specific state from its current state
func CanTransitionTo(from, to FileStatus) bool {
	transition := StateTransition{From: from, To: to}
	return validTransitions[transition]
}
