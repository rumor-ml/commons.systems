package main

import (
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/commons-systems/tmux-tui/internal/daemon"
	"github.com/commons-systems/tmux-tui/internal/tmux"
)

// testPane is a helper to create Pane instances for testing
// Panics on error since these are test fixtures with valid data
func testPane(id, windowID string, windowIndex int, windowActive bool) tmux.Pane {
	pane, err := tmux.NewPane(id, "", windowID, windowIndex, windowActive, false, "", "", false)
	if err != nil {
		panic(err)
	}
	return pane
}

// testTree is a helper to create and populate a RepoTree for testing
func testTree(repos map[string]map[string][]tmux.Pane) tmux.RepoTree {
	tree := tmux.NewRepoTree()
	for repo, branches := range repos {
		for branch, panes := range branches {
			if err := tree.SetPanes(repo, branch, panes); err != nil {
				panic(err)
			}
		}
	}
	return tree
}

func TestModelErrorStateConcurrency(t *testing.T) {
	m := initialModel()
	var wg sync.WaitGroup

	// Concurrent writers
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			m.errorMu.Lock()
			m.persistenceError = "test error"
			m.alertsDisabled = true
			m.errorMu.Unlock()
		}()
	}

	// Concurrent readers
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			m.errorMu.RLock()
			_ = m.persistenceError
			_ = m.alertsDisabled
			m.errorMu.RUnlock()
		}()
	}

	wg.Wait()
}

func TestTreeRefreshErrorHandling(t *testing.T) {
	m := initialModel()

	// Clear any initial errors to isolate tree refresh error testing
	m.errorMu.Lock()
	m.err = nil
	m.errorMu.Unlock()

	// Simulate receiving a tree_error message from daemon
	msg := daemonEventMsg{
		msg: daemon.Message{
			Type:  daemon.MsgTypeTreeError,
			Error: "mock tree refresh error",
		},
	}

	updatedModel, _ := m.Update(msg)
	m = updatedModel.(model)

	m.errorMu.RLock()
	refreshErr := m.treeRefreshError
	m.errorMu.RUnlock()

	if refreshErr == nil {
		t.Error("Expected treeRefreshError to be set")
	}
}

func TestTreeRefreshErrorClearing(t *testing.T) {
	m := initialModel()

	// Set an error first
	m.errorMu.Lock()
	m.treeRefreshError = fmt.Errorf("previous error")
	m.errorMu.Unlock()

	// Successful tree_update from daemon should clear treeRefreshError
	tree := testTree(map[string]map[string][]tmux.Pane{
		"test-repo": {
			"main": {
				testPane("%1", "@1", 0, true),
			},
		},
	})
	msg := daemonEventMsg{
		msg: daemon.Message{
			Type: daemon.MsgTypeTreeUpdate,
			Tree: &tree,
		},
	}

	updatedModel, _ := m.Update(msg)
	m = updatedModel.(model)

	m.errorMu.RLock()
	refreshErr := m.treeRefreshError
	m.errorMu.RUnlock()

	if refreshErr != nil {
		t.Errorf("Expected treeRefreshError to be cleared, got: %v", refreshErr)
	}
}

func TestViewErrorStateSnapshot(t *testing.T) {
	m := initialModel()
	// Ensure tree is initialized
	m.tree = testTree(map[string]map[string][]tmux.Pane{
		"test-repo": {
			"main": {
				testPane("%1", "@1", 0, true),
			},
		},
	})

	// Set various error states
	m.errorMu.Lock()
	m.persistenceError = "test persistence error"
	m.treeRefreshError = fmt.Errorf("test refresh error")
	m.alertError = "test alert error"
	m.alertsDisabled = true
	m.errorMu.Unlock()

	// View should snapshot the error state without racing
	view := m.View()

	// Verify that the view was generated (detailed assertion not needed,
	// just verify it doesn't crash or race)
	if view == "" {
		t.Error("View() returned empty string")
	}
}

func TestCriticalErrorTakesPrecedence(t *testing.T) {
	m := initialModel()

	// Set critical error
	m.errorMu.Lock()
	m.err = fmt.Errorf("critical error")
	m.persistenceError = "persistence error"
	m.treeRefreshError = fmt.Errorf("refresh error")
	m.errorMu.Unlock()

	view := m.View()

	// Should show critical error, not the banners
	if view != "Error: critical error\n\nPress Ctrl+C to quit" {
		t.Errorf("Expected critical error view, got: %s", view)
	}
}

func TestErrorBannerPriority(t *testing.T) {
	m := initialModel()

	// Clear any initial errors from collector/tree initialization
	// to isolate warning banner priority testing
	m.errorMu.Lock()
	m.err = nil
	m.errorMu.Unlock()

	// Initialize tree so View() doesn't return "Loading..."
	m.tree = testTree(map[string]map[string][]tmux.Pane{
		"test-repo": {
			"main": {
				testPane("%1", "@1", 0, true),
			},
		},
	})

	tests := []struct {
		name             string
		persistenceErr   string
		treeRefreshErr   error
		alertsDisabled   bool
		alertErr         string
		expectedContains string
	}{
		{
			name:             "persistence error takes priority",
			persistenceErr:   "persist fail",
			treeRefreshErr:   fmt.Errorf("refresh fail"),
			alertsDisabled:   true,
			alertErr:         "alert fail",
			expectedContains: "PERSISTENCE ERROR",
		},
		{
			name:             "tree refresh error is second priority",
			persistenceErr:   "",
			treeRefreshErr:   fmt.Errorf("refresh fail"),
			alertsDisabled:   true,
			alertErr:         "alert fail",
			expectedContains: "TREE REFRESH FAILED",
		},
		{
			name:             "alerts disabled is third priority",
			persistenceErr:   "",
			treeRefreshErr:   nil,
			alertsDisabled:   true,
			alertErr:         "alert fail",
			expectedContains: "ALERT NOTIFICATIONS DISABLED",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m.errorMu.Lock()
			m.persistenceError = tt.persistenceErr
			m.treeRefreshError = tt.treeRefreshErr
			m.alertsDisabled = tt.alertsDisabled
			m.alertError = tt.alertErr
			m.errorMu.Unlock()

			view := m.View()
			if view == "" {
				t.Fatal("View() returned empty string")
			}

			// Check that expected error type appears in view
			// Note: We can't do exact string matching because lipgloss adds styling
			// But we can verify the key text is present using strings.Contains
			if !strings.Contains(view, tt.expectedContains) {
				t.Errorf("Expected view to contain %q, but it was not found.\nView content:\n%s",
					tt.expectedContains, view)
			}
		})
	}
}

