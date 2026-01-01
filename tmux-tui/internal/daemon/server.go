package daemon

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"sync"
	"sync/atomic"
	"time"

	"github.com/commons-systems/tmux-tui/internal/debug"
	"github.com/commons-systems/tmux-tui/internal/namespace"
	"github.com/commons-systems/tmux-tui/internal/tmux"
	"github.com/commons-systems/tmux-tui/internal/watcher"
)

const (
	connectionCloseErrorThreshold = 10 // Warn after 10 close failures
	eventDeduplicationWindow      = 100 * time.Millisecond
	eventCleanupThreshold         = time.Second
)

var (
	audioMutex    sync.Mutex
	lastAudioPlay time.Time
)

// clientConnection wraps a client connection with a mutex-protected encoder
// to prevent race conditions when writing from multiple goroutines
type clientConnection struct {
	conn      net.Conn
	encoder   *json.Encoder
	encoderMu sync.Mutex
}

// successfulClient pairs a client ID with its connection for tracking
// broadcast successes during partial failure scenarios
type successfulClient struct {
	id     string
	client *clientConnection
}

// eventKey is used as a map key for event deduplication
type eventKey struct {
	paneID    string
	eventType string
	created   bool
}

// sendMessage safely sends a message to the client with mutex protection
func (c *clientConnection) sendMessage(msg Message) error {
	c.encoderMu.Lock()
	defer c.encoderMu.Unlock()
	return c.encoder.Encode(msg)
}

// handlePersistenceError logs and broadcasts a persistence failure to all clients
func (d *AlertDaemon) handlePersistenceError(err error) {
	debug.Log("DAEMON_SAVE_BLOCKED_ERROR error=%v", err)
	fmt.Fprintf(os.Stderr, "ERROR: Failed to persist blocked state: %v\n", err)
	fmt.Fprintf(os.Stderr, "  File: %s\n", d.blockedPath)
	fmt.Fprintf(os.Stderr, "  Changes will be lost on daemon restart!\n")

	// Create type-safe v2 message
	saveErr := err
	msg, constructErr := NewPersistenceErrorMessage(d.seqCounter.Add(1), fmt.Sprintf("Failed to save blocked state: %v", saveErr))
	if constructErr != nil {
		// CRITICAL: Persistence failed AND error notification failed
		fmt.Fprintf(os.Stderr, "CRITICAL: Persistence failed AND error notification failed: persistence=%v | construction=%v\n", saveErr, constructErr)
		debug.Log("DAEMON_MSG_CONSTRUCT_ERROR type=persistence_error error=%v", constructErr)

		// Fallback to v1 message format to ensure user is notified
		d.broadcast(Message{
			Type:   MsgTypePersistenceError,
			SeqNum: d.seqCounter.Add(1),
			Error:  fmt.Sprintf("Failed to save blocked state: %v", saveErr),
		})
		return
	}
	d.broadcast(msg.ToWireFormat())
}

// revertBlockedBranchChange reverts a failed block/unblock operation and broadcasts the revert.
// This is called when persistence fails to ensure in-memory state matches disk state.
func (d *AlertDaemon) revertBlockedBranchChange(branch string, wasBlocked bool, previousBlockedBy string) {
	d.blockedMu.Lock()
	if wasBlocked {
		// Restore previous blocked state
		d.blockedBranches[branch] = previousBlockedBy
	} else {
		// Remove the block that failed to persist
		delete(d.blockedBranches, branch)
	}
	d.blockedMu.Unlock()

	// Broadcast revert so all clients show correct state
	// TODO(#356): Add fallback notification when message construction fails
	// Current: Silent no-op when NewBlockChangeMessage fails (see PR review #273)
	msg, err := NewBlockChangeMessage(d.seqCounter.Add(1), branch, previousBlockedBy, wasBlocked)
	if err != nil {
		// TODO(#356): Add fallback notification for message construction failures
		// See issue for details from PR #273 review
		debug.Log("DAEMON_MSG_CONSTRUCT_ERROR type=block_change error=%v", err)
		fmt.Fprintf(os.Stderr, "ERROR: Failed to construct block change revert message: %v\n", err)
		return
	}
	d.broadcast(msg.ToWireFormat())

	debug.Log("DAEMON_REVERTED_BLOCK_CHANGE branch=%s wasBlocked=%v previousBlockedBy=%s",
		branch, wasBlocked, previousBlockedBy)
}

// playAlertSound plays the system alert sound in the background.
//
// Playback Conditions:
//   - Skipped during E2E tests (CLAUDE_E2E_TEST env var set)
//   - Rate limited: Maximum 1 sound per 500ms to prevent audio daemon overload
//   - Only plays when transitioning TO an alert state (handleAlertEvent determines this)
//
// Error Handling:
//   - Logs to stderr for immediate visibility
//   - Broadcasts MsgTypeAudioError to all connected clients
//   - Audio failures don't block other daemon operations
//
// Implementation Notes:
//   - Runs asynchronously in goroutine to avoid blocking daemon
//   - Rate limiting uses global audioMutex and lastAudioPlay timestamp
//   - afplay command targets macOS system sounds
func (d *AlertDaemon) playAlertSound() {
	// Skip sound during E2E tests
	if os.Getenv("CLAUDE_E2E_TEST") != "" {
		return
	}

	// Rate limit: Only allow one sound every 500ms to prevent audio daemon overload
	audioMutex.Lock()
	defer audioMutex.Unlock()

	now := time.Now()
	if now.Sub(lastAudioPlay) < 500*time.Millisecond {
		// Too soon since last play - skip to prevent audio daemon overload
		debug.Log("AUDIO_SKIPPED reason=rate_limit since_last=%v", now.Sub(lastAudioPlay))
		return
	}
	lastAudioPlay = now

	// Play sound asynchronously to avoid blocking daemon operations.
	// Rate limiting (500ms above) reduces but does not eliminate goroutine accumulation
	// during rapid alert bursts. Each goroutine blocks until afplay completes (~200ms typical).
	// Accumulation is mitigated by rate limiting but not prevented entirely.
	// cmd.Run() blocks the goroutine until afplay exits, automatically cleaning up the process.
	cmd := exec.Command("afplay", "/System/Library/Sounds/Tink.aiff")
	pid := os.Getpid()
	go func() {
		debug.Log("AUDIO_PLAYING pid=%d", pid)
		if err := cmd.Run(); err != nil {
			debug.Log("AUDIO_ERROR pid=%d error=%v", pid, err)
			d.broadcastAudioError(err)
		}
		debug.Log("AUDIO_COMPLETED pid=%d", pid)
	}()
}

// broadcastAudioError broadcasts an audio playback error to all connected clients.
//
// This function is called from the playAlertSound() goroutine when audio playback fails.
// It attempts to notify clients using the v2 protocol (MsgTypeAudioError), but falls back
// to a v1 message if message construction fails.
//
// Error Handling:
//   - If message construction fails: Logs CRITICAL error to stderr and falls back to v1 message
//   - The fallback ensures users are notified even if the v2 protocol has issues
//   - Audio errors are non-critical to daemon functionality - the daemon continues running
//
// Goroutine Safety:
//   - Safe to call from the playAlertSound() goroutine
//   - Uses d.broadcast() which handles concurrent access with proper locking
//
// TODO(#251): Add timeout to audio error broadcasting to prevent goroutine leaks when eventCh is congested - see PR review for #273
func (d *AlertDaemon) broadcastAudioError(audioErr error) {
	errorMsg := fmt.Sprintf("Audio playback failed: %v\n\n"+
		"Troubleshooting:\n"+
		"  1. Verify: afplay /System/Library/Sounds/Ping.aiff\n"+
		"  2. Check audio device connected and unmuted\n"+
		"  Note: Audio failures don't affect functionality", audioErr)

	fmt.Fprintf(os.Stderr, "ERROR: %s\n", errorMsg)

	// Create type-safe v2 message
	msg, constructErr := NewAudioErrorMessage(d.seqCounter.Add(1), errorMsg)
	if constructErr != nil {
		// CRITICAL: Audio error occurred AND error notification failed
		fmt.Fprintf(os.Stderr, "CRITICAL: Audio error occurred AND error notification failed: audio=%v | construction=%v\n", audioErr, constructErr)
		debug.Log("DAEMON_MSG_CONSTRUCT_ERROR type=audio_error error=%v", constructErr)

		// Fallback to v1 message format to ensure user is notified
		d.broadcast(Message{
			Type:   MsgTypeAudioError,
			SeqNum: d.seqCounter.Add(1),
			Error:  errorMsg,
		})
		return
	}

	preBroadcastFailures := d.broadcastFailures.Load()
	d.broadcast(msg.ToWireFormat())
	postBroadcastFailures := d.broadcastFailures.Load()

	if postBroadcastFailures > preBroadcastFailures {
		newFailures := postBroadcastFailures - preBroadcastFailures
		d.audioBroadcastFailures.Add(int64(newFailures))
		errMsg := fmt.Sprintf("Failed to broadcast audio error to %d clients (total audio broadcast failures: %d)",
			newFailures, d.audioBroadcastFailures.Load())
		d.lastAudioBroadcastErr.Store(errMsg)

		// ERROR VISIBILITY: Make visible to users
		fmt.Fprintf(os.Stderr, "ERROR: %s\n", errMsg)
		debug.Log("AUDIO_ERROR_BROADCAST_FAILED failures=%d total=%d",
			newFailures, d.audioBroadcastFailures.Load())
	}
}

