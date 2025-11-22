// navigation_pane_handler.go - Pane management functionality for navigation component

package ui

import (
	"time"

	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// NavigationPaneHandler handles pane discovery and change detection
type NavigationPaneHandler struct {
	logger         log.Logger
	hashHandler    *NavigationHashHandler
	lastPaneUpdate time.Time
}

// NewNavigationPaneHandler creates a new pane handler
func NewNavigationPaneHandler(hashHandler *NavigationHashHandler) *NavigationPaneHandler {
	return &NavigationPaneHandler{
		logger:      log.Get(),
		hashHandler: hashHandler,
	}
}

// ProcessPaneUpdate handles pane updates with debouncing and change detection
func (panh *NavigationPaneHandler) ProcessPaneUpdate(panes map[string]*terminal.TmuxPane, lastPanesHash *uint64, currentPanes map[string]*terminal.TmuxPane) (shouldUpdate bool, updateType string, newHash uint64) {
	// Debounce rapid updates to prevent flashing
	now := time.Now()
	if now.Sub(panh.lastPaneUpdate) < 50*time.Millisecond {
		return false, "", *lastPanesHash
	}

	// Calculate hash for change detection
	panesHash := panh.hashHandler.HashPanes(panes)

	// Skip update if panes haven't changed
	if panesHash == *lastPanesHash {
		return false, "", panesHash
	}

	// Check if panes actually changed to avoid unnecessary rebuilds
	panesStructurallyEqual := panh.panesEqual(currentPanes, panes)

	// Always update if we have Claude panes, since Claude status is tracked separately
	// and may change without the TmuxPane objects changing
	hasClaudePanes := panh.hasClaudePanes(panes)

	// If panes are structurally equal but we have Claude panes, still update for status changes
	if panesStructurallyEqual && hasClaudePanes {
		panh.lastPaneUpdate = now
		return true, "claude_status", panesHash
	}

	// If panes are structurally equal and no Claude panes, skip update
	if panesStructurallyEqual {
		return false, "", panesHash
	}

	panh.lastPaneUpdate = now
	return true, "normal", panesHash
}

// panesEqual compares two pane maps to see if they're effectively the same
func (panh *NavigationPaneHandler) panesEqual(old, new map[string]*terminal.TmuxPane) bool {
	if len(old) != len(new) {
		return false
	}

	for id, oldPane := range old {
		newPane, exists := new[id]
		if !exists {
			return false
		}

		// Compare relevant fields
		if oldPane.ShellType != newPane.ShellType ||
			oldPane.PaneTitle != newPane.PaneTitle ||
			oldPane.CurrentCommand != newPane.CurrentCommand ||
			oldPane.CurrentPath != newPane.CurrentPath {
			return false
		}

		// Compare project association by path
		if (oldPane.Project == nil) != (newPane.Project == nil) {
			return false
		}
		if oldPane.Project != nil && newPane.Project != nil {
			if oldPane.Project.Path != newPane.Project.Path {
				return false
			}
		}
	}

	return true
}

// hasClaudePanes checks if any panes are Claude panes
func (panh *NavigationPaneHandler) hasClaudePanes(panes map[string]*terminal.TmuxPane) bool {
	for _, pane := range panes {
		if pane.ShellType == model.ShellTypeClaude {
			return true
		}
	}
	return false
}

// OnlyClaudeStatusChanged checks if only Claude pane activity status changed
func (panh *NavigationPaneHandler) OnlyClaudeStatusChanged(oldPanes, newPanes map[string]*terminal.TmuxPane) bool {
	if oldPanes == nil || newPanes == nil {
		return false
	}

	// Quick check: if pane counts differ, it's not just a status change
	if len(oldPanes) != len(newPanes) {
		return false
	}

	// Check each pane to see what changed
	hasClaudePanes := false
	for paneID, newPane := range newPanes {
		oldPane, exists := oldPanes[paneID]
		if !exists {
			return false // New pane added
		}

		// Track if we have Claude panes
		if newPane.ShellType == model.ShellTypeClaude {
			hasClaudePanes = true
		}

		// Check if anything other than Claude status might have changed
		if oldPane.ShellType != newPane.ShellType ||
			oldPane.PaneTitle != newPane.PaneTitle ||
			oldPane.CurrentCommand != newPane.CurrentCommand ||
			oldPane.CurrentPath != newPane.CurrentPath {
			return false // Something else changed
		}

		// Check project association
		if (oldPane.Project == nil) != (newPane.Project == nil) {
			return false
		}
		if oldPane.Project != nil && newPane.Project != nil {
			if oldPane.Project.Path != newPane.Project.Path {
				return false
			}
		}
	}

	// Only return true if we have Claude panes (otherwise no status to change)
	return hasClaudePanes
}