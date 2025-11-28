package watcher

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"github.com/fsnotify/fsnotify"
)

const (
	alertDir     = "/tmp/claude"
	alertPrefix  = "tui-alert-"
)

var validPaneIDPattern = regexp.MustCompile(`^%\d+$`)

// isValidPaneID validates that a pane ID matches the expected format.
// Valid pane IDs must start with '%' followed by one or more digits.
// This prevents path traversal and injection attacks.
func isValidPaneID(id string) bool {
	return id != "" && validPaneIDPattern.MatchString(id)
}

// AlertEvent represents an alert file change event
type AlertEvent struct {
	PaneID  string
	Created bool  // true = created, false = deleted
	Error   error // nil for normal events, non-nil for fsnotify errors
}

// AlertWatcher watches for alert file changes using fsnotify
type AlertWatcher struct {
	watcher *fsnotify.Watcher
	alertCh chan AlertEvent
	done    chan struct{}
	mu      sync.Mutex
	started bool
}

// NewAlertWatcher creates a new AlertWatcher
func NewAlertWatcher() (*AlertWatcher, error) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("failed to create fsnotify watcher: %w", err)
	}

	// Ensure alert directory exists
	if err := os.MkdirAll(alertDir, 0755); err != nil {
		watcher.Close()
		return nil, fmt.Errorf("failed to create alert directory %s: %w", alertDir, err)
	}

	// Add directory to watcher
	if err := watcher.Add(alertDir); err != nil {
		watcher.Close()
		return nil, fmt.Errorf("failed to watch alert directory %s: %w", alertDir, err)
	}

	return &AlertWatcher{
		watcher: watcher,
		alertCh: make(chan AlertEvent, 100), // Buffered to handle bursts
		done:    make(chan struct{}),
		started: false,
	}, nil
}

// Start begins watching for alert file changes and returns the event channel
// This should only be called once. Subsequent calls return the same channel.
func (w *AlertWatcher) Start() <-chan AlertEvent {
	w.mu.Lock()
	if w.started {
		w.mu.Unlock()
		return w.alertCh
	}
	w.started = true
	w.mu.Unlock()

	go w.watch()
	return w.alertCh
}

// watch is the main event loop
func (w *AlertWatcher) watch() {
	defer close(w.alertCh)

	for {
		select {
		case <-w.done:
			return

		case event, ok := <-w.watcher.Events:
			if !ok {
				return
			}

			// Process only alert files
			filename := filepath.Base(event.Name)
			if !strings.HasPrefix(filename, alertPrefix) {
				continue
			}

			// Extract pane ID from filename
			paneID := strings.TrimPrefix(filename, alertPrefix)
			if !isValidPaneID(paneID) {
				// Invalid pane ID format - skip silently to prevent injection attacks
				continue
			}

			// Determine event type
			var alertEvent AlertEvent
			switch {
			case event.Op&fsnotify.Create == fsnotify.Create:
				alertEvent = AlertEvent{PaneID: paneID, Created: true}
			case event.Op&fsnotify.Remove == fsnotify.Remove:
				alertEvent = AlertEvent{PaneID: paneID, Created: false}
			case event.Op&fsnotify.Write == fsnotify.Write:
				// Treat writes as creates (file touched/updated)
				alertEvent = AlertEvent{PaneID: paneID, Created: true}
			default:
				// Ignore other events (chmod, rename, etc.)
				continue
			}

			// Attempt to send event. Uses select to prevent blocking during shutdown.
			// If done channel is closed, we exit immediately without blocking.
			// Event loss during shutdown is acceptable since watcher is terminating.
			select {
			case w.alertCh <- alertEvent:
			case <-w.done:
				return
			}

		case err, ok := <-w.watcher.Errors:
			if !ok {
				return
			}
			// Send error event instead of logging directly
			select {
			case w.alertCh <- AlertEvent{Error: err}:
			case <-w.done:
				return
			}
		}
	}
}

// Close stops the watcher and releases resources
func (w *AlertWatcher) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if !w.started {
		// If never started, just close the watcher
		if w.watcher != nil {
			return w.watcher.Close()
		}
		return nil
	}

	// Close the done channel to signal the goroutine
	select {
	case <-w.done:
		// Already closed
	default:
		close(w.done)
	}

	// Close the fsnotify watcher
	if w.watcher != nil {
		return w.watcher.Close()
	}
	return nil
}

// GetExistingAlerts returns a map of currently active alert files
// This is useful for initializing state when the watcher starts
func GetExistingAlerts() (map[string]bool, error) {
	alerts := make(map[string]bool)

	pattern := filepath.Join(alertDir, alertPrefix+"*")
	matches, err := filepath.Glob(pattern)
	if err != nil {
		return nil, fmt.Errorf("failed to glob alert files with pattern %s: %w", pattern, err)
	}

	for _, file := range matches {
		filename := filepath.Base(file)
		paneID := strings.TrimPrefix(filename, alertPrefix)
		if isValidPaneID(paneID) {
			alerts[paneID] = true
		}
	}

	return alerts, nil
}
