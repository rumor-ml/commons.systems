package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"sync"
	"time"

	"github.com/commons-systems/tmux-tui/internal/debug"
	"github.com/commons-systems/tmux-tui/internal/namespace"
	"github.com/google/uuid"
)

const (
	heartbeatInterval = 5 * time.Second // How often to send pings
	heartbeatTimeout  = 3 * time.Second // How long to wait for pong response
)

// queryResponse holds channels for query-response pattern
type queryResponse struct {
	dataCh chan Message
	errCh  chan error
}

// DaemonClient represents a client connection to the alert daemon.
type DaemonClient struct {
	clientID       string
	socketPath     string
	conn           net.Conn
	encoder        *json.Encoder
	encoderMu      sync.Mutex // Protects encoder from concurrent writes
	decoder        *json.Decoder
	eventCh        chan Message
	done           chan struct{}
	mu             sync.Mutex
	connected      bool
	lastPong       time.Time    // Timestamp of last pong received
	lastPongMu     sync.RWMutex // Protects lastPong
	queryResponses map[string]*queryResponse
	queryMu        sync.Mutex
}

// NewDaemonClient creates a new daemon client.
func NewDaemonClient() *DaemonClient {
	return &DaemonClient{
		clientID:       uuid.New().String(),
		socketPath:     namespace.DaemonSocket(),
		eventCh:        make(chan Message, 100),
		done:           make(chan struct{}),
		queryResponses: make(map[string]*queryResponse),
	}
}

// sendMessage safely sends a message to the daemon with mutex protection
func (c *DaemonClient) sendMessage(msg Message) error {
	c.encoderMu.Lock()
	defer c.encoderMu.Unlock()
	return c.encoder.Encode(msg)
}

// updateLastPong updates the timestamp of the last pong received
func (c *DaemonClient) updateLastPong() {
	c.lastPongMu.Lock()
	defer c.lastPongMu.Unlock()
	c.lastPong = time.Now()
}

// getLastPong returns the timestamp of the last pong received
func (c *DaemonClient) getLastPong() time.Time {
	c.lastPongMu.RLock()
	defer c.lastPongMu.RUnlock()
	return c.lastPong
}

// Connect connects to the daemon and sends a hello message.
func (c *DaemonClient) Connect() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.connected {
		return nil
	}

	// Connect to Unix socket
	conn, err := net.Dial("unix", c.socketPath)
	if err != nil {
		return fmt.Errorf("failed to connect to daemon socket: %w", err)
	}

	c.conn = conn
	c.encoder = json.NewEncoder(conn)
	c.decoder = json.NewDecoder(conn)

	// Send hello message
	helloMsg := Message{
		Type:     MsgTypeHello,
		ClientID: c.clientID,
	}
	if err := c.sendMessage(helloMsg); err != nil {
		conn.Close()
		return fmt.Errorf("failed to send hello message: %w", err)
	}

	debug.Log("CLIENT_CONNECTED id=%s socket=%s", c.clientID, c.socketPath)

	c.connected = true

	// Initialize lastPong to current time
	c.updateLastPong()

	// Start receiving messages
	go c.receive()

	// Start heartbeat monitoring
	go c.heartbeat()

	return nil
}

// receive receives messages from the daemon.
func (c *DaemonClient) receive() {
	for {
		var msg Message
		if err := c.decoder.Decode(&msg); err != nil {
			select {
			case <-c.done:
				// Client closed - expected
				return
			default:
				debug.Log("CLIENT_RECEIVE_ERROR id=%s error=%v", c.clientID, err)
				c.mu.Lock()
				c.connected = false
				c.mu.Unlock()

				// Send disconnect event (context-aware to prevent goroutine leak)
				select {
				case c.eventCh <- Message{Type: "disconnect"}:
				case <-c.done:
					return
				}
				return
			}
		}

		// Handle pong messages to update heartbeat
		if msg.Type == MsgTypePong {
			c.updateLastPong()
			debug.Log("CLIENT_PONG_RECEIVED id=%s", c.clientID)
			continue
		}

		// Handle query responses (blocked_state_response)
		if msg.Type == MsgTypeBlockedStateResponse {
			c.queryMu.Lock()
			resp, exists := c.queryResponses[msg.Branch]
			if exists {
				delete(c.queryResponses, msg.Branch) // One-time response
			}
			c.queryMu.Unlock()

			if exists {
				select {
				case resp.dataCh <- msg:
					continue // Don't forward to eventCh, consumed by query
				case <-time.After(100 * time.Millisecond):
					// Response channel full/blocked, fall through to forward
				}
			}
		}

		// Forward message to event channel
		select {
		case c.eventCh <- msg:
		case <-c.done:
			return
		}
	}
}

