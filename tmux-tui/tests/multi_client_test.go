package tests

import (
	"testing"
	"time"

	"github.com/commons-systems/tmux-tui/internal/daemon"
)

// TestMultiClientSynchronization verifies that multiple clients receive
// broadcast updates when one client modifies state (blocks/unblocks branches).
//
// This is a CRITICAL test for the daemon's core functionality: state synchronization
// across multiple tmux panes. Without this, users could see inconsistent branch
// blocking state between different panes.
func TestMultiClientSynchronization(t *testing.T) {
	t.Skip("Flaky test: Too many open files error (issue #241)")
	socketName := uniqueSocketName()
	sessionName := "multi-client-test"

	// Start daemon
	cleanupDaemon := startDaemon(t, socketName, sessionName)
	defer cleanupDaemon()

	// Create 3 clients simulating 3 different tmux panes
	clients := make([]*daemon.DaemonClient, 3)
	for i := 0; i < 3; i++ {
		client := daemon.NewDaemonClient()
		if err := client.Connect(); err != nil {
			t.Fatalf("Client %d failed to connect: %v", i, err)
		}
		defer client.Close()
		clients[i] = client
		t.Logf("Client %d connected", i)
	}

	// Test scenario 1: Client 0 blocks a branch
	t.Log("Scenario 1: Client 0 blocks 'feature' with 'main'")
	if err := clients[0].BlockBranch("feature", "main"); err != nil {
		t.Fatalf("BlockBranch failed: %v", err)
	}

	// Wait for all 3 clients to receive the block_change broadcast
	err := waitForCondition(t, WaitCondition{
		Name: "all clients receive block_change",
		CheckFunc: func() (bool, error) {
			// Check each client received the broadcast
			for i, client := range clients {
				select {
				case msg := <-client.Events():
					if msg.Type == "block_change" && msg.Branch == "feature" && msg.Blocked {
						t.Logf("Client %d received block_change", i)
					}
				default:
					// No message yet
					return false, nil
				}
			}
			return true, nil
		},
		Interval: 50 * time.Millisecond,
		Timeout:  5 * time.Second,
	})
	if err != nil {
		t.Fatalf("Not all clients received block_change broadcast: %v", err)
	}

	// Verify all clients can query the blocked state
	for i, client := range clients {
		state, err := client.QueryBlockedState("feature")
		if err != nil {
			t.Errorf("Client %d QueryBlockedState failed: %v", i, err)
			continue
		}
		if !state.IsBlocked() {
			t.Errorf("Client %d: expected feature to be blocked, but IsBlocked()=false", i)
		}
		if state.BlockedBy() != "main" {
			t.Errorf("Client %d: expected BlockedBy='main', got '%s'", i, state.BlockedBy())
		}
	}

	// Test scenario 2: Disconnect client 1 (simulate pane close)
	t.Log("Scenario 2: Disconnect client 1")
	if err := clients[1].Close(); err != nil {
		t.Logf("Client 1 close returned error (expected): %v", err)
	}
	clients[1] = nil // Mark as disconnected

	// Clear remaining events from clients 0 and 2
	for _, idx := range []int{0, 2} {
		if clients[idx] != nil {
			// Drain event channel
			for {
				select {
				case <-clients[idx].Events():
					// Consume events
				default:
					goto drained
				}
			}
		drained:
		}
	}

	// Test scenario 3: Client 0 unblocks the branch
	t.Log("Scenario 3: Client 0 unblocks 'feature'")
	if err := clients[0].UnblockBranch("feature"); err != nil {
		t.Fatalf("UnblockBranch failed: %v", err)
	}

	// Wait for clients 0 and 2 to receive unblock broadcast (client 1 is disconnected)
	receivedUnblock := make(map[int]bool)
	err = waitForCondition(t, WaitCondition{
		Name: "active clients receive unblock broadcast",
		CheckFunc: func() (bool, error) {
			for _, idx := range []int{0, 2} {
				if clients[idx] == nil {
					continue
				}
				if receivedUnblock[idx] {
					continue
				}

				select {
				case msg := <-clients[idx].Events():
					if msg.Type == "block_change" && msg.Branch == "feature" && !msg.Blocked {
						t.Logf("Client %d received unblock broadcast", idx)
						receivedUnblock[idx] = true
					}
				default:
					// No message yet
				}
			}

			// Check if both active clients received the broadcast
			return receivedUnblock[0] && receivedUnblock[2], nil
		},
		Interval: 50 * time.Millisecond,
		Timeout:  5 * time.Second,
	})
	if err != nil {
		t.Fatalf("Active clients did not receive unblock broadcast: %v", err)
	}

	// Verify active clients see unblocked state
	for _, idx := range []int{0, 2} {
		state, err := clients[idx].QueryBlockedState("feature")
		if err != nil {
			t.Errorf("Client %d QueryBlockedState failed: %v", idx, err)
			continue
		}
		if state.IsBlocked() {
			t.Errorf("Client %d: expected feature to be unblocked, but IsBlocked()=true", idx)
		}
	}

	// Test scenario 4: Reconnect client 1
	t.Log("Scenario 4: Reconnect client 1")
	newClient := daemon.NewDaemonClient()
	if err := newClient.Connect(); err != nil {
		t.Fatalf("Client 1 reconnect failed: %v", err)
	}
	defer newClient.Close()
	clients[1] = newClient

	// Wait for full_state message with current blocked state
	err = waitForCondition(t, WaitCondition{
		Name: "reconnected client receives full_state",
		CheckFunc: func() (bool, error) {
			select {
			case msg := <-clients[1].Events():
				if msg.Type == "full_state" {
					t.Logf("Client 1 received full_state after reconnect")
					// Verify the full_state has empty BlockedBranches (feature was unblocked)
					if len(msg.BlockedBranches) > 0 {
						t.Errorf("Expected empty BlockedBranches in full_state, got: %v", msg.BlockedBranches)
					}
					return true, nil
				}
			default:
				// No message yet
			}
			return false, nil
		},
		Interval: 50 * time.Millisecond,
		Timeout:  5 * time.Second,
	})
	if err != nil {
		t.Fatalf("Reconnected client did not receive full_state: %v", err)
	}

	// Verify reconnected client has correct state
	state, err := clients[1].QueryBlockedState("feature")
	if err != nil {
		t.Fatalf("Reconnected client QueryBlockedState failed: %v", err)
	}
	if state.IsBlocked() {
		t.Errorf("Reconnected client: expected feature to be unblocked after resync")
	}

	t.Log("SUCCESS: All multi-client synchronization scenarios passed")
}