// Lock Ordering Rules
//
// CRITICAL: Complete lock hierarchy to prevent deadlock:
//   1. server.alertsMu / server.blockedMu (state locks)
//   2. server.clientsMu (client registry)
//   3. client.encoderMu (per-client write lock)
//
// RATIONALE:
//   State update paths (handleAlertChange, handleBlockBranch, etc.) follow this pattern:
//   1. Acquire alertsMu/blockedMu (RLock or Lock depending on operation)
//   2. Update state (if Lock acquired)
//   3. Call broadcast() which acquires clientsMu.RLock → encoderMu
//   4. Release alertsMu/blockedMu
//
//   This ordering prevents deadlock because locks are acquired top-to-bottom
//   and never held during blocking operations.
//
// SAFE PATTERNS:
//   - alertsMu → clientsMu (via broadcast after state update)
//   - blockedMu → clientsMu (via broadcast after state update)
//   - alertsMu → blockedMu (query blocked state for alert change)
//   - clientsMu → encoderMu (broadcast iterates clients and sends messages)
//
// DEADLOCK PREVENTION:
//   - NEVER acquire alertsMu/blockedMu while holding clientsMu
//   - NEVER acquire clientsMu while holding encoderMu
//   - NEVER hold alertsMu/blockedMu across blocking operations
//   - ALWAYS release state locks before I/O operations
//
// INDEPENDENT: alertsMu and blockedMu
//   Can be acquired in either order (alertsMu → blockedMu or blockedMu → alertsMu).
//   Use RLock when only reading to allow concurrent access.
//   These locks are held only during map copying, never during I/O.
//
// EXAMPLES:
//   ✓ handleAlertChange(): alertsMu.Lock → broadcast() → clientsMu.RLock → encoderMu
//   ✓ handleBlockBranch(): blockedMu.Lock → broadcast() → clientsMu.RLock → encoderMu
//   ✓ GetHealthStatus(): alertsMu.RLock → blockedMu.RLock (both read-only, no ordering needed)
//   ✓ saveBlockedBranches(): blockedMu.RLock (no other locks, no I/O conflicts)
//   ✗ NEVER: encoderMu → clientsMu (DEADLOCK with broadcast)
//   ✗ NEVER: clientsMu → alertsMu (DEADLOCK with state update paths)

// AlertDaemon is the singleton daemon that manages alert state and fires bells.
type AlertDaemon struct {
	alertWatcher     *watcher.AlertWatcher
	paneFocusWatcher *watcher.PaneFocusWatcher
	alerts           map[string]string // Current alert state: paneID -> eventType
	previousState    map[string]string // Previous state for bell firing logic
	alertsMu         sync.RWMutex
	blockedBranches  map[string]string // Blocked branch state: branch -> blockedByBranch
	blockedMu        sync.RWMutex
	clients          map[string]*clientConnection
	clientsMu        sync.RWMutex
	listener         net.Listener
	done             chan struct{}
	socketPath       string
	blockedPath      string                 // Path to persist blocked state JSON
	recentEvents     map[eventKey]time.Time // Event deduplication: paneID+eventType+created -> last event time
	eventsMu         sync.Mutex

	// Health monitoring (accessed atomically)
	broadcastFailures      atomic.Int64  // Total broadcast failures since startup
	lastBroadcastError     atomic.Value  // Most recent broadcast error (string)
	watcherErrors          atomic.Int64  // Total watcher errors since startup
	lastWatcherError       atomic.Value  // Most recent watcher error (string)
	connectionCloseErrors  atomic.Int64  // Total connection close errors since startup
	lastCloseError         atomic.Value  // Most recent connection close error (string)
	audioBroadcastFailures atomic.Int64  // Total audio broadcast failures since startup
	lastAudioBroadcastErr  atomic.Value  // Most recent audio broadcast error (string)
	seqCounter             atomic.Uint64 // Global sequence number for message ordering

	// Tree collection (for centralizing tmux queries)
	collector     *tmux.Collector // Tmux tree collector
	collectorMu   sync.RWMutex    // Protects collector operations
	currentTree   tmux.RepoTree   // Last successful tree (for health metrics and full_state)
	treeErrors    atomic.Int64    // Total tree collection errors
	lastTreeError atomic.Value    // Most recent tree error (string)

	// Tree broadcast and construction error tracking (accessed atomically)
	treeBroadcastErrors     atomic.Int64 // Tree broadcast failures (tree_update + tree_error)
	lastTreeBroadcastErr    atomic.Value // Most recent tree broadcast error (string)
	treeMsgConstructErrors  atomic.Int64 // Tree message construction failures
	lastTreeMsgConstructErr atomic.Value // Most recent tree message construction error (string)
}

// TODO(#328): Consider extracting map copy pattern into generic helper function
// copyAlerts returns a copy of the alerts map with read lock protection
func (d *AlertDaemon) copyAlerts() map[string]string {
	d.alertsMu.RLock()
	defer d.alertsMu.RUnlock()

	copy := make(map[string]string, len(d.alerts))
	for k, v := range d.alerts {
		copy[k] = v
	}
	return copy
}

// TODO(#328): Consider extracting map copy pattern into generic helper function
// copyBlockedBranches returns a copy of the blockedBranches map with read lock protection
func (d *AlertDaemon) copyBlockedBranches() map[string]string {
	d.blockedMu.RLock()
	defer d.blockedMu.RUnlock()

	copy := make(map[string]string, len(d.blockedBranches))
	for k, v := range d.blockedBranches {
		copy[k] = v
	}
	return copy
}

// loadBlockedBranches loads the blocked branches state from JSON file
func loadBlockedBranches(path string) (map[string]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			// No file yet - return empty map
			return make(map[string]string), nil
		}
		return nil, fmt.Errorf("failed to read blocked branches file: %w", err)
	}

	var blockedBranches map[string]string
	if err := json.Unmarshal(data, &blockedBranches); err != nil {
		return nil, fmt.Errorf("failed to unmarshal blocked branches: %w", err)
	}

	return blockedBranches, nil
}

// saveBlockedBranches saves the blocked branches state to JSON file
func (d *AlertDaemon) saveBlockedBranches() error {
	blockedCopy := d.copyBlockedBranches()

	data, err := json.MarshalIndent(blockedCopy, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal blocked branches: %w", err)
	}

	if err := os.WriteFile(d.blockedPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write blocked branches file: %w", err)
	}

	debug.Log("DAEMON_BLOCKED_SAVED path=%s count=%d", d.blockedPath, len(blockedCopy))
	return nil
}

// loadExistingAlertsWithRetry attempts to load existing alerts with exponential backoff
func loadExistingAlertsWithRetry(alertDir string, maxRetries int) (map[string]string, error) {
	backoff := 50 * time.Millisecond
	maxBackoff := 500 * time.Millisecond

	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			debug.Log("DAEMON_ALERTS_LOAD_RETRY attempt=%d/%d backoff=%v", attempt+1, maxRetries, backoff)
			time.Sleep(backoff)
			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
		}

		alerts, err := watcher.GetExistingAlertsFromDir(alertDir)
		if err == nil {
			if attempt > 0 {
				debug.Log("DAEMON_ALERTS_LOAD_SUCCESS after_retries=%d", attempt)
			}
			return alerts, nil
		}

		lastErr = err
		debug.Log("DAEMON_ALERTS_LOAD_ERROR attempt=%d error=%v", attempt+1, err)
	}

	return nil, fmt.Errorf("failed to load existing alerts after %d attempts: %w", maxRetries, lastErr)
}

