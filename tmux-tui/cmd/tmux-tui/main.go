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
	case tea.KeyMsg:
		switch msg.Type {
		case tea.KeyCtrlC:
			return m, tea.Quit
		}
	}
	return m, nil
}

func (m model) View() string {
	// Build the TUI output (fixed 38 characters wide)
	lines := []string{
		"╭─ tmux-tui ─╮",
		"│            │",
		"│   Hello!   │",
		"│            │",
		"│  Ctrl+C    │",
		"│  to quit   │",
		"│            │",
		fmt.Sprintf("│ Sess: %-4s │", m.sessionID[:min(4, len(m.sessionID))]),
		"│            │",
		"╰────────────╯",
	}

	return strings.Join(lines, "\n") + "\n"
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
