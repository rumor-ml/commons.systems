// navigation_list_items.go - List item management for navigation component

package ui

import (
	"strings"

	"github.com/charmbracelet/bubbles/list"
	"github.com/natb1/tui/internal/status"
	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
)

// ListItem implements the list.Item interface for navigation component
type ListItem struct {
	title       string
	description string
	Project     *model.Project
	Worktree    *model.Worktree
	IsWorktree  bool
	keyBinding  rune
	paneTarget  string // Tmux pane target (session:window.pane) for direct pane navigation
}

// Title returns the item title
func (i ListItem) Title() string { return i.title }

// Description returns the item description
func (i ListItem) Description() string { return i.description }

// FilterValue returns the value used for filtering
func (i ListItem) FilterValue() string { return i.title }

// ChordModifiers tracks which modifier keys are currently pressed
type ChordModifiers struct {
	Ctrl  bool
	Alt   bool
	Shift bool
}

// isBoringPaneTitle filters out uninteresting pane titles like hostnames
func isBoringPaneTitle(title string) bool {
	// For debugging: temporarily show more titles

	// Filter out hostname-like titles (ends with .local)
	if strings.HasSuffix(title, ".local") {
		return true
	}

	// Filter out generic session titles
	if strings.HasPrefix(title, "Session: ") {
		return true
	}

	// Filter out exact matches for shell names only
	boring := []string{"bash", "zsh", "sh", "fish", "tcsh", "csh"}
	for _, shell := range boring {
		if title == shell {
			return true
		}
	}

	// Show everything else for now to debug what's being captured
	return false
}

// DEPRECATED: Use ListBuilder.BuildListItems instead
func BuildListItems_DEPRECATED(projects []*model.Project, keyMgr *model.KeyBindingManager, tmuxPanes map[string]*terminal.TmuxPane, claudeStatus *status.ClaudeStatusManager) []list.Item {
	// This is deprecated - redirecting to new ListBuilder
	lb := NewListBuilder()
	return lb.BuildListItems(projects, keyMgr, tmuxPanes, claudeStatus)
}

// BuildListItems provides backward compatibility for tests - DEPRECATED
// All new code should use ListBuilder.BuildListItems directly
func BuildListItems(projects []*model.Project, keyMgr *model.KeyBindingManager, tmuxPanes map[string]*terminal.TmuxPane, claudeStatus *status.ClaudeStatusManager) []list.Item {
	lb := NewListBuilder()
	return lb.BuildListItems(projects, keyMgr, tmuxPanes, claudeStatus)
}