func TestTreeUpdateNilHandling(t *testing.T) {
	m := initialModel()

	// Initialize with a tree
	initialTree := testTree(map[string]map[string][]tmux.Pane{
		"test-repo": {
			"main": {
				testPane("%1", "@1", 0, true),
			},
		},
	})
	m.tree = initialTree

	// Simulate malformed tree_update with nil Tree
	msg := daemonEventMsg{
		msg: daemon.Message{
			Type: daemon.MsgTypeTreeUpdate,
			Tree: nil, // Malformed
		},
	}

	// Should not panic, should skip update
	updatedModel, _ := m.Update(msg)
	m = updatedModel.(model)

	// Tree should remain unchanged (still has the initial tree)
	if len(m.tree.Repos()) != 1 {
		t.Errorf("Tree should not be updated with nil Tree field, expected 1 repo, got %d", len(m.tree.Repos()))
	}
}

func TestTreeUpdateAlertReconciliationConcurrency(t *testing.T) {
	m := initialModel()

	// Populate with alerts
	m.alertsMu.Lock()
	m.alerts = map[string]string{
		"%1": "alert1",
		"%2": "alert2",
	}
	m.alertsMu.Unlock()

	// Concurrent tree updates with different states
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(iteration int) {
			defer wg.Done()
			// Create different tree states
			tree := testTree(map[string]map[string][]tmux.Pane{
				fmt.Sprintf("repo-%d", iteration): {
					"main": {
						testPane(fmt.Sprintf("%%%d", iteration+10), fmt.Sprintf("@%d", iteration+10), 0, true),
					},
				},
			})
			msg := daemonEventMsg{
				msg: daemon.Message{
					Type: daemon.MsgTypeTreeUpdate,
					Tree: &tree,
				},
			}
			m.Update(msg)
		}(i)
	}

	wg.Wait()

	// Verify no race detector warnings (test will fail under -race if races occur)
	// Verify alerts are still accessible without panic
	m.alertsMu.RLock()
	_ = len(m.alerts)
	m.alertsMu.RUnlock()
}

func TestTreeUpdate_ConcurrentWithDaemonAlertChange(t *testing.T) {
	// Test for race conditions between tree_update removing panes and
	// daemon alert_change messages updating alerts for those panes
	// This test verifies that alertsMu properly synchronizes alert map access
	m := initialModel()

	// Setup: Client with tree containing panes %1, %2, %3
	initialTree := testTree(map[string]map[string][]tmux.Pane{
		"test-repo": {
			"main": {
				testPane("%1", "@1", 0, true),
				testPane("%2", "@2", 1, false),
				testPane("%3", "@3", 2, false),
			},
		},
	})
	m.tree = initialTree

	// Add alerts for panes %1 and %2
	m.alertsMu.Lock()
	m.alerts = map[string]string{
		"%1": "idle",
		"%2": "stop",
	}
	m.alertsMu.Unlock()

	// Test concurrent message processing
	// Both operations access m.alerts under alertsMu lock
	var wg sync.WaitGroup

	wg.Add(2)

	// Goroutine 1: Tree update that removes pane %2 and reconciles alerts
	go func() {
		defer wg.Done()
		// Tree without pane %2
		newTree := testTree(map[string]map[string][]tmux.Pane{
			"test-repo": {
				"main": {
					testPane("%1", "@1", 0, true),
					testPane("%3", "@3", 2, false),
				},
			},
		})
		msg := daemonEventMsg{
			msg: daemon.Message{
				Type: daemon.MsgTypeTreeUpdate,
				Tree: &newTree,
			},
		}
		// Update() acquires alertsMu during reconciliation
		m.Update(msg)
	}()

	// Goroutine 2: Alert change for pane %2 (race with tree update)
	go func() {
		defer wg.Done()
		msg := daemonEventMsg{
			msg: daemon.Message{
				Type:      daemon.MsgTypeAlertChange,
				PaneID:    "%2",
				EventType: "permission",
				Created:   true,
			},
		}
		// Update() acquires alertsMu when modifying alerts
		m.Update(msg)
	}()

	wg.Wait()

	// Verify: No race condition detected (run with -race)
	// Both goroutines properly synchronized via alertsMu

	m.alertsMu.RLock()
	alerts := m.alerts
	m.alertsMu.RUnlock()

	// Verify no panic occurred during concurrent access
	// Alert state may vary due to timing, but should be valid
	_ = alerts
}

func TestTreeUpdate_ClearsErrorAfterRecovery(t *testing.T) {
	// Test that tree errors are cleared when a successful tree_update arrives
	// Scenario: Daemon has transient failure, broadcasts tree_error, then recovers
	m := initialModel()

	// Step 1: Receive tree_error
	errMsg := daemonEventMsg{
		msg: daemon.Message{
			Type:  daemon.MsgTypeTreeError,
			Error: "collection failed: tmux not responding",
		},
	}
	updatedModel, _ := m.Update(errMsg)
	m = updatedModel.(model)

	// Verify error is set
	m.errorMu.RLock()
	if m.treeRefreshError == nil {
		t.Fatal("Expected treeRefreshError to be set after tree_error message")
	}
	errorText := m.treeRefreshError.Error()
	m.errorMu.RUnlock()

	if !strings.Contains(errorText, "collection failed") {
		t.Errorf("Expected error to contain 'collection failed', got: %v", errorText)
	}

	// Step 2: Receive successful tree_update (daemon recovered)
	tree := testTree(map[string]map[string][]tmux.Pane{
		"test-repo": {
			"main": {
				testPane("%1", "@1", 0, true),
				testPane("%2", "@2", 1, false),
			},
		},
	})
	updateMsg := daemonEventMsg{
		msg: daemon.Message{
			Type: daemon.MsgTypeTreeUpdate,
			Tree: &tree,
		},
	}
	updatedModel, _ = m.Update(updateMsg)
	m = updatedModel.(model)

	// Verify error is cleared
	m.errorMu.RLock()
	if m.treeRefreshError != nil {
		t.Errorf("Expected treeRefreshError to be cleared after successful update, got: %v", m.treeRefreshError)
	}
	m.errorMu.RUnlock()

	// Verify tree was updated successfully
	if len(m.tree.Repos()) != 1 {
		t.Errorf("Expected 1 repo, got %d", len(m.tree.Repos()))
	}
	panes, ok := m.tree.GetPanes("test-repo", "main")
	if !ok || len(panes) != 2 {
		t.Errorf("Expected 2 panes in tree, got %d", len(panes))
	}
}

