// navigation_list.go - Bubble Tea list-based navigation component
//
// ## Metadata
//
// TUI navigation component using Bubble Tea list component for project navigation
// with comprehensive shell display including unicode icons and real-time pane titles.
//
// ### Purpose
//
// Provide an interactive list view of all tmux panes organized by project and worktree with
// direct navigation to specific panes, comprehensive pane information display, and shell type
// classification without exposing tmux session/window hierarchy.
//
// ### Instructions
//
// #### Individual Pane Display
//
// ##### Pane-Level Navigation
//
// Display every tmux pane as a separate selectable item organized by project/worktree/shell type,
// enabling direct navigation to specific panes within their containing windows.
//
// ##### Pane Information Priority
//
// Show pane information in priority order: pane title (priority 1), last command executed
// for zsh shells (priority 2), current running command (priority 3) for meaningful identification.
//
// ##### Shell Type Organization
//
// Organize panes by detected shell type (zsh, claude, other) using unicode icons: ⚡ for zsh,
// 🤖 for claude, no icon for other types, without exposing session/window hierarchy.
//
// #### Pane Selection Behavior
//
// ##### Direct Pane Targeting
//
// When user selects a pane, attach to the containing tmux window and focus the specific
// pane using tmux select-pane commands for immediate pane access.
//
// ##### Unknown Pane Handling
//
// Include panes from unmapped tmux sessions in "Other Sessions" project grouping,
// ensuring all tmux activity is visible and navigable through the interface.
//
// #### List Integration
//
// ##### Project Display
//
// Display projects and worktrees in a hierarchical list structure with proper indentation,
// color coding, and status indicators while maintaining a compact 30-character width layout.
//
// ##### Keyboard Navigation
//
// Support vim-like two-key sequences where first key selects project (i=assistant, f=icf, h=health,
// n=finance) and second key selects action (c=claude, z=zsh, C=claude+new worktree, Z=zsh+new worktree).
//
// #### Visual Design
//
// ##### Color Differentiation
//
// Use bright colors for parent projects and dimmer colors for worktrees, with special
// highlighting for selected items and active status indicators for running shells.
//
// ##### Compact Layout
//
// Ensure all content fits within the 30-character navigation panel width by using concise
// labels, single-character keybindings, and abbreviated status indicators.
//
// ##### Claude Pane Highlighting
//
// Apply orange highlighting to existing Claude pane list items when they are inactive
// (no orange activity text detected). Modify existing list item styles rather than
// creating new UI elements.
//
// ### Dependencies
//
// #### [ICF](https://github.com/rumor-ml/icf)
//
// Core framework providing component patterns and project organization principles.
//
// #### [Claude Monitor](../terminal/claude_monitor.go)
//
// Activity detection service providing Claude pane status for highlighting decisions.
// Constrains highlighting logic to activity patterns detected by monitoring service.
//
// #### [Claude Status](../status/claude_status.go)
//
// Status management service providing current activity state for each Claude pane.
// Constrains TUI highlighting to status information provided by management service.

package ui

import (
	"context"
	"strings"

	"github.com/charmbracelet/bubbles/list"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
	"github.com/natb1/tui/internal/status"
	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
)

// Navigation component using delegation pattern for better organization

// NavigationListComponent provides list-based navigation using delegation pattern
type NavigationListComponent struct {
	list             list.Model
	projectManager   *NavigationProjectManager
	claudeIntegration *NavigationClaudeIntegration
	sequenceHandler  *KeySequenceHandler
	width            int
	height           int

	// Direct references for backward compatibility
	projects      []*model.Project
	claudeStatus  *status.ClaudeStatusManager
	logsComponent *LogsComponent // Reference to logs component
}

