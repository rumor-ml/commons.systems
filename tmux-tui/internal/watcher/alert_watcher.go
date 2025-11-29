package watcher

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/commons-systems/tmux-tui/internal/debug"
	"github.com/fsnotify/fsnotify"
)

const (
	alertDir     = "/tmp/claude"
	alertPrefix  = "tui-alert-"

	// Event type constants - these match the notification matchers in .claude/settings.json
	// EventTypeStop is written by the Stop hook (existing behavior)
	EventTypeStop = "stop"
	// EventTypePermission is written by Notification hook for permission_prompt
	EventTypePermission = "permission"
	// EventTypeIdle is written by Notification hook for idle_prompt
	EventTypeIdle = "idle"
	// EventTypeElicitation is written by Notification hook for elicitation_dialog
	EventTypeElicitation = "elicitation"
	// EventTypeWorking is written by UserPromptSubmit and PostToolUse hooks to signal "no alert"
	EventTypeWorking = "working"
)

var (
	validPaneIDPattern = regexp.MustCompile(`^%\d+$`)
	validEventTypes    = map[string]bool{
		EventTypeStop:        true,
		EventTypePermission:  true,
		EventTypeIdle:        true,
		EventTypeElicitation: true,
		EventTypeWorking:     true,
	}
)

// isValidPaneID validates that a pane ID matches the expected format.
// Valid pane IDs must start with '%' followed by one or more digits.
// This prevents path traversal and injection attacks.
func isValidPaneID(id string) bool {
	return id != "" && validPaneIDPattern.MatchString(id)
}

// readEventType reads the event type from an alert file.
// Returns the event type string, defaulting to "stop" for empty files or unknown types (backward compatibility).
// Implements a retry mechanism to handle race conditions where the file is created before content is written.
func readEventType(filePath string) string {
	const maxRetries = 3
	const retryDelay = 10 * time.Millisecond

	var eventType string
	var lastErr error

	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			debug.Log("WATCHER_READ_RETRY attempt=%d/%d file=%s", attempt+1, maxRetries, filePath)
			time.Sleep(retryDelay)
		}

		content, err := os.ReadFile(filePath)
		if err != nil {
			lastErr = err
			debug.Log("WATCHER_READ_ERROR file=%s error=%v", filePath, err)
			continue
		}

		eventType = strings.TrimSpace(string(content))
		if eventType != "" {
			// Successfully read non-empty content
			break
		}

		debug.Log("WATCHER_READ_EMPTY file=%s attempt=%d", filePath, attempt+1)
		lastErr = fmt.Errorf("empty file")
	}

	// Handle read errors or empty file after retries
	if lastErr != nil {
		debug.Log("WATCHER_READ_DEFAULT file=%s attempts=%d error=%v", filePath, maxRetries, lastErr)
		return EventTypeStop
	}

	// Validate against known event types
	if !validEventTypes[eventType] {
		debug.Log("WATCHER_READ_UNKNOWN eventType=%s file=%s", eventType, filePath)
		return EventTypeStop
	}

	debug.Log("WATCHER_READ_SUCCESS eventType=%s file=%s", eventType, filePath)
	return eventType
}

// AlertEvent represents an alert file change event
type AlertEvent struct {
	PaneID    string
	EventType string // Type of event: "stop", "permission", "idle", "elicitation"
	Created   bool   // true = created, false = deleted
	Error     error  // nil for normal events, non-nil for fsnotify errors
}

// AlertWatcherOption configures an AlertWatcher
type AlertWatcherOption func(*alertWatcherConfig)

type alertWatcherConfig struct {
	alertDir string
}

// WithAlertDir sets a custom directory for alert files (primarily for testing)
func WithAlertDir(dir string) AlertWatcherOption {
	return func(c *alertWatcherConfig) {
		c.alertDir = dir
	}
}

// AlertWatcher watches for alert file changes using fsnotify
type AlertWatcher struct {
	watcher *fsnotify.Watcher
	alertCh chan AlertEvent
	done    chan struct{}
	ready   chan struct{} // closed when watch goroutine is ready
	dir     string        // The alert directory being watched
	mu      sync.Mutex
	started bool
	closed  bool // tracks if Close() was explicitly called
}

