// claude_status_types.go - Type definitions for Claude status management

package status

import (
	"time"
)

// ClaudePaneStatus represents the activity status of a Claude pane
type ClaudePaneStatus struct {
	PaneID            string
	Active            bool
	DurationText      string // e.g., "41s", "116s" - current or preserved duration
	LastKnownDuration string // Last non-empty duration seen while active
	LastActive        time.Time
	LastInactive      time.Time
	LastChanged       time.Time
	// Notification-based status
	HasPermissionRequest bool
	IsIdle               bool
	LastNotification     *ClaudeNotification
}

// ClaudeStatusUpdate represents a Claude pane status change notification
type ClaudeStatusUpdate struct {
	PaneID       string
	Active       bool
	DurationText string
	Timestamp    time.Time
}