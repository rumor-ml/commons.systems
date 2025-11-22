// keybindings.go - Centralized key binding management system
//
// ## Metadata
//
// TUI key binding system providing centralized management of all keyboard shortcuts.
//
// ### Purpose
//
// Centralize all keyboard shortcuts in one location to ensure consistency between key handling
// and hint display, prevent conflicts, and provide a single source of truth for all key bindings
// across the entire application interface.
//
// ### Instructions
//
// #### Key Binding Management
//
// ##### Centralized Definition
//
// Define all key bindings in a single registry that maps keys to actions and descriptions,
// ensuring that hint displays always reflect the actual key handling behavior without duplication.
//
// ##### Conflict Prevention
//
// Validate key bindings at startup to detect conflicts and provide clear error messages when
// multiple actions are assigned to the same key combination.
//
// #### Integration with Components
//
// ##### Hint Generation
//
// Automatically generate hint strings for display in the UI based on the current key binding
// registry, eliminating the need to manually update hints when key bindings change.
//
// ##### Key Handling Delegation
//
// Provide methods for components to query whether they should handle specific keys based on
// the current binding configuration and context.
//
// ### Dependencies
//
// #### [ICF](https://github.com/rumor-ml/icf)
//
// Core framework providing UI patterns and component architecture that guide the key binding
// system design and integration with other UI components.

package ui

