// Claude Pane Status Management
//
// ## Metadata
//
// Purpose: Manage and track Claude pane activity status for TUI display integration.
// Provides state management for Claude pane monitoring and status change notifications.
//
// ### Instructions
//
// #### Status Management
//
// ##### Pane Status Tracking
// Track activity status (active/inactive) for each Claude pane by pane ID.
// Maintain timestamps for last activity detection and status changes.
//
// ##### Status Change Detection
// Detect transitions between active and inactive states for each pane.
// Provide notifications when pane status changes to trigger TUI updates.
//
// #### TUI Integration
//
// ##### Status Queries
// Provide interface for TUI components to query current pane activity status.
// Return status information formatted for display highlighting decisions.
//
// ##### Highlighting Decisions
// Inactive panes require orange highlighting in TUI list items.
// Active panes display normal formatting without special highlighting.
//
// ### Dependencies
//
// #### [Claude Monitor](../terminal/claude_monitor.go)
// Activity detection service providing raw status updates from tmux monitoring.
// Constrains status management to activity patterns detected by monitor service.
//
// #### [TUI Navigation List](../ui/navigation_list.go)
// List component requiring status information for pane highlighting decisions.
// Constrains status interface to support existing TUI list item formatting.
//
// ---

package status

import (
	"context"
	"sync"

	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// Types are now handled in claude_status_types.go

// ClaudeStatusManager manages Claude pane activity status for TUI integration using delegation
type ClaudeStatusManager struct {
	mu                  sync.RWMutex
	paneStatuses        map[string]*ClaudePaneStatus
	monitor             *terminal.ClaudeMonitor
	notificationHandler *NotificationHandler
	updateCh            chan ClaudeStatusUpdate
	subscribers         []chan ClaudeStatusUpdate
	checkingPanes       map[string]bool   // Track panes currently being checked to avoid duplicates
	projectPaneMap      map[string]string // Maps project names to pane IDs
	
	// Delegated components
	querier             *ClaudeStatusQuerier
	notificationHandler2 *ClaudeStatusNotificationHandler
}

// Types are now handled in claude_status_types.go

// NewClaudeStatusManager creates a new Claude status manager
func NewClaudeStatusManager() *ClaudeStatusManager {
	// Find tmux executable
	tmuxPath := terminal.FindTmuxExecutable(log.Get())
	executor := terminal.NewRealTmuxExecutor(tmuxPath)

	manager := &ClaudeStatusManager{
		paneStatuses:   make(map[string]*ClaudePaneStatus),
		monitor:        terminal.NewClaudeMonitor(executor),
		updateCh:       make(chan ClaudeStatusUpdate, 100), // Buffered channel for updates
		subscribers:    make([]chan ClaudeStatusUpdate, 0),
		checkingPanes:  make(map[string]bool),
		projectPaneMap: make(map[string]string),
	}
	
	// Initialize delegated components
	manager.querier = NewClaudeStatusQuerier(manager)
	manager.notificationHandler2 = NewClaudeStatusNotificationHandler(manager)

	// Set up monitor callback
	manager.monitor.SetStatusCallback(manager.onStatusChange)

	return manager
}

// SetNotificationHandler sets the notification handler for querying Claude events
func (c *ClaudeStatusManager) SetNotificationHandler(handler *NotificationHandler) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.notificationHandler = handler
}

// Start begins monitoring Claude pane activity
func (c *ClaudeStatusManager) Start(ctx context.Context) error {
	logger := log.Get()
	logger.Info("Starting Claude status manager")

	// Start the underlying monitor
	if err := c.monitor.Start(ctx); err != nil {
		return err
	}

	// Start the update processing goroutine
	go c.processUpdates(ctx)

	return nil
}

// UpdateClaudePanes updates the list of Claude panes to monitor
func (c *ClaudeStatusManager) UpdateClaudePanes(panes map[string]*terminal.TmuxPane) {
	claudePaneIDs := []string{}
	c.mu.Lock()
	// Clear and rebuild project-pane mapping
	c.projectPaneMap = make(map[string]string)
	c.mu.Unlock()

	for paneID, pane := range panes {
		if pane.ShellType == model.ShellTypeClaude {
			claudePaneIDs = append(claudePaneIDs, paneID)
			// Map project name to pane ID if we can determine it
			if pane.Project != nil {
				c.mu.Lock()
				c.projectPaneMap[pane.Project.Path] = paneID
				c.mu.Unlock()
			}
		}
	}

	c.monitor.SetClaudePanes(claudePaneIDs)

	// Check for notification events for these panes
	go c.checkNotificationEvents()

	// Removed: High-frequency DEBUG logs (fire every second):
	// - "Updated Claude panes for monitoring"
	// - "Pane detected" (per-pane in loop)
}

// Stop stops the status manager and underlying monitor
func (c *ClaudeStatusManager) Stop() {
	logger := log.Get()
	logger.Info("Stopping Claude status manager")

	c.monitor.Stop()
	close(c.updateCh)
}

// GetPaneStatus returns the current status for a specific pane
func (c *ClaudeStatusManager) GetPaneStatus(paneID string) *ClaudePaneStatus {
	return c.querier.GetPaneStatus(paneID)
}

// GetAllStatuses returns current status for all tracked panes
func (c *ClaudeStatusManager) GetAllStatuses() map[string]*ClaudePaneStatus {
	return c.querier.GetAllStatuses()
}

// IsClaudePane determines if a pane is likely a Claude pane based on activity
func (c *ClaudeStatusManager) IsClaudePane(paneID string) bool {
	return c.querier.IsClaudePane(paneID)
}

// IsClaudePaneByType checks if a pane is a Claude pane based on shell type
// This is used by the UI to determine if highlighting should be applied
func (c *ClaudeStatusManager) IsClaudePaneByType(shellType string) bool {
	return c.querier.IsClaudePaneByType(shellType)
}

// ShouldHighlight returns true if a pane should be highlighted (inactive Claude pane)
func (c *ClaudeStatusManager) ShouldHighlight(paneID string) bool {
	return c.querier.ShouldHighlight(paneID)
}

// ShouldHighlightByType returns true if a Claude-type pane should be highlighted
// This is for Claude panes that we haven't seen activity from yet
func (c *ClaudeStatusManager) ShouldHighlightByType(paneID string, shellType string) bool {
	return c.querier.ShouldHighlightByType(paneID, shellType)
}

// GetPaneDuration returns the duration text for a Claude pane
func (c *ClaudeStatusManager) GetPaneDuration(paneID string) string {
	return c.querier.GetPaneDuration(paneID)
}

// isClaudePane is handled by the querier

// Subscribe returns a channel that receives status updates
func (c *ClaudeStatusManager) Subscribe() <-chan ClaudeStatusUpdate {
	return c.notificationHandler2.Subscribe()
}

// onStatusChange is called by the monitor when a pane's status changes
func (c *ClaudeStatusManager) onStatusChange(paneID string, status *terminal.ClaudeActivityStatus) {
	c.notificationHandler2.onStatusChange(paneID, status)
}

// processUpdates processes status updates and notifies subscribers
func (c *ClaudeStatusManager) processUpdates(ctx context.Context) {
	c.notificationHandler2.processUpdates(ctx)
}

// handleStatusUpdate is handled by the notification handler

// checkNotificationEvents is handled by the notification handler
func (c *ClaudeStatusManager) checkNotificationEvents() {
	c.notificationHandler2.checkNotificationEvents()
}