// NewNavigationListComponent creates a new list-based navigation component
func NewNavigationListComponent() *NavigationListComponent {
	// Ensure lipgloss uses proper color profile for terminal
	lipgloss.SetColorProfile(termenv.TrueColor)

	// Start with empty projects - they will be set via SetProjects
	var projects []*model.Project

	// Initialize keybinding manager
	keyMgr := model.NewKeyBindingManager()

	// Initialize list builder
	listBuilder := NewListBuilder()

	// Initialize Claude status manager
	claudeStatus := status.NewClaudeStatusManager()

	// Initialize delegated components
	projectManager := NewNavigationProjectManager(keyMgr, listBuilder, claudeStatus)
	claudeIntegration := NewNavigationClaudeIntegration(claudeStatus)
	sequenceHandler := NewKeySequenceHandler()

	// Build list items with placeholder
	items := listBuilder.BuildListItems(projects, keyMgr, nil, claudeStatus)

	// Use simple delegate like the working POC
	delegate := list.NewDefaultDelegate()
	delegate.ShowDescription = false
	delegate.SetHeight(1)
	delegate.SetSpacing(0)

	// Simple styles that preserve colors (like POC)
	delegate.Styles.NormalTitle = lipgloss.NewStyle().PaddingLeft(1)
	delegate.Styles.SelectedTitle = lipgloss.NewStyle().PaddingLeft(1).Background(lipgloss.Color("240"))

	// Create the list
	l := list.New(items, delegate, 30, 20)

	// Don't show title - logs section will be at the top
	l.SetShowTitle(false) // Don't show built-in title - logs are at top
	l.SetShowStatusBar(false)
	l.SetShowPagination(false)
	l.SetShowHelp(false)       // Help is in main panel
	l.DisableQuitKeybindings() // We handle quit globally

	// Ensure no background colors bleed through
	// Add padding at the top to leave room for logs (6 lines)
	l.Styles.TitleBar = lipgloss.NewStyle().Padding(6, 0, 0, 0)
	l.Styles.StatusBar = lipgloss.NewStyle()
	l.Styles.PaginationStyle = lipgloss.NewStyle()
	l.Styles.HelpStyle = lipgloss.NewStyle()

	return &NavigationListComponent{
		list:              l,
		projectManager:    projectManager,
		claudeIntegration: claudeIntegration,
		sequenceHandler:   sequenceHandler,
		width:             30,
		height:            20,
		// Backward compatibility references
		projects:     projects,
		claudeStatus: claudeStatus,
	}
}




// These functions are now handled in navigation_list_items.go


// Init initializes the component
func (n *NavigationListComponent) Init() tea.Cmd {
	return nil
}

// Update handles messages
func (n *NavigationListComponent) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		// Don't handle window size messages directly - let the parent manager
		// set our size through SetSize() to respect the layout
		// This ensures logs and help sections are preserved
		return n, nil

	case tea.KeyMsg:
		// Check for quit keys first
		if msg.Type == tea.KeyCtrlC || msg.String() == "ctrl+q" {
			// Removed: INFO log not useful in production
			return n, tea.Quit
		}

		// Handle vim-like key sequences
		cmd = n.sequenceHandler.HandleKeySequence(msg)
		if cmd != nil {
			return n, cmd
		}

		// Remove test code that was interfering with normal operation

		// Handle special navigation keys
		switch msg.String() {
		case "enter":
			// Enter key switches to mux mode without modifiers
			return n, func() tea.Msg { return SwitchToMuxMsg{} }
		case "esc":
			// Escape key: clear sequence state or switch to mux mode
			if n.sequenceHandler.IsInSequence() {
				n.sequenceHandler.ClearSequence()
				return n, nil // Stay in navigation mode but clear sequence
			}
			// If no sequence active, switch to mux mode
			return n, func() tea.Msg { return SwitchToMuxMsg{} }
		}

		// Pass other keys to list for normal navigation
		n.list, cmd = n.list.Update(msg)
		if cmd != nil {
			cmds = append(cmds, cmd)
		}
	}

	return n, tea.Batch(cmds...)
}

// View renders the component
func (n *NavigationListComponent) View() string {
	// Get the list view
	// Note: Logs are now handled by the renderer in renderNavigationMode, not here
	// This eliminates the duplicate logs issue
	listView := n.list.View()

	// Ensure we don't exceed our allocated height
	lines := strings.Split(listView, "\n")
	if len(lines) > n.height {
		lines = lines[:n.height]
		listView = strings.Join(lines, "\n")
	}

	return listView
}





// Message types are now handled in navigation_messages.go

// createStubProjects is now handled in navigation_project_manager.go

// SetSize sets the component size
func (n *NavigationListComponent) SetSize(width, height int) {
	n.width = width // Use full width
	n.height = height
	// If we're showing logs, reduce list height by 6 lines
	listHeight := n.height
	if n.height > 20 && n.logsComponent != nil {
		listHeight = n.height - 6
	}
	n.list.SetSize(n.width, listHeight)
}

// SetLogsComponent sets the logs component for display
func (n *NavigationListComponent) SetLogsComponent(logs *LogsComponent) {
	n.logsComponent = logs
}

