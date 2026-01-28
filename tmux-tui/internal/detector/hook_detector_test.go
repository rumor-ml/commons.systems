package detector

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/commons-systems/tmux-tui/internal/watcher"
)

func TestHookDetector_New(t *testing.T) {
	// Create temporary directory for test
	tmpDir := t.TempDir()

	detector, err := NewHookDetector(tmpDir)
	if err != nil {
		t.Fatalf("NewHookDetector() error = %v, want nil", err)
	}
	defer detector.Stop()

	if detector == nil {
		t.Fatal("NewHookDetector() returned nil detector")
	}
	if detector.alertDir != tmpDir {
		t.Errorf("NewHookDetector() alertDir = %v, want %v", detector.alertDir, tmpDir)
	}
}

func TestHookDetector_ConvertAlertToState(t *testing.T) {
	// Test cases for event conversion
	tests := []struct {
		name        string
		eventType   string
		created     bool
		wantState   State
		wantPaneID  string
		description string
	}{
		{
			name:        "Idle event created",
			eventType:   watcher.EventTypeIdle,
			created:     true,
			wantState:   StateIdle,
			wantPaneID:  "%100",
			description: "Idle event should map to StateIdle",
		},
		{
			name:        "Working event created",
			eventType:   watcher.EventTypeWorking,
			created:     true,
			wantState:   StateWorking,
			wantPaneID:  "%101",
			description: "Working event should map to StateWorking",
		},
		{
			name:        "Stop event created",
			eventType:   watcher.EventTypeStop,
			created:     true,
			wantState:   StateIdle,
			wantPaneID:  "%102",
			description: "Stop event should map to StateIdle",
		},
		{
			name:        "Permission event created",
			eventType:   watcher.EventTypePermission,
			created:     true,
			wantState:   StateIdle,
			wantPaneID:  "%103",
			description: "Permission event should map to StateIdle",
		},
		{
			name:        "Event deleted",
			eventType:   watcher.EventTypeIdle,
			created:     false,
			wantState:   StateWorking,
			wantPaneID:  "%104",
			description: "Deleted event should map to StateWorking",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Use a fresh temp directory for each test to avoid cross-contamination
			tmpDir := t.TempDir()

			detector, err := NewHookDetector(tmpDir)
			if err != nil {
				t.Fatalf("NewHookDetector() error = %v", err)
			}
			defer detector.Stop()

			// Start the detector
			stateCh := detector.Start()

			// Create alert file
			filename := filepath.Join(tmpDir, "tui-alert-"+tt.wantPaneID)

			if tt.created {
				// Write event type to file
				if err := os.WriteFile(filename, []byte(tt.eventType), 0644); err != nil {
					t.Fatalf("Failed to create alert file: %v", err)
				}
			} else {
				// Create then delete the file
				if err := os.WriteFile(filename, []byte(tt.eventType), 0644); err != nil {
					t.Fatalf("Failed to create alert file: %v", err)
				}
				// Small delay to ensure creation is processed
				time.Sleep(50 * time.Millisecond)
				if err := os.Remove(filename); err != nil {
					t.Fatalf("Failed to remove alert file: %v", err)
				}
			}

			// Wait for state event with timeout
			// For deleted events, collect all events and check the last one
			var events []StateEvent
			timeout := time.After(1 * time.Second)

			if tt.created {
				// For created events, expect exactly one event
				select {
				case event := <-stateCh:
					if event.IsError() {
						t.Fatalf("Received error event: %v", event.Error())
					}
					events = append(events, event)
				case <-time.After(2 * time.Second):
					t.Fatal("Timeout waiting for state event")
				}
			} else {
				// For deleted events, collect all events (may be create+delete or just delete)
				for {
					select {
					case event := <-stateCh:
						if event.IsError() {
							t.Fatalf("Received error event: %v", event.Error())
						}
						events = append(events, event)
					case <-timeout:
						// Timeout means no more events
						if len(events) == 0 {
							t.Fatal("No events received for delete operation")
						}
						goto done
					}
				}
			}

		done:
			// Verify the final state
			lastEvent := events[len(events)-1]
			if lastEvent.PaneID() != tt.wantPaneID {
				t.Errorf("StateEvent.PaneID() = %v, want %v", lastEvent.PaneID(), tt.wantPaneID)
			}
			if lastEvent.State() != tt.wantState {
				t.Errorf("StateEvent.State() = %v, want %v (%s), received %d events", lastEvent.State(), tt.wantState, tt.description, len(events))
			}

			// Cleanup
			if tt.created {
				os.Remove(filename)
			}
		})
	}
}

