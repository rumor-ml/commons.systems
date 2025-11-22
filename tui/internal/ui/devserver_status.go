// devserver_status.go - Dev server status display component

package ui

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/natb1/tui/internal/devserver"
)

// DevServerStatusComponent displays the dev server status
type DevServerStatusComponent struct {
	width       int
	height      int
	status      devserver.StatusInfo
	inputMode   bool
	inputBuffer string
}

// NewDevServerStatusComponent creates a new dev server status component
func NewDevServerStatusComponent(width, height int) *DevServerStatusComponent {
	return &DevServerStatusComponent{
		width:  width,
		height: height,
		status: devserver.StatusInfo{
			Status:      devserver.StatusStopped,
			CurrentPath: "/",
			Port:        8080,
		},
	}
}

// Init initializes the component
func (d *DevServerStatusComponent) Init() tea.Cmd {
	return nil
}

// Update handles messages
func (d *DevServerStatusComponent) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		d.width = msg.Width
		d.height = msg.Height
	case DevServerStatusUpdateMsg:
		// Update the status when we receive an update message
		d.status = msg.Status
		// Force a re-render
		return d, nil
	}
	return d, nil
}

// View renders the dev server status
func (d *DevServerStatusComponent) View() string {
	if d.width == 0 || d.height == 0 {
		return ""
	}

	// Get status icon and text
	statusIcon := d.getStatusIcon()
	statusText := d.getStatusText()

	// Build status line
	var statusLine string
	if d.inputMode {
		// Show input mode with cursor
		statusLine = fmt.Sprintf("Dev Server: %s %s | Path: %s_ | Port: %d",
			statusIcon, statusText, d.inputBuffer, d.status.Port)
	} else {
		statusLine = fmt.Sprintf("Dev Server: %s %s | Path: %s | Port: %d",
			statusIcon, statusText, d.status.CurrentPath, d.status.Port)
	}

	// Apply styling
	style := lipgloss.NewStyle().
		Width(d.width).
		Height(d.height).
		Foreground(lipgloss.Color("245")).
		Background(lipgloss.Color("235"))

	return style.Render(statusLine)
}

// UpdateStatus updates the dev server status
func (d *DevServerStatusComponent) UpdateStatus(info devserver.StatusInfo) {
	d.status = info
}

// SetSize sets the component dimensions
func (d *DevServerStatusComponent) SetSize(width, height int) {
	d.width = width
	d.height = height
}

// getStatusIcon returns the appropriate icon for the current status
func (d *DevServerStatusComponent) getStatusIcon() string {
	switch d.status.Status {
	case devserver.StatusRunning:
		// Show yellow icon if some modules were excluded
		if d.status.TotalModules > 0 && d.status.ValidModules < d.status.TotalModules {
			return "🟡"
		}
		return "🟢"
	case devserver.StatusStarting:
		return "🟡"
	case devserver.StatusRestarting:
		return "🔄"
	case devserver.StatusError:
		return "🔴"
	default:
		return "⭕"
	}
}

// getStatusText returns the text representation of the status
func (d *DevServerStatusComponent) getStatusText() string {
	switch d.status.Status {
	case devserver.StatusRunning:
		// Show module counts if some modules were excluded
		if d.status.TotalModules > 0 && d.status.ValidModules < d.status.TotalModules {
			return fmt.Sprintf("Running (%d/%d)", d.status.ValidModules, d.status.TotalModules)
		}
		return "Running"
	case devserver.StatusStarting:
		return "Starting"
	case devserver.StatusRestarting:
		return "Restarting"
	case devserver.StatusError:
		if d.status.Error != nil {
			return fmt.Sprintf("Error: %s", d.status.Error.Error())
		}
		return "Error"
	default:
		return "Stopped"
	}
}

// SetInputMode sets the input mode state
func (d *DevServerStatusComponent) SetInputMode(active bool, buffer string) {
	d.inputMode = active
	d.inputBuffer = buffer
}