package main

import (
	"context"
	"fmt"
	"os"
	"sort"
	"sync"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/commons-systems/tmux-tui/internal/daemon"
	"github.com/commons-systems/tmux-tui/internal/debug"
	"github.com/commons-systems/tmux-tui/internal/namespace"
	"github.com/commons-systems/tmux-tui/internal/tmux"
	"github.com/commons-systems/tmux-tui/internal/ui"
)

type tickMsg time.Time

type timeTickMsg time.Time

type daemonEventMsg struct {
	msg daemon.Message
}

type treeRefreshMsg struct {
	tree tmux.RepoTree
	err  error
}

type model struct {
	collector    *tmux.Collector
	renderer     *ui.TreeRenderer
	daemonClient *daemon.DaemonClient
	tree         tmux.RepoTree

	// Alert state with concurrency protection
	alerts   map[string]string
	alertsMu *sync.RWMutex

	// Blocked branch state with concurrency protection
	blockedBranches map[string]string
	blockedMu       *sync.RWMutex

	// Error state with concurrency protection
	// Six distinct error paths determine application behavior:
	// 1. err != nil: Fatal error - displays message and exits immediately
	// 2. alertsDisabled == true: Non-fatal - continues running but disables alerts
	// 3. alertError != "": Alert system error - displays warning banner but continues
	// 4. persistenceError != "": Daemon persistence failure - displays warning banner
	// 5. audioError != "": Audio playback failure - displays warning banner
	// 6. treeRefreshError != nil: Tmux tree refresh failure - displays warning banner
	err              error
	alertsDisabled   bool
	alertError       string
	persistenceError string
	audioError       string
	treeRefreshError error         // NEW: tree refresh failure tracking
	errorMu          *sync.RWMutex // NEW: protects all error fields

	// UI state
	width  int
	height int

	// Branch picker state
	pickingBranch    bool
	pickingForBranch string
	branchPicker     *ui.BranchPicker
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
		socketPath := namespace.DaemonSocket()

		_, statErr := os.Stat(socketPath)
		var guidance string
		if os.IsNotExist(statErr) {
			guidance = "Daemon not running. Start with: tmux-tui-daemon"
		} else if os.IsPermission(statErr) {
			guidance = fmt.Sprintf("Permission denied accessing socket: %s", socketPath)
		} else {
			guidance = "Daemon may be unresponsive or socket corrupted"
		}

		enhancedError := fmt.Sprintf("%v\nSocket: %s\n%s", err, socketPath, guidance)

		fmt.Fprintf(os.Stderr, "Warning: Failed to connect to daemon:\n%s\n", enhancedError)
		fmt.Fprintf(os.Stderr, "Alert notifications will be disabled.\n")

		daemonClient = nil
		alertsDisabled = true
		alertError = enhancedError
	}

	return model{
		collector:       collector,
		renderer:        renderer,
		daemonClient:    daemonClient,
		tree:            tree,
		alerts:          make(map[string]string),
		alertsMu:        &sync.RWMutex{},
		blockedBranches: make(map[string]string),
		blockedMu:       &sync.RWMutex{},
		errorMu:         &sync.RWMutex{}, // NEW
		width:           80,
		height:          24,
		err:             err,
		alertsDisabled:  alertsDisabled,
		alertError:      alertError,
		pickingBranch:   false,
		branchPicker:    ui.NewBranchPicker([]string{}, 80, 24),
	}
}

