// manager.go - Bubble Tea UI manager and layout system
//
// ## Metadata
//
// TUI UI manager coordinating all Bubble Tea components and layout rendering.
//
// ### Purpose
//
// Coordinate multiple Bubble Tea components based on current mode, manage layout transitions,
// and provide unified event handling for the entire user interface while maintaining component
// isolation and proper focus management.
//
// ### Instructions
//
// #### Layout Management
//
// ##### Mode-Based Rendering
//
// Render different component layouts based on current mode: terminal focus (full-screen terminal
// with overlay), assistant focus (dashboard with terminal sidebar), and split view (balanced
// terminal and assistant panels).
//
// ##### Component Coordination
//
// Manage focus between components, route events to appropriate handlers, and maintain consistent
// state across all UI elements during mode transitions and user interactions.
//
// #### Event Routing
//
// ##### Focus Management
//
// Track which component currently has focus and route keyboard events appropriately while
// maintaining global hotkey functionality for mode switching and application control.
//
// ##### Mouse Event Handling
//
// Route mouse events to components based on cursor position and current layout, enabling
// intuitive interaction with both terminal sessions and assistant interface elements.
//
// ### Dependencies
//
// #### [ICF](https://github.com/rumor-ml/icf)
//
// Core framework providing UI patterns and component architecture principles that guide
// the overall interface design and interaction patterns.

package ui

import (
	tea "github.com/charmbracelet/bubbletea"
)

// Manager coordinates all UI components and layouts using delegation pattern
type Manager struct {
	components  map[string]tea.Model
	layout      *Layout
	keymap      *GlobalKeyMap
	keyBindings *KeyBindingRegistry
	focus       string // Track which component has focus
	width       int
	height      int

	// Delegated handlers
	keyHandler     *ManagerKeyHandler
	messageRouter  *ManagerMessageRouter
	layoutHandler  *ManagerLayoutHandler
	mouseHandler   *ManagerMouseHandler

	// Path input state
	pathInputActive bool
	pathInputBuffer string
}

// GetKeyMap returns the global keymap for access from controller
func (m *Manager) GetKeyMap() *GlobalKeyMap {
	return m.keymap
}

// GetKeyBindings returns the key binding registry
func (m *Manager) GetKeyBindings() *KeyBindingRegistry {
	return m.keyBindings
}

// GetNavigationComponent returns the navigation component
func (m *Manager) GetNavigationComponent() *NavigationComponent {
	if nav, exists := m.components["navigation"]; exists {
		if navComp, ok := nav.(*NavigationComponent); ok {
			return navComp
		}
	}
	return nil
}

// Layout defines the current UI layout configuration
type Layout struct {
	regions    map[string]Region
	focusOrder []string
}

// Region defines a rectangular area for component rendering
type Region struct {
	X      int
	Y      int
	Width  int
	Height int
}

// NewManager creates a new UI manager with delegation pattern
func NewManager() *Manager {
	manager := &Manager{
		components:  make(map[string]tea.Model),
		layout:      &Layout{},
		keymap:      NewGlobalKeyMap(),
		keyBindings: NewKeyBindingRegistry(),
	}

	// Initialize components
	// Use simple terminal component since tmux handles actual terminals
	terminalComp := NewSimpleTerminalComponent()
	logsComp := NewLogsComponent()
	navComp := NewNavigationComponent()
	devServerComp := NewDevServerStatusComponent(0, 1)
	helpComp := NewHelpComponentWithBindings(manager.keyBindings)

	// Connect logs component to navigation for display
	navComp.SetLogsComponent(logsComp)

	manager.components["terminal"] = terminalComp
	manager.components["logs"] = logsComp
	manager.components["navigation"] = navComp
	manager.components["devServerStatus"] = devServerComp
	manager.components["help"] = helpComp

	// Set initial focus to navigation
	manager.focus = "navigation"

	// Create delegated handlers
	manager.keyHandler = NewManagerKeyHandler(manager.components, manager.keyBindings, &manager.focus)
	manager.keyHandler.SetManager(manager) // Set back reference for path input handling
	manager.messageRouter = NewManagerMessageRouter(manager.components)
	manager.layoutHandler = NewManagerLayoutHandler(manager.layout, manager.components, &manager.width, &manager.height)
	manager.mouseHandler = NewManagerMouseHandler(manager.components, manager.layoutHandler)

	return manager
}

