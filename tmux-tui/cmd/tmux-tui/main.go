package main

import (
	"fmt"
	"os"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

type model struct {
	windowID  string
	sessionID string
	width     int
	height    int
}

func initialModel() model {
	// Parse TMUX environment variable to extract session and window info
	tmuxEnv := os.Getenv("TMUX")
	sessionID := "unknown"

	if tmuxEnv != "" {
		// TMUX format: /tmp/tmux-501/default,12345,0
		parts := strings.Split(tmuxEnv, ",")
		if len(parts) >= 2 {
			sessionID = parts[1]
		}
	}

	return model{
		windowID:  "current",
		sessionID: sessionID,
		width:     38, // 40-column pane minus padding
	}
}

func (m model) Init() tea.Cmd {
	return nil
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil
	case tea.KeyMsg:
		switch msg.Type {
		case tea.KeyCtrlC:
			return m, tea.Quit
		}
	}
	return m, nil
}

func (m model) View() string {
	// Use terminal dimensions, with sensible defaults
	width := m.width
	if width < 14 {
		width = 14 // Minimum width for content
	}
	height := m.height
	if height < 5 {
		height = 5 // Minimum height
	}

	// Inner width (excluding borders)
	innerWidth := width - 2

	// Helper to create a line with borders
	emptyLine := "│" + strings.Repeat(" ", innerWidth) + "│"
	centerText := func(text string) string {
		padding := innerWidth - len(text)
		left := padding / 2
		right := padding - left
		return "│" + strings.Repeat(" ", left) + text + strings.Repeat(" ", right) + "│"
	}

	// Build header
	titleText := " tmux-tui "
	headerPadding := innerWidth - len(titleText) - 2 // -2 for corner chars
	headerLine := "╭─" + titleText + strings.Repeat("─", headerPadding) + "╮"

	// Build footer
	footerLine := "╰" + strings.Repeat("─", innerWidth) + "╯"

	// Content lines (fixed content)
	contentLines := []string{
		emptyLine,
		centerText("Hello!"),
		emptyLine,
		centerText("Ctrl+C to quit"),
		emptyLine,
		centerText(fmt.Sprintf("Sess: %s", m.sessionID[:min(4, len(m.sessionID))])),
	}

	// Calculate remaining lines to fill
	usedLines := 1 + len(contentLines) + 1 // header + content + footer
	remainingLines := height - usedLines

	// Build final output
	lines := []string{headerLine}
	lines = append(lines, contentLines...)

	// Fill remaining space with empty lines
	for i := 0; i < remainingLines; i++ {
		lines = append(lines, emptyLine)
	}

	lines = append(lines, footerLine)

	return strings.Join(lines, "\n")
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func main() {
	p := tea.NewProgram(initialModel())
	if _, err := p.Run(); err != nil {
		fmt.Printf("Error running tmux-tui: %v\n", err)
		os.Exit(1)
	}
}
