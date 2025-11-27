package main

import (
	"fmt"
	"os"
	"sync"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/commons-systems/tmux-tui/internal/tmux"
	"github.com/commons-systems/tmux-tui/internal/ui"
	"github.com/commons-systems/tmux-tui/internal/watcher"
)

type tickMsg time.Time

type alertChangedMsg struct {
	paneID  string
	created bool
}

type treeRefreshMsg struct {
	tree tmux.RepoTree
	err  error
}

type model struct {
	collector    *tmux.Collector
	renderer     *ui.TreeRenderer
	alertWatcher *watcher.AlertWatcher
	tree         tmux.RepoTree
	alerts       map[string]bool // Persistent alert state
	alertsMu     sync.RWMutex    // Protects alerts map from race conditions
	width        int
	height       int
	err          error
}

func initialModel() model {
	collector := tmux.NewCollector()
	renderer := ui.NewTreeRenderer(80) // Default width

	// Initial tree load
	tree, err := collector.GetTree()

	// Initialize alert watcher
	alertWatcher, watcherErr := watcher.NewAlertWatcher()
	if watcherErr != nil {
		fmt.Fprintf(os.Stderr, "Warning: Alert watcher failed to initialize: %v\n", watcherErr)
		fmt.Fprintf(os.Stderr, "Alert notifications will be disabled.\n")
		alertWatcher = nil
	}

	// Load existing alerts
	alerts, alertsErr := watcher.GetExistingAlerts()
	if alertsErr != nil {
		fmt.Fprintf(os.Stderr, "Warning: Failed to load existing alerts: %v\n", alertsErr)
		alerts = make(map[string]bool)
	}

	return model{
		collector:    collector,
		renderer:     renderer,
		alertWatcher: alertWatcher,
		tree:         tree,
		alerts:       alerts,
		width:        80,
		height:       24,
		err:          err,
	}
}

func (m model) Init() tea.Cmd {
	cmds := []tea.Cmd{
		tickCmd(),
		refreshTreeCmd(m.collector),
	}

	// Start alert watcher if available
	if m.alertWatcher != nil {
		cmds = append(cmds, watchAlertsCmd(m.alertWatcher))
	}

	return tea.Batch(cmds...)
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
			// Clean up watcher on quit
			if m.alertWatcher != nil {
				m.alertWatcher.Close()
			}
			return m, tea.Quit
		}

	case alertChangedMsg:
		// FAST PATH: Update alert immediately with mutex protection
		m.alertsMu.Lock()
		if msg.created {
			m.alerts[msg.paneID] = true
		} else {
			delete(m.alerts, msg.paneID)
		}
		m.alertsMu.Unlock()
		// Continue watching for more alert events
		if m.alertWatcher != nil {
			return m, watchAlertsCmd(m.alertWatcher)
		}
		return m, nil

	case treeRefreshMsg:
		// Background tree refresh completed
		if msg.err == nil {
			m.tree = msg.tree
			// Reconcile alerts with lock held to prevent race with fast path
			m.alertsMu.Lock()
			m.alerts = reconcileAlerts(m.tree, m.alerts)
			m.alertsMu.Unlock()
			m.err = nil
		} else {
			m.err = msg.err
		}
		return m, nil

	case tickMsg:
		// Periodic refresh (30s)
		return m, tea.Batch(
			refreshTreeCmd(m.collector),
			tickCmd(),
		)
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

	// Copy alerts map with read lock for safe concurrent access
	// We copy to prevent the renderer from accessing the map after lock release
	m.alertsMu.RLock()
	alertsCopy := make(map[string]bool)
	for k, v := range m.alerts {
		alertsCopy[k] = v
	}
	m.alertsMu.RUnlock()

	return m.renderer.Render(m.tree, alertsCopy)
}

// watchAlertsCmd watches for alert file changes
func watchAlertsCmd(w *watcher.AlertWatcher) tea.Cmd {
	return func() tea.Msg {
		event, ok := <-w.Start()
		if !ok {
			return nil // Channel closed, no more events
		}
		return alertChangedMsg{
			paneID:  event.PaneID,
			created: event.Created,
		}
	}
}

// refreshTreeCmd refreshes the tree in the background
func refreshTreeCmd(c *tmux.Collector) tea.Cmd {
	return func() tea.Msg {
		tree, err := c.GetTree()
		return treeRefreshMsg{tree: tree, err: err}
	}
}

// reconcileAlerts removes alerts for panes that no longer exist.
// It modifies the alerts map in-place and returns the same map.
func reconcileAlerts(tree tmux.RepoTree, alerts map[string]bool) map[string]bool {
	// Build set of valid pane IDs from tree
	validPanes := make(map[string]bool)
	for _, branches := range tree {
		for _, panes := range branches {
			for _, pane := range panes {
				validPanes[pane.ID] = true
			}
		}
	}

	// Remove alerts for deleted panes
	for paneID := range alerts {
		if !validPanes[paneID] {
			delete(alerts, paneID)
		}
	}
	return alerts
}

func tickCmd() tea.Cmd {
	return tea.Tick(30*time.Second, func(t time.Time) tea.Msg {
		return tickMsg(t)
	})
}

// GetAlertsForTesting returns a copy of current alert state (testing only)
func (m model) GetAlertsForTesting() map[string]bool {
	m.alertsMu.RLock()
	defer m.alertsMu.RUnlock()

	// Return copy to prevent races with caller
	alerts := make(map[string]bool, len(m.alerts))
	for k, v := range m.alerts {
		alerts[k] = v
	}
	return alerts
}

func main() {
	p := tea.NewProgram(initialModel())
	if _, err := p.Run(); err != nil {
		fmt.Printf("Error running tmux-tui: %v\n", err)
		os.Exit(1)
	}
}
