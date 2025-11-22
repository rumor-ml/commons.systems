// claude_status_queries.go - Status query functionality for Claude status management

package status

import (
	"github.com/rumor-ml/log/pkg/log"
)

// ClaudeStatusQuerier handles status queries and highlighting decisions
type ClaudeStatusQuerier struct {
	manager *ClaudeStatusManager
}

// NewClaudeStatusQuerier creates a new status querier
func NewClaudeStatusQuerier(manager *ClaudeStatusManager) *ClaudeStatusQuerier {
	return &ClaudeStatusQuerier{
		manager: manager,
	}
}

// GetPaneStatus returns the current status for a specific pane
func (q *ClaudeStatusQuerier) GetPaneStatus(paneID string) *ClaudePaneStatus {
	q.manager.mu.RLock()
	defer q.manager.mu.RUnlock()

	status, exists := q.manager.paneStatuses[paneID]
	if !exists {
		return nil
	}

	// Return a copy to prevent external modification
	return &ClaudePaneStatus{
		PaneID:            status.PaneID,
		Active:            status.Active,
		DurationText:      status.DurationText,
		LastKnownDuration: status.LastKnownDuration,
		LastActive:        status.LastActive,
		LastInactive:      status.LastInactive,
		LastChanged:       status.LastChanged,
	}
}

// GetAllStatuses returns current status for all tracked panes
func (q *ClaudeStatusQuerier) GetAllStatuses() map[string]*ClaudePaneStatus {
	q.manager.mu.RLock()
	defer q.manager.mu.RUnlock()

	statuses := make(map[string]*ClaudePaneStatus)
	for paneID, status := range q.manager.paneStatuses {
		statuses[paneID] = &ClaudePaneStatus{
			PaneID:            status.PaneID,
			Active:            status.Active,
			DurationText:      status.DurationText,
			LastKnownDuration: status.LastKnownDuration,
			LastActive:        status.LastActive,
			LastInactive:      status.LastInactive,
			LastChanged:       status.LastChanged,
		}
	}
	return statuses
}

// IsClaudePane determines if a pane is likely a Claude pane based on activity
func (q *ClaudeStatusQuerier) IsClaudePane(paneID string) bool {
	q.manager.mu.RLock()
	defer q.manager.mu.RUnlock()

	status, exists := q.manager.paneStatuses[paneID]
	if !exists {
		return false
	}

	// Consider a pane a Claude pane if it has shown activity at least once
	return !status.LastActive.IsZero()
}

// IsClaudePaneByType checks if a pane is a Claude pane based on shell type
// This is used by the UI to determine if highlighting should be applied
func (q *ClaudeStatusQuerier) IsClaudePaneByType(shellType string) bool {
	// Check if this is a Claude shell type
	return shellType == "claude"
}

// ShouldHighlight returns true if a pane should be highlighted (inactive Claude pane)
func (q *ClaudeStatusQuerier) ShouldHighlight(paneID string) bool {
	q.manager.mu.RLock()
	defer q.manager.mu.RUnlock()

	status, exists := q.manager.paneStatuses[paneID]

	// If we don't have status for this pane yet, it's not highlighted
	// The UI will handle highlighting based on shell type
	if !exists {
		return false
	}

	// If the pane is currently showing activity, don't highlight
	if status.Active {
		return false
	}

	// If it's a known Claude pane (has shown activity before) and is now inactive, highlight it
	shouldHighlight := q.isClaudePane(status)

	logger := log.Get()
	logger.Debug("ShouldHighlight check",
		"pane", paneID,
		"exists", exists,
		"isClaudePane", q.isClaudePane(status),
		"active", status.Active,
		"shouldHighlight", shouldHighlight)

	return shouldHighlight
}

// ShouldHighlightByType returns true if a Claude-type pane should be highlighted
// This is for Claude panes that we haven't seen activity from yet
func (q *ClaudeStatusQuerier) ShouldHighlightByType(paneID string, shellType string) bool {
	// First check if this is a Claude shell type
	if !q.IsClaudePaneByType(shellType) {
		return false
	}

	// Always get fresh data to determine highlighting
	if q.manager.monitor != nil {
		// Force fresh check
		q.manager.monitor.CheckPaneActivityNow(paneID)
		// Get fresh status from monitor
		freshStatus := q.manager.monitor.GetActivityStatus(paneID)
		if freshStatus != nil {
			// If active, don't highlight (show duration instead)
			// If inactive, highlight in orange
			return !freshStatus.Active
		}
	}

	// Fallback to cached data if no monitor available
	q.manager.mu.RLock()
	status, exists := q.manager.paneStatuses[paneID]
	q.manager.mu.RUnlock()

	if !exists {
		// No status info, assume should highlight
		return true
	}

	// Check notification-based states
	if status.HasPermissionRequest {
		// Claude is waiting for permission - highlight in orange
		return true
	}

	// If active (processing), don't highlight; if inactive or idle, highlight
	return !status.Active || status.IsIdle
}

// GetPaneDuration returns the duration text for a Claude pane
func (q *ClaudeStatusQuerier) GetPaneDuration(paneID string) string {
	// Direct synchronous read from monitor - no race condition
	if q.manager.monitor != nil {
		status := q.manager.monitor.GetActivityStatus(paneID)
		if status != nil {
			// Trust monitor data completely - don't fall back to cache
			// If Claude is active and has duration, return it
			if status.Active && status.DurationText != "" {
				return status.DurationText
			}
			// If inactive OR active with no duration, return empty
			// (Active with no duration happens during "Crafting...", "Precipitating...", etc.)
			return ""
		}
	}

	// Fallback to cached notification-based states ONLY if monitor has no data
	q.manager.mu.RLock()
	defer q.manager.mu.RUnlock()

	status, exists := q.manager.paneStatuses[paneID]
	if !exists {
		return ""
	}

	// Show special notification-based states
	if status.HasPermissionRequest {
		return "awaiting permission"
	}

	if status.IsIdle {
		return "idle"
	}

	// If active but no duration from monitor, show preserved duration from notifications
	// (this handles notification-based duration that doesn't come from pane scraping)
	if status.Active && status.DurationText != "" {
		return status.DurationText
	}

	return ""
}

// isClaudePane is an internal helper that assumes the lock is already held
func (q *ClaudeStatusQuerier) isClaudePane(status *ClaudePaneStatus) bool {
	return !status.LastActive.IsZero()
}