func (m model) Init() tea.Cmd {
	cmds := []tea.Cmd{
		tickCmd(),
		timeTickCmd(),
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
				// Confirm selection - send block request for branch
				selectedBranch := m.branchPicker.Selected()
				if selectedBranch != "" && m.daemonClient != nil && m.pickingForBranch != "" {
					if err := m.daemonClient.BlockBranch(m.pickingForBranch, selectedBranch); err != nil {
						fmt.Fprintf(os.Stderr, "Error blocking branch: %v\n", err)
					}
				}
				m.pickingBranch = false
				m.pickingForBranch = ""
				return m, nil
			case "esc":
				// Cancel picker
				m.pickingBranch = false
				m.pickingForBranch = ""
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
			// Full state received - update alerts and blocked branches
			m.alertsMu.Lock()
			if msg.msg.Alerts != nil {
				m.alerts = msg.msg.Alerts
			} else {
				m.alerts = make(map[string]string)
			}
			m.alertsMu.Unlock()

			m.blockedMu.Lock()
			if msg.msg.BlockedBranches != nil {
				m.blockedBranches = msg.msg.BlockedBranches
			} else {
				m.blockedBranches = make(map[string]string)
			}
			m.blockedMu.Unlock()

			debug.Log("TUI_DAEMON_STATE alerts=%d blocked=%d", len(msg.msg.Alerts), len(msg.msg.BlockedBranches))
			// Trigger tree refresh to update UI
			if m.daemonClient != nil {
				return m, tea.Batch(watchDaemonCmd(m.daemonClient), refreshTreeCmd(m.collector))
			}
			return m, nil

		case daemon.MsgTypePaneFocus:
			// Pane focus changed - update active pane
			debug.Log("TUI_PANE_FOCUS paneID=%s", msg.msg.ActivePaneID)
			m.updateActivePane(msg.msg.ActivePaneID)
			if m.daemonClient != nil {
				return m, watchDaemonCmd(m.daemonClient)
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
			// Show branch picker for specified pane (or toggle off if already blocked)
			debug.Log("TUI_SHOW_PICKER paneID=%s", msg.msg.PaneID)

			// Find which branch this pane is on
			var currentBranch string
			for _, branches := range m.tree {
				for branch, panes := range branches {
					for _, pane := range panes {
						if pane.ID == msg.msg.PaneID {
							currentBranch = branch
							break
						}
					}
					if currentBranch != "" {
						break
					}
				}
				if currentBranch != "" {
					break
				}
			}

			// Check if this branch is already blocked - if so, unblock it (toggle)
			m.blockedMu.RLock()
			_, isBlocked := m.blockedBranches[currentBranch]
			m.blockedMu.RUnlock()

			if isBlocked {
				// Branch is already blocked - toggle it off
				debug.Log("TUI_TOGGLE_UNBLOCK branch=%s", currentBranch)
				if m.daemonClient != nil {
					if err := m.daemonClient.UnblockBranch(currentBranch); err != nil {
						fmt.Fprintf(os.Stderr, "Error unblocking branch: %v\n", err)
					}
				}
				// Continue watching daemon
				if m.daemonClient != nil {
					return m, watchDaemonCmd(m.daemonClient)
				}
				return m, nil
			}

			// Branch is not blocked - show picker to block it
			m.pickingForBranch = currentBranch

			// Extract all unique branches from tree (excluding current branch)
			branchSet := make(map[string]bool)
			for _, branches := range m.tree {
				for branch := range branches {
					// A branch cannot block itself
					if branch != currentBranch {
						branchSet[branch] = true
					}
				}
			}
			branches := make([]string, 0, len(branchSet))
			for branch := range branchSet {
				branches = append(branches, branch)
			}
			// Sort branches alphabetically for consistent display
			sort.Strings(branches)

			m.branchPicker.SetBranches(branches)
			m.pickingBranch = true

			// Continue watching daemon
			if m.daemonClient != nil {
				return m, watchDaemonCmd(m.daemonClient)
			}
			return m, nil

		case daemon.MsgTypeBlockChange:
			// Block state changed for a branch
			debug.Log("TUI_BLOCK_CHANGE branch=%s blockedBy=%s blocked=%v",
				msg.msg.Branch, msg.msg.BlockedBranch, msg.msg.Blocked)

			m.blockedMu.Lock()
			if msg.msg.Blocked {
				m.blockedBranches[msg.msg.Branch] = msg.msg.BlockedBranch
			} else {
				delete(m.blockedBranches, msg.msg.Branch)
			}
			m.blockedMu.Unlock()

			// Close picker in all TUI windows when a block is confirmed
			if m.pickingBranch {
				m.pickingBranch = false
				m.pickingForBranch = ""
			}

			// Continue watching daemon
			if m.daemonClient != nil {
				return m, watchDaemonCmd(m.daemonClient)
			}
			return m, nil

		case daemon.MsgTypePersistenceError:
			// Persistence error from daemon
			debug.Log("TUI_PERSISTENCE_ERROR error=%s", msg.msg.Error)
			m.errorMu.Lock()
			m.persistenceError = msg.msg.Error
			m.errorMu.Unlock()

			// Continue watching daemon
			if m.daemonClient != nil {
				return m, watchDaemonCmd(m.daemonClient)
			}
			return m, nil

		case daemon.MsgTypeAudioError:
			// Audio playback error from daemon
			debug.Log("TUI_AUDIO_ERROR error=%s", msg.msg.Error)
			m.errorMu.Lock()
			m.audioError = msg.msg.Error
			m.errorMu.Unlock()

			// Continue watching daemon
			if m.daemonClient != nil {
				return m, watchDaemonCmd(m.daemonClient)
			}
			return m, nil

		case "disconnect":
			// Daemon disconnected
			debug.Log("TUI_DAEMON_DISCONNECT")
			fmt.Fprintf(os.Stderr, "Disconnected from daemon\n")
			m.errorMu.Lock()
			m.alertsDisabled = true
			m.alertError = "Disconnected from daemon"
			m.errorMu.Unlock()
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
			m.errorMu.Lock()
			m.err = nil
			m.treeRefreshError = nil
			m.errorMu.Unlock()
		} else {
			fmt.Fprintf(os.Stderr, "Tree refresh failed: %v\n", msg.err)
			m.errorMu.Lock()
			m.treeRefreshError = msg.err // Always update with latest error
			m.errorMu.Unlock()
		}
		return m, nil

	case tickMsg:
		// Periodic refresh (30s)
		return m, tea.Batch(
			refreshTreeCmd(m.collector),
			tickCmd(),
		)

	case timeTickMsg:
		// Time tick for header update (1s)
		return m, timeTickCmd()
	}

	return m, nil
}

