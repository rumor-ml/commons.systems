package watcher

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// mustNewTestAlertWatcher creates an AlertWatcher with an isolated temp directory.
// The caller is responsible for calling Close() on the returned watcher.
func mustNewTestAlertWatcher(t *testing.T) *AlertWatcher {
	t.Helper()
	testDir := t.TempDir()
	watcher, err := NewAlertWatcher(WithAlertDir(testDir))
	if err != nil {
		t.Fatalf("NewAlertWatcher failed: %v", err)
	}
	return watcher
}

// waitForReady blocks until the watcher is ready to receive events.
func waitForReady(t *testing.T, w *AlertWatcher, timeout time.Duration) {
	t.Helper()
	select {
	case <-w.Ready():
		// Ready
	case <-time.After(timeout):
		t.Fatal("Timeout waiting for watcher to become ready")
	}
}

func TestAlertWatcher_CreateFile(t *testing.T) {
	watcher := mustNewTestAlertWatcher(t)
	defer watcher.Close()

	eventCh := watcher.Start()
	waitForReady(t, watcher, 1*time.Second)

	// Create alert file
	testPaneID := "%1"
	alertFile := filepath.Join(watcher.Dir(), alertPrefix+testPaneID)

	// Create the file with explicit event type
	if err := os.WriteFile(alertFile, []byte("stop"), 0644); err != nil {
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
		if event.EventType != EventTypeStop {
			t.Errorf("Expected EventType %s, got %s", EventTypeStop, event.EventType)
		}
	case <-time.After(1 * time.Second):
		t.Fatal("Timeout waiting for create event")
	}
}

func TestAlertWatcher_DeleteFile(t *testing.T) {
	watcher := mustNewTestAlertWatcher(t)
	defer watcher.Close()

	testPaneID := "%2"
	alertFile := filepath.Join(watcher.Dir(), alertPrefix+testPaneID)

	eventCh := watcher.Start()
	waitForReady(t, watcher, 1*time.Second)

	// Create file first (so watcher sees the create event)
	if err := os.WriteFile(alertFile, []byte("permission"), 0644); err != nil {
		t.Fatalf("Failed to create initial alert file: %v", err)
	}

	// Drain the create event
	select {
	case event := <-eventCh:
		if event.PaneID != testPaneID || !event.Created {
			t.Fatalf("Expected create event for pane %s, got %+v", testPaneID, event)
		}
	case <-time.After(1 * time.Second):
		t.Fatal("Timeout waiting for create event")
	}

	// Now delete the file
	if err := os.Remove(alertFile); err != nil {
		t.Fatalf("Failed to remove alert file: %v", err)
	}

	// Wait for delete event
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
	watcher := mustNewTestAlertWatcher(t)
	defer watcher.Close()

	testPaneID := "%3"
	alertFile := filepath.Join(watcher.Dir(), alertPrefix+testPaneID)

	eventCh := watcher.Start()
	waitForReady(t, watcher, 1*time.Second)

	// Rapid create/delete/create cycle
	// Note: fsnotify event ordering can vary, so we verify we receive events
	// for all operations rather than strict ordering

	// Create with stop event type
	if err := os.WriteFile(alertFile, []byte("stop"), 0644); err != nil {
		t.Fatalf("Failed to create alert file: %v", err)
	}

	// Wait for fsnotify to detect the create
	time.Sleep(100 * time.Millisecond)

	// Delete
	if err := os.Remove(alertFile); err != nil {
		t.Fatalf("Failed to remove alert file: %v", err)
	}

	// Wait for fsnotify to detect the delete
	time.Sleep(100 * time.Millisecond)

	// Create again
	if err := os.WriteFile(alertFile, []byte("stop"), 0644); err != nil {
		t.Fatalf("Failed to recreate alert file: %v", err)
	}

	// Collect events - expect at least some events from the operations
	// fsnotify may coalesce or reorder events, so we just verify the watcher works
	createCount := 0
	deleteCount := 0
	timeout := time.After(3 * time.Second)

collectLoop:
	for {
		select {
		case event := <-eventCh:
			if event.PaneID != testPaneID {
				t.Errorf("Expected paneID %s, got %s", testPaneID, event.PaneID)
			}
			t.Logf("Received event: Created=%v, EventType=%s", event.Created, event.EventType)
			if event.Created {
				createCount++
			} else {
				deleteCount++
			}
			// We've seen enough events to verify the watcher works
			if createCount >= 1 && deleteCount >= 1 {
				break collectLoop
			}
		case <-timeout:
			break collectLoop
		}
	}

	// Verify we received at least one create and one delete event
	// This confirms the watcher handles rapid changes without breaking
	if createCount == 0 {
		t.Error("Expected at least one create event")
	}
	if deleteCount == 0 {
		t.Error("Expected at least one delete event")
	}
	t.Logf("Received %d create events and %d delete events", createCount, deleteCount)
}

