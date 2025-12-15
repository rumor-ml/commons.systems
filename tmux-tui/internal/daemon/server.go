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
	"github.com/commons-systems/tmux-tui/internal/watcher"
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

// sendMessage safely sends a message to the client with mutex protection
func (c *clientConnection) sendMessage(msg Message) error {
	c.encoderMu.Lock()
	defer c.encoderMu.Unlock()
	return c.encoder.Encode(msg)
}

// playAlertSound plays the system alert sound in the background.
// It skips playback during E2E tests (CLAUDE_E2E_TEST env var).
// The sound only plays once when transitioning to an alert state.
// Rate limiting prevents audio daemon overload.
func playAlertSound() {
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

	// Play sound and WAIT for completion to prevent process accumulation
	cmd := exec.Command("afplay", "/System/Library/Sounds/Tink.aiff")
	go func() {
		debug.Log("AUDIO_PLAYING")
		cmd.Run() // Run (not Start) waits for completion, prevents zombies
		debug.Log("AUDIO_COMPLETED")
	}()
}

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
	blockedPath      string // Path to persist blocked state JSON

	// Health monitoring (accessed atomically)
	broadcastFailures  atomic.Int64 // Total broadcast failures since startup
	lastBroadcastError atomic.Value // Most recent broadcast error (string)
	watcherErrors      atomic.Int64 // Total watcher errors since startup
	lastWatcherError   atomic.Value // Most recent watcher error (string)
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
	d.blockedMu.RLock()
	blockedCopy := make(map[string]string)
	for k, v := range d.blockedBranches {
		blockedCopy[k] = v
	}
	d.blockedMu.RUnlock()

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
	}

	// Initialize atomic.Value fields
	daemon.lastBroadcastError.Store("")
	daemon.lastWatcherError.Store("")

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
				continue
			}

			d.handlePaneFocusEvent(event)
		}
	}
}

// handlePaneFocusEvent processes a pane focus event and broadcasts to clients.
func (d *AlertDaemon) handlePaneFocusEvent(event watcher.PaneFocusEvent) {
	debug.Log("DAEMON_PANE_FOCUS_EVENT paneID=%s", event.PaneID)

	// Broadcast to all clients
	msg := Message{
		Type:         MsgTypePaneFocus,
		ActivePaneID: event.PaneID,
	}
	d.broadcast(msg)
}

