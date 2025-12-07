package main

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/commons-systems/tmux-tui/internal/daemon"
	"github.com/commons-systems/tmux-tui/internal/debug"
	"github.com/commons-systems/tmux-tui/internal/tmux"
	"github.com/commons-systems/tmux-tui/internal/ui"
)

type tickMsg time.Time

type daemonEventMsg struct {
	msg daemon.Message
}

type treeRefreshMsg struct {
	tree tmux.RepoTree
	err  error
}

type model struct {
	collector      *tmux.Collector
	renderer       *ui.TreeRenderer
	daemonClient   *daemon.DaemonClient
	tree           tmux.RepoTree
	alerts         map[string]string // Alert state received from daemon: paneID -> eventType
	alertsMu       *sync.RWMutex     // Protects alerts map from race conditions
	blockedPanes   map[string]string // Blocked pane state: paneID -> blockedOnBranch
	blockedMu      *sync.RWMutex     // Protects blocked panes map
	width          int
	height         int
	err            error
	alertsDisabled bool   // true if daemon connection failed
	alertError     string // daemon connection error
	// Branch picker state
	pickingBranch  bool             // true when showing branch picker
	pickingForPane string           // pane ID being blocked
	branchPicker   *ui.BranchPicker // the picker UI
}

func initialModel() model {
	collector, collectorErr := tmux.NewCollector()
	if collectorErr != nil {
		return model{
			err: fmt.Errorf("failed to initialize collector: %w", collectorErr),
		}
	}

	renderer := ui.NewTreeRenderer(80) // Default width

	// Initial tree load
	tree, err := collector.GetTree()

	// Initialize daemon client
	var alertsDisabled bool
	var alertError string
	daemonClient := daemon.NewDaemonClient()

	// Try to connect to daemon with retries
	// Use background context with a reasonable timeout for initialization
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := daemonClient.ConnectWithRetry(ctx, 5); err != nil {
		fmt.Fprintf(os.Stderr, "Warning: Failed to connect to daemon: %v\n", err)
		fmt.Fprintf(os.Stderr, "Alert notifications will be disabled.\n")
		daemonClient = nil
		alertsDisabled = true
		alertError = err.Error()
	}

	return model{
		collector:      collector,
		renderer:       renderer,
		daemonClient:   daemonClient,
		tree:           tree,
		alerts:         make(map[string]string),
		alertsMu:       &sync.RWMutex{},
		blockedPanes:   make(map[string]string),
		blockedMu:      &sync.RWMutex{},
		width:          80,
		height:         24,
		err:            err,
		alertsDisabled: alertsDisabled,
		alertError:     alertError,
		pickingBranch:  false,
		branchPicker:   ui.NewBranchPicker([]string{}, 80, 24),
	}
}

