package tests

import (
	"testing"
	"time"

	"github.com/commons-systems/tmux-tui/internal/daemon"
)

// TestTreeBroadcast_SingleClient verifies that a single client receives tree_update messages
// from the daemon's periodic tree collection.
func TestTreeBroadcast_SingleClient(t *testing.T) {
	t.Skip("Flaky test: Daemon socket creation fails in sandboxed environments (issue #241)")

	socketName := uniqueSocketName()
	sessionName := "tree-single-test"

	// Start daemon
	cleanupDaemon := startDaemon(t, socketName, sessionName)
	defer cleanupDaemon()
	defer cleanupStaleSockets() // Clean up after test

	// Create a test pane to ensure tree has content
	tmuxCmd(socketName, "new-session", "-d", "-s", sessionName).Run()
	defer tmuxCmd(socketName, "kill-session", "-t", sessionName).Run()

	// Connect client
	client := daemon.NewDaemonClient()
	if err := client.Connect(); err != nil {
		t.Fatalf("Client failed to connect: %v", err)
	}
	defer client.Close()

	// Wait for full_state message first
	err := waitForCondition(t, WaitCondition{
		Name: "client receives full_state",
		CheckFunc: func() (bool, error) {
			select {
			case msg := <-client.Events():
				if msg.Type == daemon.MsgTypeFullState {
					t.Logf("Received full_state")
					return true, nil
				}
			default:
			}
			return false, nil
		},
		Interval: 50 * time.Millisecond,
		Timeout:  5 * time.Second,
	})
	if err != nil {
		t.Fatalf("Did not receive full_state: %v", err)
	}

	// Wait for tree_update message (daemon broadcasts immediately on start + every 30s)
	// Since watchTree() calls collectAndBroadcastTree() immediately, we should get one soon
	err = waitForCondition(t, WaitCondition{
		Name: "client receives tree_update",
		CheckFunc: func() (bool, error) {
			select {
			case msg := <-client.Events():
				if msg.Type == daemon.MsgTypeTreeUpdate {
					if msg.Tree == nil {
						t.Errorf("tree_update message has nil Tree field")
						return false, nil
					}
					t.Logf("Received tree_update with tree (repos: %d)", len(msg.Tree.Repos()))
					return true, nil
				}
			default:
			}
			return false, nil
		},
		Interval: 100 * time.Millisecond,
		Timeout:  10 * time.Second, // Allow time for daemon to start watchTree goroutine
	})
	if err != nil {
		t.Fatalf("Did not receive tree_update: %v", err)
	}

	t.Log("SUCCESS: Single client received tree_update")
}