// NewAlertDaemon creates a new AlertDaemon instance.
func NewAlertDaemon() (*AlertDaemon, error) {
	// Use namespace to determine alert directory and socket path
	alertDir := namespace.AlertDir()
	socketPath := namespace.DaemonSocket()

	// Ensure namespace directory exists
	if err := os.MkdirAll(alertDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create namespace directory: %w", err)
	}

	// Create alert watcher with session-scoped directory
	alertWatcher, err := watcher.NewAlertWatcher(watcher.WithAlertDir(alertDir))
	if err != nil {
		return nil, fmt.Errorf("failed to create alert watcher: %w", err)
	}

	// Create pane focus watcher with same directory
	paneFocusWatcher, err := watcher.NewPaneFocusWatcher(watcher.WithPaneFocusDir(alertDir))
	if err != nil {
		alertWatcher.Close()
		return nil, fmt.Errorf("failed to create pane focus watcher: %w", err)
	}

	// Load existing alerts with retry
	const maxLoadRetries = 3
	existingAlerts, err := loadExistingAlertsWithRetry(alertDir, maxLoadRetries)
	if err != nil {
		alertWatcher.Close()
		paneFocusWatcher.Close()
		return nil, fmt.Errorf("failed to recover alert state: %w", err)
	}

	// Load blocked branches state (handles missing file gracefully)
	blockedPath := namespace.BlockedBranchesFile()
	blockedBranches, err := loadBlockedBranches(blockedPath)
	if err != nil {
		alertWatcher.Close()
		paneFocusWatcher.Close()
		return nil, fmt.Errorf("failed to load blocked branches: %w", err)
	}

	debug.Log("DAEMON_INIT alert_dir=%s socket=%s existing_alerts=%d blocked_branches=%d",
		alertDir, socketPath, len(existingAlerts), len(blockedBranches))

	daemon := &AlertDaemon{
		alertWatcher:     alertWatcher,
		paneFocusWatcher: paneFocusWatcher,
		alerts:           existingAlerts,
		previousState:    make(map[string]string),
		blockedBranches:  blockedBranches,
		clients:          make(map[string]*clientConnection),
		done:             make(chan struct{}),
		socketPath:       socketPath,
		blockedPath:      blockedPath,
		recentEvents:     make(map[eventKey]time.Time),
	}

	// Initialize atomic.Value fields
	daemon.lastBroadcastError.Store("")
	daemon.lastWatcherError.Store("")
	daemon.lastCloseError.Store("")
	daemon.lastAudioBroadcastErr.Store("")
	daemon.lastTreeError.Store("")
	daemon.lastTreeBroadcastErr.Store("")
	daemon.lastTreeMsgConstructErr.Store("")

	// Create tmux tree collector (gracefully handle errors - tree collection is non-critical)
	collector, err := tmux.NewCollector()
	if err != nil {
		debug.Log("DAEMON_INIT_WARNING failed to create tree collector: %v - tree broadcasts will be disabled", err)
		fmt.Fprintf(os.Stderr, "WARNING: Tree collector initialization failed: %v\n", err)
		fmt.Fprintf(os.Stderr, "         Tree broadcasts will be disabled. Clients will show empty trees.\n")

		// Store error for health endpoint
		daemon.lastTreeError.Store(fmt.Sprintf("collector initialization failed: %v", err))
		daemon.treeErrors.Add(1)

		// Continue daemon startup without collector - clients will receive no tree_update messages
		// and will show empty tree state (initialized with tmux.NewRepoTree())
	} else {
		daemon.collector = collector
		daemon.currentTree = tmux.NewRepoTree()
		debug.Log("DAEMON_INIT tree collector initialized")
	}

	return daemon, nil
}

// Start starts the daemon server.
func (d *AlertDaemon) Start() error {
	// Remove existing socket file if present
	if err := os.Remove(d.socketPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove existing socket: %w", err)
	}

	// Create Unix socket listener
	listener, err := net.Listen("unix", d.socketPath)
	if err != nil {
		return fmt.Errorf("failed to create socket listener: %w", err)
	}
	d.listener = listener

	debug.Log("DAEMON_STARTED socket=%s", d.socketPath)

	// Start alert watcher
	go d.watchAlerts()

	// Start pane focus watcher
	go d.watchPaneFocus()

	// Start tree collection (if collector is available)
	if d.collector != nil {
		go d.watchTree()
	}

	// Accept client connections
	go d.acceptClients()

	return nil
}

// watchAlerts monitors the alert watcher for events.
func (d *AlertDaemon) watchAlerts() {
	alertCh := d.alertWatcher.Start()

	for {
		select {
		case <-d.done:
			return
		case event, ok := <-alertCh:
			if !ok {
				debug.Log("DAEMON_WATCHER_STOPPED")
				return
			}

			if event.Error != nil {
				d.watcherErrors.Add(1)
				d.lastWatcherError.Store(event.Error.Error())
				debug.Log("DAEMON_WATCHER_ERROR error=%v total_errors=%d", event.Error, d.watcherErrors.Load())
				fmt.Fprintf(os.Stderr, "ERROR: Alert watcher error: %v\n", event.Error)
				continue
			}

			d.handleAlertEvent(event)
		}
	}
}

// watchPaneFocus monitors the pane focus watcher for events.
func (d *AlertDaemon) watchPaneFocus() {
	focusCh := d.paneFocusWatcher.Start()

	for {
		select {
		case <-d.done:
			return
		case event, ok := <-focusCh:
			if !ok {
				debug.Log("DAEMON_PANE_WATCHER_STOPPED")
				return
			}

			if event.Error != nil {
				d.watcherErrors.Add(1)
				d.lastWatcherError.Store(event.Error.Error())
				debug.Log("DAEMON_PANE_WATCHER_ERROR error=%v total_errors=%d", event.Error, d.watcherErrors.Load())
				fmt.Fprintf(os.Stderr, "ERROR: Pane focus watcher error: %v\n", event.Error)
				continue
			}

			d.handlePaneFocusEvent(event)
		}
	}
}

// recordTreeMsgConstructError tracks message construction failures with consistent logging
func (d *AlertDaemon) recordTreeMsgConstructError(errMsg string) {
	d.treeMsgConstructErrors.Add(1)
	d.lastTreeMsgConstructErr.Store(errMsg)
	debug.Log("DAEMON_TREE_MSG_CONSTRUCT_FAILED error=%s", errMsg)
	fmt.Fprintf(os.Stderr, "ERROR: %s\n", errMsg)
}

// watchTree monitors tmux tree state and broadcasts updates to all clients.
// Tree is collected and broadcast immediately on daemon startup, then every 30 seconds thereafter.
// This centralizes tree collection in the daemon, eliminating N×client redundant queries.
func (d *AlertDaemon) watchTree() {
	// Collect immediately on start
	d.collectAndBroadcastTree()

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-d.done:
			return
		case <-ticker.C:
			d.collectAndBroadcastTree()
		}
	}
}

