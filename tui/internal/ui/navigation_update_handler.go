// navigation_update_handler.go - Update message handling for navigation component

package ui

import (
	tea "github.com/charmbracelet/bubbletea"
)

// NavigationUpdateHandler handles Bubble Tea message processing
type NavigationUpdateHandler struct {
	// Removed: logger field (no logging needed in this handler)
}

// NewNavigationUpdateHandler creates a new update handler
func NewNavigationUpdateHandler() *NavigationUpdateHandler {
	return &NavigationUpdateHandler{}
}

// ProcessMessage handles different types of Bubble Tea messages
func (uh *NavigationUpdateHandler) ProcessMessage(msg tea.Msg) (handled bool, cmd tea.Cmd, worktreeProgress *WorktreeProgress) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		// Removed: High-frequency DEBUG log (fires on every keypress)

		// Check for quit keys first
		if msg.Type == tea.KeyCtrlC || msg.String() == "ctrl+q" {
			// Removed: INFO log not useful in production
			return true, tea.Quit, nil
		}

		// Check for escape key to return to mux mode
		if msg.Type == tea.KeyEscape {
			// Return a command to switch back to mux mode
			return true, func() tea.Msg {
				return NavigationCancelMsg{}
			}, nil
		}

	case WorktreeProgressUpdateMsg:
		progress := &WorktreeProgress{
			InProgress:  msg.InProgress,
			ProjectName: msg.ProjectName,
		}
		return true, nil, progress
	}

	// Message not handled by this handler
	return false, nil, nil
}