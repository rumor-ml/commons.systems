package detector

import (
	"fmt"
	"os/exec"
	"testing"
	"time"

	"github.com/commons-systems/tmux-tui/internal/tmux"
)

// mockCollector implements a mock tmux.Collector for testing
type mockCollector struct {
	tree       tmux.RepoTree
	paneTitles map[string]string // paneID -> title
	treeErr    error
	titleErr   error
}

func newMockCollector() *mockCollector {
	return &mockCollector{
		tree:       tmux.NewRepoTree(),
		paneTitles: make(map[string]string),
	}
}

func (m *mockCollector) GetTree() (tmux.RepoTree, error) {
	if m.treeErr != nil {
		return tmux.RepoTree{}, m.treeErr
	}
	return m.tree, nil
}

func (m *mockCollector) GetPaneTitle(paneID string) (string, error) {
	if m.titleErr != nil {
		return "", m.titleErr
	}
	title, ok := m.paneTitles[paneID]
	if !ok {
		return "", fmt.Errorf("pane %s not found", paneID)
	}
	return title, nil
}

func (m *mockCollector) addPane(repo, branch, paneID, title string) error {
	// Create pane with minimal required fields
	pane, err := tmux.NewPane(paneID, "/tmp", "@1", 0, false, false, "bash", title, false)
	if err != nil {
		return err
	}

	// Get existing panes or create new slice
	panes, _ := m.tree.GetPanes(repo, branch)
	panes = append(panes, pane)

	// Set panes
	if err := m.tree.SetPanes(repo, branch, panes); err != nil {
		return err
	}

	// Store title for GetPaneTitle
	m.paneTitles[paneID] = title
	return nil
}

func (m *mockCollector) updatePaneTitle(paneID, newTitle string) {
	m.paneTitles[paneID] = newTitle
}

func (m *mockCollector) removePane(repo, branch, paneID string) error {
	panes, ok := m.tree.GetPanes(repo, branch)
	if !ok {
		return nil
	}

	// Filter out the pane
	newPanes := make([]tmux.Pane, 0, len(panes))
	for _, p := range panes {
		if p.ID() != paneID {
			newPanes = append(newPanes, p)
		}
	}

	// Update tree
	if err := m.tree.SetPanes(repo, branch, newPanes); err != nil {
		return err
	}

	// Remove from title map
	delete(m.paneTitles, paneID)
	return nil
}

func TestTitleDetector_New(t *testing.T) {
	mock := newMockCollector()

	detector, err := NewTitleDetector(mock)
	if err != nil {
		t.Fatalf("NewTitleDetector() error = %v, want nil", err)
	}
	defer detector.Stop()

	if detector == nil {
		t.Fatal("NewTitleDetector() returned nil detector")
	}
}

func TestTitleDetector_NilCollector(t *testing.T) {
	detector, err := NewTitleDetector(nil)
	if err == nil {
		defer detector.Stop()
		t.Error("NewTitleDetector(nil) should return error")
	}
	if detector != nil {
		t.Error("NewTitleDetector(nil) should return nil detector")
	}
}

