package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/commons-systems/tmux-tui/internal/debug"
	"github.com/commons-systems/tmux-tui/internal/namespace"
	"github.com/google/uuid"
)

const (
	heartbeatInterval       = 5 * time.Second        // How often to send pings
	heartbeatTimeout        = 3 * time.Second        // How long to wait for pong response
	messagePropagationDelay = 100 * time.Millisecond // Best-effort delay after send (not an ack mechanism)
)

// DaemonClient represents a client connection to the alert daemon.
type DaemonClient struct {
	clientID   string
	socketPath string
	conn       net.Conn
	encoder    *json.Encoder
	encoderMu  sync.Mutex // Protects encoder from concurrent writes
	decoder    *json.Decoder
	eventCh    chan Message
	done       chan struct{}
	mu         sync.Mutex
	connected  bool
	lastPong   time.Time     // Timestamp of last pong received
	lastPongMu sync.RWMutex  // Protects lastPong
	lastSeq    atomic.Uint64 // Last received sequence number for gap detection

	// Health metrics for diagnostics
	syncWarnings            atomic.Uint64 // Sync warning count
	resyncFailures          atomic.Uint64 // Failed resync request count
	queryChannelFull        atomic.Uint64 // Query channel overflow count
	queryDeadlockRecoveries atomic.Uint64 // Query channel deadlock recovery count
	lastDeadlockBranch      atomic.Value  // Most recent branch that caused deadlock (string)

	// Query response routing (prevents event loss in QueryBlockedState)
	queryResponses map[string]*queryResponse // Response channels keyed by branch
	queryMu        sync.Mutex                // Protects queryResponses map
}

// queryResponse holds both data and error channels for query responses
type queryResponse struct {
	dataCh chan Message // Receives successful responses
	errCh  chan error   // Receives error notifications (channel full, closed)
}

