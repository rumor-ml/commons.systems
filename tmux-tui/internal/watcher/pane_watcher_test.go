package watcher

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// mustNewTestPaneFocusWatcher creates a PaneFocusWatcher with an isolated temp directory.
// The caller is responsible for calling Close() on the returned watcher.
func mustNewTestPaneFocusWatcher(t *testing.T) *PaneFocusWatcher {
	t.Helper()
	testDir := t.TempDir()
	watcher, err := NewPaneFocusWatcher(WithPaneFocusDir(testDir))
	if err != nil {
		t.Fatalf("NewPaneFocusWatcher failed: %v", err)
	}
	return watcher
}

// waitForPaneFocusReady blocks until the watcher is ready to receive events.
func waitForPaneFocusReady(t *testing.T, w *PaneFocusWatcher, timeout time.Duration) {
	t.Helper()
	select {
	case <-w.Ready():
		// Ready
	case <-time.After(timeout):
		t.Fatal("Timeout waiting for watcher to become ready")
	}
}

func TestPaneFocusWatcher_CreateFile(t *testing.T) {
	watcher := mustNewTestPaneFocusWatcher(t)
	defer watcher.Close()

	eventCh := watcher.Start()
	waitForPaneFocusReady(t, watcher, 1*time.Second)

	// Create pane-focus file with a valid pane ID
	testPaneID := "%123"
	if err := os.WriteFile(watcher.FilePath(), []byte(testPaneID), 0644); err != nil {
		t.Fatalf("Failed to create pane-focus file: %v", err)
	}

	// Wait for event (with debounce)
	select {
	case event := <-eventCh:
		if event.Error != nil {
			t.Fatalf("Received error event: %v", event.Error)
		}
		if event.PaneID != testPaneID {
			t.Errorf("Expected paneID %s, got %s", testPaneID, event.PaneID)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("Timeout waiting for pane focus event")
	}
}

func TestPaneFocusWatcher_UpdateFile(t *testing.T) {
	watcher := mustNewTestPaneFocusWatcher(t)
	defer watcher.Close()

	eventCh := watcher.Start()
	waitForPaneFocusReady(t, watcher, 1*time.Second)

	// Create pane-focus file with first pane ID
	firstPaneID := "%100"
	if err := os.WriteFile(watcher.FilePath(), []byte(firstPaneID), 0644); err != nil {
		t.Fatalf("Failed to create pane-focus file: %v", err)
	}

	// Wait for first event
	select {
	case event := <-eventCh:
		if event.Error != nil {
			t.Fatalf("Received error event: %v", event.Error)
		}
		if event.PaneID != firstPaneID {
			t.Errorf("Expected paneID %s, got %s", firstPaneID, event.PaneID)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("Timeout waiting for first pane focus event")
	}

	// Update file with second pane ID
	secondPaneID := "%200"
	if err := os.WriteFile(watcher.FilePath(), []byte(secondPaneID), 0644); err != nil {
		t.Fatalf("Failed to update pane-focus file: %v", err)
	}

	// Wait for second event
	select {
	case event := <-eventCh:
		if event.Error != nil {
			t.Fatalf("Received error event: %v", event.Error)
		}
		if event.PaneID != secondPaneID {
			t.Errorf("Expected paneID %s, got %s", secondPaneID, event.PaneID)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("Timeout waiting for second pane focus event")
	}
}

func TestPaneFocusWatcher_InvalidPaneID(t *testing.T) {
	watcher := mustNewTestPaneFocusWatcher(t)
	defer watcher.Close()

	eventCh := watcher.Start()
	waitForPaneFocusReady(t, watcher, 1*time.Second)

	// Create pane-focus file with invalid pane ID (not starting with %)
	invalidPaneID := "123"
	if err := os.WriteFile(watcher.FilePath(), []byte(invalidPaneID), 0644); err != nil {
		t.Fatalf("Failed to create pane-focus file: %v", err)
	}

	// Wait for error event
	select {
	case event := <-eventCh:
		if event.Error == nil {
			t.Error("Expected error event for invalid pane ID, got normal event")
		}
		if event.PaneID != "" {
			t.Errorf("Expected empty paneID for error event, got %s", event.PaneID)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("Timeout waiting for error event")
	}
}

func TestPaneFocusWatcher_Debouncing(t *testing.T) {
	// Use a longer debounce period for testing
	testDebounce := 100 * time.Millisecond
	testDir := t.TempDir()
	watcher, err := NewPaneFocusWatcher(
		WithPaneFocusDir(testDir),
		WithDebounce(testDebounce),
	)
	if err != nil {
		t.Fatalf("NewPaneFocusWatcher failed: %v", err)
	}
	defer watcher.Close()

	eventCh := watcher.Start()
	waitForPaneFocusReady(t, watcher, 1*time.Second)

	// Write multiple rapid updates
	paneIDs := []string{"%1", "%2", "%3", "%4", "%5"}
	for _, paneID := range paneIDs {
		if err := os.WriteFile(watcher.FilePath(), []byte(paneID), 0644); err != nil {
			t.Fatalf("Failed to write pane-focus file: %v", err)
		}
		time.Sleep(10 * time.Millisecond) // Much shorter than debounce period
	}

	// Should only get one event (the last one) after debounce period
	lastPaneID := paneIDs[len(paneIDs)-1]

	select {
	case event := <-eventCh:
		if event.Error != nil {
			t.Fatalf("Received error event: %v", event.Error)
		}
		if event.PaneID != lastPaneID {
			t.Errorf("Expected paneID %s (last write), got %s", lastPaneID, event.PaneID)
		}
	case <-time.After(testDebounce + 100*time.Millisecond):
		t.Fatal("Timeout waiting for debounced event")
	}

	// Should not get any more events
	select {
	case event := <-eventCh:
		t.Errorf("Received unexpected additional event: %+v", event)
	case <-time.After(100 * time.Millisecond):
		// Expected - no additional events
	}
}

func TestPaneFocusWatcher_DuplicateIgnored(t *testing.T) {
	watcher := mustNewTestPaneFocusWatcher(t)
	defer watcher.Close()

	eventCh := watcher.Start()
	waitForPaneFocusReady(t, watcher, 1*time.Second)

	// Write same pane ID twice
	testPaneID := "%999"
	if err := os.WriteFile(watcher.FilePath(), []byte(testPaneID), 0644); err != nil {
		t.Fatalf("Failed to create pane-focus file: %v", err)
	}

	// Wait for first event
	select {
	case event := <-eventCh:
		if event.Error != nil {
			t.Fatalf("Received error event: %v", event.Error)
		}
		if event.PaneID != testPaneID {
			t.Errorf("Expected paneID %s, got %s", testPaneID, event.PaneID)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("Timeout waiting for first event")
	}

	// Write same pane ID again
	if err := os.WriteFile(watcher.FilePath(), []byte(testPaneID), 0644); err != nil {
		t.Fatalf("Failed to write pane-focus file again: %v", err)
	}

	// Should NOT get another event (duplicate ignored)
	select {
	case event := <-eventCh:
		t.Errorf("Received unexpected event for duplicate pane ID: %+v", event)
	case <-time.After(200 * time.Millisecond):
		// Expected - no event for duplicate
	}
}

func TestPaneFocusWatcher_Close(t *testing.T) {
	watcher := mustNewTestPaneFocusWatcher(t)

	eventCh := watcher.Start()

	// Close the watcher
	if err := watcher.Close(); err != nil {
		t.Errorf("Close failed: %v", err)
	}

	// Verify channel is closed
	select {
	case _, ok := <-eventCh:
		if ok {
			t.Error("Event channel should be closed")
		}
	case <-time.After(1 * time.Second):
		t.Error("Event channel was not closed")
	}

	// Calling Close again should be safe
	if err := watcher.Close(); err != nil {
		t.Errorf("Second Close failed: %v", err)
	}
}

func TestPaneFocusWatcher_MultipleStarts(t *testing.T) {
	watcher := mustNewTestPaneFocusWatcher(t)
	defer watcher.Close()

	// Start should be idempotent
	ch1 := watcher.Start()
	ch2 := watcher.Start()

	if ch1 != ch2 {
		t.Error("Multiple Start() calls should return the same channel")
	}
}

func TestPaneFocusWatcher_CloseBeforeStart(t *testing.T) {
	watcher := mustNewTestPaneFocusWatcher(t)

	// Call Close() without calling Start()
	if err := watcher.Close(); err != nil {
		t.Errorf("Close failed when called before Start: %v", err)
	}

	// Optionally verify Start() after Close() is handled gracefully
	eventCh := watcher.Start()

	// The channel should be closed or not receive events
	select {
	case _, ok := <-eventCh:
		if ok {
			t.Error("Expected channel to be closed after Close() was called before Start()")
		}
	case <-time.After(100 * time.Millisecond):
		// Also acceptable - channel may not send anything
	}

	t.Log("Close() before Start() handled gracefully")
}

func TestPaneFocusWatcher_DirectoryCreation(t *testing.T) {
	// This test verifies that NewPaneFocusWatcher creates the directory if it doesn't exist
	watcher := mustNewTestPaneFocusWatcher(t)
	defer watcher.Close()

	// Verify directory exists
	dir := filepath.Dir(watcher.FilePath())
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		t.Error("Pane focus directory was not created")
	}
}

func TestPaneFocusWatcher_IgnoreOtherFiles(t *testing.T) {
	watcher := mustNewTestPaneFocusWatcher(t)
	defer watcher.Close()

	eventCh := watcher.Start()
	waitForPaneFocusReady(t, watcher, 1*time.Second)

	// Create a different file in the same directory
	dir := filepath.Dir(watcher.FilePath())
	otherFile := filepath.Join(dir, "other-file.txt")
	if err := os.WriteFile(otherFile, []byte("%123"), 0644); err != nil {
		t.Fatalf("Failed to create other file: %v", err)
	}

	// Should not receive any events
	select {
	case event := <-eventCh:
		t.Errorf("Received unexpected event for other file: %+v", event)
	case <-time.After(200 * time.Millisecond):
		// Expected - no event should be sent
	}
}

func TestPaneFocusWatcher_EmptyFile(t *testing.T) {
	watcher := mustNewTestPaneFocusWatcher(t)
	defer watcher.Close()

	eventCh := watcher.Start()
	waitForPaneFocusReady(t, watcher, 1*time.Second)

	// Create empty pane-focus file
	if err := os.WriteFile(watcher.FilePath(), []byte{}, 0644); err != nil {
		t.Fatalf("Failed to create empty pane-focus file: %v", err)
	}

	// Should get an error event (after retries)
	select {
	case event := <-eventCh:
		if event.Error == nil {
			t.Error("Expected error event for empty file, got normal event")
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("Timeout waiting for error event")
	}
}