func TestTreeUpdateNilHandling_Enhanced(t *testing.T) {
	// Enhanced version of TestTreeUpdateNilHandling with additional assertions
	// Tests client-side defense against malformed tree_update messages
	m := initialModel()

	// Initialize with a tree
	initialTree := testTree(map[string]map[string][]tmux.Pane{
		"test-repo": {
			"main": {
				testPane("%1", "@1", 0, true),
			},
		},
	})
	m.tree = initialTree

	// Simulate malformed tree_update with nil Tree (defensive client-side check)
	// In practice, FromWireFormat should reject this, but test ensures graceful degradation
	msg := daemonEventMsg{
		msg: daemon.Message{
			Type:   daemon.MsgTypeTreeUpdate,
			SeqNum: 42,
			Tree:   nil, // Malformed
		},
	}

	// Should not panic, should skip update
	updatedModel, cmd := m.Update(msg)
	m = updatedModel.(model)

	// Verify treeRefreshError is set with appropriate message
	m.errorMu.RLock()
	refreshErr := m.treeRefreshError
	m.errorMu.RUnlock()

	if refreshErr == nil {
		t.Fatal("Expected treeRefreshError to be set for nil Tree field")
	}

	errorText := refreshErr.Error()
	if !strings.Contains(errorText, "nil Tree") {
		t.Errorf("Expected error to mention 'nil Tree', got: %v", errorText)
	}
	if !strings.Contains(errorText, "seq=42") {
		t.Errorf("Expected error to include sequence number, got: %v", errorText)
	}

	// Verify client continues watching daemon (returns watchDaemonCmd)
	// Note: cmd will be nil in test since m.daemonClient is nil
	// In production with daemonClient set, this would return continueWatchingDaemon
	_ = cmd

	// Verify tree remains unchanged (preserves last good state)
	if len(m.tree.Repos()) != 1 {
		t.Errorf("Tree should not be updated with nil Tree field, expected 1 repo, got %d", len(m.tree.Repos()))
	}
	panes, ok := m.tree.GetPanes("test-repo", "main")
	if !ok || len(panes) != 1 {
		t.Errorf("Expected tree to preserve last good state with 1 pane, got %d panes", len(panes))
	}
}

func TestTreeUpdate_NilTreePersistsErrorUntilRecovery(t *testing.T) {
	// Tests error state management when receiving multiple nil tree_update messages
	// Verifies that errors persist across multiple failures until a valid update arrives
	m := initialModel()

	// Setup: Initial valid tree
	validTree := testTree(map[string]map[string][]tmux.Pane{
		"test-repo": {
			"main": {
				testPane("%1", "@1", 0, true),
				testPane("%2", "@2", 1, false),
			},
		},
	})
	m.tree = validTree

	// Step 1: Receive nil tree_update (malformed message)
	nilMsg := daemonEventMsg{
		msg: daemon.Message{
			Type:   daemon.MsgTypeTreeUpdate,
			SeqNum: 1,
			Tree:   nil,
		},
	}
	updatedModel, _ := m.Update(nilMsg)
	m = updatedModel.(model)

	// Verify error is set
	m.errorMu.RLock()
	firstErr := m.treeRefreshError
	m.errorMu.RUnlock()
	if firstErr == nil {
		t.Fatal("Expected error to be set after nil Tree")
	}

	// Step 2: Receive ANOTHER nil tree_update (error still happening)
	nilMsg2 := daemonEventMsg{
		msg: daemon.Message{
			Type:   daemon.MsgTypeTreeUpdate,
			SeqNum: 2,
			Tree:   nil,
		},
	}
	updatedModel, _ = m.Update(nilMsg2)
	m = updatedModel.(model)

	// Verify error STILL set (not cleared)
	m.errorMu.RLock()
	secondErr := m.treeRefreshError
	m.errorMu.RUnlock()
	if secondErr == nil {
		t.Fatal("Expected error to persist across multiple nil updates")
	}

	// Step 3: Receive valid tree_update (daemon recovered)
	recoveredTree := testTree(map[string]map[string][]tmux.Pane{
		"test-repo": {
			"main": {
				testPane("%1", "@1", 0, true),
				testPane("%3", "@3", 2, false),
			},
		},
	})
	validMsg := daemonEventMsg{
		msg: daemon.Message{
			Type: daemon.MsgTypeTreeUpdate,
			Tree: &recoveredTree,
		},
	}
	updatedModel, _ = m.Update(validMsg)
	m = updatedModel.(model)

	// Verify error CLEARED after successful update
	m.errorMu.RLock()
	clearedErr := m.treeRefreshError
	m.errorMu.RUnlock()
	if clearedErr != nil {
		t.Errorf("Expected error to be cleared after valid update, got: %v", clearedErr)
	}

	// Verify tree was updated
	if len(m.tree.Repos()) == 0 {
		t.Error("Expected tree to be updated after recovery")
	}
	panes, ok := m.tree.GetPanes("test-repo", "main")
	if !ok || len(panes) != 2 {
		t.Errorf("Expected 2 panes after recovery, got %d", len(panes))
	}
}

