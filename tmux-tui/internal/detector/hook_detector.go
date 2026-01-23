package detector

import (
	"github.com/commons-systems/tmux-tui/internal/debug"
	"github.com/commons-systems/tmux-tui/internal/watcher"
)

// HookDetector implements IdleStateDetector using the legacy hook-based AlertWatcher.
//
// Deprecated: This detector is provided for backward compatibility only.
// New code should use TitleDetector which polls pane titles instead of relying on hooks.
// The hook-based approach has several limitations:
//   - Requires Claude hooks to be configured correctly
//   - Depends on filesystem notifications which can be unreliable
//   - Does not work for non-Claude panes
//
// To use this detector, set TMUX_TUI_DETECTOR=hook in your environment.
// This will be removed in a future version once TitleDetector is proven stable.
type HookDetector struct {
	watcher  *watcher.AlertWatcher
	eventCh  chan StateEvent
	done     chan struct{}
	started  bool
	alertDir string
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
	if d.started {
		return d.eventCh
	}
	d.started = true

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
				stateEvent = StateEvent{
					Error: event.Error,
				}
			} else {
				// Convert event type to state
				var state State
				if event.Created {
					state = eventTypeToState(event.EventType)
				} else {
					// File deleted - assume working state
					state = StateWorking
				}

				stateEvent = StateEvent{
					PaneID: event.PaneID,
					State:  state,
				}

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
	// Close done channel to signal goroutines
	select {
	case <-d.done:
		// Already closed
	default:
		close(d.done)
	}

	// Close the underlying watcher
	if d.watcher != nil {
		return d.watcher.Close()
	}
	return nil
}
