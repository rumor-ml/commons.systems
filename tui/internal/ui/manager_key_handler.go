// manager_key_handler.go - Keyboard event handling for UI manager

package ui

import (
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/rumor-ml/log/pkg/log"
)

// ManagerKeyHandler handles keyboard event routing and navigation key detection
type ManagerKeyHandler struct {
	logger      log.Logger
	components  map[string]tea.Model
	keyBindings *KeyBindingRegistry
	focus       *string
	manager     *Manager // Reference back to manager for path input state
}

// NewManagerKeyHandler creates a new key handler
func NewManagerKeyHandler(components map[string]tea.Model, keyBindings *KeyBindingRegistry, focus *string) *ManagerKeyHandler {
	return &ManagerKeyHandler{
		logger:      log.Get(),
		components:  components,
		keyBindings: keyBindings,
		focus:       focus,
	}
}

// SetManager sets the manager reference
func (kh *ManagerKeyHandler) SetManager(m *Manager) {
	kh.manager = m
}

// HandleKey routes keyboard events to appropriate components
func (kh *ManagerKeyHandler) HandleKey(msg tea.KeyMsg) tea.Cmd {
	// Check if path input mode is active
	if kh.manager != nil && kh.manager.pathInputActive {
		return kh.handlePathInput(msg)
	}

	// Convert key to string for lookup
	keyStr := KeyToString(msg)

	// Check for global key bindings first
	if kh.keyBindings.ShouldHandle(keyStr, "global") {
		action := kh.keyBindings.GetAction(keyStr)
		kh.logger.Info("Global key binding matched", "key", keyStr, "action", action)

		switch action {
		case ActionQuit:
			kh.logger.Info("Quit action triggered")
			return tea.Quit
		case ActionScreenshot:
			// Forward screenshot to controller (this will be handled by the app)
			return nil
		case ActionUnsplitMode:
			kh.logger.Info("Unsplit mode action triggered")
			return func() tea.Msg {
				return PaneManagementModeMsg{Mode: "unsplit"}
			}
		case ActionGroupedMode:
			kh.logger.Info("Grouped mode action triggered")
			return func() tea.Msg {
				return PaneManagementModeMsg{Mode: "grouped"}
			}
		}
	}

	// Check if this is an arrow key or page key - route to logs
	if kh.isLogNavigationKey(msg) {
		kh.logger.Debug("Routing arrow/page key to logs", "key", msg.String())

		// Route arrow keys and page keys to logs
		if logs, exists := kh.components["logs"]; exists {
			if model, ok := logs.(interface {
				Update(tea.Msg) (tea.Model, tea.Cmd)
			}); ok {
				updatedModel, cmd := model.Update(msg)
				kh.components["logs"] = updatedModel
				return cmd
			}
		} else {
			kh.logger.Error("Logs component not found when routing log navigation key")
		}
		return nil
	}

	// Check if this is a navigation trigger key (letter keys for projects, '/' for path input)
	if kh.isNavigationKey(msg) {
		kh.logger.Debug("Routing navigation key to navigation", "key", msg.String())

		// Route navigation keys to navigation
		if nav, exists := kh.components["navigation"]; exists {
			if model, ok := nav.(interface {
				Update(tea.Msg) (tea.Model, tea.Cmd)
			}); ok {
				updatedModel, cmd := model.Update(msg)
				kh.components["navigation"] = updatedModel
				return cmd
			}
		} else {
			kh.logger.Error("Navigation component not found when routing navigation key")
		}
	} else {
		// Route non-navigation keys to focused component
		if *kh.focus == "terminal" {
			if terminal, exists := kh.components["terminal"]; exists {
				if model, ok := terminal.(interface {
					Update(tea.Msg) (tea.Model, tea.Cmd)
				}); ok {
					updatedModel, cmd := model.Update(msg)
					kh.components["terminal"] = updatedModel
					return cmd
				}
			}
		} else if focusedComponent, exists := kh.components[*kh.focus]; exists {
			// Route to whatever component has focus
			if model, ok := focusedComponent.(interface {
				Update(tea.Msg) (tea.Model, tea.Cmd)
			}); ok {
				updatedModel, cmd := model.Update(msg)
				kh.components[*kh.focus] = updatedModel
				return cmd
			}
		}
	}
	return nil
}

// handlePathInput handles keyboard input during path input mode
func (kh *ManagerKeyHandler) handlePathInput(msg tea.KeyMsg) tea.Cmd {
	kh.logger.Info("Handling path input", "key", msg.String())

	switch msg.Type {
	case tea.KeyEnter:
		// Submit the path
		path := kh.manager.pathInputBuffer
		kh.logger.Info("Path input submitted", "path", path)

		// Exit input mode
		kh.manager.pathInputActive = false

		// Update dev server status display
		if devStatus, ok := kh.components["devServerStatus"].(*DevServerStatusComponent); ok {
			devStatus.SetInputMode(false, "")
		}

		// Send message to set the path
		return func() tea.Msg {
			return DevServerSetPathMsg{Path: path}
		}

	case tea.KeyEscape:
		// Cancel input
		kh.manager.pathInputActive = false
		kh.manager.pathInputBuffer = "/"

		// Update dev server status display
		if devStatus, ok := kh.components["devServerStatus"].(*DevServerStatusComponent); ok {
			devStatus.SetInputMode(false, "")
		}
		return nil

	case tea.KeyBackspace, tea.KeyDelete:
		// Remove last character
		if len(kh.manager.pathInputBuffer) > 1 {
			kh.manager.pathInputBuffer = kh.manager.pathInputBuffer[:len(kh.manager.pathInputBuffer)-1]
		} else {
			kh.manager.pathInputBuffer = "/"
		}

		// Update display
		if devStatus, ok := kh.components["devServerStatus"].(*DevServerStatusComponent); ok {
			devStatus.SetInputMode(true, kh.manager.pathInputBuffer)
		}
		return nil

	default:
		// Add character to buffer
		if msg.Type == tea.KeyRunes {
			for _, r := range msg.Runes {
				kh.manager.pathInputBuffer += string(r)
			}

			// Update display
			if devStatus, ok := kh.components["devServerStatus"].(*DevServerStatusComponent); ok {
				devStatus.SetInputMode(true, kh.manager.pathInputBuffer)
			}
		}
		return nil
	}
}

// isLogNavigationKey checks if a key message represents a log navigation key (arrows, page up/down)
func (kh *ManagerKeyHandler) isLogNavigationKey(msg tea.KeyMsg) bool {
	switch msg.Type {
	case tea.KeyUp, tea.KeyDown, tea.KeyPgUp, tea.KeyPgDown:
		return true
	}
	return false
}

// isNavigationKey checks if a key message represents a navigation trigger key
func (kh *ManagerKeyHandler) isNavigationKey(msg tea.KeyMsg) bool {
	// Only check for simple single-character keys
	if len(msg.Runes) != 1 {
		return false
	}

	char := msg.Runes[0]
	keyStr := msg.String()

	// Exclude keys with modifiers (let them be handled normally)
	if strings.Contains(keyStr, "ctrl+") ||
		strings.Contains(keyStr, "alt+") ||
		strings.Contains(keyStr, "shift+") ||
		msg.Alt {
		return false
	}

	// Navigation handles:
	// - Letters a-z for project prefixes (includes r, x)
	// - '/' for dev server path input
	return (char >= 'a' && char <= 'z') || char == '/'
}