// TestTreeUpdate_RaceWithAlertChange verifies correct behavior when:
// 1. Client has tree with panes %1, %2, %3
// 2. alert_change arrives for pane %2 (adds alert)
// 3. tree_update arrives removing pane %2 (reconciles alerts)
// Race: alert_change and tree_update both modify m.alerts
func TestTreeUpdate_RaceWithAlertChange(t *testing.T) {
	m := initialModel()
	initialTree := testTree(map[string]map[string][]tmux.Pane{
		"test-repo": {"main": {testPane("%1", "@1", 0, true), testPane("%2", "@2", 1, false)}},
	})
	m.tree = initialTree

	var wg sync.WaitGroup
	wg.Add(2)

	// Goroutine 1: alert_change for pane %2
	go func() {
		defer wg.Done()
		msg := daemonEventMsg{msg: daemon.Message{Type: daemon.MsgTypeAlertChange, PaneID: "%2", EventType: "stop", Created: true}}
		m.Update(msg)
	}()

	// Goroutine 2: tree_update removing pane %2 (triggers reconciliation)
	go func() {
		defer wg.Done()
		newTree := testTree(map[string]map[string][]tmux.Pane{
			"test-repo": {"main": {testPane("%1", "@1", 0, true)}},
		})
		msg := daemonEventMsg{msg: daemon.Message{Type: daemon.MsgTypeTreeUpdate, Tree: &newTree}}
		m.Update(msg)
	}()

	wg.Wait()

	// Verify: No race detector warnings
	// Verify: Alert state is consistent (either pane %2 exists with alert, or pane doesn't exist and alert is removed)
	m.alertsMu.RLock()
	_, hasAlert := m.alerts["%2"]
	m.alertsMu.RUnlock()

	panes, _ := m.tree.GetPanes("test-repo", "main")
	hasPane2InTree := false
	for _, p := range panes {
		if p.ID() == "%2" {
			hasPane2InTree = true
			break
		}
	}

	// Invariant: alert exists IFF pane exists in tree
	if hasAlert != hasPane2InTree {
		t.Errorf("Inconsistent state: hasAlert=%v, hasPane2InTree=%v", hasAlert, hasPane2InTree)
	}
}

// TestTreeUpdate_InvalidTreeData verifies client behavior when tree_update contains
// malformed Tree data (e.g., repos with empty names, branches with empty names).
// While UnmarshalJSON validates during deserialization, this tests client-side defense.
func TestTreeUpdate_InvalidTreeData(t *testing.T) {
	tests := []struct {
		name        string
		setupTree   func() tmux.RepoTree
		expectError bool
	}{
		{
			name: "empty_repo_name",
			setupTree: func() tmux.RepoTree {
				tree := tmux.NewRepoTree()
				pane := testPane("%1", "@1", 0, true)
				// Attempt to create invalid tree - SetPanes validates and returns error
				err := tree.SetPanes("", "branch", []tmux.Pane{pane})
				if err == nil {
					t.Fatal("Expected SetPanes to reject empty repo name")
				}
				return tree
			},
			expectError: false, // Empty tree is valid (no repos)
		},
		{
			name: "empty_branch_name",
			setupTree: func() tmux.RepoTree {
				tree := tmux.NewRepoTree()
				pane := testPane("%1", "@1", 0, true)
				// Attempt to create invalid tree - SetPanes validates and returns error
				err := tree.SetPanes("repo", "", []tmux.Pane{pane})
				if err == nil {
					t.Fatal("Expected SetPanes to reject empty branch name")
				}
				return tree
			},
			expectError: false, // Empty tree is valid (no repos)
		},
		{
			name: "valid_tree",
			setupTree: func() tmux.RepoTree {
				tree := tmux.NewRepoTree()
				pane := testPane("%1", "@1", 0, true)
				err := tree.SetPanes("valid-repo", "main", []tmux.Pane{pane})
				if err != nil {
					t.Fatalf("Unexpected error creating valid tree: %v", err)
				}
				return tree
			},
			expectError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := initialModel()
			tree := tt.setupTree()

			msg := daemonEventMsg{
				msg: daemon.Message{
					Type: daemon.MsgTypeTreeUpdate,
					Tree: &tree,
				},
			}

			// Client should handle tree gracefully (either accept valid or reject invalid)
			updatedModel, _ := m.Update(msg)
			m = updatedModel.(model)

			if tt.expectError {
				// Verify client handled invalid data gracefully
				m.errorMu.RLock()
				hasError := m.treeRefreshError != nil
				m.errorMu.RUnlock()

				if !hasError {
					t.Errorf("Expected client to detect and report invalid tree data")
				}
			} else {
				// Verify client accepted valid tree without error
				m.errorMu.RLock()
				hasError := m.treeRefreshError != nil
				m.errorMu.RUnlock()

				if hasError {
					t.Errorf("Expected client to accept valid tree, got error: %v", m.treeRefreshError)
				}
			}
		})
	}
}

// TestTreeError_MultipleConsecutiveFailures verifies that client correctly handles
// multiple consecutive tree_error messages without a successful tree_update in between.
// Daemon broadcasts tree_error every 30s if collection keeps failing.
func TestTreeError_MultipleConsecutiveFailures(t *testing.T) {
	m := initialModel()

	// Setup: Client has valid initial tree
	validTree := testTree(map[string]map[string][]tmux.Pane{
		"test-repo": {
			"main": {testPane("%1", "@1", 0, true)},
		},
	})
	m.tree = validTree

	// Receive 5 consecutive tree_error messages (simulating 2.5 minutes of failures)
	for i := 1; i <= 5; i++ {
		errMsg := daemonEventMsg{
			msg: daemon.Message{
				Type:   daemon.MsgTypeTreeError,
				SeqNum: uint64(i),
				Error:  fmt.Sprintf("collection failed: attempt %d", i),
			},
		}

		updatedModel, _ := m.Update(errMsg)
		m = updatedModel.(model)
	}

	// Verify: Error state is set with latest error
	m.errorMu.RLock()
	err := m.treeRefreshError
	m.errorMu.RUnlock()

	if err == nil {
		t.Fatal("Expected treeRefreshError to be set after consecutive failures")
	}

	if !strings.Contains(err.Error(), "attempt 5") {
		t.Errorf("Expected error to contain latest failure message, got: %v", err)
	}

	// Verify: Tree preserved (not cleared)
	if len(m.tree.Repos()) != 1 {
		t.Errorf("Tree should preserve last good state, got %d repos", len(m.tree.Repos()))
	}

	// Verify: No memory leak (error doesn't accumulate)
	errorLen := len(err.Error())
	if errorLen > 500 {
		t.Errorf("Error message suspiciously long (%d chars), possible accumulation", errorLen)
	}
}

