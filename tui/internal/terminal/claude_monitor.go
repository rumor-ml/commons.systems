// Claude Pane Activity Monitor
//
// ## Metadata
//
// Purpose: Monitor tmux panes for Claude activity patterns and track active/inactive status.
// Provides real-time detection of Claude thinking/processing states through pattern matching
// of captured pane output.
//
// ### Instructions
//
// #### Tmux Integration
//
// ##### Pane Discovery
// Use tmux list-panes command to discover all available panes across sessions.
// Format: tmux list-panes -a -F "#{session_name}:#{window_index}.#{pane_index}"
//
// ##### Content Capture
// Use tmux capture-pane command to get visible pane content for pattern matching.
// Format: tmux capture-pane -p -t <pane_id>
//
// #### Pattern Detection
//
// ##### Activity Patterns
// Detect Claude activity using specific patterns observed in active Claude sessions:
// - Timing info: "(41s • 5.7k tokens • esc to interrupt)" - primary indicator
// - Text-only detection for reliable cross-terminal compatibility
//
// ##### Status Determination
// Pane is ACTIVE only when specific active patterns are detected.
// Pane is INACTIVE when no active patterns are present (default state).
// This approach avoids false positives from user input prompts and idle states.
//
// #### Monitoring Operation
//
// ##### Polling Interval
// Monitor panes every 1 second to detect activity state changes with responsive updates.
//
// ##### Status Tracking
// Maintain current activity status for each discovered pane.
// Detect and report status changes (active to inactive, inactive to active).
//
// ### Dependencies
//
// #### [Tmux](https://github.com/tmux/tmux)
// Terminal multiplexer providing pane management and content capture capabilities.
// Constrains implementation to tmux-specific commands and output formats.
//
// #### [Claude.AI Interface Patterns](../CLAUDE.md#claude-activity-awareness)
// Text patterns displayed by Claude during thinking/processing states.
// Constrains pattern detection to timing indicators with "esc to interrupt" text.
//
// ---

package terminal

import (
	"context"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/rumor-ml/log/pkg/log"
)

// Claude activity detection - SIMPLE pattern matching

var (
	// The key insight: Active Claude has "esc to interrupt" in timing patterns
	// This text-only detection is reliable across all terminal configurations


	// Timing pattern with "esc to interrupt" - must handle ANSI codes within the pattern
	// Allow ANSI escape sequences between words, duration prefix is optional
	// Allow additional content after "interrupt" (e.g., "· ctrl+t to show todos")
	// Allow newlines within the pattern (e.g., "(\nesc to interrupt · ctrl+t to show todos)")
	timingPattern = regexp.MustCompile(`(?s)\(.*?esc.*?to.*?interrupt.*?\)`)

	// Duration extraction from the timing pattern - handles both before and after positions
	// Allow newlines in patterns for both duration extraction methods
	durationBeforePattern = regexp.MustCompile(`(?s)\((\d+[hms](?:\d+[ms])?(?:\d+s)?)`)
	// Updated to capture full duration with spaces like "3m 1s" or "1h 15m 30s"
	durationAfterPattern  = regexp.MustCompile(`(?s)esc.*?to.*?interrupt.*?·\s*((?:\d+[hms]\s*)+)`)
)

// ClaudeActivityStatus represents the current activity status of a Claude pane
type ClaudeActivityStatus struct {
	Active       bool
	DurationText string // e.g., "41s", "116s", "2m15s"
}

// ClaudeMonitor monitors tmux panes for Claude activity patterns
type ClaudeMonitor struct {
	mu             sync.RWMutex
	paneStatuses   map[string]*ClaudeActivityStatus // pane ID -> activity status
	statusCallback func(paneID string, status *ClaudeActivityStatus)
	stopCh         chan struct{}
	running        bool
	pollInterval   time.Duration
	executor       TmuxExecutor
}

// NewClaudeMonitor creates a new Claude activity monitor
func NewClaudeMonitor(executor TmuxExecutor) *ClaudeMonitor {
	return &ClaudeMonitor{
		paneStatuses: make(map[string]*ClaudeActivityStatus),
		pollInterval: 1 * time.Second, // 1-second polling for responsive updates
		stopCh:       make(chan struct{}),
		executor:     executor,
	}
}

