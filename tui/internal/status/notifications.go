// Package status handles Claude Code notification hooks integration
package status

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/rumor-ml/log/pkg/log"
)

// NotificationHandler processes Claude Code notifications
type NotificationHandler struct {
	logger log.Logger
}

// ClaudeNotification represents a notification from Claude Code
type ClaudeNotification struct {
	Type      string                 `json:"type"`
	Message   string                 `json:"message"`
	Timestamp time.Time              `json:"timestamp"`
	SessionID string                 `json:"session_id,omitempty"`
	ProjectID string                 `json:"project_id,omitempty"`
	Data      map[string]interface{} `json:"data,omitempty"`
}

// NotificationTypes define the different types of notifications we handle
const (
	NotificationTypeToolPermission = "tool_permission_request"
	NotificationTypeInputIdle      = "input_idle"
	NotificationTypeActivity       = "claude_activity"
	NotificationTypeError          = "claude_error"
)

// NewNotificationHandler creates a new notification handler
func NewNotificationHandler() *NotificationHandler {
	return &NotificationHandler{
		logger: log.Get().WithComponent("notifications"),
	}
}

// ProcessNotification processes a Claude Code notification
func (nh *NotificationHandler) ProcessNotification(data []byte) error {
	var notification ClaudeNotification
	if err := json.Unmarshal(data, &notification); err != nil {
		return fmt.Errorf("failed to unmarshal notification: %w", err)
	}

	// Set timestamp if not provided
	if notification.Timestamp.IsZero() {
		notification.Timestamp = time.Now()
	}

	// Determine project ID if not provided
	if notification.ProjectID == "" {
		projectID, err := nh.detectProjectID()
		if err != nil {
			nh.logger.Warn("Failed to detect project ID", "error", err)
		} else {
			notification.ProjectID = projectID
		}
	}

	// Log the notification
	nh.logger.Info("Processing Claude notification",
		"type", notification.Type,
		"project", notification.ProjectID,
		"session", notification.SessionID)

	// Handle specific notification types
	switch notification.Type {
	case NotificationTypeToolPermission:
		return nh.handleToolPermissionRequest(&notification)
	case NotificationTypeInputIdle:
		return nh.handleInputIdle(&notification)
	case NotificationTypeActivity:
		return nh.handleActivity(&notification)
	case NotificationTypeError:
		return nh.handleError(&notification)
	default:
		nh.logger.Warn("Unknown notification type", "type", notification.Type)
	}

	return nil
}

// detectProjectID attempts to detect the current project ID
func (nh *NotificationHandler) detectProjectID() (string, error) {
	// Try to get project from current working directory
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}

	// Look for project indicators
	if _, err := os.Stat(filepath.Join(cwd, "CLAUDE.md")); err == nil {
		// Use directory name as project ID
		return filepath.Base(cwd), nil
	}

	// Try parent directories
	parent := filepath.Dir(cwd)
	for parent != "/" && parent != "." && parent != cwd {
		if _, err := os.Stat(filepath.Join(parent, "CLAUDE.md")); err == nil {
			return filepath.Base(parent), nil
		}
		cwd = parent
		parent = filepath.Dir(parent)
	}

	return "", fmt.Errorf("no project found")
}

// logNotification logs the notification (no longer stored in database)
func (nh *NotificationHandler) logNotification(notification *ClaudeNotification) {
	// Just log the notification instead of storing it
	nh.logger.Info("Claude notification received",
		"session_id", notification.SessionID,
		"timestamp", notification.Timestamp,
		"type", notification.Type,
		"message", notification.Message,
		"project_id", notification.ProjectID)
}

// handleToolPermissionRequest handles tool permission requests
func (nh *NotificationHandler) handleToolPermissionRequest(notification *ClaudeNotification) error {
	nh.logger.Info("Claude tool permission requested",
		"project", notification.ProjectID,
		"message", notification.Message)

	// Update project metadata to indicate Claude is requesting permissions
	// This can be displayed in the TUI to show Claude activity
	return nil
}

// handleInputIdle handles input idle notifications
func (nh *NotificationHandler) handleInputIdle(notification *ClaudeNotification) error {
	nh.logger.Info("Claude input idle",
		"project", notification.ProjectID,
		"message", notification.Message)

	// Update project status to indicate Claude is waiting for input
	// This can be used to show visual indicators in the TUI
	return nil
}

// handleActivity handles general Claude activity notifications
func (nh *NotificationHandler) handleActivity(notification *ClaudeNotification) error {
	nh.logger.Info("Claude activity detected",
		"project", notification.ProjectID,
		"message", notification.Message)

	// Update project status to indicate Claude is active
	return nil
}

// handleError handles Claude error notifications
func (nh *NotificationHandler) handleError(notification *ClaudeNotification) error {
	nh.logger.Error("Claude error reported",
		"project", notification.ProjectID,
		"message", notification.Message)

	// Store error information for display in TUI
	return nil
}

// GetProjectNotifications retrieves recent notifications for a project
// Note: Without database persistence, this now returns an empty list
func (nh *NotificationHandler) GetProjectNotifications(projectID string, limit int) ([]*ClaudeNotification, error) {
	// Without database, we can't retrieve historical notifications
	// Return empty list - only current session notifications would be available
	return []*ClaudeNotification{}, nil
}

// GetLatestActivity returns the latest Claude activity for display in TUI
func (nh *NotificationHandler) GetLatestActivity() (*ClaudeNotification, error) {
	notifications, err := nh.GetProjectNotifications("", 1)
	if err != nil {
		return nil, err
	}

	if len(notifications) == 0 {
		return nil, nil
	}

	return notifications[0], nil
}