// TestTreeUpdate_CircuitBreakerRecovery verifies that the circuit breaker mechanism
// properly resets when valid tree updates arrive after consecutive nil tree failures.
// Tests the consecutiveNilUpdates counter and treeRefreshError clearing on recovery.
func TestTreeUpdate_CircuitBreakerRecovery(t *testing.T) {
	m := initialModel()

	// Setup: Initial valid tree
	initialTree := testTree(map[string]map[string][]tmux.Pane{
		"test-repo": {
			"main": {
				testPane("%1", "@1", 0, true),
				testPane("%2", "@2", 1, false),
			},
		},
	})
	m.tree = initialTree

	// Send 2 consecutive nil tree_update messages (below circuit breaker threshold of 3)
	for i := 1; i <= 2; i++ {
		msg := daemonEventMsg{
			msg: daemon.Message{
				Type:   daemon.MsgTypeTreeUpdate,
				SeqNum: uint64(i),
				Tree:   nil,
			},
		}
		updatedModel, _ := m.Update(msg)
		m = updatedModel.(model)
	}

	// Verify consecutiveNilUpdates incremented
	if m.consecutiveNilUpdates != 2 {
		t.Errorf("Expected consecutiveNilUpdates=2, got %d", m.consecutiveNilUpdates)
	}

	// Verify treeRefreshError is set
	m.errorMu.RLock()
	hasError := m.treeRefreshError != nil
	m.errorMu.RUnlock()

	if !hasError {
		t.Fatal("Expected treeRefreshError to be set after nil tree updates")
	}

	// Send valid tree_update (daemon recovered)
	validTree := testTree(map[string]map[string][]tmux.Pane{
		"test-repo": {
			"main": {
				testPane("%1", "@1", 0, true),
				testPane("%3", "@3", 2, false),
			},
		},
	})
	validMsg := daemonEventMsg{
		msg: daemon.Message{
			Type: daemon.MsgTypeTreeUpdate,
			Tree: &validTree,
		},
	}
	updatedModel, _ := m.Update(validMsg)
	m = updatedModel.(model)

	// Verify consecutiveNilUpdates resets to 0
	if m.consecutiveNilUpdates != 0 {
		t.Errorf("Expected consecutiveNilUpdates to reset to 0 after valid update, got %d", m.consecutiveNilUpdates)
	}

	// Verify treeRefreshError is cleared
	m.errorMu.RLock()
	refreshErr := m.treeRefreshError
	m.errorMu.RUnlock()

	if refreshErr != nil {
		t.Errorf("Expected treeRefreshError to be cleared after valid update, got: %v", refreshErr)
	}

	// Verify tree is updated correctly
	if len(m.tree.Repos()) != 1 {
		t.Errorf("Expected 1 repo after valid update, got %d", len(m.tree.Repos()))
	}
	panes, ok := m.tree.GetPanes("test-repo", "main")
	if !ok || len(panes) != 2 {
		t.Errorf("Expected 2 panes after valid update, got %d", len(panes))
	}
}

// TestTreeUpdate_EmptyTreeValid verifies that client correctly handles tree_update
// with empty RepoTree (0 repos), distinguishing it from nil tree (malformed message).
// Empty tree is valid state (e.g., no tmux sessions running).
func TestTreeUpdate_EmptyTreeValid(t *testing.T) {
	m := initialModel()

	// Populate with initial data
	tree := testTree(map[string]map[string][]tmux.Pane{
		"repo1": {"main": {testPane("%1", "@1", 0, true)}},
	})
	m.tree = tree

	// Receive empty tree update (all sessions killed)
	emptyTree := tmux.NewRepoTree()
	msg := daemonEventMsg{
		msg: daemon.Message{
			Type: daemon.MsgTypeTreeUpdate,
			Tree: &emptyTree,
		},
	}

	updatedModel, _ := m.Update(msg)
	m = updatedModel.(model)

	// Verify tree is empty (not nil)
	if len(m.tree.Repos()) != 0 {
		t.Errorf("Expected empty tree after update, got %d repos", len(m.tree.Repos()))
	}

	// Verify NO error is set (empty != error)
	m.errorMu.RLock()
	refreshErr := m.treeRefreshError
	m.errorMu.RUnlock()

	if refreshErr != nil {
		t.Errorf("Empty tree should not trigger error, got: %v", refreshErr)
	}

	// Verify consecutiveNilUpdates is 0 (empty tree is valid)
	if m.consecutiveNilUpdates != 0 {
		t.Errorf("Empty tree should not increment consecutiveNilUpdates, got %d", m.consecutiveNilUpdates)
	}
}

// TestTreeUpdate_CircuitBreakerTriggersAtThreshold verifies that the circuit breaker
// disconnects from daemon after exactly 3 consecutive nil tree updates.
// This is a critical protection mechanism against runaway daemon bugs.
func TestTreeUpdate_CircuitBreakerTriggersAtThreshold(t *testing.T) {
	m := initialModel()

	// Setup: Initial valid tree
	initialTree := testTree(map[string]map[string][]tmux.Pane{
		"test-repo": {
			"main": {
				testPane("%1", "@1", 0, true),
				testPane("%2", "@2", 1, false),
			},
		},
	})
	m.tree = initialTree

	// Send exactly 3 consecutive nil tree_update messages (circuit breaker threshold)
	for i := 1; i <= 3; i++ {
		msg := daemonEventMsg{
			msg: daemon.Message{
				Type:   daemon.MsgTypeTreeUpdate,
				SeqNum: uint64(i),
				Tree:   nil,
			},
		}
		updatedModel, cmd := m.Update(msg)
		m = updatedModel.(model)

		// Verify consecutiveNilUpdates increments
		if m.consecutiveNilUpdates != i {
			t.Errorf("After update %d: expected consecutiveNilUpdates=%d, got %d", i, i, m.consecutiveNilUpdates)
		}

		// On 3rd update, circuit breaker should trigger
		if i == 3 {
			// Verify daemonClient is disconnected (set to nil)
			if m.daemonClient != nil {
				t.Error("Expected daemonClient to be nil after 3 consecutive nil updates")
			}

			// Verify treeRefreshError contains disconnect message
			m.errorMu.RLock()
			refreshErr := m.treeRefreshError
			m.errorMu.RUnlock()

			if refreshErr == nil {
				t.Fatal("Expected treeRefreshError to be set after circuit breaker triggers")
			}

			errorText := refreshErr.Error()
			if !strings.Contains(errorText, "disconnected after 3 failures") {
				t.Errorf("Expected error to contain 'disconnected after 3 failures', got: %v", errorText)
			}

			// Verify Update() returns nil cmd (stops watching daemon)
			if cmd != nil {
				t.Errorf("Expected Update() to return nil cmd after circuit breaker, got: %v", cmd)
			}
		}
	}

	// Send 4th nil update - counter increments but circuit breaker already triggered
	msg4 := daemonEventMsg{
		msg: daemon.Message{
			Type:   daemon.MsgTypeTreeUpdate,
			SeqNum: 4,
			Tree:   nil,
		},
	}
	updatedModel, _ := m.Update(msg4)
	m = updatedModel.(model)

	// consecutiveNilUpdates increments to 4 (counter updates before circuit breaker check)
	// Circuit breaker already triggered at 3, so daemonClient remains nil
	if m.consecutiveNilUpdates != 4 {
		t.Errorf("Expected consecutiveNilUpdates=4 after 4th update, got %d", m.consecutiveNilUpdates)
	}

	// Verify daemonClient still nil (circuit breaker remains active)
	if m.daemonClient != nil {
		t.Error("Expected daemonClient to remain nil after 4th nil update")
	}
}