// SetStatusCallback sets the callback function for status changes
func (c *ClaudeMonitor) SetStatusCallback(callback func(paneID string, status *ClaudeActivityStatus)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.statusCallback = callback
}

// Start begins monitoring tmux panes for Claude activity
func (c *ClaudeMonitor) Start(ctx context.Context) error {
	c.mu.Lock()
	if c.running {
		c.mu.Unlock()
		return nil // Already running
	}
	c.running = true
	c.mu.Unlock()

	logger := log.Get()
	logger.Debug("Starting Claude activity monitor", "pollInterval", c.pollInterval)

	go c.monitorLoop(ctx)
	return nil
}

// Stop stops the monitoring loop
func (c *ClaudeMonitor) Stop() {
	c.mu.Lock()
	defer c.mu.Unlock()

	if !c.running {
		return // Already stopped
	}

	c.running = false
	close(c.stopCh)

	logger := log.Get()
	logger.Debug("Claude activity monitor stopped")
}

// IsActive returns the current activity status for a pane
func (c *ClaudeMonitor) IsActive(paneID string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	status, exists := c.paneStatuses[paneID]
	return exists && status != nil && status.Active
}

// GetActivityStatus returns the full activity status for a pane
func (c *ClaudeMonitor) GetActivityStatus(paneID string) *ClaudeActivityStatus {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if status, exists := c.paneStatuses[paneID]; exists {
		// Return a copy to avoid race conditions
		return &ClaudeActivityStatus{
			Active:       status.Active,
			DurationText: status.DurationText,
		}
	}
	return &ClaudeActivityStatus{Active: false, DurationText: ""}
}

// GetAllStatuses returns a copy of all current pane statuses
func (c *ClaudeMonitor) GetAllStatuses() map[string]bool {
	c.mu.RLock()
	defer c.mu.RUnlock()

	statuses := make(map[string]bool)
	for pane, status := range c.paneStatuses {
		if status != nil {
			statuses[pane] = status.Active
		}
	}
	return statuses
}

// monitorLoop runs the continuous monitoring process
func (c *ClaudeMonitor) monitorLoop(ctx context.Context) {
	logger := log.Get()
	ticker := time.NewTicker(c.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			logger.Debug("Claude monitor stopping due to context cancellation")
			return
		case <-c.stopCh:
			logger.Debug("Claude monitor stopping due to stop signal")
			return
		case <-ticker.C:
			c.checkAllPanes()
		}
	}
}

// SetClaudePanes sets the list of Claude panes to monitor
func (c *ClaudeMonitor) SetClaudePanes(paneIDs []string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Clear status for panes that are no longer Claude panes
	for existingID := range c.paneStatuses {
		found := false
		for _, newID := range paneIDs {
			if existingID == newID {
				found = true
				break
			}
		}
		if !found {
			delete(c.paneStatuses, existingID)
		}
	}

	// Add new Claude panes and check their activity immediately
	for _, paneID := range paneIDs {
		if _, exists := c.paneStatuses[paneID]; !exists {
			// Don't default to inactive - check activity immediately
			c.mu.Unlock() // Unlock before calling checkPaneActivity to avoid deadlock
			c.checkPaneActivity(paneID)
			c.mu.Lock() // Re-lock for next iteration
		}
	}

	logger := log.Get()
	logger.Debug("Updated Claude panes to monitor", "count", len(paneIDs))
}

// checkAllPanes checks all known Claude panes for activity
func (c *ClaudeMonitor) checkAllPanes() {
	c.mu.RLock()
	paneIDs := make([]string, 0, len(c.paneStatuses))
	for paneID := range c.paneStatuses {
		paneIDs = append(paneIDs, paneID)
	}
	c.mu.RUnlock()

	for _, paneID := range paneIDs {
		c.checkPaneActivity(paneID)
	}
}

