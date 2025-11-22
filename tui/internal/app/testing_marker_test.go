package app

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

func TestCheckTestingMarker(t *testing.T) {
	// Create test marker directory
	testMarkerDir := filepath.Join(os.TempDir(), "tui-marker-test")
	os.MkdirAll(testMarkerDir, 0755)
	defer os.RemoveAll(testMarkerDir)

	// Get current process PID
	currentPID := os.Getpid()

	t.Run("no marker file returns empty message", func(t *testing.T) {
		// Ensure no marker file exists
		markerPath := filepath.Join(testMarkerDir, fmt.Sprintf("mark-testing-request-%d", currentPID))
		os.Remove(markerPath)

		msg := checkTestingMarker()

		// Should return TestingMarkerCheckMsg (empty/ticker message)
		if _, ok := msg.(TestingMarkerCheckMsg); !ok {
			t.Errorf("Expected TestingMarkerCheckMsg, got %T", msg)
		}
	})

	t.Run("marker with matching PID is processed", func(t *testing.T) {
		markerPath := filepath.Join(markerDir, fmt.Sprintf("mark-testing-request-%d", currentPID))
		os.MkdirAll(markerDir, 0755)
		defer os.Remove(markerPath)

		// Create marker with session:window format
		markerContent := "test-session:5"
		err := os.WriteFile(markerPath, []byte(markerContent), 0644)
		if err != nil {
			t.Fatalf("Failed to create test marker: %v", err)
		}

		msg := checkTestingMarker()

		// Should return MarkProjectTestingMsg
		markMsg, ok := msg.(MarkProjectTestingMsg)
		if !ok {
			t.Fatalf("Expected MarkProjectTestingMsg, got %T", msg)
		}

		if markMsg.SessionName != "test-session" {
			t.Errorf("Expected session 'test-session', got '%s'", markMsg.SessionName)
		}

		if markMsg.WindowIndex != 5 {
			t.Errorf("Expected window 5, got %d", markMsg.WindowIndex)
		}

		// Marker file should be deleted after processing
		if _, err := os.Stat(markerPath); !os.IsNotExist(err) {
			t.Error("Marker file should be deleted after processing")
		}
	})

	t.Run("marker with non-matching PID is ignored", func(t *testing.T) {
		// Create marker for different PID
		differentPID := currentPID + 99999
		markerPath := filepath.Join(markerDir, fmt.Sprintf("mark-testing-request-%d", differentPID))
		os.MkdirAll(markerDir, 0755)
		defer os.Remove(markerPath)

		markerContent := "test-session:5"
		err := os.WriteFile(markerPath, []byte(markerContent), 0644)
		if err != nil {
			t.Fatalf("Failed to create test marker: %v", err)
		}

		msg := checkTestingMarker()

		// Should return TestingMarkerCheckMsg (marker not for us)
		if _, ok := msg.(TestingMarkerCheckMsg); !ok {
			t.Errorf("Expected TestingMarkerCheckMsg, got %T", msg)
		}

		// Marker file should still exist (not consumed)
		if _, err := os.Stat(markerPath); os.IsNotExist(err) {
			t.Error("Marker file for different PID should not be deleted")
		}
	})

	t.Run("malformed marker content is handled gracefully", func(t *testing.T) {
		markerPath := filepath.Join(markerDir, fmt.Sprintf("mark-testing-request-%d", currentPID))
		os.MkdirAll(markerDir, 0755)
		defer os.Remove(markerPath)

		// Create marker with invalid format (missing colon)
		markerContent := "invalid-format"
		err := os.WriteFile(markerPath, []byte(markerContent), 0644)
		if err != nil {
			t.Fatalf("Failed to create test marker: %v", err)
		}

		// This should not panic
		msg := checkTestingMarker()

		// Should return TestingMarkerCheckMsg (invalid marker)
		if _, ok := msg.(TestingMarkerCheckMsg); !ok {
			t.Errorf("Expected TestingMarkerCheckMsg for invalid marker, got %T", msg)
		}

		// Marker should be deleted even if invalid
		if _, err := os.Stat(markerPath); !os.IsNotExist(err) {
			t.Error("Invalid marker file should be deleted")
		}
	})

	t.Run("empty marker file is handled gracefully", func(t *testing.T) {
		markerPath := filepath.Join(markerDir, fmt.Sprintf("mark-testing-request-%d", currentPID))
		os.MkdirAll(markerDir, 0755)
		defer os.Remove(markerPath)

		// Create empty marker file
		err := os.WriteFile(markerPath, []byte(""), 0644)
		if err != nil {
			t.Fatalf("Failed to create test marker: %v", err)
		}

		// This should not panic
		msg := checkTestingMarker()

		// Should return TestingMarkerCheckMsg (empty marker)
		if _, ok := msg.(TestingMarkerCheckMsg); !ok {
			t.Errorf("Expected TestingMarkerCheckMsg for empty marker, got %T", msg)
		}

		// Marker should be deleted
		if _, err := os.Stat(markerPath); !os.IsNotExist(err) {
			t.Error("Empty marker file should be deleted")
		}
	})
}

func TestTickTestingMarkerCheck(t *testing.T) {
	cmd := tickTestingMarkerCheck()
	if cmd == nil {
		t.Fatal("tickTestingMarkerCheck should return a command")
	}

	// Execute the command to verify it returns a message
	msg := cmd()
	if msg == nil {
		t.Fatal("Ticker command should return a message")
	}

	// The message should be either TestingMarkerCheckMsg or MarkProjectTestingMsg
	switch msg.(type) {
	case TestingMarkerCheckMsg, MarkProjectTestingMsg:
		// Expected types
	default:
		t.Errorf("Unexpected message type: %T", msg)
	}
}

func TestMarkerPollingTiming(t *testing.T) {
	// This test verifies that marker checking happens within acceptable timeframe
	markerPath := filepath.Join(markerDir, fmt.Sprintf("mark-testing-request-%d", os.Getpid()))
	os.MkdirAll(markerDir, 0755)
	defer os.Remove(markerPath)

	// Create marker
	markerContent := "timing-test:1"
	startTime := time.Now()
	err := os.WriteFile(markerPath, []byte(markerContent), 0644)
	if err != nil {
		t.Fatalf("Failed to create test marker: %v", err)
	}

	// Poll for marker (simulating real polling)
	var msg tea.Msg
	timeout := time.After(2 * time.Second)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-timeout:
			t.Fatal("Marker was not detected within 2 seconds")
		case <-ticker.C:
			msg = checkTestingMarker()
			if _, ok := msg.(MarkProjectTestingMsg); ok {
				duration := time.Since(startTime)
				t.Logf("Marker detected in %v", duration)

				// Should be detected relatively quickly (< 1 second for polling at 500ms)
				if duration > 1*time.Second {
					t.Errorf("Marker detection took too long: %v", duration)
				}
				return
			}
		}
	}
}
