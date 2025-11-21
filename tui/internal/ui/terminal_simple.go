// terminal_simple.go - Simplified terminal component for tmux-based flow
//
// ## Metadata
//
// TUI simplified terminal component for tmux-based architecture.
//
// ### Purpose
//
// Provide a minimal terminal component that displays status messages and worktree
// creation progress, since all actual terminal functionality is handled by tmux.
//
// ### Instructions
//
// #### Status Display
//
// Show appropriate messages based on application state, including worktree creation
// progress and waiting states, without managing any actual terminal sessions.
//
// ### Dependencies
//
// #### [ICF](https://github.com/rumor-ml/icf)
//
// Core framework providing component patterns.

package ui

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/rumor-ml/log/pkg/log"
)

// SimpleTerminalComponent just shows status messages
type SimpleTerminalComponent struct {
	width            int
	height           int
	style            lipgloss.Style
	worktreeProgress WorktreeProgress
	message          string
}

// NewSimpleTerminalComponent creates a new simplified terminal component
func NewSimpleTerminalComponent() *SimpleTerminalComponent {
	return &SimpleTerminalComponent{
		style:   lipgloss.NewStyle(),
		message: "Select a project to open terminal session",
	}
}

// Init initializes the component
func (tc *SimpleTerminalComponent) Init() tea.Cmd {
	return nil
}

// Update handles messages
func (tc *SimpleTerminalComponent) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		tc.width = msg.Width
		tc.height = msg.Height

	case WorktreeProgressUpdateMsg:
		tc.worktreeProgress = WorktreeProgress{
			InProgress:  msg.InProgress,
			ProjectName: msg.ProjectName,
		}
	}

	return tc, nil
}

// View renders the component
func (tc *SimpleTerminalComponent) View() string {
	logger := log.Get()
	// Don't log on every View() call - this happens on every render frame

	// Check if we're creating a worktree
	if tc.worktreeProgress.InProgress {
		result := tc.style.
			Width(tc.width).
			Height(tc.height).
			Align(lipgloss.Center, lipgloss.Center).
			Render("Creating worktree for " + tc.worktreeProgress.ProjectName + "...")
		logger.Info("SimpleTerminalComponent returning worktree progress", "length", len(result))
		return result
	}

	// Default message
	result := tc.style.
		Width(tc.width).
		Height(tc.height).
		Align(lipgloss.Center, lipgloss.Center).
		Render(tc.message)
	logger.Info("SimpleTerminalComponent returning default message", "length", len(result))
	return result
}

// SetSize sets the component size
func (tc *SimpleTerminalComponent) SetSize(width, height int) {
	tc.width = width
	tc.height = height
}

// SetMessage sets the display message
func (tc *SimpleTerminalComponent) SetMessage(message string) {
	tc.message = message
}
