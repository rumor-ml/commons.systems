package model

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/commons-systems/{{APP_NAME}}/internal/ui"
)

const (
	DefaultWidth  = 80
	DefaultHeight = 24
)

// Model represents the application state
type Model struct {
	width  int
	height int
}

// New creates a new Model instance
func New() Model {
	return Model{
		width:  DefaultWidth,
		height: DefaultHeight,
	}
}

// Init initializes the model
func (m Model) Init() tea.Cmd {
	return nil
}

// Update handles messages and updates the model
func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case tea.KeyMsg:
		switch msg.Type {
		case tea.KeyCtrlC, tea.KeyEsc:
			return m, tea.Quit
		}
	}

	return m, nil
}

// View renders the model
func (m Model) View() string {
	return ui.Render(m.width)
}