// handleAlertEvent processes an alert event and broadcasts to clients.
func (d *AlertDaemon) handleAlertEvent(event watcher.AlertEvent) {
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
				playAlertSound()
			}
		}
	} else {
		// File deleted - remove from both maps
		delete(d.alerts, event.PaneID)
		delete(d.previousState, event.PaneID)
		debug.Log("DAEMON_ALERT_REMOVED paneID=%s remaining=%d", event.PaneID, len(d.alerts))
	}

	d.alertsMu.Unlock()

	// Broadcast to all clients
	msg := Message{
		Type:      MsgTypeAlertChange,
		PaneID:    event.PaneID,
		EventType: event.EventType,
		Created:   event.Created,
	}
	d.broadcast(msg)
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
	d.alertsMu.RLock()
	alertsCopy := make(map[string]string)
	for k, v := range d.alerts {
		alertsCopy[k] = v
	}
	d.alertsMu.RUnlock()

	d.blockedMu.RLock()
	blockedCopy := make(map[string]string)
	for k, v := range d.blockedBranches {
		blockedCopy[k] = v
	}
	d.blockedMu.RUnlock()

	fullStateMsg := Message{
		Type:            MsgTypeFullState,
		Alerts:          alertsCopy,
		BlockedBranches: blockedCopy,
	}
	if err := client.sendMessage(fullStateMsg); err != nil {
		debug.Log("DAEMON_SEND_STATE_ERROR client=%s error=%v", clientID, err)
		d.removeClient(clientID)
		conn.Close()
		return
	}

	debug.Log("DAEMON_SENT_STATE client=%s alerts=%d blocked=%d", clientID, len(alertsCopy), len(blockedCopy))

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
			pongMsg := Message{Type: MsgTypePong}
			if err := client.sendMessage(pongMsg); err != nil {
				debug.Log("DAEMON_PONG_ERROR client=%s error=%v", clientID, err)
				d.removeClient(clientID)
				conn.Close()
				return
			}

		case MsgTypeShowBlockPicker:
			// Broadcast to all clients to show picker for this pane
			debug.Log("DAEMON_SHOW_PICKER paneID=%s", msg.PaneID)
			d.broadcast(Message{
				Type:   MsgTypeShowBlockPicker,
				PaneID: msg.PaneID,
			})

		case MsgTypeBlockBranch:
			// Block a branch with another branch
			debug.Log("DAEMON_BLOCK_BRANCH branch=%s blockedBy=%s", msg.Branch, msg.BlockedBranch)
			d.blockedMu.Lock()
			d.blockedBranches[msg.Branch] = msg.BlockedBranch
			d.blockedMu.Unlock()

			// Save to disk
			if err := d.saveBlockedBranches(); err != nil {
				debug.Log("DAEMON_SAVE_BLOCKED_ERROR error=%v", err)
				// Broadcast persistence error to all clients
				d.broadcast(Message{
					Type:  MsgTypePersistenceError,
					Error: fmt.Sprintf("Failed to save blocked state: %v", err),
				})
			}

			// Broadcast change to all clients (this will close pickers in all TUI windows)
			d.broadcast(Message{
				Type:          MsgTypeBlockChange,
				Branch:        msg.Branch,
				BlockedBranch: msg.BlockedBranch,
				Blocked:       true,
			})

		case MsgTypeUnblockBranch:
			// Unblock a branch
			debug.Log("DAEMON_UNBLOCK_BRANCH branch=%s", msg.Branch)
			d.blockedMu.Lock()
			delete(d.blockedBranches, msg.Branch)
			d.blockedMu.Unlock()

			// Save to disk
			if err := d.saveBlockedBranches(); err != nil {
				debug.Log("DAEMON_SAVE_BLOCKED_ERROR error=%v", err)
				// Broadcast persistence error to all clients
				d.broadcast(Message{
					Type:  MsgTypePersistenceError,
					Error: fmt.Sprintf("Failed to save blocked state: %v", err),
				})
			}

			// Broadcast change to all clients
			d.broadcast(Message{
				Type:    MsgTypeBlockChange,
				Branch:  msg.Branch,
				Blocked: false,
			})

		case MsgTypeQueryBlockedState:
			// Query blocked state for a branch
			debug.Log("DAEMON_QUERY_BLOCKED_STATE branch=%s", msg.Branch)
			d.blockedMu.RLock()
			blockedBy, isBlocked := d.blockedBranches[msg.Branch]
			d.blockedMu.RUnlock()

			// Send response back to requesting client
			response := Message{
				Type:          MsgTypeBlockedStateResponse,
				Branch:        msg.Branch,
				IsBlocked:     isBlocked,
				BlockedBranch: blockedBy,
			}
			if err := client.sendMessage(response); err != nil {
				debug.Log("DAEMON_QUERY_RESPONSE_ERROR client=%s error=%v", clientID, err)
			} else {
				debug.Log("DAEMON_QUERY_RESPONSE branch=%s isBlocked=%v blockedBy=%s",
					msg.Branch, isBlocked, blockedBy)
			}
		}
	}
}

// broadcast sends a message to all connected clients.
func (d *AlertDaemon) broadcast(msg Message) {
	d.clientsMu.RLock()
	defer d.clientsMu.RUnlock()

	var failures int64
	for clientID, client := range d.clients {
		if err := client.sendMessage(msg); err != nil {
			failures++
			debug.Log("DAEMON_BROADCAST_ERROR client=%s error=%v", clientID, err)
			d.lastBroadcastError.Store(err.Error())
			// Don't remove client here - let handleClient detect disconnect
		}
	}

	if failures > 0 {
		d.broadcastFailures.Add(failures)
		debug.Log("DAEMON_BROADCAST_FAILURES count=%d total_failures=%d", failures, d.broadcastFailures.Load())
	}
}

// removeClient removes a client from the clients map.
func (d *AlertDaemon) removeClient(clientID string) {
	d.clientsMu.Lock()
	defer d.clientsMu.Unlock()
	delete(d.clients, clientID)
	debug.Log("DAEMON_CLIENT_REMOVED id=%s remaining=%d", clientID, len(d.clients))
}

// GetHealthStatus returns daemon health metrics for monitoring
func (d *AlertDaemon) GetHealthStatus() HealthStatus {
	lastBroadcastErr, _ := d.lastBroadcastError.Load().(string)
	lastWatcherErr, _ := d.lastWatcherError.Load().(string)

	d.clientsMu.RLock()
	clientCount := len(d.clients)
	d.clientsMu.RUnlock()

	d.alertsMu.RLock()
	alertCount := len(d.alerts)
	d.alertsMu.RUnlock()

	d.blockedMu.RLock()
	blockedCount := len(d.blockedBranches)
	d.blockedMu.RUnlock()

	return HealthStatus{
		BroadcastFailures:  d.broadcastFailures.Load(),
		LastBroadcastError: lastBroadcastErr,
		WatcherErrors:      d.watcherErrors.Load(),
		LastWatcherError:   lastWatcherErr,
		ConnectedClients:   clientCount,
		ActiveAlerts:       alertCount,
		BlockedBranches:    blockedCount,
	}
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
