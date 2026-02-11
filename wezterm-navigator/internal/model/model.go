package model

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// Model represents the application state
type Model struct {
	width  int
	height int
}

// NewModel creates a new model instance
func NewModel() Model {
	return Model{
		width:  40, // Default navigator width
		height: 24, // Default height
	}
}

// Init initializes the model
func (m Model) Init() tea.Cmd {
	return nil
}

// Update handles messages and updates the model
func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "q":
			return m, tea.Quit
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	}
	return m, nil
}

// View renders the UI
func (m Model) View() string {
	// Tokyo Night color scheme
	titleStyle := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("#7aa2f7")).
		MarginBottom(1)

	sectionStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("#c0caf5"))

	keyStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("#9ece6a")).
		Bold(true)

	descStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("#a9b1d6"))

	helpStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("#565f89")).
		Italic(true).
		MarginTop(1)

	// Build content
	var content string

	// Title
	content += titleStyle.Render("WezTerm Navigator") + "\n\n"

	// Welcome message
	content += sectionStyle.Render("Welcome to WezTerm!") + "\n"
	content += helpStyle.Render("Mode: Singleton Window") + "\n\n"

	// Keybindings section
	content += sectionStyle.Render("Keybindings:") + "\n\n"

	// Window management
	content += keyStyle.Render("Window Management:") + "\n"
	content += descStyle.Render("  Ctrl+Shift+T") + " - New tab\n"
	content += descStyle.Render("  Ctrl+Shift+N") + " - New window\n"
	content += descStyle.Render("  Ctrl+Shift+9") + " - Switch workspace (navigator)\n\n"

	// Navigation
	content += keyStyle.Render("Navigation:") + "\n"
	content += descStyle.Render("  Alt+Left/Right") + " - Switch tabs\n"
	content += descStyle.Render("  Ctrl+Shift+Arrow") + " - Navigate panes\n\n"

	// Splitting
	content += keyStyle.Render("Splitting:") + "\n"
	content += descStyle.Render("  Ctrl+Shift+%") + " - Horizontal split\n"
	content += descStyle.Render(`  Ctrl+Shift+"`) + " - Vertical split\n\n"

	// Closing
	content += keyStyle.Render("Closing:") + "\n"
	content += descStyle.Render("  Ctrl+Shift+W") + " - Close tab\n\n"

	// Help
	content += helpStyle.Render("Press Ctrl+C or q to quit")

	// Wrap in container with padding
	containerStyle := lipgloss.NewStyle().
		Width(m.width).
		Height(m.height).
		Padding(1)

	return containerStyle.Render(content)
}