// checkPaneActivity checks a specific pane for Claude activity
func (c *ClaudeMonitor) checkPaneActivity(paneID string) {
	logger := log.Get()

	content, err := c.capturePaneContent(paneID)
	if err != nil {
		logger.Debug("Failed to capture pane content", "pane", paneID, "error", err)
		return
	}

	status := c.detectClaudeActivityWithDuration(content)

	c.mu.Lock()
	previousStatus, existed := c.paneStatuses[paneID]
	c.paneStatuses[paneID] = status
	callback := c.statusCallback
	c.mu.Unlock()

	// Notify of status changes (either activity change or duration update)
	if !existed || previousStatus == nil ||
		previousStatus.Active != status.Active ||
		previousStatus.DurationText != status.DurationText {
		// Log activity changes at Debug level (only when active status changes, not duration)
		if !existed || previousStatus == nil || previousStatus.Active != status.Active {
			logger.Debug("Claude pane activity changed",
				"pane", paneID,
				"active", status.Active,
				"duration", status.DurationText)
		}
		// Removed: High-frequency duration update log (would fire every second while Claude is active)

		if callback != nil {
			callback(paneID, status)
		}
	}
}

// getAllTmuxPanes returns list of all pane IDs across all tmux sessions
func (c *ClaudeMonitor) getAllTmuxPanes() ([]string, error) {
	output, err := c.executor.Execute("list-panes", "-a", "-F", "#{session_name}:#{window_index}.#{pane_index}")
	if err != nil {
		return nil, err
	}

	panes := strings.Split(strings.TrimSpace(string(output)), "\n")
	var result []string
	for _, pane := range panes {
		if pane != "" {
			result = append(result, pane)
		}
	}
	return result, nil
}

// capturePaneContent captures the visible content of a tmux pane with ANSI codes
func (c *ClaudeMonitor) capturePaneContent(paneID string) (string, error) {
	// Use -e flag to preserve ANSI escape sequences for complete pattern matching
	output, err := c.executor.Execute("capture-pane", "-p", "-e", "-t", paneID)
	if err != nil {
		return "", err
	}
	return string(output), nil
}

// detectClaudeActivity checks if content contains Claude activity patterns
func (c *ClaudeMonitor) detectClaudeActivity(content string) bool {
	return c.detectClaudeActivityWithDuration(content).Active
}

// detectClaudeActivityWithDuration checks for Claude activity and extracts duration
func (c *ClaudeMonitor) detectClaudeActivityWithDuration(content string) *ClaudeActivityStatus {
	status := &ClaudeActivityStatus{Active: false, DurationText: ""}

	// First check the entire content for multi-line patterns
	if hasTimingPattern := timingPattern.MatchString(content); hasTimingPattern {
		status.Active = true
		// Extract duration if found - try both before and after patterns
		if durationMatches := durationBeforePattern.FindStringSubmatch(content); len(durationMatches) > 1 {
			status.DurationText = strings.TrimSpace(durationMatches[1])
		} else if durationMatches := durationAfterPattern.FindStringSubmatch(content); len(durationMatches) > 1 {
			status.DurationText = strings.TrimSpace(durationMatches[1])
		}
		return status
	}

	// If no multi-line match found, check each line individually for backward compatibility
	lines := strings.Split(content, "\n")

	// Check each line for the timing pattern with "esc to interrupt"
	for _, line := range lines {
		// Check if line has timing pattern with "esc to interrupt"
		hasTimingPattern := timingPattern.MatchString(line)

		if hasTimingPattern {
			status.Active = true
			// Extract duration if found - try both before and after patterns
			if durationMatches := durationBeforePattern.FindStringSubmatch(line); len(durationMatches) > 1 {
				status.DurationText = strings.TrimSpace(durationMatches[1])
			} else if durationMatches := durationAfterPattern.FindStringSubmatch(line); len(durationMatches) > 1 {
				status.DurationText = strings.TrimSpace(durationMatches[1])
			}
			break
		}
	}

	return status
}

// DetectClaudeActivity is a public method for testing
func (c *ClaudeMonitor) DetectClaudeActivity(content string) bool {
	return c.detectClaudeActivity(content)
}

// DetectClaudeActivityWithDuration is a public method for testing
func (c *ClaudeMonitor) DetectClaudeActivityWithDuration(content string) *ClaudeActivityStatus {
	return c.detectClaudeActivityWithDuration(content)
}

// CheckPaneActivityNow immediately checks a pane's activity status
func (c *ClaudeMonitor) CheckPaneActivityNow(paneID string) {
	c.checkPaneActivity(paneID)
}
