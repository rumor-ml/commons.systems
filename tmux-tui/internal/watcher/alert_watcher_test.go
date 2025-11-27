package watcher

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAlertWatcher_CreateFile(t *testing.T) {
	// Setup
	watcher, err := NewAlertWatcher()
	if err != nil {
		t.Fatalf("NewAlertWatcher failed: %v", err)
	}
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
	watcher, err := NewAlertWatcher()
	if err != nil {
		t.Fatalf("NewAlertWatcher failed: %v", err)
	}
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
	// Setup
	watcher, err := NewAlertWatcher()
	if err != nil {
		t.Fatalf("NewAlertWatcher failed: %v", err)
	}
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
	// The directory should be created by NewAlertWatcher, so this should always succeed
	watcher, err := NewAlertWatcher()
	if err != nil {
		t.Fatalf("NewAlertWatcher failed even though it should create the directory: %v", err)
	}
	defer watcher.Close()

	// Verify directory exists
	if _, err := os.Stat(alertDir); os.IsNotExist(err) {
		t.Error("Alert directory was not created")
	}
}

func TestAlertWatcher_Close(t *testing.T) {
	watcher, err := NewAlertWatcher()
	if err != nil {
		t.Fatalf("NewAlertWatcher failed: %v", err)
	}

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
	watcher, err := NewAlertWatcher()
	if err != nil {
		t.Fatalf("NewAlertWatcher failed: %v", err)
	}
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
	alerts := GetExistingAlerts()

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
	watcher, err := NewAlertWatcher()
	if err != nil {
		t.Fatalf("NewAlertWatcher failed: %v", err)
	}
	defer watcher.Close()

	eventCh := watcher.Start()

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