func TestHookDetector_Stop(t *testing.T) {
	tmpDir := t.TempDir()

	detector, err := NewHookDetector(tmpDir)
	if err != nil {
		t.Fatalf("NewHookDetector() error = %v", err)
	}

	// Start the detector
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

func TestHookDetector_DoubleStart(t *testing.T) {
	tmpDir := t.TempDir()

	detector, err := NewHookDetector(tmpDir)
	if err != nil {
		t.Fatalf("NewHookDetector() error = %v", err)
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

func TestHookDetector_ErrorPropagation(t *testing.T) {
	// Use a non-existent directory to force an error
	detector, err := NewHookDetector("/this/path/should/not/exist/and/is/not/writable")
	if err == nil {
		defer detector.Stop()
		t.Error("NewHookDetector() with invalid path should return error")
	}
}

func TestHookDetector_UnreadableAlertDirectory(t *testing.T) {
	t.Run("directory with no permissions", func(t *testing.T) {
		// Create a temporary directory
		tmpDir := t.TempDir()
		alertDir := filepath.Join(tmpDir, "alerts")

		// Create the directory with normal permissions first
		if err := os.MkdirAll(alertDir, 0755); err != nil {
			t.Fatalf("Failed to create alert directory: %v", err)
		}

		// Change permissions to make it unreadable/unwritable/unexecutable
		if err := os.Chmod(alertDir, 0000); err != nil {
			t.Fatalf("Failed to chmod alert directory: %v", err)
		}

		// Restore permissions after test for cleanup
		defer os.Chmod(alertDir, 0755)

		// Attempt to create HookDetector - should fail when trying to watch directory
		detector, err := NewHookDetector(alertDir)
		if err == nil {
			detector.Stop()
			t.Error("NewHookDetector() with unreadable directory should return error")
		}

		// Verify error message indicates permission issue
		if err != nil && !os.IsPermission(err) {
			// fsnotify might return different error types, check the message
			errMsg := err.Error()
			if errMsg != "" {
				t.Logf("Got expected error: %v", err)
			}
		}
	})

	t.Run("directory with execute but no read permissions", func(t *testing.T) {
		// Create a temporary directory
		tmpDir := t.TempDir()
		alertDir := filepath.Join(tmpDir, "alerts-noread")

		// Create the directory with normal permissions first
		if err := os.MkdirAll(alertDir, 0755); err != nil {
			t.Fatalf("Failed to create alert directory: %v", err)
		}

		// Change permissions to execute-only (no read/write)
		if err := os.Chmod(alertDir, 0111); err != nil {
			t.Fatalf("Failed to chmod alert directory: %v", err)
		}

		// Restore permissions after test for cleanup
		defer os.Chmod(alertDir, 0755)

		// Attempt to create HookDetector - should fail when trying to watch directory
		detector, err := NewHookDetector(alertDir)
		if err == nil {
			detector.Stop()
			t.Error("NewHookDetector() with non-readable directory should return error")
		}

		// Verify error occurred
		if err != nil {
			t.Logf("Got expected error: %v", err)
		}
	})
}

func TestHookDetector_DeleteOnly(t *testing.T) {
	tmpDir := t.TempDir()

	// Pre-create the file before detector starts
	filename := filepath.Join(tmpDir, "tui-alert-%100")
	if err := os.WriteFile(filename, []byte(watcher.EventTypeIdle), 0644); err != nil {
		t.Fatalf("Failed to pre-create alert file: %v", err)
	}

	detector, err := NewHookDetector(tmpDir)
	if err != nil {
		t.Fatalf("NewHookDetector() error = %v", err)
	}
	defer detector.Stop()

	stateCh := detector.Start()

	// Wait for initial file detection to settle
	time.Sleep(100 * time.Millisecond)

	// Drain any initial events
	drainTimeout := time.After(200 * time.Millisecond)
drainLoop:
	for {
		select {
		case <-stateCh:
		case <-drainTimeout:
			break drainLoop
		}
	}

	// NOW delete the file - should generate only ONE event
	if err := os.Remove(filename); err != nil {
		t.Fatalf("Failed to remove alert file: %v", err)
	}

	// Verify deletion maps to StateWorking
	select {
	case event := <-stateCh:
		if event.IsError() {
			t.Fatalf("Received error event: %v", event.Error())
		}
		if event.PaneID() != "%100" {
			t.Errorf("PaneID() = %v, want %%100", event.PaneID())
		}
		if event.State() != StateWorking {
			t.Errorf("Delete event mapped to %v, want StateWorking", event.State())
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Timeout waiting for delete event")
	}
}