// collectAndBroadcastTree collects current tmux tree state and broadcasts to all clients.
// Collection errors are non-fatal: broadcasts tree_error to notify clients and continues operation.
// Message construction failures are logged and attempt to broadcast tree_error if possible.
// TODO(#482): Add test to verify seqNum increases monotonically across multiple broadcasts
func (d *AlertDaemon) collectAndBroadcastTree() {
	// Lock collector for exclusive access during GetTree()
	d.collectorMu.Lock()
	defer d.collectorMu.Unlock()

	// Collect tree (can be slow - up to several seconds with many panes/repos)
	tree, err := d.collector.GetTree()
	if err != nil {
		// Collection failed - broadcast error to clients
		d.treeErrors.Add(1)
		errMsg := fmt.Sprintf("tree collection failed: %v", err)
		d.lastTreeError.Store(errMsg)
		debug.Log("DAEMON_TREE_ERROR error=%v total_errors=%d", err, d.treeErrors.Load())

		// Broadcast tree_error to all clients
		msg, msgErr := NewTreeErrorMessage(d.seqCounter.Add(1), errMsg)
		if msgErr != nil {
			// Track metric for message construction failures
			d.recordTreeMsgConstructError(fmt.Sprintf("tree_error construction failed: %v (original error: %v)", msgErr, err))
			fmt.Fprintf(os.Stderr, "       Original tree error: %s\n", errMsg)
			fmt.Fprintf(os.Stderr, "       CRITICAL: Clients will not be notified of tree collection failure\n")
			return
		}
		d.broadcastTree(msg.ToWireFormat())
		return
	}

	// Collection succeeded - update currentTree and broadcast to clients
	d.currentTree = tree
	debug.Log("DAEMON_TREE_UPDATE repos=%d", len(tree.Repos()))

	// Broadcast tree_update to all clients
	msg := NewTreeUpdateMessage(d.seqCounter.Add(1), tree)

	// Defensive: Verify message construction succeeded
	if msg == nil {
		errMsg := fmt.Sprintf("tree_update message construction returned nil (repos=%d, possible OOM or data corruption)", len(tree.Repos()))
		d.recordTreeMsgConstructError(errMsg)
		fmt.Fprintf(os.Stderr, "       Attempting to notify clients with tree_error message\n")

		// Attempt to notify clients instead of silent return
		if treeErrMsg, msgErr := NewTreeErrorMessage(d.seqCounter.Add(1), errMsg); msgErr == nil {
			d.broadcastTree(treeErrMsg.ToWireFormat())
		} else {
			fmt.Fprintf(os.Stderr, "       CRITICAL: Cannot construct tree_error - clients orphaned: %v\n", msgErr)
		}
		return
	}

	// Verify wire format conversion succeeds
	wireMsg := msg.ToWireFormat()
	if wireMsg.Tree == nil {
		errMsg := "ToWireFormat returned message with nil Tree field - possible memory corruption"
		d.recordTreeMsgConstructError(errMsg)
		fmt.Fprintf(os.Stderr, "       Attempting to notify clients with tree_error message\n")

		// Attempt to notify clients instead of silently dropping the update
		if treeErrMsg, msgErr := NewTreeErrorMessage(d.seqCounter.Add(1), errMsg); msgErr == nil {
			d.broadcastTree(treeErrMsg.ToWireFormat())
		} else {
			fmt.Fprintf(os.Stderr, "       CRITICAL: Cannot construct tree_error - clients orphaned: %v\n", msgErr)
		}
		return
	}

	d.broadcastTree(wireMsg)
}

// isDuplicateEvent checks if an event is a duplicate within the deduplication window.
// It also cleans up old entries to prevent memory leaks.
// Returns true if the event should be skipped as a duplicate.
func (d *AlertDaemon) isDuplicateEvent(paneID, eventType string, created bool) bool {
	// Validate inputs - empty paneID or eventType should be rejected
	if paneID == "" || eventType == "" {
		debug.Log("DAEMON_INVALID_EVENT_INPUT paneID=%q eventType=%q", paneID, eventType)
		return true // Skip invalid events
	}

	d.eventsMu.Lock()
	defer d.eventsMu.Unlock()

	key := eventKey{paneID: paneID, eventType: eventType, created: created}
	now := time.Now()

	// Check if this event occurred recently (deduplication window)
	if lastTime, exists := d.recentEvents[key]; exists {
		if now.Sub(lastTime) < eventDeduplicationWindow {
			// Duplicate event - skip
			return true
		}
	}

	// Update recent event time
	d.recentEvents[key] = now

	// Clean up old entries (>cleanup threshold) to prevent memory leak
	for k, timestamp := range d.recentEvents {
		if now.Sub(timestamp) > eventCleanupThreshold {
			delete(d.recentEvents, k)
		}
	}

	return false
}

// handlePaneFocusEvent processes a pane focus event and broadcasts to clients.
func (d *AlertDaemon) handlePaneFocusEvent(event watcher.PaneFocusEvent) {
	debug.Log("DAEMON_PANE_FOCUS_EVENT paneID=%s", event.PaneID)

	// Create type-safe v2 message
	msg, err := NewPaneFocusMessage(d.seqCounter.Add(1), event.PaneID)
	if err != nil {
		debug.Log("DAEMON_MSG_CONSTRUCT_ERROR type=pane_focus error=%v", err)
		fmt.Fprintf(os.Stderr, "ERROR: Failed to construct pane focus message: %v\n", err)
		return
	}
	d.broadcast(msg.ToWireFormat())
}

// handleAlertEvent processes an alert event and broadcasts to clients.
func (d *AlertDaemon) handleAlertEvent(event watcher.AlertEvent) {
	// Check for duplicate events BEFORE taking any locks
	if d.isDuplicateEvent(event.PaneID, event.EventType, event.Created) {
		debug.Log("DAEMON_ALERT_DUPLICATE paneID=%s eventType=%s created=%v", event.PaneID, event.EventType, event.Created)
		return
	}

	debug.Log("DAEMON_ALERT_EVENT paneID=%s eventType=%s created=%v", event.PaneID, event.EventType, event.Created)

	d.alertsMu.Lock()

	var isNewAlert bool
	previousState, hadPreviousState := d.previousState[event.PaneID]

	if event.Created {
		// Update previous state
		d.previousState[event.PaneID] = event.EventType

		if event.EventType == watcher.EventTypeWorking {
			// "working" means no alert - remove from alerts map
			delete(d.alerts, event.PaneID)
			debug.Log("DAEMON_ALERT_CLEARED paneID=%s remaining=%d", event.PaneID, len(d.alerts))
		} else {
			// Alert states: idle, stop, permission, elicitation
			// Check if this is a new alert (transition TO alert state)
			isNewAlert = !hadPreviousState || previousState == watcher.EventTypeWorking
			d.alerts[event.PaneID] = event.EventType
			debug.Log("DAEMON_ALERT_STORED paneID=%s eventType=%s total=%d isNew=%v",
				event.PaneID, event.EventType, len(d.alerts), isNewAlert)

			// Play sound only when transitioning to alert state
			if isNewAlert {
				d.playAlertSound()
			}
		}
	} else {
		// File deleted - remove from both maps
		delete(d.alerts, event.PaneID)
		delete(d.previousState, event.PaneID)
		debug.Log("DAEMON_ALERT_REMOVED paneID=%s remaining=%d", event.PaneID, len(d.alerts))
	}

	d.alertsMu.Unlock()

	// Create type-safe v2 message
	msg, err := NewAlertChangeMessage(d.seqCounter.Add(1), event.PaneID, event.EventType, event.Created)
	if err != nil {
		debug.Log("DAEMON_MSG_CONSTRUCT_ERROR type=alert_change error=%v", err)
		fmt.Fprintf(os.Stderr, "ERROR: Failed to construct alert change message: %v\n", err)
		return
	}
	d.broadcast(msg.ToWireFormat())
}

// acceptClients accepts incoming client connections.
func (d *AlertDaemon) acceptClients() {
	for {
		conn, err := d.listener.Accept()
		if err != nil {
			select {
			case <-d.done:
				// Shutdown - expected
				return
			default:
				debug.Log("DAEMON_ACCEPT_ERROR error=%v", err)
				continue
			}
		}

		go d.handleClient(conn)
	}
}