// Init initializes the UI manager
func (m *Manager) Init() tea.Cmd {
	// Initialize components
	var cmds []tea.Cmd

	// Initialize all components
	for _, component := range m.components {
		if initCmd := component.Init(); initCmd != nil {
			cmds = append(cmds, initCmd)
		}
	}

	m.layoutHandler.UpdateLayout()
	return tea.Batch(cmds...)
}

// View renders the current UI based on mode and layout
func (m *Manager) View() string {
	// Force default size if not set
	if m.width == 0 {
		m.width = 120
	}
	if m.height == 0 {
		m.height = 40
	}

	// Ensure layout is set up for the current mode
	if len(m.layout.regions) == 0 {
		m.layoutHandler.UpdateLayout()
	}

	// Always render navigation mode (navigation is always visible)
	return m.renderNavigationMode()
}

// HandleKey routes keyboard events to appropriate components using delegation
func (m *Manager) HandleKey(msg tea.KeyMsg) tea.Cmd {
	return m.keyHandler.HandleKey(msg)
}

// Update routes messages to all components using delegation
func (m *Manager) Update(msg tea.Msg) tea.Cmd {
	return m.messageRouter.RouteMessage(msg)
}

// HandleMouse routes mouse events to appropriate components using delegation
func (m *Manager) HandleMouse(msg tea.MouseMsg) tea.Cmd {
	return m.mouseHandler.HandleMouse(msg)
}

// HandleResize updates layout for new terminal size using delegation
func (m *Manager) HandleResize(msg tea.WindowSizeMsg) tea.Cmd {
	return m.layoutHandler.HandleResize(msg)
}

// SetActiveTerminalSession is no longer needed with tmux
func (m *Manager) SetActiveTerminalSession(sessionID string) {
	// No-op - tmux handles sessions
}

// GetLogsComponent returns the logs component for logging integration
func (m *Manager) GetLogsComponent() *LogsComponent {
	if logsComp, exists := m.components["logs"]; exists {
		if lc, ok := logsComp.(*LogsComponent); ok {
			return lc
		}
	}
	return nil
}

// GetLogComponent returns the logs component for logging integration (alias)
func (m *Manager) GetLogComponent() *LogsComponent {
	return m.GetLogsComponent()
}

// GetDevServerStatusComponent returns the dev server status component
func (m *Manager) GetDevServerStatusComponent() *DevServerStatusComponent {
	if devComp, exists := m.components["devServerStatus"]; exists {
		if dc, ok := devComp.(*DevServerStatusComponent); ok {
			return dc
		}
	}
	return nil
}

// ShowPathInputModal shows the path input modal
func (m *Manager) ShowPathInputModal() {
	m.pathInputActive = true
	m.pathInputBuffer = "/"
}

// StartPathInput starts path input mode for dev server
func (m *Manager) StartPathInput() {
	m.pathInputActive = true
	m.pathInputBuffer = "/"
	// Update dev server status to show input mode
	if devStatus, ok := m.components["devServerStatus"].(*DevServerStatusComponent); ok {
		devStatus.SetInputMode(true, m.pathInputBuffer)
	}
}

// IsPathInputActive returns whether path input mode is active
func (m *Manager) IsPathInputActive() bool {
	return m.pathInputActive
}

// GetPathInputBuffer returns the current path input buffer
func (m *Manager) GetPathInputBuffer() string {
	return m.pathInputBuffer
}
