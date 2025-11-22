// terminal.go - Terminal component with Bubble Tea viewport
//
// ## Metadata
//
// TUI terminal component providing terminal session rendering with Bubble Tea.
//
// ### Purpose
//
// Render terminal sessions using Bubble Tea viewport component, handle terminal input/output,
// and provide seamless integration with the multiplexer's PTY management while maintaining
// responsive user interaction and proper event handling.
//
// ### Instructions
//
// #### Terminal Rendering
//
// ##### Viewport Integration
//
// Use Bubble Tea viewport component to render terminal output with proper scrolling, text
// wrapping, and ANSI escape sequence handling for colors and formatting within the
// multiplexer interface.
//
// ##### Input Handling
//
// Capture and forward keyboard input to the active terminal session while preserving
// global hotkeys and mode switching functionality for seamless user experience.
//
// #### Session Integration
//
// ##### Output Display
//
// Display real-time output from terminal sessions with proper buffering and performance
// optimization to handle high-volume terminal output without degrading interface responsiveness.
//
// ##### Status Indication
//
// Show terminal session status, current working directory, and running processes with
// visual indicators that integrate with the overall multiplexer status system.
//
// ### Dependencies
//
// #### [ICF](https://github.com/rumor-ml/icf)
//
// Core framework providing component patterns and integration guidelines that inform
// the terminal component's design and interaction with other multiplexer components.

package ui

import (
	"time"

	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/natb1/tui/internal/terminal"
	"github.com/rumor-ml/log/pkg/log"
)

// TerminalComponent renders terminal sessions using delegation pattern
type TerminalComponent struct {
	viewport         viewport.Model
	emulator         *TerminalEmulator
	style            lipgloss.Style
	
	// Delegated components
	sessionManager   *TerminalSessionManager
	contentProcessor *TerminalContentProcessor
	inputHandler     *TerminalInputHandler

	// Fields for backward compatibility
	active           bool
	sessionID        string
	lastOutputLen    int
	worktreeProgress WorktreeProgress
}

// NewTerminalComponent creates a new terminal component
func NewTerminalComponent(manager terminal.ManagerInterface) *TerminalComponent {
	vp := viewport.New(80, 24)
	vp.Style = lipgloss.NewStyle() // No border or padding

	// Create terminal emulator to handle output properly
	emulator := NewTerminalEmulator(80, 24)

	// Create delegated components
	contentProcessor := NewTerminalContentProcessor(&vp, emulator, manager)
	inputHandler := NewTerminalInputHandler(manager)
	sessionManager := NewTerminalSessionManager(manager, contentProcessor, inputHandler)

	return &TerminalComponent{
		viewport:         vp,
		emulator:         emulator,
		style:            lipgloss.NewStyle(), // No border or padding
		sessionManager:   sessionManager,
		contentProcessor: contentProcessor,
		inputHandler:     inputHandler,
	}
}

// Init initializes the terminal component
func (tc *TerminalComponent) Init() tea.Cmd {
	return tea.Batch(
		tc.viewport.Init(),
		tc.startOutputPolling(),
	)
}

// Update handles messages for the terminal component
func (tc *TerminalComponent) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		// Window size changes are now handled by SetSize method called from renderer
		// This ensures terminal gets the correct allocated space, not full window size
		tc.viewport, cmd = tc.viewport.Update(msg)
		cmds = append(cmds, cmd)

	case tea.KeyMsg:
		if tc.sessionManager.IsActive() && tc.sessionManager.GetSessionID() != "" {
			// Forward input to terminal session
			cmds = append(cmds, tc.handleTerminalInput(msg))
		}
		// Don't pass KeyMsg to viewport - we handle terminal input directly
		return tc, tea.Batch(cmds...)

	case terminal.SessionCreatedMsg:
		// Debug log
		// fmt.Printf("[DEBUG] Terminal received SessionCreatedMsg: %s\n", msg.Session.ID)
		tc.sessionID = msg.Session.ID
		tc.sessionManager.SetSession(msg.Session.ID)
		if tc.emulator != nil {
			tc.emulator.Clear() // Clear emulator for new session
		}
		// Resize session will be handled by SetSize method called from renderer
		// This ensures proper coordination with layout
		tc.updateContent()
		// Set the terminal as active
		tc.active = true
		tc.sessionManager.SetActive(true)
		// Start polling for output immediately
		cmds = append(cmds, tc.startOutputPolling())
		// Also trigger an immediate output check
		cmds = append(cmds, func() tea.Msg {
			return TerminalOutputUpdateMsg{SessionID: tc.sessionManager.GetSessionID()}
		})

	case terminal.SessionTerminatedMsg:
		if msg.SessionID == tc.sessionManager.GetSessionID() {
			tc.sessionID = ""
			tc.sessionManager.SetSession("")
			tc.viewport.SetContent("Terminal session ended")
		}

	case TerminalOutputUpdateMsg:
		if msg.SessionID == tc.sessionManager.GetSessionID() && tc.sessionManager.IsActive() {
			tc.updateContent()
		}
		// Continue polling only if we have an active session
		if tc.sessionManager.GetSessionID() != "" && tc.sessionManager.IsActive() {
			cmds = append(cmds, tc.startOutputPolling())
		}

	case WorktreeProgressUpdateMsg:
		// Update worktree progress state
		logger := log.Get()
		logger.Info("Terminal received WorktreeProgressUpdateMsg",
			"inProgress", msg.InProgress,
			"projectName", msg.ProjectName)
		tc.worktreeProgress = WorktreeProgress{
			InProgress:  msg.InProgress,
			ProjectName: msg.ProjectName,
		}
	}

	// Update viewport
	tc.viewport, cmd = tc.viewport.Update(msg)
	cmds = append(cmds, cmd)

	return tc, tea.Batch(cmds...)
}

