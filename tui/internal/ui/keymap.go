// keymap.go - Centralized keymap management using bubbles
//
// ## Metadata
//
// TUI centralized keymap management using Bubble Tea key bindings.
//
// ### Purpose
//
// Provide a centralized location for all application keybindings using the charmbracelet/bubbles
// key package, ensuring consistent key handling across all components and supporting dynamic
// keybinding updates based on application state.
//
// ### Instructions
//
// #### Keymap Organization
//
// ##### Centralized Definition
//
// Define all application keybindings in a single location using the bubbles key.Binding
// type, organizing them by functional groups and component ownership.
//
// ##### Dynamic Updates
//
// Support dynamic enabling/disabling of keybindings based on application mode and state,
// ensuring only relevant keys are active at any given time.
//
// ### Dependencies
//
// #### [ICF](https://github.com/rumor-ml/icf)
//
// Core framework providing architectural patterns for centralized configuration.

package ui

import (
	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
)

// GlobalKeyMap defines all keybindings for the application
type GlobalKeyMap struct {
	// Application control
	Quit       key.Binding
	Screenshot key.Binding
	Help       key.Binding

	// Navigation chord modifiers
	ClaudeModifier    key.Binding
	ZshModifier       key.Binding
	DashboardModifier key.Binding
	WorktreeModifier  key.Binding

	// Terminal input
	Enter     key.Binding
	Tab       key.Binding
	Backspace key.Binding
	Delete    key.Binding
	Escape    key.Binding

	// Terminal control
	CtrlC key.Binding
	CtrlD key.Binding
	CtrlZ key.Binding
	CtrlL key.Binding

	// Navigation
	Up    key.Binding
	Down  key.Binding
	Left  key.Binding
	Right key.Binding

	// Scrolling
	PageUp   key.Binding
	PageDown key.Binding
	Home     key.Binding
	End      key.Binding
}

// NewGlobalKeyMap creates the global keymap with all bindings
func NewGlobalKeyMap() *GlobalKeyMap {
	return &GlobalKeyMap{
		// Application control
		Quit: key.NewBinding(
			key.WithKeys("ctrl+q"),
			key.WithHelp("^q", "quit"),
		),
		Screenshot: key.NewBinding(
			key.WithKeys("ctrl+s"),
			key.WithHelp("^s", "screenshot"),
		),
		Help: key.NewBinding(
			key.WithKeys("?", "ctrl+h"),
			key.WithHelp("?", "help"),
		),

		// Navigation chord modifiers
		ClaudeModifier: key.NewBinding(
			key.WithKeys("ctrl"),
			key.WithHelp("^", "claude modifier"),
		),
		ZshModifier: key.NewBinding(
			key.WithKeys("alt"),
			key.WithHelp("alt", "zsh modifier"),
		),
		DashboardModifier: key.NewBinding(
			key.WithKeys("ctrl+alt"),
			key.WithHelp("^alt", "dashboard modifier"),
		),
		WorktreeModifier: key.NewBinding(
			key.WithKeys("ctrl+shift"),
			key.WithHelp("^⇧", "worktree modifier"),
		),

		// Terminal input
		Enter: key.NewBinding(
			key.WithKeys("enter"),
			key.WithHelp("↵", "enter"),
		),
		Tab: key.NewBinding(
			key.WithKeys("tab"),
			key.WithHelp("⇥", "tab"),
		),
		Backspace: key.NewBinding(
			key.WithKeys("backspace"),
			key.WithHelp("⌫", "backspace"),
		),
		Delete: key.NewBinding(
			key.WithKeys("delete"),
			key.WithHelp("⌦", "delete"),
		),
		Escape: key.NewBinding(
			key.WithKeys("esc"),
			key.WithHelp("esc", "escape"),
		),

		// Terminal control
		CtrlC: key.NewBinding(
			key.WithKeys("ctrl+c"),
			key.WithHelp("^c", "interrupt"),
		),
		CtrlD: key.NewBinding(
			key.WithKeys("ctrl+d"),
			key.WithHelp("^d", "EOF"),
		),
		CtrlZ: key.NewBinding(
			key.WithKeys("ctrl+z"),
			key.WithHelp("^z", "suspend"),
		),
		CtrlL: key.NewBinding(
			key.WithKeys("ctrl+l"),
			key.WithHelp("^l", "clear"),
		),

		// Navigation
		Up: key.NewBinding(
			key.WithKeys("up"),
			key.WithHelp("↑", "up"),
		),
		Down: key.NewBinding(
			key.WithKeys("down"),
			key.WithHelp("↓", "down"),
		),
		Left: key.NewBinding(
			key.WithKeys("left"),
			key.WithHelp("←", "left"),
		),
		Right: key.NewBinding(
			key.WithKeys("right"),
			key.WithHelp("→", "right"),
		),

		// Scrolling
		PageUp: key.NewBinding(
			key.WithKeys("pgup"),
			key.WithHelp("pgup", "page up"),
		),
		PageDown: key.NewBinding(
			key.WithKeys("pgdown"),
			key.WithHelp("pgdn", "page down"),
		),
		Home: key.NewBinding(
			key.WithKeys("home"),
			key.WithHelp("home", "start"),
		),
		End: key.NewBinding(
			key.WithKeys("end"),
			key.WithHelp("end", "end"),
		),
	}
}

// DisableNavigationKeys disables arrow key navigation (for terminal mode)
func (k *GlobalKeyMap) DisableNavigationKeys() {
	k.Up.SetEnabled(false)
	k.Down.SetEnabled(false)
	k.Left.SetEnabled(false)
	k.Right.SetEnabled(false)
}

// EnableNavigationKeys enables arrow key navigation
func (k *GlobalKeyMap) EnableNavigationKeys() {
	k.Up.SetEnabled(true)
	k.Down.SetEnabled(true)
	k.Left.SetEnabled(true)
	k.Right.SetEnabled(true)
}

// DisableTerminalKeys disables terminal-specific keys (for navigation mode)
func (k *GlobalKeyMap) DisableTerminalKeys() {
	k.Enter.SetEnabled(false)
	k.Tab.SetEnabled(false)
	k.Backspace.SetEnabled(false)
	k.Delete.SetEnabled(false)
}

// EnableTerminalKeys enables terminal-specific keys
func (k *GlobalKeyMap) EnableTerminalKeys() {
	k.Enter.SetEnabled(true)
	k.Tab.SetEnabled(true)
	k.Backspace.SetEnabled(true)
	k.Delete.SetEnabled(true)
}

// IsChordModifier checks if a key is a chord modifier
func (k *GlobalKeyMap) IsChordModifier(keyStr string) bool {
	return key.Matches(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(keyStr)},
		k.ClaudeModifier, k.ZshModifier, k.DashboardModifier, k.WorktreeModifier)
}

// IsQuit checks if a key is the quit key
func (k *GlobalKeyMap) IsQuit(msg tea.KeyMsg) bool {
	return key.Matches(msg, k.Quit)
}

// IsScreenshot checks if a key is the screenshot key
func (k *GlobalKeyMap) IsScreenshot(msg tea.KeyMsg) bool {
	return key.Matches(msg, k.Screenshot)
}

// IsHelp checks if a key is the help key
func (k *GlobalKeyMap) IsHelp(msg tea.KeyMsg) bool {
	return key.Matches(msg, k.Help)
}