// handleClient manages a client connection.
func (d *AlertDaemon) handleClient(conn net.Conn) {
	decoder := json.NewDecoder(conn)

	var clientID string

	// Read hello message
	var helloMsg Message
	if err := decoder.Decode(&helloMsg); err != nil {
		debug.Log("DAEMON_CLIENT_HELLO_ERROR error=%v", err)
		conn.Close()
		return
	}

	if helloMsg.Type != MsgTypeHello {
		debug.Log("DAEMON_CLIENT_INVALID_HELLO type=%s", helloMsg.Type)
		conn.Close()
		return
	}

	clientID = helloMsg.ClientID
	debug.Log("DAEMON_CLIENT_CONNECTED id=%s", clientID)

	// Create client connection wrapper
	client := &clientConnection{
		conn:    conn,
		encoder: json.NewEncoder(conn),
	}

	// Register client
	d.clientsMu.Lock()
	d.clients[clientID] = client
	d.clientsMu.Unlock()

	// Send full state (alerts + blocked branches)
	alertsCopy := d.copyAlerts()
	blockedCopy := d.copyBlockedBranches()

	// Create type-safe v2 message
	fullStateMsg, err := NewFullStateMessage(d.seqCounter.Add(1), alertsCopy, blockedCopy)
	if err != nil {
		debug.Log("DAEMON_MSG_CONSTRUCT_ERROR type=full_state error=%v", err)
		d.removeClient(clientID)
		conn.Close()
		return
	}

	if err := client.sendMessage(fullStateMsg.ToWireFormat()); err != nil {
		debug.Log("DAEMON_SEND_STATE_ERROR client=%s error=%v", clientID, err)
		d.removeClient(clientID)
		conn.Close()
		return
	}

	debug.Log("DAEMON_SENT_STATE client=%s alerts=%d blocked=%d", clientID, len(alertsCopy), len(blockedCopy))

	// If tree collector failed initialization, notify client why tree updates won't happen
	if d.collector == nil {
		initErrMsg, _ := d.lastTreeError.Load().(string)
		if initErrMsg == "" {
			initErrMsg = "tree collector initialization failed (reason unknown)"
		}

		treeErrMsg, err := NewTreeErrorMessage(d.seqCounter.Add(1), initErrMsg)
		if err != nil {
			debug.Log("DAEMON_MSG_CONSTRUCT_ERROR type=tree_error error=%v", err)
			fmt.Fprintf(os.Stderr, "ERROR: Cannot construct tree_error message for client %s: %v\n", clientID, err)
			fmt.Fprintf(os.Stderr, "       Collector initialization failed: %s\n", initErrMsg)
			fmt.Fprintf(os.Stderr, "       Client will see empty tree state without explanation\n")
			// Don't disconnect client for this - they can still use alerts/blocking features
		} else {
			if err := client.sendMessage(treeErrMsg.ToWireFormat()); err != nil {
				debug.Log("DAEMON_TREE_INIT_ERROR_SEND_FAILED client=%s error=%v", clientID, err)
				fmt.Fprintf(os.Stderr, "WARNING: Failed to send tree_error to newly connected client %s: %v\n", clientID, err)
				fmt.Fprintf(os.Stderr, "         Original error: %s\n", initErrMsg)
				fmt.Fprintf(os.Stderr, "         Client will see empty tree state\n")
				// Don't disconnect - tree is non-critical feature
			} else {
				debug.Log("DAEMON_SENT_TREE_INIT_ERROR client=%s", clientID)
			}
		}
	}

	// Handle incoming messages
	for {
		var msg Message
		if err := decoder.Decode(&msg); err != nil {
			debug.Log("DAEMON_CLIENT_DISCONNECT client=%s error=%v", clientID, err)
			d.removeClient(clientID)
			conn.Close()
			return
		}

		switch msg.Type {
		case MsgTypePing:
			// Create type-safe v2 pong message
			pongMsg, err := NewPongMessage(d.seqCounter.Add(1))
			if err != nil {
				debug.Log("DAEMON_MSG_CONSTRUCT_ERROR type=pong error=%v", err)
				continue
			}
			if err := client.sendMessage(pongMsg.ToWireFormat()); err != nil {
				debug.Log("DAEMON_PONG_ERROR client=%s error=%v", clientID, err)
				d.removeClient(clientID)
				conn.Close()
				return
			}

		case MsgTypeShowBlockPicker:
			// Validate message before processing
			if err := ValidateMessage(msg); err != nil {
				debug.Log("DAEMON_INVALID_MESSAGE type=%s error=%v", msg.Type, err)
				fmt.Fprintf(os.Stderr, "ERROR: Invalid show_block_picker message: %v\n", err)

				// Send validation error response - use sync warning for protocol errors
				errorMsg, constructErr := NewSyncWarningMessage(
					d.seqCounter.Add(1),
					msg.Type,
					fmt.Sprintf("Invalid show_block_picker request: %v", err),
				)
				if constructErr != nil {
					// CRITICAL: Validation error AND error notification failed
					fmt.Fprintf(os.Stderr, "CRITICAL: Validation failed AND error notification failed: validation=%v | construction=%v\n", err, constructErr)
					debug.Log("DAEMON_MSG_CONSTRUCT_ERROR type=sync_warning error=%v", constructErr)

					// Fallback to v1 message format
					client.sendMessage(Message{
						Type:            MsgTypeSyncWarning,
						SeqNum:          d.seqCounter.Add(1),
						OriginalMsgType: msg.Type,
						Error:           fmt.Sprintf("Invalid show_block_picker request: %v", err),
					})
				} else {
					client.sendMessage(errorMsg.ToWireFormat())
				}
				continue
			}

			// Broadcast to all clients to show picker for this pane
			debug.Log("DAEMON_SHOW_PICKER paneID=%s", msg.PaneID)

			// Create type-safe v2 message
			pickerMsg, err := NewShowBlockPickerMessage(d.seqCounter.Add(1), msg.PaneID)
			if err != nil {
				debug.Log("DAEMON_MSG_CONSTRUCT_ERROR type=show_block_picker error=%v", err)
				continue
			}
			d.broadcast(pickerMsg.ToWireFormat())

		case MsgTypeBlockBranch:
			// Validate message before processing
			if err := ValidateMessage(msg); err != nil {
				debug.Log("DAEMON_INVALID_MESSAGE type=%s error=%v", msg.Type, err)
				fmt.Fprintf(os.Stderr, "ERROR: Invalid block_branch message: %v\n", err)

				// Send validation error response - use sync warning for protocol errors
				errorMsg, constructErr := NewSyncWarningMessage(
					d.seqCounter.Add(1),
					msg.Type,
					fmt.Sprintf("Invalid block request: %v", err),
				)
				if constructErr != nil {
					// CRITICAL: Validation error AND error notification failed
					fmt.Fprintf(os.Stderr, "CRITICAL: Validation failed AND error notification failed: validation=%v | construction=%v\n", err, constructErr)
					debug.Log("DAEMON_MSG_CONSTRUCT_ERROR type=sync_warning error=%v", constructErr)

					// Fallback to v1 message format
					client.sendMessage(Message{
						Type:            MsgTypeSyncWarning,
						SeqNum:          d.seqCounter.Add(1),
						OriginalMsgType: msg.Type,
						Error:           fmt.Sprintf("Invalid block request: %v", err),
					})
				} else {
					client.sendMessage(errorMsg.ToWireFormat())
				}
				continue
			}

			// Block a branch with another branch
			debug.Log("DAEMON_BLOCK_BRANCH branch=%s blockedBy=%s", msg.Branch, msg.BlockedBranch)

			// Capture previous state before making changes
			d.blockedMu.RLock()
			previousBlockedBy, wasBlocked := d.blockedBranches[msg.Branch]
			d.blockedMu.RUnlock()

			// Update in-memory state
			d.blockedMu.Lock()
			d.blockedBranches[msg.Branch] = msg.BlockedBranch
			d.blockedMu.Unlock()

			// Save to disk - revert if persistence fails
			if err := d.saveBlockedBranches(); err != nil {
				d.handlePersistenceError(err)
				d.revertBlockedBranchChange(msg.Branch, wasBlocked, previousBlockedBy)
				continue // Skip success broadcast
			}

			// Only broadcast success if persistence succeeded
			blockMsg, err := NewBlockChangeMessage(d.seqCounter.Add(1), msg.Branch, msg.BlockedBranch, true)
			if err != nil {
				debug.Log("DAEMON_MSG_CONSTRUCT_ERROR type=block_change error=%v", err)
				continue
			}
			d.broadcast(blockMsg.ToWireFormat())

		case MsgTypeUnblockBranch:
			// Validate message before processing
			if err := ValidateMessage(msg); err != nil {
				debug.Log("DAEMON_INVALID_MESSAGE type=%s error=%v", msg.Type, err)
				fmt.Fprintf(os.Stderr, "ERROR: Invalid unblock_branch message: %v\n", err)

				// Send validation error response - use sync warning for protocol errors
				errorMsg, constructErr := NewSyncWarningMessage(
					d.seqCounter.Add(1),
					msg.Type,
					fmt.Sprintf("Invalid unblock request: %v", err),
				)
				if constructErr != nil {
					// CRITICAL: Validation error AND error notification failed
					fmt.Fprintf(os.Stderr, "CRITICAL: Validation failed AND error notification failed: validation=%v | construction=%v\n", err, constructErr)
					debug.Log("DAEMON_MSG_CONSTRUCT_ERROR type=sync_warning error=%v", constructErr)

					// Fallback to v1 message format
					client.sendMessage(Message{
						Type:            MsgTypeSyncWarning,
						SeqNum:          d.seqCounter.Add(1),
						OriginalMsgType: msg.Type,
						Error:           fmt.Sprintf("Invalid unblock request: %v", err),
					})
				} else {
					client.sendMessage(errorMsg.ToWireFormat())
				}
				continue
			}

			// Unblock a branch
			debug.Log("DAEMON_UNBLOCK_BRANCH branch=%s", msg.Branch)

			// Capture previous state before making changes
			d.blockedMu.RLock()
			previousBlockedBy, wasBlocked := d.blockedBranches[msg.Branch]
			d.blockedMu.RUnlock()

			// Update in-memory state
			d.blockedMu.Lock()
			delete(d.blockedBranches, msg.Branch)
			d.blockedMu.Unlock()

			// Save to disk - revert if persistence fails
			if err := d.saveBlockedBranches(); err != nil {
				d.handlePersistenceError(err)
				d.revertBlockedBranchChange(msg.Branch, wasBlocked, previousBlockedBy)
				continue // Skip success broadcast
			}

			// Only broadcast success if persistence succeeded
			unblockMsg, err := NewBlockChangeMessage(d.seqCounter.Add(1), msg.Branch, "", false)
			if err != nil {
				debug.Log("DAEMON_MSG_CONSTRUCT_ERROR type=block_change error=%v", err)
				continue
			}
			d.broadcast(unblockMsg.ToWireFormat())

		case MsgTypeQueryBlockedState:
			// Query blocked state for a branch
			debug.Log("DAEMON_QUERY_BLOCKED_STATE branch=%s", msg.Branch)
			d.blockedMu.RLock()
			blockedBy, isBlocked := d.blockedBranches[msg.Branch]
			d.blockedMu.RUnlock()

			// Send response back to requesting client
			response, err := NewBlockedStateResponseMessage(d.seqCounter.Add(1), msg.Branch, isBlocked, blockedBy)
			if err != nil {
				debug.Log("DAEMON_MSG_CONSTRUCT_ERROR type=blocked_state_response error=%v", err)
				continue
			}
			if err := client.sendMessage(response.ToWireFormat()); err != nil {
				debug.Log("DAEMON_QUERY_RESPONSE_ERROR client=%s error=%v", clientID, err)
			} else {
				debug.Log("DAEMON_QUERY_RESPONSE branch=%s isBlocked=%v blockedBy=%s",
					msg.Branch, isBlocked, blockedBy)
			}

		case MsgTypeHealthQuery:
			// Return health status
			debug.Log("DAEMON_HEALTH_QUERY client=%s", clientID)
			// TODO(#281): Include field-level details in health validation errors
			// Current: Generic message without specific field/value context
			status, healthErr := d.GetHealthStatus()
			if healthErr != nil {
				// Send error message to client instead of fabricated health status
				errMsg := fmt.Sprintf("Health status validation failed: %v", healthErr)
				fmt.Fprintf(os.Stderr, "ERROR: %s\n", errMsg)

				// Use sync warning for health validation errors (protocol-level issue)
				errorResponse, constructErr := NewSyncWarningMessage(
					d.seqCounter.Add(1),
					MsgTypeHealthQuery,
					errMsg,
				)
				if constructErr != nil {
					// CRITICAL: Health validation failed AND error notification failed
					fmt.Fprintf(os.Stderr, "CRITICAL: Health validation failed AND error notification failed: validation=%v | construction=%v\n", healthErr, constructErr)
					debug.Log("DAEMON_MSG_CONSTRUCT_ERROR type=sync_warning error=%v", constructErr)

					// Fallback to v1 message format
					client.sendMessage(Message{
						Type:            MsgTypeSyncWarning,
						SeqNum:          d.seqCounter.Add(1),
						OriginalMsgType: MsgTypeHealthQuery,
						Error:           errMsg,
					})
				} else {
					client.sendMessage(errorResponse.ToWireFormat())
				}
				debug.Log("DAEMON_HEALTH_VALIDATION_FAILED client=%s error=%v", clientID, healthErr)
				continue
			}
			response, constructErr := NewHealthResponseMessage(d.seqCounter.Add(1), status)
			if constructErr != nil {
				// CRITICAL: Health response construction failed - client will timeout
				errMsg := fmt.Sprintf("Health response construction failed: %v", constructErr)
				fmt.Fprintf(os.Stderr, "CRITICAL: %s\n", errMsg)
				debug.Log("DAEMON_MSG_CONSTRUCT_ERROR type=health_response error=%v", constructErr)

				// Send error message instead of leaving client hanging
				errorResponse, syncConstructErr := NewSyncWarningMessage(
					d.seqCounter.Add(1),
					MsgTypeHealthQuery,
					errMsg,
				)
				if syncConstructErr != nil {
					// CRITICAL: Cannot construct any error message
					fmt.Fprintf(os.Stderr, "CRITICAL: Health response failed AND error notification failed: response=%v | error=%v\n", constructErr, syncConstructErr)

					// Fallback to v1 message format
					client.sendMessage(Message{
						Type:            MsgTypeSyncWarning,
						SeqNum:          d.seqCounter.Add(1),
						OriginalMsgType: MsgTypeHealthQuery,
						Error:           errMsg,
					})
				} else {
					client.sendMessage(errorResponse.ToWireFormat())
				}
				continue
			}
			if err := client.sendMessage(response.ToWireFormat()); err != nil {
				debug.Log("DAEMON_HEALTH_RESPONSE_ERROR client=%s error=%v", clientID, err)
			} else {
				debug.Log("DAEMON_HEALTH_RESPONSE client=%s", clientID)
			}

		case MsgTypeResyncRequest:
			// Client detected a gap in sequence numbers, send full state
			debug.Log("DAEMON_RESYNC_REQUEST client=%s", clientID)
			if err := d.sendFullState(client, clientID); err != nil {
				debug.Log("DAEMON_RESYNC_FAILED client=%s error=%v", clientID, err)
			}

		default:
			// Unknown message type
			debug.Log("DAEMON_UNKNOWN_MESSAGE_TYPE client=%s type=%s", clientID, msg.Type)
			errMsg := fmt.Sprintf("Unknown message type: %s", msg.Type)
			fmt.Fprintf(os.Stderr, "ERROR: Unknown message type from client %s: %s\n", clientID, msg.Type)

			// Use sync warning for unknown message types (protocol-level issue)
			errorMsg, constructErr := NewSyncWarningMessage(
				d.seqCounter.Add(1),
				msg.Type,
				errMsg,
			)
			if constructErr != nil {
				// CRITICAL: Unknown message type AND error notification failed
				fmt.Fprintf(os.Stderr, "CRITICAL: Unknown message type AND error notification failed: type=%s | construction=%v\n", msg.Type, constructErr)
				debug.Log("DAEMON_MSG_CONSTRUCT_ERROR type=sync_warning error=%v", constructErr)

				// Fallback to v1 message format
				client.sendMessage(Message{
					Type:            MsgTypeSyncWarning,
					SeqNum:          d.seqCounter.Add(1),
					OriginalMsgType: msg.Type,
					Error:           errMsg,
				})
			} else {
				client.sendMessage(errorMsg.ToWireFormat())
			}
		}
	}
}

