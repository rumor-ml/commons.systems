// manager_mouse_handler.go - Mouse event handling for UI manager

package ui

import (
	tea "github.com/charmbracelet/bubbletea"
)

// ManagerMouseHandler handles mouse event routing to components
type ManagerMouseHandler struct {
	components     map[string]tea.Model
	layoutHandler  *ManagerLayoutHandler
}

// NewManagerMouseHandler creates a new mouse handler
func NewManagerMouseHandler(components map[string]tea.Model, layoutHandler *ManagerLayoutHandler) *ManagerMouseHandler {
	return &ManagerMouseHandler{
		components:    components,
		layoutHandler: layoutHandler,
	}
}

// HandleMouse routes mouse events to appropriate components
func (mh *ManagerMouseHandler) HandleMouse(msg tea.MouseMsg) tea.Cmd {
	// Determine which component should receive the mouse event
	componentName := mh.layoutHandler.GetComponentAtPosition(msg.X, msg.Y)

	// Route to component
	if component, exists := mh.components[componentName]; exists {
		if model, ok := component.(interface {
			Update(tea.Msg) (tea.Model, tea.Cmd)
		}); ok {
			updatedModel, cmd := model.Update(msg)
			mh.components[componentName] = updatedModel
			return cmd
		}
	}
	return nil
}