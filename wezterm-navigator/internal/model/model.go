package model

// TODO(#1977): Add unit tests for wezterm-navigator Bubbletea TUI

import (
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// Tokyo Night color scheme styles
var (
	titleStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("#7aa2f7")).
			MarginBottom(1)

	sectionStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#c0caf5"))

	keyStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#9ece6a")).
			Bold(true)

	descStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#a9b1d6"))

	helpStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#565f89")).
			Italic(true).
			MarginTop(1)
)

// TODO(#1984): Model zero value is invalid - width=0, height=0 breaks rendering. Document zero-value danger or add validation.
// TODO(#1997): Add getter methods for Model width and height fields
// TODO(#1999): Add dimension validation and invariant enforcement (bounds checking, defensive rendering)
type Model struct {
	width  int
	height int
}

func NewModel() Model {
	// TODO(#1987): Extract magic numbers to named constants (MinWidth, MinHeight)
	return Model{
		width:  40,
		height: 24,
	}
}

func (m Model) Init() tea.Cmd {
	return nil
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "q":
			return m, tea.Quit
		}
	case tea.WindowSizeMsg:
		// TODO(#1996): Add bounds validation on WindowSizeMsg values
		m.width = msg.Width
		m.height = msg.Height
	}
	return m, nil
}

func (m Model) View() string {
	var b strings.Builder

	b.WriteString(titleStyle.Render("WezTerm Navigator"))
	b.WriteString("\n\n")

	b.WriteString(sectionStyle.Render("Welcome to WezTerm!"))
	b.WriteString("\n")
	b.WriteString(helpStyle.Render("Mode: Singleton Window"))
	b.WriteString("\n\n")

	b.WriteString(sectionStyle.Render("Keybindings:"))
	b.WriteString("\n\n")

	b.WriteString(keyStyle.Render("Window Management:"))
	b.WriteString("\n")
	b.WriteString(descStyle.Render("  Ctrl+Shift+T"))
	b.WriteString(" - New tab\n")
	b.WriteString(descStyle.Render("  Ctrl+Shift+N"))
	b.WriteString(" - New window\n")
	b.WriteString(descStyle.Render("  Ctrl+Shift+9"))
	b.WriteString(" - Switch to navigator window\n")
	b.WriteString(descStyle.Render("  Ctrl+Shift+0"))
	b.WriteString(" - Switch to main window\n\n")

	b.WriteString(keyStyle.Render("Navigation:"))
	b.WriteString("\n")
	b.WriteString(descStyle.Render("  Alt+Left/Right"))
	b.WriteString(" - Switch tabs\n")
	b.WriteString(descStyle.Render("  Ctrl+Shift+Arrow"))
	b.WriteString(" - Navigate panes\n\n")

	b.WriteString(keyStyle.Render("Splitting:"))
	b.WriteString("\n")
	b.WriteString(descStyle.Render("  Ctrl+Shift+%"))
	b.WriteString(" - Horizontal split\n")
	b.WriteString(descStyle.Render(`  Ctrl+Shift+"`))
	b.WriteString(" - Vertical split\n\n")

	b.WriteString(keyStyle.Render("Closing:"))
	b.WriteString("\n")
	b.WriteString(descStyle.Render("  Ctrl+Shift+W"))
	b.WriteString(" - Close tab\n\n")

	b.WriteString(helpStyle.Render("Press Ctrl+C or q to quit"))

	containerStyle := lipgloss.NewStyle().
		Width(m.width).
		Height(m.height).
		Padding(1)

	return containerStyle.Render(b.String())
}