func TestTitleDetector_IdleDetection(t *testing.T) {
	mock := newMockCollector()

	// Add a pane with idle title
	if err := mock.addPane("test-repo", "main", "%1", "✳ test pane"); err != nil {
		t.Fatalf("Failed to add pane: %v", err)
	}

	detector, err := NewTitleDetector(mock)
	if err != nil {
		t.Fatalf("NewTitleDetector() error = %v", err)
	}
	defer detector.Stop()

	stateCh := detector.Start()

	// Wait for initial state event
	select {
	case event := <-stateCh:
		if event.Error != nil {
			t.Fatalf("Received error event: %v", event.Error)
		}
		if event.PaneID != "%1" {
			t.Errorf("StateEvent.PaneID = %v, want %v", event.PaneID, "%1")
		}
		if event.State != StateIdle {
			t.Errorf("StateEvent.State = %v, want %v (idle prefix '✳ ' should trigger idle state)", event.State, StateIdle)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Timeout waiting for initial state event")
	}
}

func TestTitleDetector_WorkingDetection(t *testing.T) {
	mock := newMockCollector()

	// Add a pane with working title (no idle prefix)
	if err := mock.addPane("test-repo", "main", "%1", "regular pane title"); err != nil {
		t.Fatalf("Failed to add pane: %v", err)
	}

	detector, err := NewTitleDetector(mock)
	if err != nil {
		t.Fatalf("NewTitleDetector() error = %v", err)
	}
	defer detector.Stop()

	stateCh := detector.Start()

	// Wait for initial state event
	select {
	case event := <-stateCh:
		if event.Error != nil {
			t.Fatalf("Received error event: %v", event.Error)
		}
		if event.PaneID != "%1" {
			t.Errorf("StateEvent.PaneID = %v, want %v", event.PaneID, "%1")
		}
		if event.State != StateWorking {
			t.Errorf("StateEvent.State = %v, want %v (no idle prefix should trigger working state)", event.State, StateWorking)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Timeout waiting for initial state event")
	}
}

func TestTitleDetector_StateTransition(t *testing.T) {
	mock := newMockCollector()

	// Start with working state
	if err := mock.addPane("test-repo", "main", "%1", "working"); err != nil {
		t.Fatalf("Failed to add pane: %v", err)
	}

	detector, err := NewTitleDetector(mock)
	if err != nil {
		t.Fatalf("NewTitleDetector() error = %v", err)
	}
	defer detector.Stop()

	stateCh := detector.Start()

	// Wait for initial working state
	select {
	case event := <-stateCh:
		if event.Error != nil {
			t.Fatalf("Received error event: %v", event.Error)
		}
		if event.State != StateWorking {
			t.Fatalf("Initial state = %v, want %v", event.State, StateWorking)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Timeout waiting for initial state event")
	}

	// Change to idle state
	mock.updatePaneTitle("%1", "✳ now idle")

	// Wait for transition to idle
	select {
	case event := <-stateCh:
		if event.Error != nil {
			t.Fatalf("Received error event: %v", event.Error)
		}
		if event.PaneID != "%1" {
			t.Errorf("StateEvent.PaneID = %v, want %v", event.PaneID, "%1")
		}
		if event.State != StateIdle {
			t.Errorf("StateEvent.State = %v, want %v (transition to idle)", event.State, StateIdle)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Timeout waiting for idle transition")
	}

	// Change back to working
	mock.updatePaneTitle("%1", "working again")

	// Wait for transition to working
	select {
	case event := <-stateCh:
		if event.Error != nil {
			t.Fatalf("Received error event: %v", event.Error)
		}
		if event.State != StateWorking {
			t.Errorf("StateEvent.State = %v, want %v (transition back to working)", event.State, StateWorking)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Timeout waiting for working transition")
	}
}

func TestTitleDetector_NoRepeatedEvents(t *testing.T) {
	mock := newMockCollector()

	// Add a pane with idle title
	if err := mock.addPane("test-repo", "main", "%1", "✳ idle"); err != nil {
		t.Fatalf("Failed to add pane: %v", err)
	}

	detector, err := NewTitleDetector(mock)
	if err != nil {
		t.Fatalf("NewTitleDetector() error = %v", err)
	}
	defer detector.Stop()

	stateCh := detector.Start()

	// Wait for initial event
	select {
	case event := <-stateCh:
		if event.Error != nil {
			t.Fatalf("Received error event: %v", event.Error)
		}
		if event.State != StateIdle {
			t.Fatalf("Initial state = %v, want %v", event.State, StateIdle)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Timeout waiting for initial state event")
	}

	// No title change - should not emit another event
	// Wait longer than poll interval to ensure we'd see duplicate if it was emitted
	select {
	case event := <-stateCh:
		if event.Error == nil {
			t.Errorf("Received duplicate event: paneID=%v state=%v (should not emit when state unchanged)",
				event.PaneID, event.State)
		}
	case <-time.After(1 * time.Second):
		// Expected - no event should be emitted
	}
}

func TestTitleDetector_PaneRemoval(t *testing.T) {
	mock := newMockCollector()

	// Add a pane
	if err := mock.addPane("test-repo", "main", "%1", "test"); err != nil {
		t.Fatalf("Failed to add pane: %v", err)
	}

	detector, err := NewTitleDetector(mock)
	if err != nil {
		t.Fatalf("NewTitleDetector() error = %v", err)
	}
	defer detector.Stop()

	stateCh := detector.Start()

	// Wait for initial event
	select {
	case event := <-stateCh:
		if event.Error != nil {
			t.Fatalf("Received error event: %v", event.Error)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Timeout waiting for initial state event")
	}

	// Remove the pane
	if err := mock.removePane("test-repo", "main", "%1"); err != nil {
		t.Fatalf("Failed to remove pane: %v", err)
	}

	// Wait a poll cycle - no event should be emitted (pane is gone)
	// This tests that removed panes are cleaned from lastStates
	select {
	case event := <-stateCh:
		if event.Error == nil {
			t.Errorf("Received event for removed pane: paneID=%v state=%v",
				event.PaneID, event.State)
		}
	case <-time.After(1 * time.Second):
		// Expected - no event for removed pane
	}
}

func TestTitleDetector_TreeError(t *testing.T) {
	mock := newMockCollector()
	mock.treeErr = fmt.Errorf("mock tree error")

	detector, err := NewTitleDetector(mock)
	if err != nil {
		t.Fatalf("NewTitleDetector() error = %v", err)
	}
	defer detector.Stop()

	stateCh := detector.Start()

	// Wait for error event
	select {
	case event := <-stateCh:
		if event.Error == nil {
			t.Error("Expected error event when GetTree fails")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Timeout waiting for error event")
	}
}

func TestTitleDetector_TitleError(t *testing.T) {
	mock := newMockCollector()

	// Add a pane
	if err := mock.addPane("test-repo", "main", "%1", "test"); err != nil {
		t.Fatalf("Failed to add pane: %v", err)
	}

	// Set title error
	mock.titleErr = fmt.Errorf("mock title error")

	detector, err := NewTitleDetector(mock)
	if err != nil {
		t.Fatalf("NewTitleDetector() error = %v", err)
	}
	defer detector.Stop()

	stateCh := detector.Start()

	// Should not emit an event because GetPaneTitle fails
	// But also should not emit an error event (just logged)
	select {
	case event := <-stateCh:
		t.Errorf("Should not emit event when GetPaneTitle fails, got: error=%v paneID=%v state=%v",
			event.Error, event.PaneID, event.State)
	case <-time.After(1 * time.Second):
		// Expected - no event when title fetch fails
	}
}

func TestTitleDetector_Stop(t *testing.T) {
	mock := newMockCollector()

	detector, err := NewTitleDetector(mock)
	if err != nil {
		t.Fatalf("NewTitleDetector() error = %v", err)
	}

	stateCh := detector.Start()

	// Stop should close the channel
	if err := detector.Stop(); err != nil {
		t.Errorf("Stop() error = %v, want nil", err)
	}

	// Verify channel is closed
	select {
	case _, ok := <-stateCh:
		if ok {
			t.Error("State channel should be closed after Stop()")
		}
	case <-time.After(1 * time.Second):
		t.Error("Timeout waiting for channel close")
	}
}

func TestTitleDetector_DoubleStart(t *testing.T) {
	mock := newMockCollector()

	detector, err := NewTitleDetector(mock)
	if err != nil {
		t.Fatalf("NewTitleDetector() error = %v", err)
	}
	defer detector.Stop()

	// Start twice
	ch1 := detector.Start()
	ch2 := detector.Start()

	// Should return the same channel
	if ch1 != ch2 {
		t.Error("Start() called twice should return the same channel")
	}
}

func TestTitleDetector_MultiplePanes(t *testing.T) {
	mock := newMockCollector()

	// Add multiple panes with different states
	if err := mock.addPane("repo1", "main", "%1", "✳ idle pane"); err != nil {
		t.Fatalf("Failed to add pane: %v", err)
	}
	if err := mock.addPane("repo1", "feature", "%2", "working pane"); err != nil {
		t.Fatalf("Failed to add pane: %v", err)
	}
	if err := mock.addPane("repo2", "main", "%3", "✳ another idle"); err != nil {
		t.Fatalf("Failed to add pane: %v", err)
	}

	detector, err := NewTitleDetector(mock)
	if err != nil {
		t.Fatalf("NewTitleDetector() error = %v", err)
	}
	defer detector.Stop()

	stateCh := detector.Start()

	// Collect initial events
	events := make(map[string]State)
	timeout := time.After(2 * time.Second)

	for i := 0; i < 3; i++ {
		select {
		case event := <-stateCh:
			if event.Error != nil {
				t.Fatalf("Received error event: %v", event.Error)
			}
			events[event.PaneID] = event.State
		case <-timeout:
			t.Fatalf("Timeout waiting for event %d/3", i+1)
		}
	}

	// Verify all panes reported correct states
	if events["%1"] != StateIdle {
		t.Errorf("Pane %%1 state = %v, want %v", events["%1"], StateIdle)
	}
	if events["%2"] != StateWorking {
		t.Errorf("Pane %%2 state = %v, want %v", events["%2"], StateWorking)
	}
	if events["%3"] != StateIdle {
		t.Errorf("Pane %%3 state = %v, want %v", events["%3"], StateIdle)
	}
}

// Integration test helper - requires actual tmux.Collector
func TestTitleDetector_Integration(t *testing.T) {
	// Skip if not in tmux or if this is CI
	if _, err := exec.Command("tmux", "display-message", "-p", "#{session_name}").Output(); err != nil {
		t.Skip("Skipping integration test - not in tmux or tmux not available")
	}

	collector, err := tmux.NewCollector()
	if err != nil {
		t.Skipf("Skipping integration test - failed to create collector: %v", err)
	}

	detector, err := NewTitleDetector(collector)
	if err != nil {
		t.Fatalf("NewTitleDetector() error = %v", err)
	}
	defer detector.Stop()

	stateCh := detector.Start()

	// Just verify we can receive some events without errors
	// (actual pane states depend on test environment)
	timeout := time.After(2 * time.Second)
	receivedEvent := false

	for !receivedEvent {
		select {
		case event := <-stateCh:
			if event.Error != nil {
				t.Logf("Received error event (may be expected): %v", event.Error)
			} else {
				t.Logf("Received state event: paneID=%s state=%s", event.PaneID, event.State)
				receivedEvent = true
			}
		case <-timeout:
			// No events is also acceptable - may have no panes
			t.Log("No events received (acceptable for empty session)")
			return
		}
	}
}