// TestTreeUpdateErrorRecoveryCycle verifies the complete error recovery path:
// tree_error → (collection recovers) → tree_update with proper error clearing.
// This is the primary error recovery path in production.
func TestTreeUpdateErrorRecoveryCycle(t *testing.T) {
	m := initialModel()

	// Step 1: Initialize model with valid tree state
	initialTree := testTree(map[string]map[string][]tmux.Pane{
		"test-repo": {
			"main": {
				testPane("%1", "@1", 0, true),
				testPane("%2", "@2", 1, false),
			},
		},
	})
	m.tree = initialTree

	// Step 2: Send tree_error message (daemon collection failed)
	errMsg1 := daemonEventMsg{
		msg: daemon.Message{
			Type:  daemon.MsgTypeTreeError,
			Error: "collection failed: tmux not responding",
		},
	}
	updatedModel, _ := m.Update(errMsg1)
	m = updatedModel.(model)

	// Step 3: Verify treeRefreshError is set
	m.errorMu.RLock()
	firstErr := m.treeRefreshError
	m.errorMu.RUnlock()

	if firstErr == nil {
		t.Fatal("Expected treeRefreshError to be set after tree_error")
	}

	if !strings.Contains(firstErr.Error(), "collection failed") {
		t.Errorf("Expected error to contain 'collection failed', got: %v", firstErr)
	}

	// Step 4: Verify tree preserves last good state (not cleared)
	if len(m.tree.Repos()) != 1 {
		t.Errorf("Expected tree to preserve last good state, got %d repos", len(m.tree.Repos()))
	}
	panes, ok := m.tree.GetPanes("test-repo", "main")
	if !ok || len(panes) != 2 {
		t.Errorf("Expected 2 panes in preserved tree, got %d", len(panes))
	}

	// Step 5: Send ANOTHER tree_error (still failing) - verify error updates to latest
	errMsg2 := daemonEventMsg{
		msg: daemon.Message{
			Type:  daemon.MsgTypeTreeError,
			Error: "collection failed: timeout waiting for tmux",
		},
	}
	updatedModel, _ = m.Update(errMsg2)
	m = updatedModel.(model)

	m.errorMu.RLock()
	secondErr := m.treeRefreshError
	m.errorMu.RUnlock()

	if secondErr == nil {
		t.Fatal("Expected treeRefreshError to persist after second tree_error")
	}

	if !strings.Contains(secondErr.Error(), "timeout waiting for tmux") {
		t.Errorf("Expected error to update to latest message, got: %v", secondErr)
	}

	// Step 6: Send tree_update with new valid tree (daemon recovered)
	recoveredTree := testTree(map[string]map[string][]tmux.Pane{
		"test-repo": {
			"main": {
				testPane("%1", "@1", 0, true),
				testPane("%3", "@3", 2, false),
			},
		},
		"other-repo": {
			"develop": {
				testPane("%4", "@4", 0, true),
			},
		},
	})
	updateMsg := daemonEventMsg{
		msg: daemon.Message{
			Type: daemon.MsgTypeTreeUpdate,
			Tree: &recoveredTree,
		},
	}
	updatedModel, _ = m.Update(updateMsg)
	m = updatedModel.(model)

	// Step 7: Verify treeRefreshError is cleared
	m.errorMu.RLock()
	clearedErr := m.treeRefreshError
	m.errorMu.RUnlock()

	if clearedErr != nil {
		t.Errorf("Expected treeRefreshError to be cleared after successful update, got: %v", clearedErr)
	}

	// Step 8: Verify tree is updated with new data
	if len(m.tree.Repos()) != 2 {
		t.Errorf("Expected 2 repos after recovery, got %d", len(m.tree.Repos()))
	}

	panes, ok = m.tree.GetPanes("test-repo", "main")
	if !ok || len(panes) != 2 {
		t.Errorf("Expected 2 panes in test-repo/main, got %d", len(panes))
	}

	panes, ok = m.tree.GetPanes("other-repo", "develop")
	if !ok || len(panes) != 1 {
		t.Errorf("Expected 1 pane in other-repo/develop, got %d", len(panes))
	}

	// Step 9: Verify consecutiveNilUpdates is 0 (not incremented by tree_error)
	if m.consecutiveNilUpdates != 0 {
		t.Errorf("Expected consecutiveNilUpdates to be 0, got %d", m.consecutiveNilUpdates)
	}
}