// SetProjects updates the navigation with real discovered projects
func (n *NavigationListComponent) SetProjects(projects []*model.Project) {
	// Removed: Verbose INFO logs not useful in production

	// Delegate to project manager
	deduplicatedProjects := n.projectManager.SetProjects(projects)

	// Update backward compatibility reference
	n.projects = deduplicatedProjects

	// Update Claude integration with projects
	n.claudeIntegration.SetProjects(deduplicatedProjects)

	// Update sequence handler with new projects
	n.sequenceHandler.SetProjects(deduplicatedProjects, n.projectManager.GetKeyBindingManager())

	// Rebuild list items with deduplicated projects
	items := n.projectManager.BuildListItems(nil)

	// Convert []interface{} back to []list.Item for the list
	listItems := make([]list.Item, len(items))
	for i, item := range items {
		listItems[i] = item.(ListItem)
	}
	n.list.SetItems(listItems)

	// Force list to refresh - sometimes needed with Bubble Tea
	// Reset the list to ensure it updates
	n.list.Select(0)
}

// SetProjectsAndPanes updates the navigation with projects and tmux panes
func (n *NavigationListComponent) SetProjectsAndPanes(projects []*model.Project, tmuxPanes map[string]*terminal.TmuxPane) {
	// Delegate to project manager
	processedProjects := n.projectManager.SetProjectsAndPanes(projects, tmuxPanes)

	// Update backward compatibility reference
	n.projects = processedProjects

	// Update Claude integration with projects
	n.claudeIntegration.SetProjects(processedProjects)

	// Update sequence handler with new projects
	n.sequenceHandler.SetProjects(processedProjects, n.projectManager.GetKeyBindingManager())

	// Rebuild list items with tmux panes
	items := n.projectManager.BuildListItems(tmuxPanes)

	// Convert []interface{} back to []list.Item for the list
	listItems := make([]list.Item, len(items))
	for i, item := range items {
		listItems[i] = item.(ListItem)
	}
	n.list.SetItems(listItems)

	// Reset the list to ensure it updates
	n.list.Select(0)
}

// UpdateTmuxPanes updates only the tmux pane mappings after layout changes
func (n *NavigationListComponent) UpdateTmuxPanes(tmuxPanes map[string]*terminal.TmuxPane) {
	// Update panes in project manager
	if n.projectManager != nil {
		n.projectManager.UpdatePanes(tmuxPanes)
	}

	// Rebuild list items with updated panes
	items := n.projectManager.BuildListItems(tmuxPanes)

	// Update the list
	listItems := make([]list.Item, len(items))
	for i, item := range items {
		listItems[i] = item.(ListItem)
	}
	n.list.SetItems(listItems)

	// Force refresh
	n.list.Select(n.list.Index())
}

// RefreshDisplay rebuilds the list items with current project data
func (n *NavigationListComponent) RefreshDisplay() {
	// Rebuild list items with current projects using project manager
	items := n.projectManager.BuildListItems(nil)

	// Convert []interface{} back to []list.Item for the list
	listItems := make([]list.Item, len(items))
	for i, item := range items {
		listItems[i] = item.(ListItem)
	}
	n.list.SetItems(listItems)
}

// GetSequenceStatus returns the current sequence status for help display
func (n *NavigationListComponent) GetSequenceStatus() (bool, string) {
	return n.sequenceHandler.GetSequenceStatus()
}

// StartClaudeMonitoring starts the Claude activity monitoring service
func (n *NavigationListComponent) StartClaudeMonitoring(ctx context.Context) error {
	return n.claudeIntegration.StartClaudeMonitoring(ctx)
}

// StopClaudeMonitoring stops the Claude activity monitoring service
func (n *NavigationListComponent) StopClaudeMonitoring() {
	n.claudeIntegration.StopClaudeMonitoring()
}

// GetClaudeStatusManager returns the ClaudeStatusManager for external configuration
func (n *NavigationListComponent) GetClaudeStatusManager() *status.ClaudeStatusManager {
	return n.claudeIntegration.GetClaudeStatusManager()
}

// guessAltCharacterFromContext attempts to guess which Alt+letter combination
// was pressed by looking at available project keybindings
func (n *NavigationListComponent) guessAltCharacterFromContext(inputRune rune) rune {
	return n.claudeIntegration.guessAltCharacterFromContext(inputRune)
}

// UpdatePanesOnly is implemented in navigation_list_panes.go

// GetKeyBindingManager returns the key binding manager for backward compatibility
func (n *NavigationListComponent) GetKeyBindingManager() *model.KeyBindingManager {
	return n.projectManager.GetKeyBindingManager()
}