// broadcast sends a message to all connected clients with partial failure handling.
//
// Message Requirements:
//   - Message must have a sequence number assigned via v2 constructor (NewAlertChangeMessage, etc.)
//   - Sequence numbers are globally incrementing via d.seqCounter.Add(1)
//   - Clients use sequence numbers to detect gaps and request resync
//
// Partial Failure Handling:
//   - If some clients fail to receive the message, they are disconnected and removed
//   - Failed clients are forced to reconnect, which triggers a full state resync (sendFullState)
//   - Successful clients receive a sync warning notification about the disconnections
//   - This ensures eventual consistency across all clients
//
// Error Recovery Cascade (when client send fails):
//  1. Track the send failure and log to debug
//  2. Disconnect the client (close connection)
//  3. Send sync warning to successful clients
//  4. If disconnect notification fails, log to debug
//  5. If connection close fails, log to stderr and track in health metrics (CRITICAL if threshold exceeded)
//
// Lock Safety:
//   - Acquires RLock for reading clients and attempting sends (allows concurrent broadcasts)
//   - Releases RLock before cleanup to avoid deadlock
//   - Acquires Lock for removing failed clients (exclusive access during cleanup)
//   - Follows lock ordering: Never hold clientsMu.Lock during message sends
//
// Health Metrics:
//   - Tracks broadcast failures in d.broadcastFailures counter
//   - Tracks connection close errors in d.connectionCloseErrors counter
//   - Stores last broadcast error in d.lastBroadcastError for health queries
//   - Stores last close error in d.lastCloseError for health queries
//
// Thread Safety:
//   - Concurrent-safe: Multiple goroutines can call broadcast simultaneously
//   - Lock-free message send attempts under RLock
//   - Exclusive Lock only for client cleanup
func (d *AlertDaemon) broadcast(msg Message) {
	d.clientsMu.RLock()
	totalClients := len(d.clients)

	var failedClients []string
	var successfulClients []successfulClient

	for clientID, client := range d.clients {
		if err := client.sendMessage(msg); err != nil {
			failedClients = append(failedClients, clientID)
			debug.Log("DAEMON_BROADCAST_ERROR client=%s error=%v", clientID, err)
			d.lastBroadcastError.Store(err.Error())
		} else {
			successfulClients = append(successfulClients, successfulClient{
				id:     clientID,
				client: client,
			})
		}
	}
	d.clientsMu.RUnlock()

	// Clean up failed clients - must be done after RUnlock to avoid deadlock
	// This forces reconnection with full state resync
	if len(failedClients) > 0 {
		d.clientsMu.Lock()
		for _, clientID := range failedClients {
			if client, exists := d.clients[clientID]; exists {
				// Send disconnect notification BEFORE closing
				// Note: disconnect is not in the v2 protocol, using raw Message for now
				disconnectMsg := Message{
					Type:  "disconnect",
					Error: "Broadcast send failed - forcing reconnect for state resync",
				}
				if err := client.sendMessage(disconnectMsg); err != nil {
					debug.Log("DAEMON_DISCONNECT_NOTIFY_FAILED client=%s error=%v", clientID, err)
				}

				// TODO(#330): Add pattern detection for rapid connection close failures
				if closeErr := client.conn.Close(); closeErr != nil {
					totalCloseErrors := d.connectionCloseErrors.Add(1)
					d.lastCloseError.Store(closeErr.Error())

					// ERROR VISIBILITY: Log to stderr
					fmt.Fprintf(os.Stderr, "WARNING: Connection close error for client %s: %v (total: %d)\n",
						clientID, closeErr, totalCloseErrors)
					debug.Log("DAEMON_CONNECTION_CLOSE_ERROR client=%s close_error=%v total=%d",
						clientID, closeErr, totalCloseErrors)

					// THRESHOLD MONITORING: Warn if close errors exceed threshold
					if totalCloseErrors >= connectionCloseErrorThreshold {
						fmt.Fprintf(os.Stderr, "CRITICAL: Connection close errors (%d) exceeded threshold (%d). Potential file descriptor leak.\n",
							totalCloseErrors, connectionCloseErrorThreshold)
						debug.Log("DAEMON_CLOSE_ERROR_THRESHOLD_EXCEEDED total=%d threshold=%d",
							totalCloseErrors, connectionCloseErrorThreshold)
					}
				}
				delete(d.clients, clientID)
				debug.Log("DAEMON_CLIENT_REMOVED_AFTER_BROADCAST_FAILURE client=%s", clientID)
			}
		}
		d.clientsMu.Unlock()

		d.broadcastFailures.Add(int64(len(failedClients)))

		// ERROR VISIBILITY: Log to stderr for user visibility
		errMsg := fmt.Sprintf("Broadcast partial failure: %d of %d clients failed to receive %s (seq %d). Affected clients disconnected.",
			len(failedClients), totalClients, msg.Type, msg.SeqNum)
		fmt.Fprintf(os.Stderr, "WARNING: %s\n", errMsg)

		debug.Log("DAEMON_BROADCAST_FAILURES count=%d total=%d total_failures=%d",
			len(failedClients), totalClients, d.broadcastFailures.Load())

		// Notify successful clients that some peers missed the update
		// This is informational - clients can decide how to handle it
		errorMsg := fmt.Sprintf(
			"%d of %d clients failed to receive %s update (seq %d). "+
				"Affected clients disconnected and will resync on reconnect.",
			len(failedClients), totalClients, msg.Type, msg.SeqNum,
		)
		// TODO(#281): Improve sync warning error context
		// Current: Fallback can cascade into another failure without clear user messaging
		syncWarning, err := NewSyncWarningMessage(d.seqCounter.Add(1), msg.Type, errorMsg)
		if err != nil {
			// CRITICAL: Cannot construct sync warning - use fallback raw message
			// TODO(#281): Escalate broadcast cascade failures to health metrics - see PR review for #273
			fmt.Fprintf(os.Stderr, "CRITICAL: Sync warning construction failed (type=%s, failed_clients=%d): %v\n",
				msg.Type, len(failedClients), err)
			debug.Log("DAEMON_MSG_CONSTRUCT_ERROR type=sync_warning error=%v", err)

			// FALLBACK: Send raw message to inform clients of sync issue
			fallbackMsg := Message{
				Type:            MsgTypeSyncWarning,
				SeqNum:          d.seqCounter.Add(1),
				Error:           fmt.Sprintf("Sync warning (fallback): %d clients failed to receive update", len(failedClients)),
				OriginalMsgType: "unknown", // Safe fallback when original type is invalid
			}

			// Send fallback message to successful clients
			syncFailures := 0
			for _, sc := range successfulClients {
				if err := sc.client.sendMessage(fallbackMsg); err != nil {
					syncFailures++
					debug.Log("DAEMON_SYNC_WARNING_FALLBACK_SEND_ERROR client=%s error=%v", sc.id, err)
				}
			}

			if syncFailures > 0 {
				fmt.Fprintf(os.Stderr, "CRITICAL: Sync warning fallback cascade failure (sync_failures=%d/%d)\n",
					syncFailures, len(successfulClients))
			}
		} else {
			// Normal path: Send properly constructed sync warning
			syncFailures := 0
			for _, sc := range successfulClients {
				if err := sc.client.sendMessage(syncWarning.ToWireFormat()); err != nil {
					syncFailures++
					debug.Log("DAEMON_SYNC_WARNING_SEND_ERROR client=%s error=%v", sc.id, err)
				}
			}

			if syncFailures > 0 {
				// CRITICAL: Sync warning cascade failure - some clients unaware of peer disconnections
				fmt.Fprintf(os.Stderr, "CRITICAL: Sync warning cascade failure (original=%s, sync_failures=%d/%d)\n",
					msg.Type, syncFailures, len(successfulClients))
			}
		}
	}
}