// TestTreeUpdate_AlertReconciliationLogic verifies that alert reconciliation
// correctly removes alerts for panes no longer in the tree.
// This prevents memory leaks and UI confusion from zombie alerts.
func TestTreeUpdate_AlertReconciliationLogic(t *testing.T) {
	m := initialModel()

	// Step 1: Initialize model with tree containing panes %1, %2, %3
	initialTree := testTree(map[string]map[string][]tmux.Pane{
		"test-repo": {
			"main": {
				testPane("%1", "@1", 0, true),
				testPane("%2", "@2", 1, false),
				testPane("%3", "@3", 2, false),
			},
		},
	})
	m.tree = initialTree

	// Step 2: Add alerts for panes %1 and %2 (but not %3)
	m.alertsMu.Lock()
	m.alerts = map[string]string{
		"%1": "stop",
		"%2": "idle",
	}
	m.alertsMu.Unlock()

	// Step 3: Send tree_update with only pane %1 (panes %2, %3 removed)
	updatedTree := testTree(map[string]map[string][]tmux.Pane{
		"test-repo": {
			"main": {
				testPane("%1", "@1", 0, true),
			},
		},
	})
	msg := daemonEventMsg{
		msg: daemon.Message{
			Type: daemon.MsgTypeTreeUpdate,
			Tree: &updatedTree,
		},
	}
	updatedModel, _ := m.Update(msg)
	m = updatedModel.(model)

	// Step 4: Verify alerts map contains ONLY %1 alert
	m.alertsMu.RLock()
	alerts := m.alerts
	m.alertsMu.RUnlock()

	if len(alerts) != 1 {
		t.Errorf("Expected 1 alert after reconciliation, got %d: %v", len(alerts), alerts)
	}

	if alert, ok := alerts["%1"]; !ok || alert != "stop" {
		t.Errorf("Expected alert for %%1 to be 'stop', got: %v", alert)
	}

	// Step 5: Verify %2 alert was removed (pane with alert gone)
	if _, exists := alerts["%2"]; exists {
		t.Error("Expected alert for %%2 to be removed after pane disappeared from tree")
	}

	// Step 6: Send tree_update removing all panes (empty tree)
	emptyTree := tmux.NewRepoTree()
	msg2 := daemonEventMsg{
		msg: daemon.Message{
			Type: daemon.MsgTypeTreeUpdate,
			Tree: &emptyTree,
		},
	}
	updatedModel, _ = m.Update(msg2)
	m = updatedModel.(model)

	// Step 7: Verify alerts map is empty
	m.alertsMu.RLock()
	finalAlerts := m.alerts
	m.alertsMu.RUnlock()

	if len(finalAlerts) != 0 {
		t.Errorf("Expected 0 alerts after empty tree update, got %d: %v", len(finalAlerts), finalAlerts)
	}
}

// TestReconcileAlerts_EmptyTree verifies that reconcileAlerts correctly handles
// empty tree state (all panes removed). All alerts should be removed to prevent
// memory leaks from orphaned alerts.
func TestReconcileAlerts_EmptyTree(t *testing.T) {
	m := initialModel()

	// Setup: Model with alerts for panes %1, %2
	m.alertsMu.Lock()
	m.alerts = map[string]string{
		"%1": "stop",
		"%2": "idle",
	}
	m.alertsMu.Unlock()

	// Send tree_update with empty tree (all sessions killed)
	emptyTree := tmux.NewRepoTree()
	msg := daemonEventMsg{
		msg: daemon.Message{
			Type: daemon.MsgTypeTreeUpdate,
			Tree: &emptyTree,
		},
	}

	updatedModel, _ := m.Update(msg)
	m = updatedModel.(model)

	// Verify alerts map is empty after reconciliation
	m.alertsMu.RLock()
	alerts := m.alerts
	m.alertsMu.RUnlock()

	if len(alerts) != 0 {
		t.Errorf("Expected alerts to be empty after reconciling with empty tree, got %d alerts: %v", len(alerts), alerts)
	}
}

// TestReconcileAlerts_EmptyAlerts verifies that reconcileAlerts handles
// empty alerts map gracefully (no panic, no unexpected behavior).
func TestReconcileAlerts_EmptyAlerts(t *testing.T) {
	m := initialModel()

	// Setup: Model with empty alerts
	m.alertsMu.Lock()
	m.alerts = map[string]string{}
	m.alertsMu.Unlock()

	// Send tree_update with populated tree
	tree := testTree(map[string]map[string][]tmux.Pane{
		"test-repo": {
			"main": {
				testPane("%1", "@1", 0, true),
				testPane("%2", "@2", 1, false),
			},
		},
	})
	msg := daemonEventMsg{
		msg: daemon.Message{
			Type: daemon.MsgTypeTreeUpdate,
			Tree: &tree,
		},
	}

	updatedModel, _ := m.Update(msg)
	m = updatedModel.(model)

	// Verify no panic, alerts remain empty
	m.alertsMu.RLock()
	alerts := m.alerts
	m.alertsMu.RUnlock()

	if len(alerts) != 0 {
		t.Errorf("Expected alerts to remain empty, got %d alerts: %v", len(alerts), alerts)
	}
}

// TestReconcileAlerts_OrphanedAlerts verifies that reconcileAlerts removes
// orphaned alerts for non-existent panes (data corruption scenario).
// Only alerts matching tree panes should remain.
func TestReconcileAlerts_OrphanedAlerts(t *testing.T) {
	m := initialModel()

	// Setup: Manually inject alerts for non-existent panes (simulate data corruption)
	m.alertsMu.Lock()
	m.alerts = map[string]string{
		"%1":   "stop",       // Will match tree pane %1
		"%99":  "idle",       // Orphaned - no pane %99 in tree
		"%100": "permission", // Orphaned - no pane %100 in tree
	}
	m.alertsMu.Unlock()

	// Send tree_update with valid tree containing only %1, %2
	tree := testTree(map[string]map[string][]tmux.Pane{
		"test-repo": {
			"main": {
				testPane("%1", "@1", 0, true),
				testPane("%2", "@2", 1, false),
			},
		},
	})
	msg := daemonEventMsg{
		msg: daemon.Message{
			Type: daemon.MsgTypeTreeUpdate,
			Tree: &tree,
		},
	}

	updatedModel, _ := m.Update(msg)
	m = updatedModel.(model)

	// Verify orphaned alerts are removed
	m.alertsMu.RLock()
	alerts := m.alerts
	m.alertsMu.RUnlock()

	if len(alerts) != 1 {
		t.Errorf("Expected 1 alert after reconciliation, got %d: %v", len(alerts), alerts)
	}

	// Verify only alert matching tree pane %1 remains
	if alert, ok := alerts["%1"]; !ok || alert != "stop" {
		t.Errorf("Expected alert for %%1 to be 'stop', got: %v", alert)
	}

	// Verify orphaned alerts were removed
	if _, exists := alerts["%99"]; exists {
		t.Error("Expected orphaned alert for %%99 to be removed")
	}
	if _, exists := alerts["%100"]; exists {
		t.Error("Expected orphaned alert for %%100 to be removed")
	}
}

