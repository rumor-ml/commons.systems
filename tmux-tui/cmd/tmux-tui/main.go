package main

import (
	"fmt"
	"os"
	"os/exec"
	"sync"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/commons-systems/tmux-tui/internal/debug"
	"github.com/commons-systems/tmux-tui/internal/tmux"
	"github.com/commons-systems/tmux-tui/internal/ui"
	"github.com/commons-systems/tmux-tui/internal/watcher"
)

type tickMsg time.Time

type alertChangedMsg struct {
	paneID    string
	eventType string
	created   bool
	err       error
}

type alertWatcherStoppedMsg struct {
	wasIntentional bool
}

type treeRefreshMsg struct {
	tree tmux.RepoTree
	err  error
}

// playAlertSound plays the system alert sound in the background.
// It skips playback during E2E tests (CLAUDE_E2E_TEST env var).
// The sound only plays once when transitioning to an alert state.
func playAlertSound() {
	// Skip sound during E2E tests
	if os.Getenv("CLAUDE_E2E_TEST") != "" {
		return
	}

	// Play sound in background (non-blocking)
	cmd := exec.Command("afplay", "/System/Library/Sounds/Tink.aiff")
	// Detach from parent process so it continues even if TUI exits
	cmd.Start()
	// Don't wait for completion - fire and forget
}

