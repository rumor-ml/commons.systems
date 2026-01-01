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

	// Simulate daemon tree_error message
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

	// Successful tree update from daemon should clear the error
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
