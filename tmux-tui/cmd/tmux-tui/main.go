package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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

	alerts := getActiveAlerts()
	return m.renderer.Render(m.tree, alerts)
}

// getActiveAlerts reads alert files from filesystem and validates against existing panes
func getActiveAlerts() map[string]bool {
	alerts := make(map[string]bool)

	// Get list of all current pane IDs
	validPanes := make(map[string]bool)
	output, err := exec.Command("tmux", "list-panes", "-a", "-F", "#{pane_id}").Output()
	if err == nil {
		for _, paneID := range strings.Split(strings.TrimSpace(string(output)), "\n") {
			if paneID != "" {
				validPanes[paneID] = true
			}
		}
	}

	pattern := "/tmp/claude/tui-alert-*"
	matches, _ := filepath.Glob(pattern)
	for _, file := range matches {
		paneID := strings.TrimPrefix(filepath.Base(file), "tui-alert-")
		// Only include if pane currently exists (validates format implicitly)
		if validPanes[paneID] {
			alerts[paneID] = true
		}
	}
	return alerts
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
