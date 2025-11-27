package ui

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

const (
	ColorTitle   = lipgloss.Color("205") // Pink
	ColorContent = lipgloss.Color("252") // Light gray
	ColorHelp    = lipgloss.Color("241") // Dim gray
)

var (
	titleStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(ColorTitle).
			MarginBottom(1)

	contentStyle = lipgloss.NewStyle().
			Foreground(ColorContent)

	helpStyle = lipgloss.NewStyle().
			Foreground(ColorHelp).
			MarginTop(1)
)

// Render renders the UI
func Render(width int) string {
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
