package watcher

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// mustNewAlertWatcher creates an AlertWatcher and fails the test if creation fails.
// The caller is responsible for calling Close() on the returned watcher.
func mustNewAlertWatcher(t *testing.T) *AlertWatcher {
	t.Helper()
	watcher, err := NewAlertWatcher()
	if err != nil {
		t.Fatalf("NewAlertWatcher failed: %v", err)
	}
	return watcher
}

func TestAlertWatcher_CreateFile(t *testing.T) {
	watcher := mustNewAlertWatcher(t)
	defer watcher.Close()

	eventCh := watcher.Start()

	// Create alert file
	testPaneID := "%1"
	alertFile := filepath.Join(alertDir, alertPrefix+testPaneID)

	// Clean up any existing file
	os.Remove(alertFile)
	defer os.Remove(alertFile)

	// Create the file
	if err := os.WriteFile(alertFile, []byte{}, 0644); err != nil {
		t.Fatalf("Failed to create alert file: %v", err)
	}

	// Wait for event
	select {
	case event := <-eventCh:
		if event.PaneID != testPaneID {
			t.Errorf("Expected paneID %s, got %s", testPaneID, event.PaneID)
		}
		if !event.Created {
			t.Error("Expected Created=true, got false")
		}
	case <-time.After(1 * time.Second):
		t.Fatal("Timeout waiting for create event")
	}
}

func TestAlertWatcher_DeleteFile(t *testing.T) {
	// Setup - create file first
	testPaneID := "%2"
	alertFile := filepath.Join(alertDir, alertPrefix+testPaneID)

	if err := os.WriteFile(alertFile, []byte{}, 0644); err != nil {
		t.Fatalf("Failed to create initial alert file: %v", err)
	}

	// Start watcher after file exists
	watcher := mustNewAlertWatcher(t)
	defer watcher.Close()

	eventCh := watcher.Start()

	// Small delay to ensure watcher is ready
	time.Sleep(100 * time.Millisecond)

	// Delete the file
	if err := os.Remove(alertFile); err != nil {
		t.Fatalf("Failed to remove alert file: %v", err)
	}

	// Wait for event
	select {
	case event := <-eventCh:
		if event.PaneID != testPaneID {
			t.Errorf("Expected paneID %s, got %s", testPaneID, event.PaneID)
		}
		if event.Created {
			t.Error("Expected Created=false, got true")
		}
	case <-time.After(1 * time.Second):
		t.Fatal("Timeout waiting for delete event")
	}
}

func TestAlertWatcher_RapidChanges(t *testing.T) {
	watcher := mustNewAlertWatcher(t)
	defer watcher.Close()

	eventCh := watcher.Start()

	testPaneID := "%3"
	alertFile := filepath.Join(alertDir, alertPrefix+testPaneID)
	defer os.Remove(alertFile)

	// Rapid create/delete/create cycle
	events := []bool{}

	// Create
	if err := os.WriteFile(alertFile, []byte{}, 0644); err != nil {
		t.Fatalf("Failed to create alert file: %v", err)
	}

	// Delete
	time.Sleep(10 * time.Millisecond)
	if err := os.Remove(alertFile); err != nil {
		t.Fatalf("Failed to remove alert file: %v", err)
	}

	// Create again
	time.Sleep(10 * time.Millisecond)
	if err := os.WriteFile(alertFile, []byte{}, 0644); err != nil {
		t.Fatalf("Failed to recreate alert file: %v", err)
	}

	// Collect events (should see 3: create, delete, create)
	timeout := time.After(2 * time.Second)
	for len(events) < 3 {
		select {
		case event := <-eventCh:
			if event.PaneID != testPaneID {
				t.Errorf("Expected paneID %s, got %s", testPaneID, event.PaneID)
			}
			events = append(events, event.Created)
		case <-timeout:
			t.Fatalf("Timeout waiting for events, got %d/3", len(events))
		}
	}

	// Verify sequence: true, false, true
	if len(events) != 3 {
		t.Fatalf("Expected 3 events, got %d", len(events))
	}
	if !events[0] {
		t.Error("First event should be Created=true")
	}
	if events[1] {
		t.Error("Second event should be Created=false")
	}
	if !events[2] {
		t.Error("Third event should be Created=true")
	}
}

func TestAlertWatcher_DirectoryNotExist(t *testing.T) {
	// This test verifies that NewAlertWatcher creates the directory if it doesn't exist
	watcher := mustNewAlertWatcher(t)
	defer watcher.Close()

	// Verify directory exists
	if _, err := os.Stat(alertDir); os.IsNotExist(err) {
		t.Error("Alert directory was not created")
	}
}

