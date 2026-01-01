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

type timeTickMsg time.Time

type daemonEventMsg struct {
	msg daemon.Message
}

type model struct {
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
	err                   error
	alertsDisabled        bool
	alertError            string
	persistenceError      string
	audioError            string
	treeRefreshError      error         // NEW: tree refresh failure tracking
	consecutiveNilUpdates int           // Circuit breaker for malformed tree updates
	errorMu               *sync.RWMutex // NEW: protects all error fields

	// UI state
	width  int
	height int

	// Branch picker state
	pickingBranch    bool
	pickingForBranch string
	branchPicker     *ui.BranchPicker
}

func initialModel() model {
	// Initialize model with mutexes first to ensure safe concurrent access
	m := model{
		alerts:          make(map[string]string),
		alertsMu:        &sync.RWMutex{},
		blockedBranches: make(map[string]string),
		blockedMu:       &sync.RWMutex{},
		errorMu:         &sync.RWMutex{},
		width:           80,
		height:          24,
		pickingBranch:   false,
		branchPicker:    ui.NewBranchPicker([]string{}, 80, 24),
	}

	renderer := ui.NewTreeRenderer(80) // Default width
	m.renderer = renderer

	// Initialize empty tree - populated by daemon tree_update broadcasts (not client-side collection)
	// Daemon collects tree once and broadcasts to all clients, eliminating redundant per-client queries
	m.tree = tmux.NewRepoTree()

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
	m.daemonClient = daemonClient

	// Set error fields under lock to prevent races with concurrent access
	m.errorMu.Lock()
	m.alertsDisabled = alertsDisabled
	m.alertError = alertError
	m.errorMu.Unlock()

	return m
}