// warningStyle creates a lipgloss style for warning banners with the specified background color
func warningStyle(bgColor string) lipgloss.Style {
	return lipgloss.NewStyle().
		Foreground(lipgloss.Color("0")).
		Background(lipgloss.Color(bgColor)).
		Bold(true).
		Padding(0, 1)
}

func (m model) View() string {
	// Snapshot error state with read lock
	m.errorMu.RLock()
	criticalErr := m.err
	persistenceErr := m.persistenceError
	audioErr := m.audioError
	alertsDisabled := m.alertsDisabled
	alertErr := m.alertError
	treeRefreshErr := m.treeRefreshError
	m.errorMu.RUnlock()

	if criticalErr != nil {
		return fmt.Sprintf("Error: %v\n\nPress Ctrl+C to quit", criticalErr)
	}

	if m.tree == nil {
		return "Loading..."
	}

	// Build warning banners (priority: persistence > audio > tree refresh > alerts)
	var warningBanner string

	if persistenceErr != "" {
		warningBanner = warningStyle("1").Render("⚠ PERSISTENCE ERROR: "+persistenceErr+" (changes won't survive restart)") + "\n\n"
	} else if audioErr != "" {
		warningBanner = warningStyle("3").Render("⚠ AUDIO ERROR: "+audioErr+" (notifications may not work)") + "\n\n"
	} else if treeRefreshErr != nil {
		warningBanner = warningStyle("3").Render(fmt.Sprintf("⚠ TREE REFRESH FAILED: %v (showing stale data, will retry)", treeRefreshErr)) + "\n\n"
	} else if alertsDisabled {
		warningBanner = warningStyle("3").Render("⚠ ALERT NOTIFICATIONS DISABLED: "+alertErr) + "\n\n"
	}

	// Render header
	header := m.renderer.RenderHeader()

	// Copy alerts and blocked panes maps with read locks for safe concurrent access
	// We copy to prevent the renderer from accessing the map after lock release
	m.alertsMu.RLock()
	alertsCopy := make(map[string]string)
	for k, v := range m.alerts {
		alertsCopy[k] = v
	}
	m.alertsMu.RUnlock()

	m.blockedMu.RLock()
	blockedCopy := make(map[string]string)
	for k, v := range m.blockedBranches {
		blockedCopy[k] = v
	}
	m.blockedMu.RUnlock()

	if len(blockedCopy) > 0 {
		debug.Log("TUI_VIEW_RENDER blockedBranches=%v", blockedCopy)
	}

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

	return header + "\n" + warningBanner + output
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

// updateActivePane updates the WindowActive flag across all panes in the tree.
func (m *model) updateActivePane(activePaneID string) {
	if m.tree == nil {
		return
	}

	for _, branches := range m.tree {
		for _, panes := range branches {
			for i := range panes {
				panes[i].WindowActive = (panes[i].ID == activePaneID)
			}
		}
	}
}

func timeTickCmd() tea.Cmd {
	return tea.Tick(time.Second, func(t time.Time) tea.Msg {
		return timeTickMsg(t)
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
