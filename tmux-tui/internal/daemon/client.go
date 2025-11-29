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

// DaemonClient represents a client connection to the alert daemon.
type DaemonClient struct {
	clientID   string
	socketPath string
	conn       net.Conn
	encoder    *json.Encoder
	decoder    *json.Decoder
	eventCh    chan Message
	done       chan struct{}
	mu         sync.Mutex
	connected  bool
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
	if err := c.encoder.Encode(helloMsg); err != nil {
		conn.Close()
		return fmt.Errorf("failed to send hello message: %w", err)
	}

	debug.Log("CLIENT_CONNECTED id=%s socket=%s", c.clientID, c.socketPath)

	c.connected = true

	// Start receiving messages
	go c.receive()

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

				// Send disconnect event
				c.eventCh <- Message{
					Type: "disconnect",
				}
				return
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
	close(c.done)

	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn != nil {
		c.conn.Close()
		c.conn = nil
	}
	c.connected = false

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