// heartbeat periodically sends ping messages and monitors for pong responses.
// If no pong is received within the timeout period, it triggers a disconnect.
func (c *DaemonClient) heartbeat() {
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-c.done:
			return
		case <-ticker.C:
			// Check if we're still connected
			c.mu.Lock()
			connected := c.connected
			c.mu.Unlock()

			if !connected {
				return
			}

			// Check if last pong is too old
			lastPong := c.getLastPong()
			timeSinceLastPong := time.Since(lastPong)
			if timeSinceLastPong > heartbeatInterval+heartbeatTimeout {
				debug.Log("CLIENT_HEARTBEAT_TIMEOUT id=%s since_last_pong=%v", c.clientID, timeSinceLastPong)
				c.mu.Lock()
				c.connected = false
				c.mu.Unlock()

				// Trigger disconnect event
				select {
				case c.eventCh <- Message{Type: "disconnect"}:
				case <-c.done:
					return
				}
				return
			}

			// Send ping
			pingMsg := Message{Type: MsgTypePing}
			if err := c.sendMessage(pingMsg); err != nil {
				debug.Log("CLIENT_PING_ERROR id=%s error=%v", c.clientID, err)
				c.mu.Lock()
				c.connected = false
				c.mu.Unlock()

				// Trigger disconnect event
				select {
				case c.eventCh <- Message{Type: "disconnect"}:
				case <-c.done:
					return
				}
				return
			}

			debug.Log("CLIENT_PING_SENT id=%s", c.clientID)
		}
	}
}

// Events returns the channel for receiving daemon events.
func (c *DaemonClient) Events() <-chan Message {
	return c.eventCh
}

// IsConnected returns whether the client is currently connected.
func (c *DaemonClient) IsConnected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.connected
}

// Close closes the daemon client connection.
func (c *DaemonClient) Close() error {
	debug.Log("CLIENT_CLOSING id=%s", c.clientID)

	c.mu.Lock()
	wasConnected := c.connected
	if wasConnected {
		select {
		case <-c.done:
			// Already closed
		default:
			close(c.done)
		}
	}
	c.connected = false

	if c.conn != nil {
		c.conn.Close()
		c.conn = nil
	}
	c.mu.Unlock()

	// Drain eventCh to allow any blocked goroutines to exit
	if wasConnected {
		drainTimeout := time.After(100 * time.Millisecond)
		for {
			select {
			case <-c.eventCh:
				// Discard message, allow blocked senders to proceed
			case <-drainTimeout:
				return nil
			default:
				// Channel is empty, we're done
				return nil
			}
		}
	}

	return nil
}

// ConnectWithRetry attempts to connect to the daemon with exponential backoff.
// Returns nil on success, error if all retries exhausted or context cancelled.
func (c *DaemonClient) ConnectWithRetry(ctx context.Context, maxRetries int) error {
	backoff := 100 * time.Millisecond
	maxBackoff := 5 * time.Second

	for attempt := 0; attempt < maxRetries; attempt++ {
		// Check context cancellation before attempting connection
		select {
		case <-ctx.Done():
			return fmt.Errorf("connection cancelled: %w", ctx.Err())
		default:
		}

		if err := c.Connect(); err == nil {
			return nil
		}

		if attempt < maxRetries-1 {
			debug.Log("CLIENT_CONNECT_RETRY id=%s attempt=%d/%d backoff=%v",
				c.clientID, attempt+1, maxRetries, backoff)

			// Context-aware backoff sleep
			select {
			case <-time.After(backoff):
				// Continue to next retry
			case <-ctx.Done():
				return fmt.Errorf("connection cancelled during backoff: %w", ctx.Err())
			}

			// Exponential backoff with cap
			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
		}
	}

	return fmt.Errorf("failed to connect after %d attempts", maxRetries)
}

// RequestBlockPicker sends a request to show the block picker for a pane
func (c *DaemonClient) RequestBlockPicker(paneID string) error {
	msg := Message{
		Type:   MsgTypeShowBlockPicker,
		PaneID: paneID,
	}
	if err := c.sendMessage(msg); err != nil {
		return fmt.Errorf("failed to send show block picker message: %w", err)
	}
	debug.Log("CLIENT_REQUEST_BLOCK_PICKER id=%s paneID=%s", c.clientID, paneID)

	// Wait briefly to ensure daemon processes the message before we disconnect
	time.Sleep(100 * time.Millisecond)
	return nil
}