// TestTreeBroadcast_MultipleClients verifies that all connected clients receive
// identical tree_update messages with the same sequence number.
func TestTreeBroadcast_MultipleClients(t *testing.T) {
	t.Skip("Flaky test: Daemon socket creation fails in sandboxed environments (issue #241)")

	socketName := uniqueSocketName()
	sessionName := "tree-multi-test"

	// Start daemon
	cleanupDaemon := startDaemon(t, socketName, sessionName)
	defer cleanupDaemon()
	defer cleanupStaleSockets() // Clean up after test

	// Create a test pane
	tmuxCmd(socketName, "new-session", "-d", "-s", sessionName).Run()
	defer tmuxCmd(socketName, "kill-session", "-t", sessionName).Run()

	// Connect 3 clients
	clients := make([]*daemon.DaemonClient, 3)
	for i := 0; i < 3; i++ {
		client := daemon.NewDaemonClient()
		if err := client.Connect(); err != nil {
			t.Fatalf("Client %d failed to connect: %v", i, err)
		}
		defer client.Close()
		clients[i] = client

		// Drain full_state message
		select {
		case msg := <-client.Events():
			if msg.Type != daemon.MsgTypeFullState {
				t.Logf("Client %d: Expected full_state, got %s", i, msg.Type)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("Client %d did not receive full_state", i)
		}
	}

	// Wait for all clients to receive tree_update with same seqNum
	receivedUpdates := make(map[int]*daemon.Message)
	err := waitForCondition(t, WaitCondition{
		Name: "all clients receive tree_update",
		CheckFunc: func() (bool, error) {
			for i, client := range clients {
				if receivedUpdates[i] != nil {
					continue // Already received
				}

				select {
				case msg := <-client.Events():
					if msg.Type == daemon.MsgTypeTreeUpdate {
						if msg.Tree == nil {
							t.Errorf("Client %d: tree_update has nil Tree", i)
							return false, nil
						}
						receivedUpdates[i] = &msg
						t.Logf("Client %d received tree_update (seq=%d, repos=%d)",
							i, msg.SeqNum, len(msg.Tree.Repos()))
					}
				default:
				}
			}
			return len(receivedUpdates) == 3, nil
		},
		Interval: 100 * time.Millisecond,
		Timeout:  10 * time.Second,
	})
	if err != nil {
		t.Fatalf("Not all clients received tree_update: %v (received: %d/3)", err, len(receivedUpdates))
	}

	// Verify all clients got the same sequence number
	firstSeq := receivedUpdates[0].SeqNum
	for i := 1; i < 3; i++ {
		if receivedUpdates[i].SeqNum != firstSeq {
			t.Errorf("Client %d seqNum mismatch: got %d, expected %d",
				i, receivedUpdates[i].SeqNum, firstSeq)
		}
	}

	t.Logf("SUCCESS: All 3 clients received tree_update with seqNum=%d", firstSeq)
}

// TestTreeBroadcast_CollectionError verifies that when tree collection fails,
// the daemon broadcasts tree_error messages to all clients.
// This test is skipped by default since simulating tree collection errors
// requires special setup (e.g., tmux not running).
func TestTreeBroadcast_CollectionError(t *testing.T) {
	t.Skip("Requires special setup to simulate tree collection errors")
	// TODO: Implement when we have a mechanism to inject collection errors
}

// TestTreeBroadcast_ClientReconnect verifies that a newly connected client
// receives the current tree in the full_state message.
func TestTreeBroadcast_ClientReconnect(t *testing.T) {
	t.Skip("Flaky test: Daemon socket creation fails in sandboxed environments (issue #241)")

	socketName := uniqueSocketName()
	sessionName := "tree-reconnect-test"

	// Start daemon
	cleanupDaemon := startDaemon(t, socketName, sessionName)
	defer cleanupDaemon()
	defer cleanupStaleSockets() // Clean up after test

	// Create a test pane
	tmuxCmd(socketName, "new-session", "-d", "-s", sessionName).Run()
	defer tmuxCmd(socketName, "kill-session", "-t", sessionName).Run()

	// Connect first client and wait for initial tree_update
	client1 := daemon.NewDaemonClient()
	if err := client1.Connect(); err != nil {
		t.Fatalf("Client 1 failed to connect: %v", err)
	}

	// Drain messages and wait for tree_update
	var gotTreeUpdate bool
	for i := 0; i < 10 && !gotTreeUpdate; i++ {
		select {
		case msg := <-client1.Events():
			if msg.Type == daemon.MsgTypeTreeUpdate {
				gotTreeUpdate = true
				t.Logf("Client 1 received tree_update")
			}
		case <-time.After(1 * time.Second):
		}
	}

	if !gotTreeUpdate {
		t.Fatalf("Client 1 did not receive tree_update")
	}

	client1.Close()

	// Wait a moment for daemon to process disconnect
	time.Sleep(100 * time.Millisecond)

	// Connect second client (simulating reconnect)
	client2 := daemon.NewDaemonClient()
	if err := client2.Connect(); err != nil {
		t.Fatalf("Client 2 failed to connect: %v", err)
	}
	defer client2.Close()

	// Wait for full_state message - it should include the current tree
	err := waitForCondition(t, WaitCondition{
		Name: "reconnected client receives full_state",
		CheckFunc: func() (bool, error) {
			select {
			case msg := <-client2.Events():
				if msg.Type == daemon.MsgTypeFullState {
					t.Logf("Client 2 received full_state after reconnect")
					// Note: full_state doesn't include tree in current implementation
					// Tree will come in subsequent tree_update broadcast
					return true, nil
				}
			default:
			}
			return false, nil
		},
		Interval: 50 * time.Millisecond,
		Timeout:  5 * time.Second,
	})
	if err != nil {
		t.Fatalf("Reconnected client did not receive full_state: %v", err)
	}

	// Client should also receive tree_update broadcast
	err = waitForCondition(t, WaitCondition{
		Name: "reconnected client receives tree_update",
		CheckFunc: func() (bool, error) {
			select {
			case msg := <-client2.Events():
				if msg.Type == daemon.MsgTypeTreeUpdate {
					if msg.Tree == nil {
						t.Errorf("tree_update has nil Tree")
						return false, nil
					}
					t.Logf("Client 2 received tree_update (repos: %d)", len(msg.Tree.Repos()))
					return true, nil
				}
			default:
			}
			return false, nil
		},
		Interval: 100 * time.Millisecond,
		Timeout:  10 * time.Second,
	})
	if err != nil {
		t.Fatalf("Reconnected client did not receive tree_update: %v", err)
	}

	t.Log("SUCCESS: Reconnected client received current tree state")
}

// TestTreeBroadcast_DaemonRestart verifies that clients can reconnect and
// resync tree state after daemon restarts.
func TestTreeBroadcast_DaemonRestart(t *testing.T) {
	t.Skip("Daemon restart tests are complex and may be flaky in CI")
	// TODO: Implement when we have robust daemon restart testing infrastructure
}

// TestTreeBroadcast_Performance benchmarks the tree broadcast performance
// to verify that centralizing tree collection in the daemon provides
// expected performance benefits over N×client collections.
func TestTreeBroadcast_Performance(t *testing.T) {
	t.Skip("Performance benchmarks should be run separately")
	// TODO: Implement benchmark comparing:
	// - Daemon: 1 collection + broadcast to N clients
	// - Client: N independent collections
	// Expected: Daemon approach is ~90% faster with 12 clients
}