func (m model) Init() tea.Cmd {
	cmds := []tea.Cmd{
		timeTickCmd(),
	}

	// Start daemon event listener if connected
	// Tree updates come from daemon broadcasts - no client-side collection needed
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
						errMsg := fmt.Sprintf("Failed to block branch '%s' with '%s': %v\nBlock was not applied.", m.pickingForBranch, selectedBranch, err)
						fmt.Fprintf(os.Stderr, "ERROR: %s\n", errMsg)

						// Make error visible in UI
						m.errorMu.Lock()
						m.alertError = errMsg
						m.errorMu.Unlock()

						// Keep picker open so user can see error and retry
						return m, nil
					}
					// Request sent successfully - waiting for daemon block_change confirmation
					fmt.Fprintf(os.Stderr, "Block request sent: '%s' blocked by '%s' (waiting for confirmation)\n", m.pickingForBranch, selectedBranch)
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
					fmt.Fprintf(os.Stderr, "WARNING: Failed to cleanly close daemon connection: %v\n", err)
					fmt.Fprintf(os.Stderr, "         Application will exit anyway but daemon may have stale client state\n")
					debug.Log("TUI_CLIENT_CLOSE_ERROR error=%v", err)
				} else {
					debug.Log("TUI_CLIENT_CLOSE_SUCCESS")
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
			// Continue watching daemon (tree updates come via tree_update messages)
			return m, m.continueWatchingDaemon()

		case daemon.MsgTypePaneFocus:
			// Pane focus changed - logged for debugging, tree state comes via tree_update
			debug.Log("TUI_PANE_FOCUS paneID=%s", msg.msg.ActivePaneID)
			return m, m.continueWatchingDaemon()

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
			return m, m.continueWatchingDaemon()

		case daemon.MsgTypeShowBlockPicker:
			// Show branch picker for specified pane (or toggle off if already blocked)
			debug.Log("TUI_SHOW_PICKER paneID=%s", msg.msg.PaneID)

			// Find which branch this pane is on
			var currentBranch string
			for _, repo := range m.tree.Repos() {
				for _, branch := range m.tree.Branches(repo) {
					panes, ok := m.tree.GetPanes(repo, branch)
					if !ok {
						continue
					}
					for _, pane := range panes {
						if pane.ID() == msg.msg.PaneID {
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
						errMsg := fmt.Sprintf("Failed to unblock branch '%s': %v\nBranch remains blocked. Check daemon status or retry.", currentBranch, err)
						fmt.Fprintf(os.Stderr, "ERROR: %s\n", errMsg)

						// Make error visible in UI - use alertError for daemon communication failures
						m.errorMu.Lock()
						m.alertError = errMsg
						m.errorMu.Unlock()

						return m, m.continueWatchingDaemon()
					}
					// Request sent successfully - waiting for daemon block_change confirmation
				}
				return m, m.continueWatchingDaemon()
			}

			// Branch is not blocked - show picker to block it
			m.pickingForBranch = currentBranch

			// Extract all unique branches from tree (excluding current branch)
			branchSet := make(map[string]bool)
			for _, repo := range m.tree.Repos() {
				for _, branch := range m.tree.Branches(repo) {
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
			return m, m.continueWatchingDaemon()

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
			return m, m.continueWatchingDaemon()

		case daemon.MsgTypePersistenceError:
			// Persistence error from daemon
			debug.Log("TUI_PERSISTENCE_ERROR error=%s", msg.msg.Error)
			m.errorMu.Lock()
			m.persistenceError = msg.msg.Error
			m.errorMu.Unlock()

			// Continue watching daemon
			return m, m.continueWatchingDaemon()

		case daemon.MsgTypeAudioError:
			// Audio playback error from daemon
			debug.Log("TUI_AUDIO_ERROR error=%s", msg.msg.Error)
			m.errorMu.Lock()
			m.audioError = msg.msg.Error
			m.errorMu.Unlock()

			// Continue watching daemon
			return m, m.continueWatchingDaemon()

		case daemon.MsgTypeTreeUpdate:
			// Tree update received from daemon
			if msg.msg.Tree == nil {
				m.consecutiveNilUpdates++

				err := fmt.Errorf("received tree_update with nil Tree field (seq=%d)", msg.msg.SeqNum)
				debug.Log("TUI_TREE_UPDATE_INVALID error=%v consecutive=%d", err, m.consecutiveNilUpdates)

				// CRITICAL: Set error state IMMEDIATELY to show warning banner
				m.errorMu.Lock()
				m.treeRefreshError = err
				m.errorMu.Unlock()

				// User-facing error notification
				fmt.Fprintf(os.Stderr, "ERROR: Received invalid tree update from daemon (seqNum=%d)\n", msg.msg.SeqNum)
				fmt.Fprintf(os.Stderr, "       Tree data is missing. This indicates a daemon bug or protocol mismatch.\n")

				// Circuit breaker: disconnect after 3 consecutive nil updates
				if m.consecutiveNilUpdates >= 3 {
					fmt.Fprintf(os.Stderr, `CRITICAL: Received %d consecutive nil tree updates. Disconnecting from daemon.

       To recover:
       1. pkill tmux-tui-daemon
       2. tmux-tui-daemon &
       3. Restart tmux-tui clients
`, m.consecutiveNilUpdates)

					if m.daemonClient != nil {
						m.daemonClient.Close()
					}
					m.daemonClient = nil
					m.errorMu.Lock()
					m.treeRefreshError = fmt.Errorf("daemon sending malformed updates - disconnected after %d failures", m.consecutiveNilUpdates)
					m.errorMu.Unlock()
					return m, nil // Circuit breaker: stop watching daemon after too many malformed updates
				}

				fmt.Fprintf(os.Stderr, "       Tree display will show stale data. Consider restarting the daemon.\n")

				return m, m.continueWatchingDaemon()
			}

			// Valid tree received - reset circuit breaker
			m.consecutiveNilUpdates = 0

			m.tree = *msg.msg.Tree
			// Reconcile alerts with lock held to prevent race with fast path
			m.alertsMu.Lock()
			alertsBefore := len(m.alerts)
			m.alerts = reconcileAlerts(m.tree, m.alerts)
			alertsAfter := len(m.alerts)
			removed := alertsBefore - alertsAfter

			// Count total panes in tree
			totalPanes := m.tree.TotalPanes()

			// Log reconciliation results
			debug.Log("TUI_RECONCILE removed=%d remaining=%d panes_in_tree=%d", removed, alertsAfter, totalPanes)
			m.alertsMu.Unlock()

			// Clear any previous tree refresh error
			m.errorMu.Lock()
			m.treeRefreshError = nil
			m.errorMu.Unlock()

			return m, m.continueWatchingDaemon()

		case daemon.MsgTypeTreeError:
			// Tree collection error from daemon
			debug.Log("TUI_TREE_ERROR error=%s", msg.msg.Error)

			// User-facing error notification
			fmt.Fprintf(os.Stderr, "WARNING: Daemon failed to collect tmux tree: %s\n", msg.msg.Error)
			fmt.Fprintf(os.Stderr, "         Tree display will show stale data until collection succeeds.\n")

			m.errorMu.Lock()
			m.treeRefreshError = fmt.Errorf("daemon tree collection failed: %s", msg.msg.Error)
			m.errorMu.Unlock()

			// Continue watching daemon
			return m, m.continueWatchingDaemon()

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
		return m, m.continueWatchingDaemon()

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

	if len(m.tree.Repos()) == 0 {
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

// reconcileAlerts removes alerts for panes that no longer exist.
// It modifies the alerts map in-place and returns the same map.
func reconcileAlerts(tree tmux.RepoTree, alerts map[string]string) map[string]string {
	// Build set of valid pane IDs from tree
	validPanes := make(map[string]bool)
	for _, repo := range tree.Repos() {
		for _, branch := range tree.Branches(repo) {
			panes, ok := tree.GetPanes(repo, branch)
			if !ok {
				continue
			}
			for _, pane := range panes {
				validPanes[pane.ID()] = true
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

// continueWatchingDaemon returns the appropriate command to continue watching daemon events
func (m model) continueWatchingDaemon() tea.Cmd {
	if m.daemonClient != nil {
		return watchDaemonCmd(m.daemonClient)
	}
	return nil
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
