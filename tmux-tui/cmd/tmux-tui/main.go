package main

import (
	"fmt"
	"os"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/commons-systems/tmux-tui/internal/tmux"
	"github.com/commons-systems/tmux-tui/internal/ui"
)

type tickMsg time.Time

type model struct {
	collector *tmux.Collector
	renderer  *ui.TreeRenderer
	tree      tmux.RepoTree
	width     int
	height    int
	err       error
}

func initialModel() model {
	collector := tmux.NewCollector()
	renderer := ui.NewTreeRenderer(80) // Default width

	// Initial tree load
	tree, err := collector.GetTree()

	return model{
		collector: collector,
		renderer:  renderer,
		tree:      tree,
		width:     80,
		height:    24,
		err:       err,
	}
}

func (m model) Init() tea.Cmd {
	return tickCmd()
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.renderer.SetWidth(msg.Width)
		m.renderer.SetHeight(msg.Height)
		return m, nil

	case tea.KeyMsg:
		switch msg.Type {
		case tea.KeyCtrlC:
			return m, tea.Quit
		}

	case tickMsg:
		// Refresh tree data
		tree, err := m.collector.GetTree()
		if err == nil {
			m.tree = tree
			m.err = nil
		} else {
			m.err = err
		}
		return m, tickCmd()
	}

	return m, nil
}

func (m model) View() string {
	if m.err != nil {
		return fmt.Sprintf("Error: %v\n\nPress Ctrl+C to quit", m.err)
	}

	if m.tree == nil {
		return "Loading..."
	}

	return m.renderer.Render(m.tree)
}

func tickCmd() tea.Cmd {
	return tea.Tick(2*time.Second, func(t time.Time) tea.Msg {
		return tickMsg(t)
	})
}

func main() {
	p := tea.NewProgram(initialModel())
	if _, err := p.Run(); err != nil {
		fmt.Printf("Error running tmux-tui: %v\n", err)
		os.Exit(1)
	}
}
