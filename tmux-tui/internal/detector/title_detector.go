package detector

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/commons-systems/tmux-tui/internal/debug"
	"github.com/commons-systems/tmux-tui/internal/tmux"
)

const (
	// pollInterval is how frequently we check pane titles
	pollInterval = 500 * time.Millisecond

	// idlePrefix is the UTF-8 character prefix that Claude Code sets in pane titles to indicate idle state.
	// This character appears at the start of the pane title when Claude is waiting for user input.
	//
	// CRITICAL DEPENDENCY: This prefix is defined by Claude Code's title system.
	// Breaking change risk: If Claude Code changes this prefix, idle detection will fail silently.
	//
	// Mitigation strategies:
	// 1. Monitor detection failures via treeErrors counter in metrics
	// 2. Add integration test validating prefix with actual Claude Code instance
	// 3. Make prefix configurable via TMUX_TUI_IDLE_PREFIX env var for forward compatibility
	// 4. TODO(#1529): Add automated check against Claude Code source in CI pipeline
	//
	// Last verified: 2026-01-23 against Claude Code internal title system
	idlePrefix = "✳ " // U+2733 EIGHT SPOKED ASTERISK + space
)

// PaneCollector is the interface required by TitleDetector to query pane information.
// This allows for easy testing with mock collectors.
type PaneCollector interface {
	GetTree() (tmux.RepoTree, error)
	GetPaneTitle(paneID string) (string, error)
}

// TitleDetector implements IdleStateDetector by polling pane titles from tmux.
// This is the preferred detection strategy as it works reliably without requiring
// hooks or filesystem notifications.
type TitleDetector struct {
	collector  PaneCollector
	eventCh    chan StateEvent
	done       chan struct{}
	closeOnce  sync.Once
	started    bool
	mu         sync.Mutex
	lastStates map[string]State // Track last known state per pane to detect changes
}

// NewTitleDetector creates a new title-based detector that polls tmux pane titles.
func NewTitleDetector(collector PaneCollector) (*TitleDetector, error) {
	if collector == nil {
		return nil, fmt.Errorf("collector cannot be nil")
	}

	return &TitleDetector{
		collector:  collector,
		eventCh:    make(chan StateEvent, 100),
		done:       make(chan struct{}),
		started:    false,
		lastStates: make(map[string]State),
	}, nil
}

// Start begins polling pane titles and returns the state event channel.
func (d *TitleDetector) Start() <-chan StateEvent {
	d.mu.Lock()
	if d.started {
		d.mu.Unlock()
		return d.eventCh
	}
	d.started = true
	d.mu.Unlock()

	// Launch polling goroutine
	go d.pollPaneTitles()

	return d.eventCh
}

// pollPaneTitles continuously polls pane titles at the configured interval
func (d *TitleDetector) pollPaneTitles() {
	defer close(d.eventCh)

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	// Poll immediately on start
	d.checkAllPanes()

	for {
		select {
		case <-d.done:
			return
		case <-ticker.C:
			d.checkAllPanes()
		}
	}
}

// checkAllPanes queries all panes from the collector and emits state change events
func (d *TitleDetector) checkAllPanes() {
	// Get the current tree of panes
	tree, err := d.collector.GetTree()
	if err != nil {
		// Emit error event
		select {
		case d.eventCh <- NewStateErrorEvent(fmt.Errorf("failed to get pane tree: %w", err)):
		case <-d.done:
			return
		}
		debug.Log("TITLE_DETECTOR_TREE_ERROR error=%v", err)
		return
	}

	// Track which panes we've seen in this iteration
	seenPanes := make(map[string]bool)

	// Iterate through all panes in the tree
	for _, repo := range tree.Repos() {
		for _, branch := range tree.Branches(repo) {
			panes, ok := tree.GetPanes(repo, branch)
			if !ok {
				continue
			}

			for _, pane := range panes {
				paneID := pane.ID()
				seenPanes[paneID] = true

				// Get the pane's current title
				title, err := d.collector.GetPaneTitle(paneID)
				if err != nil {
					// Check if this is an expected pane-not-found error (race condition during deletion)
					if isPaneNotFoundError(err) {
						debug.Log("TITLE_DETECTOR_PANE_DELETED paneID=%s", paneID)
						continue
					}

					// Unexpected error - notify user via error event
					debug.Log("TITLE_DETECTOR_TITLE_ERROR paneID=%s error=%v", paneID, err)
					select {
					case d.eventCh <- NewStateErrorEvent(fmt.Errorf("failed to get title for pane %s: %w", paneID, err)):
					case <-d.done:
						return
					}
					continue
				}

				// Determine state from title
				state := d.stateFromTitle(title)

				// Check if state changed
				d.mu.Lock()
				lastState, exists := d.lastStates[paneID]
				stateChanged := !exists || lastState != state

				if stateChanged {
					// Update tracked state
					d.lastStates[paneID] = state
					d.mu.Unlock()

					// Emit state change event
					event := NewStateChangeEvent(paneID, state)

					select {
					case d.eventCh <- event:
						debug.Log("TITLE_DETECTOR_STATE_CHANGE paneID=%s state=%s title=%q",
							paneID, state, title)
					case <-d.done:
						return
					}
				} else {
					d.mu.Unlock()
				}
			}
		}
	}

	// Clean up state for panes that no longer exist
	d.mu.Lock()
	for paneID := range d.lastStates {
		if !seenPanes[paneID] {
			delete(d.lastStates, paneID)
			debug.Log("TITLE_DETECTOR_PANE_REMOVED paneID=%s", paneID)
		}
	}
	d.mu.Unlock()
}

// stateFromTitle determines the pane state based on its title
func (d *TitleDetector) stateFromTitle(title string) State {
	if strings.HasPrefix(title, idlePrefix) {
		return StateIdle
	}
	return StateWorking
}

// isPaneNotFoundError checks if an error indicates a pane was not found.
// This is expected during pane deletion and should be silently ignored.
func isPaneNotFoundError(err error) bool {
	if err == nil {
		return false
	}
	// Check for common pane not found error messages
	errMsg := err.Error()
	return strings.Contains(errMsg, "not found") || strings.Contains(errMsg, "no pane")
}

// Stop halts the detector and releases resources
func (d *TitleDetector) Stop() error {
	// Use sync.Once to ensure done channel is closed exactly once
	d.closeOnce.Do(func() {
		close(d.done)
	})

	return nil
}