// TestReconcileAlerts_NoRepos verifies reconciliation when tree has no repos
// (different from empty tree - no repos vs repos with no branches).
func TestReconcileAlerts_NoRepos(t *testing.T) {
	m := initialModel()

	// Setup: Alerts exist
	m.alertsMu.Lock()
	m.alerts = map[string]string{
		"%1": "stop",
		"%2": "idle",
	}
	m.alertsMu.Unlock()

	// Create tree with no repos (empty)
	emptyTree := tmux.NewRepoTree()
	msg := daemonEventMsg{
		msg: daemon.Message{
			Type: daemon.MsgTypeTreeUpdate,
			Tree: &emptyTree,
		},
	}

	updatedModel, _ := m.Update(msg)
	m = updatedModel.(model)

	// Verify all alerts removed (no repos = no panes)
	m.alertsMu.RLock()
	alerts := m.alerts
	m.alertsMu.RUnlock()

	if len(alerts) != 0 {
		t.Errorf("Expected 0 alerts when tree has no repos, got %d: %v", len(alerts), alerts)
	}
}

// TestReconcileAlerts_NoBranches verifies reconciliation when tree has repos
// but no branches (sessions exist but no panes).
func TestReconcileAlerts_NoBranches(t *testing.T) {
	m := initialModel()

	// Setup: Alerts exist
	m.alertsMu.Lock()
	m.alerts = map[string]string{
		"%1": "stop",
		"%2": "idle",
	}
	m.alertsMu.Unlock()

	// Create tree with repo but no branches (can't actually do this via testTree)
	// Empty tree is the closest we can get - RepoTree doesn't allow repos without branches
	emptyTree := tmux.NewRepoTree()
	msg := daemonEventMsg{
		msg: daemon.Message{
			Type: daemon.MsgTypeTreeUpdate,
			Tree: &emptyTree,
		},
	}

	updatedModel, _ := m.Update(msg)
	m = updatedModel.(model)

	// Verify all alerts removed (no branches = no panes)
	m.alertsMu.RLock()
	alerts := m.alerts
	m.alertsMu.RUnlock()

	if len(alerts) != 0 {
		t.Errorf("Expected 0 alerts when tree has no branches, got %d: %v", len(alerts), alerts)
	}
}

// TestReconcileAlerts_NoPanes verifies reconciliation when tree has repos and
// branches but no panes (branches exist but empty).
func TestReconcileAlerts_NoPanes(t *testing.T) {
	m := initialModel()

	// Setup: Alerts exist
	m.alertsMu.Lock()
	m.alerts = map[string]string{
		"%1": "stop",
		"%2": "idle",
	}
	m.alertsMu.Unlock()

	// Create tree with repo and branch but empty panes array
	tree := testTree(map[string]map[string][]tmux.Pane{
		"test-repo": {
			"main": {}, // Empty panes array
		},
	})
	msg := daemonEventMsg{
		msg: daemon.Message{
			Type: daemon.MsgTypeTreeUpdate,
			Tree: &tree,
		},
	}

	updatedModel, _ := m.Update(msg)
	m = updatedModel.(model)

	// Verify all alerts removed (no panes in branch)
	m.alertsMu.RLock()
	alerts := m.alerts
	m.alertsMu.RUnlock()

	if len(alerts) != 0 {
		t.Errorf("Expected 0 alerts when tree has no panes, got %d: %v", len(alerts), alerts)
	}
}

// TestReconcileAlerts_RaceWithAlertChange verifies that alert reconciliation
// correctly handles race condition where alert_change arrives for a pane
// just before tree_update removes that pane.
func TestReconcileAlerts_RaceWithAlertChange(t *testing.T) {
	m := initialModel()

	// Setup: Tree with panes %1, %2
	initialTree := testTree(map[string]map[string][]tmux.Pane{
		"test-repo": {
			"main": {
				testPane("%1", "@1", 0, true),
				testPane("%2", "@2", 1, false),
			},
		},
	})
	m.tree = initialTree

	// Setup: Alerts for pane %1 only
	m.alertsMu.Lock()
	m.alerts = map[string]string{
		"%1": "stop",
	}
	m.alertsMu.Unlock()

	var wg sync.WaitGroup
	wg.Add(2)

	// Goroutine 1: alert_change for pane %2 (adds alert)
	go func() {
		defer wg.Done()
		msg := daemonEventMsg{
			msg: daemon.Message{
				Type:      daemon.MsgTypeAlertChange,
				PaneID:    "%2",
				EventType: "idle",
				Created:   true,
			},
		}
		m.Update(msg)
	}()

	// Goroutine 2: tree_update removing pane %2 (reconciles alerts)
	go func() {
		defer wg.Done()
		newTree := testTree(map[string]map[string][]tmux.Pane{
			"test-repo": {
				"main": {
					testPane("%1", "@1", 0, true),
				},
			},
		})
		msg := daemonEventMsg{
			msg: daemon.Message{
				Type: daemon.MsgTypeTreeUpdate,
				Tree: &newTree,
			},
		}
		m.Update(msg)
	}()

	wg.Wait()

	// Verify: No race detector warnings (run with -race)
	// Verify: Final state is consistent
	m.alertsMu.RLock()
	alerts := m.alerts
	m.alertsMu.RUnlock()

	panes, _ := m.tree.GetPanes("test-repo", "main")
	hasPane2InTree := false
	for _, p := range panes {
		if p.ID() == "%2" {
			hasPane2InTree = true
			break
		}
	}

	// If pane %2 is in tree, alert may exist (timing-dependent)
	// If pane %2 not in tree, alert must NOT exist
	if !hasPane2InTree {
		if _, exists := alerts["%2"]; exists {
			t.Error("Alert for %%2 should be removed when pane no longer in tree")
		}
	}

	// Alert for %1 should always exist (pane %1 remains in tree)
	if _, exists := alerts["%1"]; !exists {
		t.Error("Expected alert for %%1 to remain (pane still in tree)")
	}
}