func TestAlertWatcher_DirectoryNotExist(t *testing.T) {
	// This test verifies that NewAlertWatcher creates the directory if it doesn't exist
	watcher := mustNewTestAlertWatcher(t)
	defer watcher.Close()

	// Verify directory exists
	if _, err := os.Stat(watcher.Dir()); os.IsNotExist(err) {
		t.Error("Alert directory was not created")
	}
}

func TestAlertWatcher_Close(t *testing.T) {
	watcher := mustNewTestAlertWatcher(t)

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
	watcher := mustNewTestAlertWatcher(t)
	defer watcher.Close()

	// Start should be idempotent
	ch1 := watcher.Start()
	ch2 := watcher.Start()

	if ch1 != ch2 {
		t.Error("Multiple Start() calls should return the same channel")
	}
}

func TestGetExistingAlerts(t *testing.T) {
	// Note: GetExistingAlerts uses the hardcoded alertDir constant.
	// This test still uses the production directory since GetExistingAlerts
	// is not yet configurable. This test may still be flaky if other
	// Claude instances are running. A future improvement could make
	// GetExistingAlerts also accept a directory parameter.

	// Clean up first
	pattern := filepath.Join(alertDir, alertPrefix+"*")
	matches, _ := filepath.Glob(pattern)
	for _, file := range matches {
		os.Remove(file)
	}

	// Create some test alert files with different event types
	testPanes := map[string]string{
		"%10": EventTypeStop,
		"%11": EventTypePermission,
		"%12": EventTypeIdle,
	}
	for paneID, eventType := range testPanes {
		alertFile := filepath.Join(alertDir, alertPrefix+paneID)
		if err := os.WriteFile(alertFile, []byte(eventType), 0644); err != nil {
			t.Fatalf("Failed to create test alert file: %v", err)
		}
		defer os.Remove(alertFile)
	}

	// Get existing alerts
	alerts, err := GetExistingAlerts()
	if err != nil {
		t.Fatalf("GetExistingAlerts failed: %v", err)
	}

	// Verify all test panes are present with correct event types
	if len(alerts) < len(testPanes) {
		t.Errorf("Expected at least %d alerts, got %d", len(testPanes), len(alerts))
	}

	for paneID, expectedEventType := range testPanes {
		actualEventType, exists := alerts[paneID]
		if !exists {
			t.Errorf("Expected paneID %s to be in alerts", paneID)
		}
		if actualEventType != expectedEventType {
			t.Errorf("Expected paneID %s to have event type %s, got %s", paneID, expectedEventType, actualEventType)
		}
	}
}

