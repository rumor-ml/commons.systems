package detector

import (
	"sync"

	"github.com/commons-systems/tmux-tui/internal/debug"
	"github.com/commons-systems/tmux-tui/internal/watcher"
)

// TODO(#1543): Consider extracting common detector base type
// Both HookDetector and TitleDetector share:
// - eventCh management (channel creation, buffering, closing)
// - done channel lifecycle (sync.Once close pattern)
// - started flag tracking (Start() idempotency with mutex protection)
// - mu sync.Mutex for protecting started flag
// Potential base type could reduce duplication and ensure consistent patterns.

// HookDetector implements IdleStateDetector using the legacy hook-based AlertWatcher.
//
// Deprecated: This detector is provided for backward compatibility only.
// New code should use TitleDetector which polls pane titles instead of relying on hooks.
// The hook-based approach has several limitations:
//   - Requires Claude hooks to be configured correctly
//   - Depends on filesystem notifications which can be unreliable
//   - Does not work for non-Claude panes
//
// Migration: Remove TMUX_TUI_DETECTOR=hook from your environment to use TitleDetector (default).
// To temporarily use this detector, set TMUX_TUI_DETECTOR=hook in your environment.
//
// Removal timeline:
// - v1.0.0 (current): Hook detector supported but deprecated, title detector is default
// - v1.1.0+: Monitor for P1 issues (crashes, data loss, security issues) with title detector
// - v2.0.0: Remove hook detector if 2+ minor releases with zero P1 issues
// - Tracked in: TODO(#1544): Remove HookDetector after v2.0.0 deprecation period
type HookDetector struct {
	watcher   *watcher.AlertWatcher
	eventCh   chan StateEvent
	done      chan struct{}
	closeOnce sync.Once
	mu        sync.Mutex // Protects started field
	started   bool
	alertDir  string
}

// NewHookDetector creates a new hook-based detector that wraps AlertWatcher.
// The alertDir parameter specifies the directory to watch for alert files.
func NewHookDetector(alertDir string) (*HookDetector, error) {
	// Create alert watcher with specified directory
	alertWatcher, err := watcher.NewAlertWatcher(watcher.WithAlertDir(alertDir))
	if err != nil {
		return nil, err
	}

	return &HookDetector{
		watcher:  alertWatcher,
		eventCh:  make(chan StateEvent, 100), // Same buffer size as AlertWatcher
		done:     make(chan struct{}),
		started:  false,
		alertDir: alertDir,
	}, nil
}

// Start begins monitoring alert file changes and returns the state event channel.
// This adapter converts AlertEvents to StateEvents.
func (d *HookDetector) Start() <-chan StateEvent {
	d.mu.Lock()
	if d.started {
		d.mu.Unlock()
		return d.eventCh
	}
	d.started = true
	d.mu.Unlock()

	// Start the underlying alert watcher
	alertCh := d.watcher.Start()

	// Launch conversion goroutine
	go d.convertEvents(alertCh)

	return d.eventCh
}

// convertEvents transforms AlertEvents into StateEvents
func (d *HookDetector) convertEvents(alertCh <-chan watcher.AlertEvent) {
	defer close(d.eventCh)

	for {
		select {
		case <-d.done:
			return

		case event, ok := <-alertCh:
			if !ok {
				// Alert watcher closed
				return
			}

			// Convert alert event to state event
			var stateEvent StateEvent
			if event.Error != nil {
				// Pass through errors
				stateEvent = NewStateErrorEvent(event.Error)
			} else {
				// Convert event type to state
				var state State
				if event.Created {
					state = eventTypeToState(event.EventType)
				} else {
					// File deleted - assume working state
					state = StateWorking
				}

				stateEvent = NewStateChangeEvent(event.PaneID, state)

				debug.Log("HOOK_DETECTOR_STATE_CHANGE paneID=%s state=%s eventType=%s created=%v",
					event.PaneID, state, event.EventType, event.Created)
			}

			// Forward the converted event
			select {
			case d.eventCh <- stateEvent:
			case <-d.done:
				return
			}
		}
	}
}

// Stop halts the detector and releases resources
func (d *HookDetector) Stop() error {
	// Use sync.Once to ensure done channel is closed exactly once
	d.closeOnce.Do(func() {
		close(d.done)
	})

	// Close the underlying watcher
	if d.watcher != nil {
		return d.watcher.Close()
	}
	return nil
}