// broadcastTree broadcasts tree-related messages (tree_update, tree_error) and tracks failures separately.
// This allows health metrics to distinguish tree broadcast issues from general broadcast issues.
func (d *AlertDaemon) broadcastTree(msg Message) {
	preBroadcastFailures := d.broadcastFailures.Load()
	d.broadcast(msg)
	postBroadcastFailures := d.broadcastFailures.Load()

	if postBroadcastFailures > preBroadcastFailures {
		newFailures := postBroadcastFailures - preBroadcastFailures
		d.treeBroadcastErrors.Add(int64(newFailures))

		errMsg := fmt.Sprintf("Tree broadcast failed to %d clients (type=%s, seq=%d)",
			newFailures, msg.Type, msg.SeqNum)
		d.lastTreeBroadcastErr.Store(errMsg)

		debug.Log("TREE_BROADCAST_FAILED type=%s failures=%d total_tree_failures=%d",
			msg.Type, newFailures, d.treeBroadcastErrors.Load())
		fmt.Fprintf(os.Stderr, "WARNING: %s\n", errMsg)
	}
}

// sendFullState sends the complete current daemon state to a single client.
//
// Purpose:
//   - Initial state synchronization when a client first connects
//   - Resynchronization when a client detects a sequence number gap
//   - Recovery mechanism after broadcast failures (via forced reconnection)
//
// State Included:
//   - All current alerts (pane ID -> event type mapping)
//   - All blocked branches (branch name -> reason mapping)
//   - Fresh sequence number from the global counter
//
// Error Handling:
//   - Message construction errors: Logged to stderr and debug, returned to caller
//   - Send errors: Logged to stderr and debug, returned to caller
//   - Caller (handleClient) typically disconnects the client on error
//
// Thread Safety:
//   - Creates copies of alerts and blocked branches maps under locks
//   - Sends the message without holding any locks (prevents blocking other operations)
//   - Safe to call concurrently for different clients
func (d *AlertDaemon) sendFullState(client *clientConnection, clientID string) error {
	// If collector is nil, send tree_error to explain why tree is empty
	if d.collector == nil {
		errMsg, ok := d.lastTreeError.Load().(string)
		if !ok || errMsg == "" {
			errMsg = "tree collector initialization failed - tree broadcasts disabled"
		}

		msg, msgErr := NewTreeErrorMessage(d.seqCounter.Add(1), errMsg)
		if msgErr != nil {
			// Cannot construct error message - log the failure
			debug.Log("DAEMON_TREE_ERROR_CONSTRUCT_FAILED client=%s construct_error=%v original_error=%s", clientID, msgErr, errMsg)
			fmt.Fprintf(os.Stderr, "ERROR: Cannot construct tree_error message for client %s: %v\n", clientID, msgErr)
			fmt.Fprintf(os.Stderr, "       Tree initialization failed with: %s\n", errMsg)
			fmt.Fprintf(os.Stderr, "       Client will see empty tree state without explanation\n")
			// Don't return - client can still use alerts and blocking features
		} else {
			wireMsg := msg.ToWireFormat()
			if sendErr := client.sendMessage(wireMsg); sendErr != nil {
				debug.Log("DAEMON_TREE_ERROR_SEND_FAILED client=%s error=%v", clientID, sendErr)
				fmt.Fprintf(os.Stderr, "WARNING: Failed to send tree_error to client %s: %v\n", clientID, sendErr)
			} else {
				debug.Log("DAEMON_TREE_ERROR_SENT client=%s reason=%s", clientID, errMsg)
			}
		}
		// Continue to send alerts and blocked branches
	}

	alertsCopy := d.copyAlerts()
	blockedCopy := d.copyBlockedBranches()

	// Create type-safe v2 message
	fullStateMsg, err := NewFullStateMessage(d.seqCounter.Add(1), alertsCopy, blockedCopy)
	if err != nil {
		debug.Log("DAEMON_MSG_CONSTRUCT_ERROR type=full_state error=%v", err)
		fmt.Fprintf(os.Stderr, "ERROR: Failed to construct full state message for client %s: %v\n", clientID, err)
		return fmt.Errorf("failed to construct full state message: %w", err)
	}

	if err := client.sendMessage(fullStateMsg.ToWireFormat()); err != nil {
		debug.Log("DAEMON_RESYNC_ERROR client=%s error=%v", clientID, err)
		fmt.Fprintf(os.Stderr, "ERROR: Failed to send full state to client %s: %v\n", clientID, err)
		return fmt.Errorf("resync failed: %w", err)
	}
	debug.Log("DAEMON_RESYNC_SENT client=%s alerts=%d blocked=%d", clientID, len(alertsCopy), len(blockedCopy))
	return nil
}

