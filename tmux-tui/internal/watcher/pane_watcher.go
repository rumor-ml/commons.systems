package watcher

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/commons-systems/tmux-tui/internal/debug"
	"github.com/fsnotify/fsnotify"
)

const (
	// PaneFocusFile is the name of the file that contains the active pane ID
	PaneFocusFile = "pane-focus"
)

// readPaneID reads the pane ID from the pane-focus file.
// Returns the pane ID string or an error if the file cannot be read or contains invalid data.
// Implements a retry mechanism to handle race conditions where the file is created before content is written.
func readPaneID(filePath string) (string, error) {
	const maxRetries = 3
	const retryDelay = 10 * time.Millisecond

	var paneID string
	var lastErr error

	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			debug.Log("PANE_WATCHER_READ_RETRY attempt=%d/%d file=%s", attempt+1, maxRetries, filePath)
			time.Sleep(retryDelay)
		}

		content, err := os.ReadFile(filePath)
		if err != nil {
			lastErr = err
			debug.Log("PANE_WATCHER_READ_ERROR file=%s error=%v", filePath, err)
			continue
		}

		paneID = strings.TrimSpace(string(content))
		if paneID != "" {
			// Successfully read non-empty content
			break
		}

		debug.Log("PANE_WATCHER_READ_EMPTY file=%s attempt=%d", filePath, attempt+1)
		lastErr = fmt.Errorf("empty file")
	}

	// Handle read errors or empty file after retries
	if lastErr != nil {
		debug.Log("PANE_WATCHER_READ_FAILED file=%s attempts=%d error=%v", filePath, maxRetries, lastErr)
		return "", fmt.Errorf("failed to read pane ID after %d attempts: %w", maxRetries, lastErr)
	}

	// Validate pane ID format
	if !isValidPaneID(paneID) {
		debug.Log("PANE_WATCHER_INVALID_ID paneID=%s file=%s", paneID, filePath)
		return "", fmt.Errorf("invalid pane ID format: %s", paneID)
	}

	debug.Log("PANE_WATCHER_READ_SUCCESS paneID=%s file=%s", paneID, filePath)
	return paneID, nil
}

// PaneFocusEvent represents a pane focus change event
type PaneFocusEvent struct {
	PaneID string
	Error  error // nil for normal events, non-nil for errors
}

// PaneFocusOption configures a PaneFocusWatcher
type PaneFocusOption func(*paneFocusConfig)

type paneFocusConfig struct {
	alertDir string
	debounce time.Duration
}

// WithPaneFocusDir sets a custom directory for the pane-focus file (primarily for testing)
func WithPaneFocusDir(dir string) PaneFocusOption {
	return func(c *paneFocusConfig) {
		c.alertDir = dir
	}
}

// WithDebounce sets the debounce duration for rapid pane switches
func WithDebounce(d time.Duration) PaneFocusOption {
	return func(c *paneFocusConfig) {
		c.debounce = d
	}
}

// PaneFocusWatcher watches for changes to the pane-focus file using fsnotify
type PaneFocusWatcher struct {
	watcher  *fsnotify.Watcher
	focusCh  chan PaneFocusEvent
	done     chan struct{}
	ready    chan struct{} // closed when watch goroutine is ready
	filePath string        // The pane-focus file being watched
	debounce time.Duration
	mu       sync.Mutex
	started  bool
	closed   bool // tracks if Close() was explicitly called
}

// FilePath returns the file path being watched (for testing)
func (w *PaneFocusWatcher) FilePath() string {
	return w.filePath
}

// NewPaneFocusWatcher creates a new PaneFocusWatcher
func NewPaneFocusWatcher(opts ...PaneFocusOption) (*PaneFocusWatcher, error) {
	cfg := &paneFocusConfig{
		alertDir: alertDir, // default - same directory as alerts
		debounce: 50 * time.Millisecond,
	}
	for _, opt := range opts {
		opt(cfg)
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("failed to create fsnotify watcher: %w", err)
	}

	// Ensure directory exists
	if err := os.MkdirAll(cfg.alertDir, 0755); err != nil {
		watcher.Close()
		return nil, fmt.Errorf("failed to create directory %s: %w", cfg.alertDir, err)
	}

	// Add directory to watcher (we watch the directory, not the file directly)
	if err := watcher.Add(cfg.alertDir); err != nil {
		watcher.Close()
		return nil, fmt.Errorf("failed to watch directory %s: %w", cfg.alertDir, err)
	}

	filePath := fmt.Sprintf("%s/%s", cfg.alertDir, PaneFocusFile)

	return &PaneFocusWatcher{
		watcher:  watcher,
		focusCh:  make(chan PaneFocusEvent, 10), // Small buffer for debouncing
		done:     make(chan struct{}),
		ready:    make(chan struct{}),
		filePath: filePath,
		debounce: cfg.debounce,
		started:  false,
	}, nil
}

// Start begins watching for pane focus changes and returns the event channel
// This should only be called once. Subsequent calls return the same channel.
func (w *PaneFocusWatcher) Start() <-chan PaneFocusEvent {
	w.mu.Lock()
	if w.started {
		w.mu.Unlock()
		return w.focusCh
	}
	w.started = true
	w.mu.Unlock()

	go w.watch()
	return w.focusCh
}

// Ready returns a channel that is closed when the watch goroutine
// has started and is ready to receive events.
func (w *PaneFocusWatcher) Ready() <-chan struct{} {
	return w.ready
}

// watch is the main event loop with debouncing
func (w *PaneFocusWatcher) watch() {
	defer close(w.focusCh)

	// Signal that the watcher is ready (safe from double-close)
	select {
	case <-w.ready:
		// Already closed
	default:
		close(w.ready)
	}

	var debounceTimer *time.Timer
	var lastPaneID string

	for {
		select {
		case <-w.done:
			if debounceTimer != nil {
				debounceTimer.Stop()
			}
			return

		case event, ok := <-w.watcher.Events:
			if !ok {
				return
			}

			// Only process events for our specific file
			if event.Name != w.filePath {
				continue
			}

			// Process Create and Write events
			if event.Op&fsnotify.Create == fsnotify.Create || event.Op&fsnotify.Write == fsnotify.Write {
				// Read the pane ID
				paneID, err := readPaneID(w.filePath)
				if err != nil {
					// Send error event
					select {
					case w.focusCh <- PaneFocusEvent{Error: err}:
					case <-w.done:
						return
					}
					continue
				}

				// Skip if same as last pane ID (no change)
				if paneID == lastPaneID {
					debug.Log("PANE_WATCHER_DUPLICATE paneID=%s", paneID)
					continue
				}

				lastPaneID = paneID

				// Reset debounce timer
				if debounceTimer != nil {
					debounceTimer.Stop()
				}

				// Capture paneID in closure for timer
				currentPaneID := paneID

				debounceTimer = time.AfterFunc(w.debounce, func() {
					// Send event after debounce period
					debug.Log("PANE_WATCHER_FOCUS paneID=%s", currentPaneID)
					select {
					case w.focusCh <- PaneFocusEvent{PaneID: currentPaneID}:
					case <-w.done:
						return
					}
				})
			}

		case err, ok := <-w.watcher.Errors:
			if !ok {
				return
			}
			// Send error event
			select {
			case w.focusCh <- PaneFocusEvent{Error: err}:
			case <-w.done:
				return
			}
		}
	}
}

// IsClosed returns true if Close() was explicitly called
func (w *PaneFocusWatcher) IsClosed() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.closed
}

// Close stops the watcher and releases resources
func (w *PaneFocusWatcher) Close() error {
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