func TestAlertWatcher_EventTypes(t *testing.T) {
	// Test that each event type is correctly read and propagated
	testCases := []struct {
		name      string
		paneID    string
		eventType string
	}{
		{"Stop event", "%100", EventTypeStop},
		{"Permission event", "%101", EventTypePermission},
		{"Idle event", "%102", EventTypeIdle},
		{"Elicitation event", "%103", EventTypeElicitation},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			watcher := mustNewTestAlertWatcher(t)
			defer watcher.Close()

			alertFile := filepath.Join(watcher.Dir(), alertPrefix+tc.paneID)

			eventCh := watcher.Start()
			waitForReady(t, watcher, 1*time.Second)

			// Create the file with specific event type
			if err := os.WriteFile(alertFile, []byte(tc.eventType), 0644); err != nil {
				t.Fatalf("Failed to create alert file: %v", err)
			}

			// Wait for event
			select {
			case event := <-eventCh:
				if event.PaneID != tc.paneID {
					t.Errorf("Expected paneID %s, got %s", tc.paneID, event.PaneID)
				}
				if !event.Created {
					t.Error("Expected Created=true, got false")
				}
				if event.EventType != tc.eventType {
					t.Errorf("Expected EventType %s, got %s", tc.eventType, event.EventType)
				}
			case <-time.After(1 * time.Second):
				t.Fatal("Timeout waiting for create event")
			}
		})
	}
}

func TestAlertWatcher_UnknownEventType(t *testing.T) {
	// Test that unknown event types default to "stop"
	watcher := mustNewTestAlertWatcher(t)
	defer watcher.Close()

	testPaneID := "%104"
	alertFile := filepath.Join(watcher.Dir(), alertPrefix+testPaneID)

	eventCh := watcher.Start()
	waitForReady(t, watcher, 1*time.Second)

	// Create file with unknown event type
	if err := os.WriteFile(alertFile, []byte("unknown_type"), 0644); err != nil {
		t.Fatalf("Failed to create alert file: %v", err)
	}

	// Wait for event
	select {
	case event := <-eventCh:
		if event.PaneID != testPaneID {
			t.Errorf("Expected paneID %s, got %s", testPaneID, event.PaneID)
		}
		if event.EventType != EventTypeStop {
			t.Errorf("Expected EventType to default to %s for unknown type, got %s", EventTypeStop, event.EventType)
		}
	case <-time.After(1 * time.Second):
		t.Fatal("Timeout waiting for create event")
	}
}

func TestAlertWatcher_EmptyEventType(t *testing.T) {
	// Test that empty files default to "stop" event type
	watcher := mustNewTestAlertWatcher(t)
	defer watcher.Close()

	testPaneID := "%105"
	alertFile := filepath.Join(watcher.Dir(), alertPrefix+testPaneID)

	eventCh := watcher.Start()
	waitForReady(t, watcher, 1*time.Second)

	// Create empty file
	if err := os.WriteFile(alertFile, []byte{}, 0644); err != nil {
		t.Fatalf("Failed to create alert file: %v", err)
	}

	// Wait for event - should default to stop after retries
	select {
	case event := <-eventCh:
		if event.PaneID != testPaneID {
			t.Errorf("Expected paneID %s, got %s", testPaneID, event.PaneID)
		}
		if event.EventType != EventTypeStop {
			t.Errorf("Expected EventType to default to %s for empty file, got %s", EventTypeStop, event.EventType)
		}
	case <-time.After(1 * time.Second):
		t.Fatal("Timeout waiting for create event")
	}
}