// View renders the terminal component
func (tc *TerminalComponent) View() string {
	// Log the worktree progress state with INFO level for debugging
	logger := log.Get()
	if tc.worktreeProgress.InProgress {
		logger.Info("Terminal View: showing worktree progress",
			"worktreeInProgress", tc.worktreeProgress.InProgress,
			"worktreeProject", tc.worktreeProgress.ProjectName)
	}

	// Check if we're creating a worktree
	if tc.worktreeProgress.InProgress {
		return tc.style.Render("Creating worktree for " + tc.worktreeProgress.ProjectName + "...")
	}

	if tc.sessionManager.GetSessionID() == "" {
		// Debug: log when we're waiting for session
		// fmt.Printf("[DEBUG] Terminal View: sessionID is empty\n")
		return tc.style.Render("Waiting for terminal session...")
	}

	// Always return the viewport content, even if empty
	content := tc.viewport.View()
	if content == "" {
		// If viewport is empty, show a message
		// fmt.Printf("[DEBUG] Terminal View: sessionID=%s but viewport is empty\n", tc.sessionManager.GetSessionID())
		return tc.style.Render("Terminal connected, waiting for output...")
	}
	return content
}

// hasNewOutput checks if there's new output since the last update
func (tc *TerminalComponent) hasNewOutput() bool {
	return tc.sessionManager.HasNewOutput()
}

// SetActive sets the focus state of the terminal component
func (tc *TerminalComponent) SetActive(active bool) {
	tc.sessionManager.SetActive(active)
}

// SetSession sets the active terminal session
func (tc *TerminalComponent) SetSession(sessionID string) {
	tc.sessionManager.SetSession(sessionID)
}

// Reset resets the terminal component state (used for testing buffer replacement)
func (tc *TerminalComponent) Reset() {
	tc.sessionManager.Reset()
	if tc.emulator != nil {
		tc.emulator.Clear()
	}
}

// updateContent updates the viewport content from the terminal session
func (tc *TerminalComponent) updateContent() {
	tc.sessionManager.UpdateContent()
}

// handleTerminalInput forwards keyboard input to the terminal session
func (tc *TerminalComponent) handleTerminalInput(msg tea.KeyMsg) tea.Cmd {
	return tc.inputHandler.HandleTerminalInput(msg)
}

// startOutputPolling starts polling for terminal output updates
func (tc *TerminalComponent) startOutputPolling() tea.Cmd {
	return tea.Tick(50*time.Millisecond, func(t time.Time) tea.Msg {
		return TerminalOutputUpdateMsg{SessionID: tc.sessionManager.GetSessionID()}
	})
}

// Message types are now handled in terminal_messages.go

// detectTUIApplication is now handled by the content processor

// SetSize sets the terminal component size and resizes all internal components
func (tc *TerminalComponent) SetSize(width, height int) {
	tc.viewport.Width = width
	tc.viewport.Height = height

	// Resize the terminal emulator
	if tc.emulator != nil {
		tc.emulator.Resize(width, height)
	}

	// Delegate to session manager for PTY resize
	tc.sessionManager.SetSize(width, height)
}

// Message types are now handled in terminal_messages.go