// BlockPane sends a request to block a pane on a specific branch
func (c *DaemonClient) BlockPane(paneID, branch string) error {
	msg := Message{
		Type:          MsgTypeBlockPane,
		PaneID:        paneID,
		BlockedBranch: branch,
	}
	if err := c.sendMessage(msg); err != nil {
		return fmt.Errorf("failed to send block pane message: %w", err)
	}
	debug.Log("CLIENT_BLOCK_PANE id=%s paneID=%s branch=%s", c.clientID, paneID, branch)

	// Wait briefly to ensure daemon processes the message before we disconnect
	time.Sleep(100 * time.Millisecond)
	return nil
}

// UnblockPane sends a request to unblock a pane
func (c *DaemonClient) UnblockPane(paneID string) error {
	msg := Message{
		Type:   MsgTypeUnblockPane,
		PaneID: paneID,
	}
	if err := c.sendMessage(msg); err != nil {
		return fmt.Errorf("failed to send unblock pane message: %w", err)
	}
	debug.Log("CLIENT_UNBLOCK_PANE id=%s paneID=%s", c.clientID, paneID)

	// Wait briefly to ensure daemon processes the message before we disconnect
	time.Sleep(100 * time.Millisecond)
	return nil
}

// BlockBranch sends a request to block a branch with another branch
func (c *DaemonClient) BlockBranch(branch, blockedByBranch string) error {
	msg := Message{
		Type:          MsgTypeBlockBranch,
		Branch:        branch,
		BlockedBranch: blockedByBranch,
	}
	if err := c.sendMessage(msg); err != nil {
		return fmt.Errorf("failed to send block branch message: %w", err)
	}
	debug.Log("CLIENT_BLOCK_BRANCH id=%s branch=%s blockedBy=%s", c.clientID, branch, blockedByBranch)

	// Wait briefly to ensure daemon processes the message before we disconnect
	time.Sleep(100 * time.Millisecond)
	return nil
}

// UnblockBranch sends a request to unblock a branch
func (c *DaemonClient) UnblockBranch(branch string) error {
	msg := Message{
		Type:   MsgTypeUnblockBranch,
		Branch: branch,
	}
	if err := c.sendMessage(msg); err != nil {
		return fmt.Errorf("failed to send unblock branch message: %w", err)
	}
	debug.Log("CLIENT_UNBLOCK_BRANCH id=%s branch=%s", c.clientID, branch)

	// Wait briefly to ensure daemon processes the message before we disconnect
	time.Sleep(100 * time.Millisecond)
	return nil
}

// QueryBlockedState queries whether a branch is blocked and returns the blocking state.
// This method sends a query_blocked_state message and waits for the daemon's response
// with a 2-second timeout.
//
// Returns BlockedState indicating whether the branch is blocked and by which branch.
// Returns error if:
//   - branch name is empty
//   - failed to send query message
//   - timeout waiting for response (daemon not responding)
//   - client is disconnected
func (c *DaemonClient) QueryBlockedState(branch string) (BlockedState, error) {
	if branch == "" {
		return BlockedState{}, fmt.Errorf("branch name required")
	}

	c.mu.Lock()
	if !c.connected {
		c.mu.Unlock()
		return BlockedState{}, fmt.Errorf("client not connected")
	}
	c.mu.Unlock()

	// Create response channels
	resp := &queryResponse{
		dataCh: make(chan Message, 1),
		errCh:  make(chan error, 1),
	}

	// Register response handler
	c.queryMu.Lock()
	c.queryResponses[branch] = resp
	c.queryMu.Unlock()

	// Ensure cleanup on exit
	defer func() {
		c.queryMu.Lock()
		delete(c.queryResponses, branch)
		c.queryMu.Unlock()
	}()

	// Send query message
	queryMsg := Message{
		Type:   MsgTypeQueryBlockedState,
		Branch: branch,
	}
	if err := c.sendMessage(queryMsg); err != nil {
		return BlockedState{}, fmt.Errorf("failed to send query: %w", err)
	}

	debug.Log("CLIENT_QUERY_BLOCKED_STATE id=%s branch=%s", c.clientID, branch)

	// Wait for response with timeout
	select {
	case msg := <-resp.dataCh:
		debug.Log("CLIENT_QUERY_RESPONSE id=%s branch=%s blocked=%v blockedBy=%s",
			c.clientID, branch, msg.IsBlocked, msg.BlockedBranch)
		return BlockedState{
			IsBlocked: msg.IsBlocked,
			BlockedBy: msg.BlockedBranch,
		}, nil
	case err := <-resp.errCh:
		return BlockedState{}, err
	case <-time.After(2 * time.Second):
		return BlockedState{}, fmt.Errorf("timeout waiting for blocked state response")
	case <-c.done:
		return BlockedState{}, fmt.Errorf("client closed while waiting for response")
	}
}
