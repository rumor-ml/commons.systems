// claude_status_notifications.go - Notification handling for Claude status management

package status

import (
	"context"
	"path/filepath"
	"time"

	"github.com/natb1/tui/internal/terminal"
	"github.com/rumor-ml/log/pkg/log"
)

// ClaudeStatusNotificationHandler handles notifications and status updates
type ClaudeStatusNotificationHandler struct {
	manager *ClaudeStatusManager
}

// NewClaudeStatusNotificationHandler creates a new notification handler
func NewClaudeStatusNotificationHandler(manager *ClaudeStatusManager) *ClaudeStatusNotificationHandler {
	return &ClaudeStatusNotificationHandler{
		manager: manager,
	}
}

// Subscribe returns a channel that receives status updates
func (n *ClaudeStatusNotificationHandler) Subscribe() <-chan ClaudeStatusUpdate {
	n.manager.mu.Lock()
	defer n.manager.mu.Unlock()

	updateCh := make(chan ClaudeStatusUpdate, 10)
	n.manager.subscribers = append(n.manager.subscribers, updateCh)
	return updateCh
}

// onStatusChange is called by the monitor when a pane's status changes
func (n *ClaudeStatusNotificationHandler) onStatusChange(paneID string, status *terminal.ClaudeActivityStatus) {
	now := time.Now()

	update := ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       status.Active,
		DurationText: status.DurationText,
		Timestamp:    now,
	}

	// Send update to processing goroutine (non-blocking)
	select {
	case n.manager.updateCh <- update:
	default:
		// Channel full, drop update (shouldn't happen with large buffer)
		logger := log.Get()
		logger.Warn("Dropped status update due to full channel", "pane", paneID)
	}
}

// processUpdates processes status updates and notifies subscribers
func (n *ClaudeStatusNotificationHandler) processUpdates(ctx context.Context) {
	logger := log.Get()
	// Removed: Verbose INFO log (one-time startup message, not useful in production)

	for {
		select {
		case <-ctx.Done():
			logger.Info("Claude status manager stopping due to context cancellation")
			return
		case update, ok := <-n.manager.updateCh:
			if !ok {
				logger.Info("Claude status manager stopping due to closed update channel")
				return
			}

			n.handleStatusUpdate(update)
		}
	}
}

// isValidDuration checks if a duration string is meaningful (not "0m", "0s", or empty)
func isValidDuration(duration string) bool {
	return duration != "" && duration != "0m" && duration != "0s"
}

// handleStatusUpdate processes a single status update
func (n *ClaudeStatusNotificationHandler) handleStatusUpdate(update ClaudeStatusUpdate) {
	n.manager.mu.Lock()

	// Get or create pane status
	status, exists := n.manager.paneStatuses[update.PaneID]
	if !exists {
		status = &ClaudePaneStatus{
			PaneID: update.PaneID,
		}
		n.manager.paneStatuses[update.PaneID] = status
	}

	// Update status
	previousActive := status.Active
	previousDuration := status.DurationText
	status.Active = update.Active
	status.LastChanged = update.Timestamp

	// Duration update logic
	if update.Active {
		// Claude is active
		status.LastActive = update.Timestamp

		if isValidDuration(update.DurationText) {
			// New valid duration available - use it and remember it
			status.DurationText = update.DurationText
			status.LastKnownDuration = update.DurationText
		} else {
			// No valid duration in update (empty, "0m", or "0s") - clear duration
			status.DurationText = ""
		}
	} else {
		// Claude became inactive - reset duration immediately
		status.LastInactive = update.Timestamp
		status.DurationText = ""
		status.LastKnownDuration = ""
	}

	// Create a copy of subscribers list for notification
	subscribers := make([]chan ClaudeStatusUpdate, len(n.manager.subscribers))
	copy(subscribers, n.manager.subscribers)

	n.manager.mu.Unlock()

	// Log significant status changes
	if previousActive != update.Active || previousDuration != update.DurationText {
		logger := log.Get()
		logger.Debug("Claude pane status changed",
			"pane", update.PaneID,
			"active", update.Active,
			"duration", update.DurationText,
			"wasActive", previousActive,
			"previousDuration", previousDuration)
	}

	// Notify subscribers (non-blocking)
	for _, subscriber := range subscribers {
		select {
		case subscriber <- update:
		default:
			// Subscriber channel full, skip
		}
	}
}

// checkNotificationEvents queries recent notification events from the store
func (n *ClaudeStatusNotificationHandler) checkNotificationEvents() {
	if n.manager.notificationHandler == nil {
		return
	}

	logger := log.Get()

	// Query recent notifications
	notificationList, err := n.manager.notificationHandler.GetProjectNotifications("", 50)
	if err != nil {
		logger.Warn("Failed to query notifications", "error", err)
		return
	}

	// Group notifications by project
	projectNotifications := make(map[string]*ClaudeNotification)
	for _, notif := range notificationList {
		if notif.ProjectID != "" {
			// Keep the most recent notification per project
			if existing, ok := projectNotifications[notif.ProjectID]; !ok || notif.Timestamp.After(existing.Timestamp) {
				projectNotifications[notif.ProjectID] = notif
			}
		}
	}

	// Update pane statuses based on notifications
	n.manager.mu.Lock()
	defer n.manager.mu.Unlock()

	for projectID, notif := range projectNotifications {
		// Try to find the pane ID for this project
		var paneID string
		for projPath, pid := range n.manager.projectPaneMap {
			if projPath == projectID || filepath.Base(projPath) == projectID {
				paneID = pid
				break
			}
		}

		if paneID != "" {
			status, exists := n.manager.paneStatuses[paneID]
			if !exists {
				status = &ClaudePaneStatus{PaneID: paneID}
				n.manager.paneStatuses[paneID] = status
			}

			// Update notification-based status
			status.LastNotification = notif
			status.HasPermissionRequest = notif.Type == "tool_permission_request"
			status.IsIdle = notif.Type == "input_idle"

			logger.Debug("Updated pane notification status",
				"pane", paneID,
				"project", projectID,
				"notificationType", notif.Type,
				"hasPermission", status.HasPermissionRequest,
				"isIdle", status.IsIdle)
		}
	}
}