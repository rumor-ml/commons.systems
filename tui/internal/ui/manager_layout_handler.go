// manager_layout_handler.go - Layout management for UI manager

package ui

import (
	tea "github.com/charmbracelet/bubbletea"
)

// ManagerLayoutHandler handles component positioning and resize operations
type ManagerLayoutHandler struct {
	layout     *Layout
	components map[string]tea.Model
	width      *int
	height     *int
}

// NewManagerLayoutHandler creates a new layout handler
func NewManagerLayoutHandler(layout *Layout, components map[string]tea.Model, width *int, height *int) *ManagerLayoutHandler {
	return &ManagerLayoutHandler{
		layout:     layout,
		components: components,
		width:      width,
		height:     height,
	}
}

// HandleResize updates layout for new terminal size
func (lh *ManagerLayoutHandler) HandleResize(msg tea.WindowSizeMsg) tea.Cmd {
	*lh.width = msg.Width
	*lh.height = msg.Height

	// Always use layout-based resizing (navigation is always visible)
	return lh.handleLayoutModeResize(msg)
}

// handleLayoutModeResize handles resize with layout constraints
func (lh *ManagerLayoutHandler) handleLayoutModeResize(msg tea.WindowSizeMsg) tea.Cmd {
	lh.UpdateLayout()

	// Propagate resize to all components based on layout regions
	var cmds []tea.Cmd
	for name, component := range lh.components {
		if model, ok := component.(interface {
			Update(tea.Msg) (tea.Model, tea.Cmd)
		}); ok {
			// Create region-specific resize message
			if region, exists := lh.layout.regions[name]; exists {
				resizeMsg := tea.WindowSizeMsg{
					Width:  region.Width,
					Height: region.Height,
				}
				updatedModel, cmd := model.Update(resizeMsg)
				lh.components[name] = updatedModel
				if cmd != nil {
					cmds = append(cmds, cmd)
				}

				// No need to resize PTY sessions - tmux handles that
			}
		}
	}

	return tea.Batch(cmds...)
}

// UpdateLayout recalculates component regions based on current mode and size
func (lh *ManagerLayoutHandler) UpdateLayout() {
	if *lh.width == 0 || *lh.height == 0 {
		return
	}

	lh.layout.regions = make(map[string]Region)

	logsHeight := 7       // Fixed height for logs (4 truncated + 3 detail)
	devServerHeight := 1  // Fixed height for dev server status
	helpHeight := 2       // Fixed height for help
	mainHeight := *lh.height - logsHeight - devServerHeight - helpHeight

	// Navigation is always visible
	// Layout: logs at top, navigation UI in middle, dev server status, help at bottom
	lh.layout.regions["logs"] = Region{
		X: 0, Y: 0,
		Width: *lh.width, Height: logsHeight,
	}
	lh.layout.regions["navigation"] = Region{
		X: 0, Y: logsHeight,
		Width: *lh.width, Height: mainHeight,
	}
	lh.layout.regions["devServerStatus"] = Region{
		X: 0, Y: logsHeight + mainHeight,
		Width: *lh.width, Height: devServerHeight,
	}
	lh.layout.regions["help"] = Region{
		X: 0, Y: logsHeight + mainHeight + devServerHeight,
		Width: *lh.width, Height: helpHeight,
	}
}

// getComponentAtPosition determines which component is at the given coordinates
func (lh *ManagerLayoutHandler) GetComponentAtPosition(x, y int) string {
	for name, region := range lh.layout.regions {
		if x >= region.X && x < region.X+region.Width &&
			y >= region.Y && y < region.Y+region.Height {
			return name
		}
	}
	return ""
}