func (m model) Init() tea.Cmd {
	cmds := []tea.Cmd{
		tickCmd(),
		refreshTreeCmd(m.collector),
	}

	// Start daemon event listener if connected
	if m.daemonClient != nil {
		cmds = append(cmds, watchDaemonCmd(m.daemonClient))
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
		// Handle picker navigation if active
		if m.pickingBranch {
			switch msg.String() {
			case "up", "k":
				m.branchPicker.MoveUp()
				return m, nil
			case "down", "j":
				m.branchPicker.MoveDown()
				return m, nil
			case "enter":
				// Confirm selection - send block request
				selectedBranch := m.branchPicker.Selected()
				if selectedBranch != "" && m.daemonClient != nil {
					if err := m.daemonClient.BlockPane(m.pickingForPane, selectedBranch); err != nil {
						fmt.Fprintf(os.Stderr, "Error blocking pane: %v\n", err)
					}
				}
				m.pickingBranch = false
				m.pickingForPane = ""
				return m, nil
			case "esc":
				// Cancel picker
				m.pickingBranch = false
				m.pickingForPane = ""
				return m, nil
			}
			return m, nil
		}

		// Normal key handling when picker is not active
		switch msg.Type {
		case tea.KeyCtrlC:
			// Clean up daemon client on quit
			if m.daemonClient != nil {
				if err := m.daemonClient.Close(); err != nil {
					fmt.Fprintf(os.Stderr, "Error closing daemon client: %v\n", err)
				}
			}
			return m, tea.Quit
		}

	case daemonEventMsg:
		// Handle daemon event
		switch msg.msg.Type {
		case daemon.MsgTypeFullState:
			// Full state received - update alerts and blocked panes
			m.alertsMu.Lock()
			if msg.msg.Alerts != nil {
				m.alerts = msg.msg.Alerts
			} else {
				m.alerts = make(map[string]string)
			}
			m.alertsMu.Unlock()

			m.blockedMu.Lock()
			if msg.msg.BlockedPanes != nil {
				m.blockedPanes = msg.msg.BlockedPanes
			} else {
				m.blockedPanes = make(map[string]string)
			}
			m.blockedMu.Unlock()

			debug.Log("TUI_DAEMON_STATE alerts=%d blocked=%d", len(msg.msg.Alerts), len(msg.msg.BlockedPanes))
			// Trigger tree refresh to update UI
			if m.daemonClient != nil {
				return m, tea.Batch(watchDaemonCmd(m.daemonClient), refreshTreeCmd(m.collector))
			}
			return m, nil

		case daemon.MsgTypeAlertChange:
			// Single alert changed
			debug.Log("TUI_DAEMON_ALERT paneID=%s eventType=%s created=%v",
				msg.msg.PaneID, msg.msg.EventType, msg.msg.Created)

			m.alertsMu.Lock()
			if msg.msg.Created && msg.msg.EventType != "working" {
				// Alert state (idle, stop, permission, elicitation) - store it
				m.alerts[msg.msg.PaneID] = msg.msg.EventType
			} else {
				// Either file deleted OR "working" state - remove alert
				delete(m.alerts, msg.msg.PaneID)
			}
			m.alertsMu.Unlock()

			// Continue watching daemon events (no tree refresh needed - alert state is managed by daemon)
			if m.daemonClient != nil {
				return m, watchDaemonCmd(m.daemonClient)
			}
			return m, nil

		case daemon.MsgTypeShowBlockPicker:
			// Show branch picker for specified pane
			debug.Log("TUI_SHOW_PICKER paneID=%s", msg.msg.PaneID)
			m.pickingForPane = msg.msg.PaneID

			// Extract all unique branches from tree
			branchSet := make(map[string]bool)
			for _, branches := range m.tree {
				for branch := range branches {
					branchSet[branch] = true
				}
			}
			branches := make([]string, 0, len(branchSet))
			for branch := range branchSet {
				branches = append(branches, branch)
			}
			// Sort branches alphabetically for consistent display
			sortBranches := func(branches []string) {
				for i := 0; i < len(branches); i++ {
					for j := i + 1; j < len(branches); j++ {
						if branches[i] > branches[j] {
							branches[i], branches[j] = branches[j], branches[i]
						}
					}
				}
			}
			sortBranches(branches)

			m.branchPicker.SetBranches(branches)
			m.pickingBranch = true

			// Continue watching daemon
			if m.daemonClient != nil {
				return m, watchDaemonCmd(m.daemonClient)
			}
			return m, nil

		case daemon.MsgTypeBlockChange:
			// Block state changed for a pane
			debug.Log("TUI_BLOCK_CHANGE paneID=%s branch=%s blocked=%v",
				msg.msg.PaneID, msg.msg.BlockedBranch, msg.msg.Blocked)

			m.blockedMu.Lock()
			if msg.msg.Blocked {
				m.blockedPanes[msg.msg.PaneID] = msg.msg.BlockedBranch
			} else {
				delete(m.blockedPanes, msg.msg.PaneID)
			}
			m.blockedMu.Unlock()

			// Continue watching daemon
			if m.daemonClient != nil {
				return m, watchDaemonCmd(m.daemonClient)
			}
			return m, nil

		case "disconnect":
			// Daemon disconnected
			debug.Log("TUI_DAEMON_DISCONNECT")
			fmt.Fprintf(os.Stderr, "Disconnected from daemon\n")
			m.alertsDisabled = true
			m.alertError = "Disconnected from daemon"
			m.daemonClient = nil
			return m, nil
		}

		// Continue watching
		if m.daemonClient != nil {
			return m, watchDaemonCmd(m.daemonClient)
		}
		return m, nil

	case treeRefreshMsg:
		// Background tree refresh completed
		if msg.err == nil {
			m.tree = msg.tree
			// Reconcile alerts with lock held to prevent race with fast path
			m.alertsMu.Lock()
			alertsBefore := len(m.alerts)
			m.alerts = reconcileAlerts(m.tree, m.alerts)
			alertsAfter := len(m.alerts)
			removed := alertsBefore - alertsAfter

			// Count total panes in tree
			totalPanes := 0
			for _, branches := range m.tree {
				for _, panes := range branches {
					totalPanes += len(panes)
				}
			}

			// Log reconciliation results
			debug.Log("TUI_RECONCILE removed=%d remaining=%d panes_in_tree=%d", removed, alertsAfter, totalPanes)
			m.alertsMu.Unlock()
			m.err = nil
		} else {
			fmt.Fprintf(os.Stderr, "Tree refresh failed: %v\n", msg.err)
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

	// Display alert error banner at TOP of screen if alerts are disabled
	var warningBanner string
	if m.alertsDisabled {
		warningStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("0")).
			Background(lipgloss.Color("3")).
			Bold(true).
			Padding(0, 1)
		warningBanner = warningStyle.Render("⚠ ALERT NOTIFICATIONS DISABLED: "+m.alertError) + "\n\n"
	}

	// Copy alerts and blocked panes maps with read locks for safe concurrent access
	m.alertsMu.RLock()
	alertsCopy := make(map[string]string)
	for k, v := range m.alerts {
		alertsCopy[k] = v
	}
	m.alertsMu.RUnlock()

	m.blockedMu.RLock()
	blockedCopy := make(map[string]string)
	for k, v := range m.blockedPanes {
		blockedCopy[k] = v
	}
	m.blockedMu.RUnlock()

	output := m.renderer.Render(m.tree, alertsCopy, blockedCopy)

	// If picker is active, overlay it centered on screen
	if m.pickingBranch {
		pickerView := m.branchPicker.Render()
		// Use lipgloss to center the picker
		centeredPicker := lipgloss.Place(
			m.width,
			m.height,
			lipgloss.Center,
			lipgloss.Center,
			pickerView,
		)
		return centeredPicker
	}

	return warningBanner + output
}

// watchDaemonCmd watches for daemon events
func watchDaemonCmd(client *daemon.DaemonClient) tea.Cmd {
	return func() tea.Msg {
		msg, ok := <-client.Events()
		if !ok {
			// Channel closed
			return daemonEventMsg{
				msg: daemon.Message{Type: "disconnect"},
			}
		}
		return daemonEventMsg{msg: msg}
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
func reconcileAlerts(tree tmux.RepoTree, alerts map[string]string) map[string]string {
	// Build set of valid pane IDs from tree
	validPanes := make(map[string]bool)
	for _, branches := range tree {
		for _, panes := range branches {
			for _, pane := range panes {
				validPanes[pane.ID] = true
			}
		}
	}

	// Debug: Log the pane IDs in the tree
	debug.Log("TUI_RECONCILE_DEBUG validPanes=%v alerts=%v", validPanes, alerts)

	// Remove alerts for deleted panes
	for paneID := range alerts {
		if !validPanes[paneID] {
			debug.Log("TUI_RECONCILE_REMOVING paneID=%s notInTree=true", paneID)
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
func (m model) GetAlertsForTesting() map[string]string {
	m.alertsMu.RLock()
	defer m.alertsMu.RUnlock()

	// Return copy to prevent races with caller
	alerts := make(map[string]string, len(m.alerts))
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
