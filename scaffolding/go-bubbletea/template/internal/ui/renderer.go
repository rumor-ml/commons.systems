package ui

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

var (
	titleStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("205")).
			MarginBottom(1)

	contentStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("252"))

	helpStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("241")).
			MarginTop(1)
)

// Renderer handles UI rendering
type Renderer struct {
	width int
}

// NewRenderer creates a new Renderer instance
func NewRenderer(width int) *Renderer {
	return &Renderer{width: width}
}

// SetWidth updates the renderer width
func (r *Renderer) SetWidth(width int) {
	r.width = width
}

// Render renders the UI
func (r *Renderer) Render() string {
	var b strings.Builder

	title := titleStyle.Render("{{APP_NAME_TITLE}}")
	b.WriteString(title)
	b.WriteString("\n\n")

	content := contentStyle.Render("Welcome to your new Bubbletea TUI app!")
	b.WriteString(content)
	b.WriteString("\n")

	help := helpStyle.Render("Press Ctrl+C or Esc to quit")
	b.WriteString(help)
	b.WriteString("\n")

	return b.String()
}
