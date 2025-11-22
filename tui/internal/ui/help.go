// help.go - Bubble Tea help component
//
// ## Metadata
//
// TUI help component using Bubble Tea help component for keybinding display.
//
// ### Purpose
//
// Provide a consistent help display showing available keybindings and commands using the
// charmbracelet/bubbles help component, with support for dynamic help based on current
// application state and mode.
//
// ### Instructions
//
// #### Help Display
//
// ##### Keybinding Organization
//
// Organize keybindings into logical groups and display them using the bubbles help
// component's built-in formatting, ensuring consistent styling and compact display.
//
// ##### Dynamic Help
//
// Update help content based on current application mode and context, showing only
// relevant keybindings for the current state while maintaining a consistent layout.
//
// ### Dependencies
//
// #### [ICF](https://github.com/rumor-ml/icf)
//
// Core framework providing UI patterns and component guidelines.

package ui

import (
	"fmt"

	"github.com/charmbracelet/bubbles/help"
	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// HelpComponent provides help display using bubbles help
type HelpComponent struct {
	help               help.Model
	keys               keyMap
	width              int
	height             int
	mode               string // "mux" or "navigation"
	paneManagementMode string // "grouped" or "unsplit"
	keyBindings        *KeyBindingRegistry
}

// keyMap defines all the keybindings for the application
type keyMap struct {
	// Navigation keys
	ClaudeShell key.Binding
	ZshShell    key.Binding
	Dashboard   key.Binding
	NewWorktree key.Binding

	// Application keys
	Screenshot key.Binding
	Quit       key.Binding

	// Additional keys that might be shown in different modes
	Up    key.Binding
	Down  key.Binding
	Enter key.Binding
	Tab   key.Binding
}

// ShortHelp returns keybindings to show in the mini help view
func (k keyMap) ShortHelp() []key.Binding {
	return []key.Binding{
		k.ZshShell,
		k.ClaudeShell,
		k.Dashboard,
		k.NewWorktree,
		k.Screenshot,
		k.Quit,
	}
}

// FullHelp returns keybindings to show in the full help view
func (k keyMap) FullHelp() [][]key.Binding {
	return [][]key.Binding{
		{k.ZshShell, k.ClaudeShell, k.Dashboard, k.NewWorktree},
		{k.Screenshot, k.Quit},
		{k.Up, k.Down, k.Enter, k.Tab},
	}
}

// NewHelpComponent creates a new help component
func NewHelpComponent() *HelpComponent {
	return NewHelpComponentWithBindings(NewKeyBindingRegistry())
}

// NewHelpComponentWithBindings creates a new help component with custom key bindings
func NewHelpComponentWithBindings(keyBindings *KeyBindingRegistry) *HelpComponent {
	// Create keybindings
	keys := keyMap{
		ZshShell: key.NewBinding(
			key.WithKeys("ctrl+[key]"),
			key.WithHelp("^[key]", "zsh shell"),
		),
		ClaudeShell: key.NewBinding(
			key.WithKeys("alt+[key]"),
			key.WithHelp("alt+[key]", "claude shell"),
		),
		Dashboard: key.NewBinding(
			key.WithKeys("shift+ctrl+[key]"),
			key.WithHelp("⇧^[key]", "new+claude"),
		),
		NewWorktree: key.NewBinding(
			key.WithKeys("shift+alt+[key]"),
			key.WithHelp("⇧alt+[key]", "new+zsh"),
		),
		Screenshot: key.NewBinding(
			key.WithKeys("ctrl+s"),
			key.WithHelp("^s", "screenshot"),
		),
		Quit: key.NewBinding(
			key.WithKeys("ctrl+d"),
			key.WithHelp("^d", "quit"),
		),
		Up: key.NewBinding(
			key.WithKeys("up", "k"),
			key.WithHelp("↑/k", "up"),
		),
		Down: key.NewBinding(
			key.WithKeys("down", "j"),
			key.WithHelp("↓/j", "down"),
		),
		Enter: key.NewBinding(
			key.WithKeys("enter"),
			key.WithHelp("enter", "select"),
		),
		Tab: key.NewBinding(
			key.WithKeys("tab"),
			key.WithHelp("tab", "next field"),
		),
	}

	// Create help model
	h := help.New()
	h.ShowAll = false // Start with short help

	// Customize styles
	h.Styles.ShortKey = lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	h.Styles.ShortDesc = lipgloss.NewStyle().Foreground(lipgloss.Color("245"))
	h.Styles.ShortSeparator = lipgloss.NewStyle().Foreground(lipgloss.Color("240")).SetString(" • ")
	h.Styles.FullKey = lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	h.Styles.FullDesc = lipgloss.NewStyle().Foreground(lipgloss.Color("245"))
	h.Styles.FullSeparator = lipgloss.NewStyle().Foreground(lipgloss.Color("240")).SetString(" • ")

	return &HelpComponent{
		help:               h,
		keys:               keys,
		keyBindings:        keyBindings,
		paneManagementMode: "grouped", // Default mode
	}
}

// Init initializes the help component
func (h *HelpComponent) Init() tea.Cmd {
	return nil
}

// Update handles messages for the help component
func (h *HelpComponent) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		h.width = msg.Width
		h.height = msg.Height
		h.help.Width = msg.Width
	}

	return h, nil
}

// View renders the help component
func (h *HelpComponent) View() string {
	return h.ViewWithSequenceStatus(false, "")
}

// ViewWithSequenceStatus renders the help component with optional sequence status
func (h *HelpComponent) ViewWithSequenceStatus(hasSequence bool, sequenceText string) string {
	var helpText string

	if hasSequence {
		// Show sequence-specific help
		helpText = sequenceText
	} else {
		// Generate help text from key binding registry
		if h.keyBindings != nil {
			helpText = h.keyBindings.GetNavigationHints()
		} else {
			// Fallback to default help text
			helpText = "[key] project → c(laude) z(sh) n(vim) x(blocked) • r(dev server) /(set path) • ESC(cancel) • ^d(quit)"
		}

		// Add pane management mode indicator and mode switching keys
		modeText := "grouped"
		if h.paneManagementMode == "unsplit" {
			modeText = "unsplit"
		}
		// Always show both mode options
		modeKeys := "^g(grouped) ^u(unsplit)"
		helpText = fmt.Sprintf("[Mode: %s] %s • %s", modeText, helpText, modeKeys)

		if h.mode == "tmux" {
			helpText = "tmux mode: ^Space (navigation) • ^b s (screenshot) • ^b d (detach) • ^b ? (help)"
		}
	}

	// Center the help text
	return lipgloss.NewStyle().
		Width(h.width).
		Height(h.height).
		Align(lipgloss.Center, lipgloss.Center).
		Render(helpText)
}

// SetSize sets the component size
func (h *HelpComponent) SetSize(width, height int) {
	h.width = width
	h.height = height
	h.help.Width = width
}

// SetShowAll toggles between short and full help
func (h *HelpComponent) SetShowAll(showAll bool) {
	h.help.ShowAll = showAll
}

// SetPaneManagementMode sets the current pane management mode
func (h *HelpComponent) SetPaneManagementMode(mode string) {
	h.paneManagementMode = mode
}
