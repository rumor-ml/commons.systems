// manager_message_router.go - Message routing for UI manager

package ui

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/rumor-ml/log/pkg/log"
)

// ManagerMessageRouter handles Bubble Tea message distribution to components
type ManagerMessageRouter struct {
	logger     log.Logger
	components map[string]tea.Model
}

// NewManagerMessageRouter creates a new message router
func NewManagerMessageRouter(components map[string]tea.Model) *ManagerMessageRouter {
	return &ManagerMessageRouter{
		logger:     log.Get(),
		components: components,
	}
}

// RouteMessage routes messages to all components
func (mr *ManagerMessageRouter) RouteMessage(msg tea.Msg) tea.Cmd {
	var cmds []tea.Cmd

	// Skip logging for frequent update messages

	// Skip ALL KeyMsg in Update - they are handled by HandleKey
	if _, isKeyMsg := msg.(tea.KeyMsg); isKeyMsg {
		// Keys are already processed through HandleKey, don't process again
		return nil
	}

	// Handle specific message types that need special processing
	switch msg := msg.(type) {
	case WorktreeProgressUpdateMsg:
		mr.logger.Info("ManagerMessageRouter received WorktreeProgressUpdateMsg",
			"inProgress", msg.InProgress,
			"projectName", msg.ProjectName)
		// Route to simple terminal component - it will show in all components loop below

	case PaneManagementModeMsg:
		mr.logger.Info("ManagerMessageRouter received PaneManagementModeMsg",
			"mode", msg.Mode)
		// Update help component with new mode
		if help, exists := mr.components["help"]; exists {
			if helpComp, ok := help.(*HelpComponent); ok {
				helpComp.SetPaneManagementMode(msg.Mode)
			}
		}
	}

	// Route other messages to all components
	for name, component := range mr.components {
		if model, ok := component.(interface {
			Update(tea.Msg) (tea.Model, tea.Cmd)
		}); ok {
			// Skip logging for frequent update messages
			updatedModel, cmd := model.Update(msg)
			mr.components[name] = updatedModel
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
		}
	}

	return tea.Batch(cmds...)
}