// removeClient removes a client from the clients map.
func (d *AlertDaemon) removeClient(clientID string) {
	d.clientsMu.Lock()
	defer d.clientsMu.Unlock()
	delete(d.clients, clientID)
	debug.Log("DAEMON_CLIENT_REMOVED id=%s remaining=%d", clientID, len(d.clients))
}

// GetHealthStatus returns daemon health metrics for monitoring and diagnostics.
//
// Metrics Returned:
//   - Broadcast failures: Total count of failed client message sends
//   - Watcher errors: Total count of alert/pane focus watcher errors
//   - Connection close errors: Total count of failed connection closures
//   - Audio failures: Total count of audio playback failures
//   - Active connections: Current number of connected clients
//   - Active alerts: Current number of panes with alerts
//   - Blocked branches: Current number of blocked git branches
//   - Last errors: Most recent error messages for each category (if any)
//
// Error Handling:
//   - Validates the health status before returning
//   - Returns error if validation fails
//   - Logs validation errors to stderr for immediate visibility
//
// Thread Safety:
//   - Uses atomic counters for error counts (no locks needed)
//   - Briefly acquires RLock on each map to get counts
//   - Lock acquisitions are short and non-blocking
//   - Safe to call concurrently from multiple goroutines
//
// Usage:
//   - Called by the health query handler (/health endpoint)
//   - Used by monitoring tools to detect daemon issues
//   - Provides visibility into error conditions without requiring log access
func (d *AlertDaemon) GetHealthStatus() (HealthStatus, error) {
	lastBroadcastErr, _ := d.lastBroadcastError.Load().(string)
	lastWatcherErr, _ := d.lastWatcherError.Load().(string)
	lastCloseErr, _ := d.lastCloseError.Load().(string)
	lastAudioBroadcastErr, _ := d.lastAudioBroadcastErr.Load().(string)
	lastTreeBroadcastErr, _ := d.lastTreeBroadcastErr.Load().(string)
	lastTreeMsgConstructErr, _ := d.lastTreeMsgConstructErr.Load().(string)

	d.clientsMu.RLock()
	clientCount := len(d.clients)
	d.clientsMu.RUnlock()

	d.alertsMu.RLock()
	alertCount := len(d.alerts)
	d.alertsMu.RUnlock()

	d.blockedMu.RLock()
	blockedCount := len(d.blockedBranches)
	d.blockedMu.RUnlock()

	// TODO(#281): Include validation errors in health status response - see PR review for #273
	status, err := NewHealthStatus(
		d.broadcastFailures.Load(),
		lastBroadcastErr,
		d.watcherErrors.Load(),
		lastWatcherErr,
		d.connectionCloseErrors.Load(),
		lastCloseErr,
		d.audioBroadcastFailures.Load(),
		lastAudioBroadcastErr,
		d.treeBroadcastErrors.Load(),
		lastTreeBroadcastErr,
		d.treeMsgConstructErrors.Load(),
		lastTreeMsgConstructErr,
		clientCount,
		alertCount,
		blockedCount,
	)
	if err != nil {
		errMsg := fmt.Sprintf("Failed to create health status: %v", err)

		// CRITICAL: Make validation failures visible
		fmt.Fprintf(os.Stderr, "ERROR: %s\n", errMsg)
		debug.Log("DAEMON_HEALTH_STATUS_ERROR error=%v", err)

		// Return error to caller instead of zero-value fallback
		return HealthStatus{}, fmt.Errorf("%w: %v", ErrHealthValidationFailed, err)
	}
	return status, nil
}

// Stop stops the daemon server.
func (d *AlertDaemon) Stop() error {
	debug.Log("DAEMON_STOPPING")
	close(d.done)

	// Close alert watcher
	if d.alertWatcher != nil {
		d.alertWatcher.Close()
	}

	// Close pane focus watcher
	if d.paneFocusWatcher != nil {
		d.paneFocusWatcher.Close()
	}

	// Close all client connections
	d.clientsMu.Lock()
	for clientID, client := range d.clients {
		debug.Log("DAEMON_CLOSING_CLIENT id=%s", clientID)
		client.conn.Close()
	}
	d.clients = make(map[string]*clientConnection)
	d.clientsMu.Unlock()

	// Close listener
	if d.listener != nil {
		d.listener.Close()
	}

	// Remove socket file
	if err := os.Remove(d.socketPath); err != nil && !os.IsNotExist(err) {
		debug.Log("DAEMON_SOCKET_REMOVE_ERROR error=%v", err)
	}

	debug.Log("DAEMON_STOPPED")
	return nil
}