// Dir returns the directory being watched (for testing)
func (w *AlertWatcher) Dir() string {
	return w.dir
}

// NewAlertWatcher creates a new AlertWatcher
func NewAlertWatcher(opts ...AlertWatcherOption) (*AlertWatcher, error) {
	cfg := &alertWatcherConfig{
		alertDir: alertDir, // default
	}
	for _, opt := range opts {
		opt(cfg)
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("failed to create fsnotify watcher: %w", err)
	}

	// Ensure alert directory exists
	if err := os.MkdirAll(cfg.alertDir, 0755); err != nil {
		watcher.Close()
		return nil, fmt.Errorf("failed to create alert directory %s: %w", cfg.alertDir, err)
	}

	// Add directory to watcher
	if err := watcher.Add(cfg.alertDir); err != nil {
		watcher.Close()
		return nil, fmt.Errorf("failed to watch alert directory %s: %w", cfg.alertDir, err)
	}

	return &AlertWatcher{
		watcher: watcher,
		alertCh: make(chan AlertEvent, 100), // Buffered to handle bursts
		done:    make(chan struct{}),
		ready:   make(chan struct{}),
		dir:     cfg.alertDir,
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

// Ready returns a channel that is closed when the watch goroutine
// has started and is ready to receive events.
func (w *AlertWatcher) Ready() <-chan struct{} {
	return w.ready
}

// watch is the main event loop
func (w *AlertWatcher) watch() {
	defer close(w.alertCh)

	// Signal that the watcher is ready (safe from double-close)
	select {
	case <-w.ready:
		// Already closed
	default:
		close(w.ready)
	}

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
				eventType := readEventType(event.Name)
				alertEvent = AlertEvent{PaneID: paneID, EventType: eventType, Created: true}
			case event.Op&fsnotify.Remove == fsnotify.Remove:
				alertEvent = AlertEvent{PaneID: paneID, Created: false}
			case event.Op&fsnotify.Write == fsnotify.Write:
				// Check if file still exists - Write events may occur before Remove during deletion
				_, err := os.Stat(event.Name)
				if os.IsNotExist(err) {
					// File was deleted - treat as delete event
					alertEvent = AlertEvent{PaneID: paneID, Created: false}
				} else {
					// File exists - treat as create/update event
					eventType := readEventType(event.Name)
					alertEvent = AlertEvent{PaneID: paneID, EventType: eventType, Created: true}
				}
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

// IsClosed returns true if Close() was explicitly called
func (w *AlertWatcher) IsClosed() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.closed
}

// Close stops the watcher and releases resources
func (w *AlertWatcher) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()

	// Mark as closed
	w.closed = true

	if !w.started {
		// If never started, close ready channel if not already closed
		select {
		case <-w.ready:
			// Already closed
		default:
			close(w.ready)
		}
		// Close the watcher
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

// GetExistingAlerts returns a map of currently active alert files with their event types
// This is useful for initializing state when the watcher starts
// Uses the default alert directory.
func GetExistingAlerts() (map[string]string, error) {
	return GetExistingAlertsFromDir(alertDir)
}

// GetExistingAlertsFromDir returns a map of currently active alert files with their event types
// from a specific directory. This is useful for session-scoped alert directories.
func GetExistingAlertsFromDir(dir string) (map[string]string, error) {
	alerts := make(map[string]string)

	pattern := filepath.Join(dir, alertPrefix+"*")
	matches, err := filepath.Glob(pattern)
	if err != nil {
		return nil, fmt.Errorf("failed to glob alert files with pattern %s: %w", pattern, err)
	}

	for _, file := range matches {
		filename := filepath.Base(file)
		paneID := strings.TrimPrefix(filename, alertPrefix)
		if isValidPaneID(paneID) {
			eventType := readEventType(file)
			// Only include actual alert states, not "working"
			if eventType != EventTypeWorking {
				alerts[paneID] = eventType
			}
		}
	}

	return alerts, nil
}