func TestAlertWatcher_Close(t *testing.T) {
	watcher := mustNewAlertWatcher(t)

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

func TestAlertWatcher_MultipleStarts(t *testing.T) {
	watcher := mustNewAlertWatcher(t)
	defer watcher.Close()

	// Start should be idempotent
	ch1 := watcher.Start()
	ch2 := watcher.Start()

	if ch1 != ch2 {
		t.Error("Multiple Start() calls should return the same channel")
	}
}

func TestGetExistingAlerts(t *testing.T) {
	// Clean up first
	pattern := filepath.Join(alertDir, alertPrefix+"*")
	matches, _ := filepath.Glob(pattern)
	for _, file := range matches {
		os.Remove(file)
	}

	// Create some test alert files
	testPanes := []string{"%10", "%11", "%12"}
	for _, paneID := range testPanes {
		alertFile := filepath.Join(alertDir, alertPrefix+paneID)
		if err := os.WriteFile(alertFile, []byte{}, 0644); err != nil {
			t.Fatalf("Failed to create test alert file: %v", err)
		}
		defer os.Remove(alertFile)
	}

	// Get existing alerts
	alerts, err := GetExistingAlerts()
	if err != nil {
		t.Fatalf("GetExistingAlerts failed: %v", err)
	}

	// Verify all test panes are present
	if len(alerts) != len(testPanes) {
		t.Errorf("Expected %d alerts, got %d", len(testPanes), len(alerts))
	}

	for _, paneID := range testPanes {
		if !alerts[paneID] {
			t.Errorf("Expected paneID %s to be in alerts", paneID)
		}
	}
}

func TestAlertWatcher_IgnoreNonAlertFiles(t *testing.T) {
	// Clean up any stale alert files first
	pattern := filepath.Join(alertDir, alertPrefix+"*")
	matches, _ := filepath.Glob(pattern)
	for _, file := range matches {
		os.Remove(file)
	}

	watcher := mustNewAlertWatcher(t)
	defer watcher.Close()

	eventCh := watcher.Start()

	// Small delay to ensure watcher is ready
	time.Sleep(100 * time.Millisecond)

	// Create a non-alert file
	nonAlertFile := filepath.Join(alertDir, "not-an-alert.txt")
	if err := os.WriteFile(nonAlertFile, []byte{}, 0644); err != nil {
		t.Fatalf("Failed to create non-alert file: %v", err)
	}
	defer os.Remove(nonAlertFile)

	// Should not receive any events
	select {
	case event := <-eventCh:
		t.Errorf("Received unexpected event for non-alert file: %+v", event)
	case <-time.After(200 * time.Millisecond):
		// Expected - no event should be sent
	}
}

func TestAlertWatcher_ErrorRecovery(t *testing.T) {
	// This test verifies that the watcher continues operating after fsnotify errors
	// by testing that events are still received after the watcher encounters errors
	watcher := mustNewAlertWatcher(t)
	defer watcher.Close()

	eventCh := watcher.Start()

	// Create a test alert file to verify normal operation
	testPaneID := "%error-test"
	alertFile := filepath.Join(alertDir, alertPrefix+testPaneID)
	defer os.Remove(alertFile)

	if err := os.WriteFile(alertFile, []byte{}, 0644); err != nil {
		t.Fatalf("Failed to create alert file: %v", err)
	}

	// Wait for the create event
	select {
	case event := <-eventCh:
		if event.PaneID != testPaneID {
			t.Errorf("Expected paneID %s, got %s", testPaneID, event.PaneID)
		}
		if !event.Created {
			t.Error("Expected Created=true, got false")
		}
	case <-time.After(1 * time.Second):
		t.Fatal("Timeout waiting for create event")
	}

	// Note: It's difficult to reliably trigger fsnotify errors in a test environment
	// The main verification is that after the watcher logs errors (which we added in 1.2),
	// it continues to function. We verify this by creating another event.

	// Delete the file
	if err := os.Remove(alertFile); err != nil {
		t.Fatalf("Failed to remove alert file: %v", err)
	}

	// Wait for delete event to verify watcher is still functioning
	select {
	case event := <-eventCh:
		if event.PaneID != testPaneID {
			t.Errorf("Expected paneID %s, got %s", testPaneID, event.PaneID)
		}
		if event.Created {
			t.Error("Expected Created=false, got true")
		}
	case <-time.After(1 * time.Second):
		t.Fatal("Timeout waiting for delete event - watcher may have stopped after error")
	}

	// Create the file again to ensure watcher is still responsive
	if err := os.WriteFile(alertFile, []byte{}, 0644); err != nil {
		t.Fatalf("Failed to recreate alert file: %v", err)
	}

	select {
	case event := <-eventCh:
		if event.PaneID != testPaneID {
			t.Errorf("Expected paneID %s, got %s", testPaneID, event.PaneID)
		}
		if !event.Created {
			t.Error("Expected Created=true, got false")
		}
	case <-time.After(1 * time.Second):
		t.Fatal("Timeout waiting for second create event")
	}
}

func TestAlertWatcher_CloseBeforeStart(t *testing.T) {
	// This test verifies that Close() works correctly before Start() is called
	watcher := mustNewAlertWatcher(t)

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

func TestAlertWatcher_CloseWhileBlocking(t *testing.T) {
	// This test verifies that Close() cleanly unblocks channel reads
	watcher := mustNewAlertWatcher(t)

	eventCh := watcher.Start()

	// Start a goroutine that blocks on reading
	readDone := make(chan bool)
	var receivedEvent AlertEvent
	var channelOpen bool

	go func() {
		receivedEvent, channelOpen = <-eventCh
		close(readDone)
	}()

	// Give the goroutine time to start blocking
	time.Sleep(100 * time.Millisecond)

	// Close while the goroutine is blocking on the channel
	if err := watcher.Close(); err != nil {
		t.Fatalf("Close failed: %v", err)
	}

	// Verify the reader unblocked
	select {
	case <-readDone:
		// Success - reader unblocked
		if channelOpen {
			t.Error("Channel should be closed, but received an event")
		}
		if receivedEvent.PaneID != "" {
			t.Errorf("Event should be zero value on channel closure, got PaneID=%s", receivedEvent.PaneID)
		}
	case <-time.After(1 * time.Second):
		t.Fatal("Reader did not unblock after Close() - potential goroutine leak")
	}

	t.Log("Close() successfully unblocked channel read without goroutine leak")
}

func TestAlertWatcher_ConcurrentClose(t *testing.T) {
	watcher := mustNewAlertWatcher(t)
	_ = watcher.Start()

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = watcher.Close()
		}()
	}
	wg.Wait()
}