type model struct {
	collector       *tmux.Collector
	renderer        *ui.TreeRenderer
	alertWatcher    *watcher.AlertWatcher
	tree            tmux.RepoTree
	alerts          map[string]string // Persistent alert state: paneID -> eventType
	alertsMu        *sync.RWMutex     // Protects alerts map from race conditions
	width           int
	height          int
	err             error
	alertsDisabled  bool   // true if alert watcher failed to initialize
	alertError      string // watcher initialization error
	alertLoadError  string // error loading existing alerts
	// Circuit breaker state
	alertWatcherErrors    int
	alertWatcherMaxErrors int // Default: 5
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

	// Initialize alert watcher
	var alertsDisabled bool
	var alertError string
	alertWatcher, watcherErr := watcher.NewAlertWatcher()
	if watcherErr != nil {
		fmt.Fprintf(os.Stderr, "Warning: Alert watcher failed to initialize: %v\n", watcherErr)
		fmt.Fprintf(os.Stderr, "Alert notifications will be disabled.\n")
		alertWatcher = nil
		alertsDisabled = true
		alertError = watcherErr.Error()
	}

	// Load existing alerts
	var alertLoadError string
	alerts, alertsErr := watcher.GetExistingAlerts()
	if alertsErr != nil {
		fmt.Fprintf(os.Stderr, "Warning: Failed to load existing alerts: %v\n", alertsErr)
		fmt.Fprintf(os.Stderr, "Existing alert files in ~/.tmux-alerts/ will not be shown.\n")
		alerts = make(map[string]string)
		alertLoadError = fmt.Sprintf("Failed to load existing alerts: %v", alertsErr)
	}

	return model{
		collector:             collector,
		renderer:              renderer,
		alertWatcher:          alertWatcher,
		tree:                  tree,
		alerts:                alerts,
		alertsMu:              &sync.RWMutex{},
		width:                 80,
		height:                24,
		err:                   err,
		alertsDisabled:        alertsDisabled,
		alertError:            alertError,
		alertLoadError:        alertLoadError,
		alertWatcherMaxErrors: 5,
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
				if err := m.alertWatcher.Close(); err != nil {
					fmt.Fprintf(os.Stderr, "Error closing alert watcher: %v\n", err)
				}
			}
			return m, tea.Quit
		}

	case alertChangedMsg:
		// Check for error events first
		if msg.err != nil {
			m.alertWatcherErrors++
			fmt.Fprintf(os.Stderr, "Alert watcher error (%d/%d): %v\n",
				m.alertWatcherErrors, m.alertWatcherMaxErrors, msg.err)

			// Circuit breaker: disable after threshold
			if m.alertWatcherErrors >= m.alertWatcherMaxErrors {
				fmt.Fprintf(os.Stderr, "Alert watcher disabled after %d consecutive errors\n",
					m.alertWatcherErrors)
				if m.alertWatcher != nil {
					m.alertWatcher.Close()
				}
				m.alertWatcher = nil
				m.alertsDisabled = true
				m.alertError = fmt.Sprintf("Disabled after %d consecutive errors", m.alertWatcherErrors)
				return m, nil
			}

			// Continue watching despite error
			if m.alertWatcher != nil {
				return m, watchAlertsCmd(m.alertWatcher)
			}
			return m, nil
		}

		// Success - reset error counter
		m.alertWatcherErrors = 0

		// Log when alert is received
		debug.Log("TUI_ALERT_RECEIVED paneID=%s eventType=%s created=%v", msg.paneID, msg.eventType, msg.created)

		// FAST PATH: Update alert immediately with mutex protection
		var isNewAlert bool
		m.alertsMu.Lock()
		if msg.created {
			// Check if this is a new alert (transition TO idle state)
			_, alreadyExists := m.alerts[msg.paneID]
			isNewAlert = !alreadyExists
			m.alerts[msg.paneID] = msg.eventType

			// Log after storing
			debug.Log("TUI_ALERT_STORED paneID=%s eventType=%s total_alerts=%d", msg.paneID, msg.eventType, len(m.alerts))

			// Play sound only when transitioning to alert state (not already in alert)
			if isNewAlert {
				playAlertSound()
			}
		} else {
			delete(m.alerts, msg.paneID)
			// Log after removing
			debug.Log("TUI_ALERT_REMOVED paneID=%s remaining=%d", msg.paneID, len(m.alerts))
		}
		m.alertsMu.Unlock()

		// Continue watching for more alert events
		// Trigger tree refresh for both alert creation and removal to ensure immediate UI updates.
		// For new alerts, also clear cache to update IsClaudePane status.
		if m.alertWatcher != nil {
			if isNewAlert {
				// New alert - clear cache and refresh tree to pick up IsClaudePane changes
				debug.Log("TUI_TRIGGER_REFRESH reason=new_alert paneID=%s", msg.paneID)
				m.collector.ClearCache()
				return m, tea.Batch(watchAlertsCmd(m.alertWatcher), refreshTreeCmd(m.collector))
			}
			// Alert removed - trigger refresh to immediately update UI
			debug.Log("TUI_TRIGGER_REFRESH reason=alert_removed paneID=%s", msg.paneID)
			return m, tea.Batch(watchAlertsCmd(m.alertWatcher), refreshTreeCmd(m.collector))
		}
		return m, nil

	case alertWatcherStoppedMsg:
		// Only print error if watcher stopped unexpectedly
		if !msg.wasIntentional {
			fmt.Fprintf(os.Stderr, "Alert watcher stopped unexpectedly\n")
			fmt.Fprintf(os.Stderr, "Alert notifications are now disabled\n")
		}
		m.alertWatcher = nil
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
	if m.alertLoadError != "" {
		warningStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("0")).
			Background(lipgloss.Color("3")).
			Bold(true).
			Padding(0, 1)
		warningBanner += warningStyle.Render("⚠ "+m.alertLoadError) + "\n\n"
	}

	// Copy alerts map with read lock for safe concurrent access
	// We copy to prevent the renderer from accessing the map after lock release
	m.alertsMu.RLock()
	alertsCopy := make(map[string]string)
	for k, v := range m.alerts {
		alertsCopy[k] = v
	}
	m.alertsMu.RUnlock()

	output := m.renderer.Render(m.tree, alertsCopy)

	return warningBanner + output
}

// watchAlertsCmd watches for alert file changes
func watchAlertsCmd(w *watcher.AlertWatcher) tea.Cmd {
	return func() tea.Msg {
		event, ok := <-w.Start()
		if !ok {
			// Channel closed - check if it was intentional
			wasIntentional := w.IsClosed()
			return alertWatcherStoppedMsg{wasIntentional: wasIntentional}
		}
		return alertChangedMsg{
			paneID:    event.PaneID,
			eventType: event.EventType,
			created:   event.Created,
			err:       event.Error,
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