import (
	"fmt"
	"sort"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

// KeyAction represents an action that can be triggered by a key
type KeyAction string

const (
	ActionQuit           KeyAction = "quit"
	ActionSelectProject  KeyAction = "select_project"
	ActionClaudeShell      KeyAction = "claude_shell"
	ActionZshShell         KeyAction = "zsh_shell"
	ActionNvimShell        KeyAction = "nvim_shell"
	ActionDevServerRestart KeyAction = "dev_server_restart"
	ActionDevServerPath    KeyAction = "dev_server_path"
	ActionToggleBlocked    KeyAction = "toggle_blocked"
	ActionToggleTesting    KeyAction = "toggle_testing"
	ActionCreateWorktree KeyAction = "create_worktree"
	ActionCancel         KeyAction = "cancel"
	ActionScreenshot     KeyAction = "screenshot"
	ActionUnsplitMode    KeyAction = "unsplit_mode"
	ActionGroupedMode    KeyAction = "grouped_mode"
)

// KeyBinding represents a key and its associated action
type KeyBinding struct {
	Key         string    // Key sequence (e.g., "ctrl+d", "c", "enter")
	Action      KeyAction // Action to perform
	Description string    // Human-readable description for hints
	Context     string    // Context where this binding applies ("global", "navigation", etc.)
}

// KeyBindingRegistry manages all key bindings for the application
type KeyBindingRegistry struct {
	bindings map[string]*KeyBinding   // key -> binding
	contexts map[string][]*KeyBinding // context -> bindings
}

// NewKeyBindingRegistry creates a new key binding registry with default bindings
func NewKeyBindingRegistry() *KeyBindingRegistry {
	registry := &KeyBindingRegistry{
		bindings: make(map[string]*KeyBinding),
		contexts: make(map[string][]*KeyBinding),
	}

	// Define default key bindings
	defaultBindings := []*KeyBinding{
		// Global bindings
		{Key: "ctrl+d", Action: ActionQuit, Description: "quit", Context: "global"},
		{Key: "ctrl+s", Action: ActionScreenshot, Description: "screenshot", Context: "global"},
		{Key: "ctrl+g", Action: ActionGroupedMode, Description: "grouped mode", Context: "global"},
		{Key: "ctrl+u", Action: ActionUnsplitMode, Description: "unsplit mode", Context: "global"},

		// Navigation bindings
		{Key: "enter", Action: ActionSelectProject, Description: "select project", Context: "navigation"},
		{Key: "c", Action: ActionClaudeShell, Description: "claude shell", Context: "navigation"},
		{Key: "z", Action: ActionZshShell, Description: "zsh shell", Context: "navigation"},
		{Key: "n", Action: ActionNvimShell, Description: "nvim shell", Context: "navigation"},
		{Key: "r", Action: ActionDevServerRestart, Description: "dev server restart", Context: "navigation"},
		{Key: "/", Action: ActionDevServerPath, Description: "set dev path", Context: "navigation"},
		{Key: "x", Action: ActionToggleBlocked, Description: "toggle blocked", Context: "navigation"},
		{Key: "t", Action: ActionToggleTesting, Description: "toggle testing", Context: "navigation"},
		{Key: "C", Action: ActionCreateWorktree, Description: "create claude worktree", Context: "navigation"},
		{Key: "Z", Action: ActionCreateWorktree, Description: "create zsh worktree", Context: "navigation"},
		{Key: "esc", Action: ActionCancel, Description: "cancel", Context: "navigation"},
	}

	// Register all default bindings
	for _, binding := range defaultBindings {
		registry.Register(binding)
	}

	return registry
}

// Register adds a key binding to the registry
func (r *KeyBindingRegistry) Register(binding *KeyBinding) error {
	// Check for conflicts
	if existing, exists := r.bindings[binding.Key]; exists {
		// Allow same action in different contexts
		if existing.Action != binding.Action || existing.Context != binding.Context {
			return fmt.Errorf("key binding conflict: %s is already bound to %s in context %s, cannot bind to %s in context %s",
				binding.Key, existing.Action, existing.Context, binding.Action, binding.Context)
		}
	}

	r.bindings[binding.Key] = binding
	r.contexts[binding.Context] = append(r.contexts[binding.Context], binding)
	return nil
}

// GetBinding returns the binding for a key, or nil if not found
func (r *KeyBindingRegistry) GetBinding(key string) *KeyBinding {
	return r.bindings[key]
}

// GetAction returns the action for a key, or empty string if not found
func (r *KeyBindingRegistry) GetAction(key string) KeyAction {
	if binding := r.bindings[key]; binding != nil {
		return binding.Action
	}
	return ""
}

// ShouldHandle returns true if the given key should be handled in the given context
func (r *KeyBindingRegistry) ShouldHandle(key string, context string) bool {
	binding := r.bindings[key]
	if binding == nil {
		return false
	}
	// Global bindings work in any context
	return binding.Context == "global" || binding.Context == context
}

// GetHintString generates a hint string for display in the UI
func (r *KeyBindingRegistry) GetHintString(context string) string {
	var hints []string

	// Collect bindings for this context and global bindings
	var contextBindings []*KeyBinding
	contextBindings = append(contextBindings, r.contexts["global"]...)
	contextBindings = append(contextBindings, r.contexts[context]...)

	// Sort bindings by key for consistent display
	sort.Slice(contextBindings, func(i, j int) bool {
		return contextBindings[i].Key < contextBindings[j].Key
	})

	// Generate hint strings
	for _, binding := range contextBindings {
		hint := fmt.Sprintf("%s(%s)", binding.Key, binding.Description)
		hints = append(hints, hint)
	}

	return strings.Join(hints, " • ")
}

// GetNavigationHints returns formatted hints for navigation context
func (r *KeyBindingRegistry) GetNavigationHints() string {
	// Get all navigation and global bindings
	var allBindings []*KeyBinding
	allBindings = append(allBindings, r.contexts["global"]...)
	allBindings = append(allBindings, r.contexts["navigation"]...)

	// Group by type for better organization
	projectActions := []string{}
	shellActions := []string{}
	globalActions := []string{}

	for _, binding := range allBindings {
		hint := fmt.Sprintf("%s(%s)", binding.Key, binding.Description)

		switch binding.Action {
		case ActionSelectProject:
			projectActions = append(projectActions, "[key] project")
		case ActionClaudeShell:
			shellActions = append(shellActions, "c(laude)")
		case ActionZshShell:
			shellActions = append(shellActions, "z(sh)")
		case ActionNvimShell:
			shellActions = append(shellActions, "n(vim)")
		case ActionDevServerRestart:
			shellActions = append(shellActions, "r(estart)")
		case ActionDevServerPath:
			shellActions = append(shellActions, "/(path)")
		case ActionToggleBlocked:
			shellActions = append(shellActions, "x(blocked)")
		case ActionToggleTesting:
			shellActions = append(shellActions, "t(esting)")
		case ActionCancel, ActionQuit:
			globalActions = append(globalActions, hint)
		}
	}

	// Combine shell actions
	shellHint := strings.Join(shellActions, "")
	if len(shellHint) > 0 {
		shellHint = fmt.Sprintf("→ %s", shellHint)
	}

	// Build final hint string
	parts := []string{}
	if len(projectActions) > 0 {
		parts = append(parts, projectActions[0])
	}
	if len(shellHint) > 0 {
		parts = append(parts, shellHint)
	}
	if len(globalActions) > 0 {
		parts = append(parts, strings.Join(globalActions, " • "))
	}

	return strings.Join(parts, " • ")
}

// KeyToString normalizes a tea.KeyMsg to a string for lookup
func KeyToString(msg tea.KeyMsg) string {
	switch msg.Type {
	case tea.KeyCtrlD:
		return "ctrl+d"
	case tea.KeyCtrlS:
		return "ctrl+s"
	case tea.KeyCtrlC:
		return "ctrl+c"
	case tea.KeyEsc:
		return "esc"
	case tea.KeyEnter:
		return "enter"
	case tea.KeySpace:
		return "space"
	case tea.KeyTab:
		return "tab"
	case tea.KeyBackspace:
		return "backspace"
	case tea.KeyDelete:
		return "delete"
	case tea.KeyUp:
		return "up"
	case tea.KeyDown:
		return "down"
	case tea.KeyLeft:
		return "left"
	case tea.KeyRight:
		return "right"
	case tea.KeyHome:
		return "home"
	case tea.KeyEnd:
		return "end"
	case tea.KeyPgUp:
		return "pgup"
	case tea.KeyPgDown:
		return "pgdn"
	default:
		// For regular character keys
		if len(msg.Runes) == 1 {
			return string(msg.Runes[0])
		}
		return msg.String()
	}
}