func TestAlertWatcher_BufferOverflow(t *testing.T) {
	watcher := mustNewAlertWatcher(t)
	defer watcher.Close()

	eventCh := watcher.Start()

	// Create 150 files rapidly (exceeds buffer of 100)
	for i := 0; i < 150; i++ {
		paneID := fmt.Sprintf("%%buffer%d", i)
		alertFile := filepath.Join(alertDir, alertPrefix+paneID)
		os.WriteFile(alertFile, []byte{}, 0644)
		defer os.Remove(alertFile)
		time.Sleep(1 * time.Millisecond)
	}

	// Verify can read events without deadlock
	receivedCount := 0
	timeout := time.After(3 * time.Second)
	for {
		select {
		case _, ok := <-eventCh:
			if !ok {
				t.Fatal("Channel closed unexpectedly")
			}
			receivedCount++
			if receivedCount >= 100 {
				return // Success
			}
		case <-timeout:
			t.Fatalf("Only received %d events", receivedCount)
		}
	}
}

func TestAlertWatcher_ErrorChannelClosure(t *testing.T) {
	watcher := mustNewAlertWatcher(t)
	eventCh := watcher.Start()

	// Close watcher (closes error channel internally)
	if err := watcher.Close(); err != nil {
		t.Fatalf("Close failed: %v", err)
	}

	// Verify event channel closes (watch goroutine exited)
	select {
	case _, ok := <-eventCh:
		if ok {
			t.Error("Event channel should be closed")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Event channel not closed - goroutine leak")
	}
}

func TestAlertWatcher_ErrorEventPropagation(t *testing.T) {
	// This test verifies that normal alert events have nil Error field
	// and that the PaneID is correctly extracted
	watcher := mustNewAlertWatcher(t)
	defer watcher.Close()

	eventCh := watcher.Start()

	// Create a normal alert file
	testPaneID := "%error-prop-test"
	alertFile := filepath.Join(alertDir, alertPrefix+testPaneID)
	defer os.Remove(alertFile)

	if err := os.WriteFile(alertFile, []byte{}, 0644); err != nil {
		t.Fatalf("Failed to create alert file: %v", err)
	}

	// Wait for the create event
	select {
	case event := <-eventCh:
		// Verify the event has nil Error field for normal events
		if event.Error != nil {
			t.Errorf("Expected Error to be nil for normal event, got: %v", event.Error)
		}
		// Verify PaneID is correct
		if event.PaneID != testPaneID {
			t.Errorf("Expected paneID %s, got %s", testPaneID, event.PaneID)
		}
		// Verify Created flag
		if !event.Created {
			t.Error("Expected Created=true, got false")
		}
	case <-time.After(1 * time.Second):
		t.Fatal("Timeout waiting for create event")
	}
}