func TestAlertWatcher_IgnoreNonAlertFiles(t *testing.T) {
	watcher := mustNewTestAlertWatcher(t)
	defer watcher.Close()

	eventCh := watcher.Start()
	waitForReady(t, watcher, 1*time.Second)

	// Create a non-alert file
	nonAlertFile := filepath.Join(watcher.Dir(), "not-an-alert.txt")
	if err := os.WriteFile(nonAlertFile, []byte{}, 0644); err != nil {
		t.Fatalf("Failed to create non-alert file: %v", err)
	}

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
	watcher := mustNewTestAlertWatcher(t)
	defer watcher.Close()

	eventCh := watcher.Start()
	waitForReady(t, watcher, 1*time.Second)

	// Create a test alert file to verify normal operation
	testPaneID := "%4"
	alertFile := filepath.Join(watcher.Dir(), alertPrefix+testPaneID)

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
	watcher := mustNewTestAlertWatcher(t)

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
	watcher := mustNewTestAlertWatcher(t)

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
	watcher := mustNewTestAlertWatcher(t)
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
	watcher := mustNewTestAlertWatcher(t)
	defer watcher.Close()

	eventCh := watcher.Start()
	waitForReady(t, watcher, 1*time.Second)

	// Create 150 files rapidly (exceeds buffer of 100)
	for i := 0; i < 150; i++ {
		paneID := fmt.Sprintf("%%10%d", i)
		alertFile := filepath.Join(watcher.Dir(), alertPrefix+paneID)
		os.WriteFile(alertFile, []byte{}, 0644)
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
	watcher := mustNewTestAlertWatcher(t)
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
	watcher := mustNewTestAlertWatcher(t)
	defer watcher.Close()

	eventCh := watcher.Start()
	waitForReady(t, watcher, 1*time.Second)

	// Create a normal alert file
	testPaneID := "%5"
	alertFile := filepath.Join(watcher.Dir(), alertPrefix+testPaneID)

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

func TestAlertWatcher_BufferOverflowRecovery(t *testing.T) {
	watcher := mustNewTestAlertWatcher(t)
	defer watcher.Close()

	eventCh := watcher.Start()
	waitForReady(t, watcher, 1*time.Second)

	// Create 200 files rapidly (buffer is 100)
	// Without reading from the channel, the buffer will fill up
	// Create files in batches to allow fsnotify to generate events
	for i := 0; i < 200; i++ {
		paneID := fmt.Sprintf("%%20%d", i)
		alertFile := filepath.Join(watcher.Dir(), alertPrefix+paneID)
		os.WriteFile(alertFile, []byte{}, 0644)
		// Small delay to allow fsnotify to generate events
		if i%10 == 0 {
			time.Sleep(5 * time.Millisecond)
		}
	}

	// Wait a bit for all events to be generated
	time.Sleep(100 * time.Millisecond)

	// Now drain channel - if buffer overflowed, we won't get all events
	receivedPanes := make(map[string]bool)
	timeout := time.After(1 * time.Second)

drainLoop:
	for {
		select {
		case event, ok := <-eventCh:
			if !ok {
				break drainLoop
			}
			receivedPanes[event.PaneID] = true
		case <-timeout:
			break drainLoop
		}
	}

	// We should have received some events, possibly all if no overflow
	// The key is that the watcher should still be functional
	t.Logf("Received %d events from 200 file creations", len(receivedPanes))
	if len(receivedPanes) == 0 {
		t.Error("Expected to receive at least some events")
	}

	// Test recovery: watcher should still work after potential overflow
	// Use a unique pane ID that won't conflict with batch (batch uses %20X format)
	recoveryPaneID := "%88888"
	recoveryFile := filepath.Join(watcher.Dir(), alertPrefix+recoveryPaneID)

	os.WriteFile(recoveryFile, []byte("stop"), 0644)

	// Wait for the recovery event, skipping any remaining batch events
	recoveryTimeout := time.After(5 * time.Second)
	foundCreate := false
recoveryLoop:
	for {
		select {
		case event, ok := <-eventCh:
			if !ok {
				break recoveryLoop
			}
			if event.PaneID == recoveryPaneID && event.Created {
				foundCreate = true
				break recoveryLoop
			}
			// Skip other events from the batch
		case <-recoveryTimeout:
			break recoveryLoop
		}
	}

	if !foundCreate {
		t.Error("Watcher failed to deliver recovery event after buffer overflow")
		return
	}

	// Verify continued operation with delete
	os.Remove(recoveryFile)

	// Wait for delete event, skipping any remaining batch events
	deleteTimeout := time.After(5 * time.Second)
	foundDelete := false
deleteLoop:
	for {
		select {
		case event, ok := <-eventCh:
			if !ok {
				break deleteLoop
			}
			if event.PaneID == recoveryPaneID && !event.Created {
				foundDelete = true
				break deleteLoop
			}
			// Skip other events
		case <-deleteTimeout:
			break deleteLoop
		}
	}

	if !foundDelete {
		t.Error("Watcher not processing deletes after recovery")
	}
}