// newQueryResponse creates a queryResponse with properly buffered channels.
// Both channels have buffer size 1 to prevent blocking in the receive loop.
func newQueryResponse() *queryResponse {
	return &queryResponse{
		dataCh: make(chan Message, 1),
		errCh:  make(chan error, 1),
	}
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

// sendAndWait sends a message and waits a fixed delay to allow the daemon
// time to process it. This is best-effort timing, not an acknowledgment.
func (c *DaemonClient) sendAndWait(msg Message) error {
	if err := c.sendMessage(msg); err != nil {
		return err
	}
	time.Sleep(messagePropagationDelay)
	return nil
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
		// Classify the connection error for better diagnostics
		var errType error
		switch {
		case os.IsNotExist(err):
			errType = ErrSocketNotFound
		case os.IsPermission(err):
			errType = ErrPermissionDenied
		case os.IsTimeout(err):
			errType = ErrConnectionTimeout
		default:
			errType = ErrConnectionFailed
		}
		return fmt.Errorf("%w: daemon socket %s: %v", errType, c.socketPath, err)
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

		// Gap detection: Check sequence numbers for missed messages
		if msg.SeqNum > 0 {
			lastSeq := c.lastSeq.Load()
			if lastSeq > 0 && msg.SeqNum > lastSeq+1 {
				// Gap detected - request resync from daemon
				gap := msg.SeqNum - lastSeq - 1
				debug.Log("CLIENT_GAP_DETECTED id=%s expected=%d got=%d gap=%d",
					c.clientID, lastSeq+1, msg.SeqNum, gap)
				// Request full state resync with retry logic
				go func() {
					const maxRetries = 3
					backoff := 50 * time.Millisecond
					savedGap := gap // Capture for logging

					for attempt := 0; attempt < maxRetries; attempt++ {
						if attempt > 0 {
							time.Sleep(backoff)
							backoff *= 2 // Exponential backoff: 50ms, 100ms, 200ms
						}

						resyncMsg := Message{Type: MsgTypeResyncRequest}
						if err := c.sendMessage(resyncMsg); err == nil {
							debug.Log("CLIENT_RESYNC_REQUESTED id=%s attempt=%d gap=%d", c.clientID, attempt+1, savedGap)
							return // Success
						}

						if attempt == maxRetries-1 {
							// All retries exhausted - must disconnect
							c.resyncFailures.Add(1)
							debug.Log("CLIENT_RESYNC_REQUEST_EXHAUSTED - disconnecting id=%s attempts=%d gap=%d count=%d",
								c.clientID, maxRetries, savedGap, c.resyncFailures.Load())

							// CRITICAL: Cannot continue with known gaps - disconnect to trigger full reconnect
							c.mu.Lock()
							c.connected = false
							if c.conn != nil {
								c.conn.Close()
							}
							c.mu.Unlock()

							// Send disconnect event with timeout to prevent goroutine leak
							select {
							case c.eventCh <- Message{Type: "disconnect", Error: fmt.Sprintf("Failed to request resync after %d attempts (gap=%d)", maxRetries, savedGap)}:
							case <-time.After(100 * time.Millisecond):
								// CRITICAL: Resync failed and disconnect notification blocked
								fmt.Fprintf(os.Stderr, "CRITICAL: Resync disconnect blocked - eventCh congested (client=%s, gap=%d)\n",
									c.clientID, savedGap)
								debug.Log("CLIENT_RESYNC_DISCONNECT_EVENT_BLOCKED id=%s gap=%d", c.clientID, savedGap)
							case <-c.done:
							}
						}
					}
				}()
			}
			c.lastSeq.Store(msg.SeqNum)
		}

		// Route query responses to dedicated channels to ensure QueryBlockedState() receives them.
		// Without this routing, responses would be delivered to the general event channel,
		// requiring the caller to poll Events() instead of receiving a direct return value.
		if msg.Type == MsgTypeBlockedStateResponse {
			c.queryMu.Lock()
			if resp, exists := c.queryResponses[msg.Branch]; exists {
				select {
				case resp.dataCh <- msg:
					// Response delivered successfully
				case <-c.done:
					c.queryMu.Unlock()
					return
				default:
					// Channel full - send error notification to caller
					// This provides accurate error instead of misleading timeout
					c.queryChannelFull.Add(1)
					errMsg := ErrQueryChannelFull
					select {
					case resp.errCh <- errMsg:
						debug.Log("CLIENT_QUERY_CHANNEL_FULL id=%s branch=%s fallback_level=1 total_overflows=%d reason=dataCh_full",
							c.clientID, msg.Branch, c.queryChannelFull.Load())
					default:
						// Both channels full - retry once after brief delay before forcing disconnect
						debug.Log("CLIENT_QUERY_CHANNELS_BOTH_FULL id=%s branch=%s fallback_level=2 total_overflows=%d reason=both_channels_full retrying_after=50ms",
							c.clientID, msg.Branch, c.queryChannelFull.Load())
						time.Sleep(50 * time.Millisecond)

						select {
						case resp.dataCh <- msg:
							debug.Log("CLIENT_QUERY_RETRY_SUCCESS id=%s branch=%s fallback_level=2 total_overflows=%d retry_path=dataCh",
								c.clientID, msg.Branch, c.queryChannelFull.Load())
						case resp.errCh <- errMsg:
							debug.Log("CLIENT_QUERY_RETRY_SUCCESS id=%s branch=%s fallback_level=2 total_overflows=%d retry_path=errCh",
								c.clientID, msg.Branch, c.queryChannelFull.Load())
						default:
							// CRITICAL: Still deadlocked after retry - force disconnect
							c.queryDeadlockRecoveries.Add(1)
							c.lastDeadlockBranch.Store(msg.Branch)

							errMsg := fmt.Sprintf("Query channel deadlock for branch %s - forcing disconnect (total deadlocks: %d)",
								msg.Branch, c.queryDeadlockRecoveries.Load())

							// ERROR VISIBILITY: Make deadlock visible to users
							fmt.Fprintf(os.Stderr, "ERROR: %s\n", errMsg)
							fmt.Fprintf(os.Stderr, "  Client ID: %s\n", c.clientID)
							fmt.Fprintf(os.Stderr, "  This indicates a severe congestion issue - daemon will reconnect and resync\n")

							debug.Log("CLIENT_QUERY_DEADLOCK_CONFIRMED id=%s branch=%s fallback_level=3 total_overflows=%d total_deadlocks=%d reason=retry_failed_both_channels_still_full action=forcing_disconnect",
								c.clientID, msg.Branch, c.queryChannelFull.Load(), c.queryDeadlockRecoveries.Load())

							c.mu.Lock()
							c.connected = false
							if c.conn != nil {
								c.conn.Close()
							}
							c.mu.Unlock()

							// Send disconnect event with timeout to prevent goroutine leak
							select {
							case c.eventCh <- Message{
								Type:  "disconnect",
								Error: errMsg,
							}:
							case <-time.After(100 * time.Millisecond):
								// CRITICAL: eventCh blocked - disconnect notification lost
								fmt.Fprintf(os.Stderr, "CRITICAL: Client disconnect blocked - eventCh congested (client=%s, branch=%s, deadlocks=%d)\n",
									c.clientID, msg.Branch, c.queryDeadlockRecoveries.Load())
								debug.Log("CLIENT_DISCONNECT_EVENT_BLOCKED id=%s branch=%s - event channel full",
									c.clientID, msg.Branch)
							case <-c.done:
								return
							}
							return // Exit receive() goroutine
						}
					}
				}
				delete(c.queryResponses, msg.Branch)
				c.queryMu.Unlock()
				continue // Don't forward to eventCh
			}
			c.queryMu.Unlock()
			debug.Log("CLIENT_QUERY_RESPONSE_UNREGISTERED id=%s branch=%s", c.clientID, msg.Branch)
		}

		// Handle sync warnings - log but don't forward to avoid client disruption
		if msg.Type == MsgTypeSyncWarning {
			c.syncWarnings.Add(1)
			debug.Log("CLIENT_SYNC_WARNING id=%s warning=%s count=%d",
				c.clientID, msg.Error, c.syncWarnings.Load())
			continue // Skip forwarding to eventCh
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
	if err := c.sendAndWait(msg); err != nil {
		return fmt.Errorf("failed to send show block picker message: %w", err)
	}
	debug.Log("CLIENT_REQUEST_BLOCK_PICKER id=%s paneID=%s", c.clientID, paneID)
	return nil
}

// BlockBranch sends a request to block a branch with another branch
func (c *DaemonClient) BlockBranch(branch, blockedByBranch string) error {
	msg := Message{
		Type:          MsgTypeBlockBranch,
		Branch:        branch,
		BlockedBranch: blockedByBranch,
	}
	if err := c.sendAndWait(msg); err != nil {
		return fmt.Errorf("failed to send block branch message: %w", err)
	}
	debug.Log("CLIENT_BLOCK_BRANCH id=%s branch=%s blockedBy=%s", c.clientID, branch, blockedByBranch)
	return nil
}

// UnblockBranch sends a request to unblock a branch
func (c *DaemonClient) UnblockBranch(branch string) error {
	msg := Message{
		Type:   MsgTypeUnblockBranch,
		Branch: branch,
	}
	if err := c.sendAndWait(msg); err != nil {
		return fmt.Errorf("failed to send unblock branch message: %w", err)
	}
	debug.Log("CLIENT_UNBLOCK_BRANCH id=%s branch=%s", c.clientID, branch)
	return nil
}

// QueryBlockedState queries whether a branch is blocked and returns the blocking branch if so
func (c *DaemonClient) QueryBlockedState(branch string) (BlockedState, error) {
	// Create response channels (buffered to prevent blocking)
	resp := newQueryResponse()

	// Register for response
	c.queryMu.Lock()
	// Map already initialized in constructor
	c.queryResponses[branch] = resp
	c.queryMu.Unlock()

	// Cleanup registration
	// CRITICAL: Close channels INSIDE the lock to prevent race with receive() goroutine.
	// If we close outside the lock, receive() could get the channel reference from the map,
	// then we close it here, then receive() tries to send → panic on closed channel.
	defer func() {
		c.queryMu.Lock()
		delete(c.queryResponses, branch)
		close(resp.dataCh)
		close(resp.errCh)
		c.queryMu.Unlock()
	}()

	// Send query message
	queryMsg := Message{
		Type:   MsgTypeQueryBlockedState,
		Branch: branch,
	}
	if err := c.sendMessage(queryMsg); err != nil {
		return BlockedState{}, fmt.Errorf("failed to send query blocked state message: %w", err)
	}
	debug.Log("CLIENT_QUERY_BLOCKED_STATE id=%s branch=%s", c.clientID, branch)

	// Wait for response on dedicated channel to prevent race conditions.
	// Without this dedicated channel, the response could be consumed by the
	// general receive() loop before QueryBlockedState returns it to the caller.
	// Timeout prevents indefinite blocking if daemon is unresponsive.
	timeout := time.After(2 * time.Second)
	select {
	case msg := <-resp.dataCh:
		debug.Log("CLIENT_BLOCKED_STATE_RESPONSE id=%s branch=%s isBlocked=%v blockedBy=%s",
			c.clientID, branch, msg.IsBlocked, msg.BlockedBranch)
		return NewBlockedState(msg.IsBlocked, msg.BlockedBranch)
	case queryErr := <-resp.errCh:
		// Receive() detected an issue (channel full/closed) and notified us
		debug.Log("CLIENT_QUERY_ERROR id=%s branch=%s error=%v", c.clientID, branch, queryErr)
		return BlockedState{}, fmt.Errorf("query failed: %w", queryErr)
	case <-timeout:
		return BlockedState{}, ErrQueryTimeout
	case <-c.done:
		return BlockedState{}, fmt.Errorf("client closed")
	}
}

// GetHealthMetrics returns diagnostic counters for monitoring client health.
func (c *DaemonClient) GetHealthMetrics() (syncWarnings, resyncFailures, queryChannelFull, queryDeadlockRecoveries uint64) {
	return c.syncWarnings.Load(), c.resyncFailures.Load(), c.queryChannelFull.Load(), c.queryDeadlockRecoveries.Load()
}

// GetDeadlockRecoveries returns the count of query channel deadlock recoveries
func (c *DaemonClient) GetDeadlockRecoveries() uint64 {
	return c.queryDeadlockRecoveries.Load()
}

// GetLastDeadlockBranch returns the most recent branch that caused a deadlock
func (c *DaemonClient) GetLastDeadlockBranch() string {
	if val := c.lastDeadlockBranch.Load(); val != nil {
		if branch, ok := val.(string); ok {
			return branch
		}
	}
	return ""
}
