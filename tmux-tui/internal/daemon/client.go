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
	heartbeatInterval = 5 * time.Second  // How often to send pings
	heartbeatTimeout  = 3 * time.Second  // How long to wait for pong response
)

// DaemonClient represents a client connection to the alert daemon.
type DaemonClient struct {
	clientID   string
	socketPath string
	conn       net.Conn
	encoder    *json.Encoder
	encoderMu  sync.Mutex    // Protects encoder from concurrent writes
	decoder    *json.Decoder
	eventCh    chan Message
	done       chan struct{}
	mu         sync.Mutex
	connected  bool
	lastPong   time.Time     // Timestamp of last pong received
	lastPongMu sync.RWMutex  // Protects lastPong
}

// NewDaemonClient creates a new daemon client.
func NewDaemonClient() *DaemonClient {
	return &DaemonClient{
		clientID:   uuid.New().String(),
		socketPath: namespace.DaemonSocket(),
		eventCh:    make(chan Message, 100),
		done:       make(chan struct{}),
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
