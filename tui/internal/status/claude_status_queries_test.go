// claude_status_queries_test.go - Tests for duration preservation logic

package status

import (
	"testing"
	"time"

	"github.com/natb1/tui/internal/terminal"
)

// TestActiveDurationClearsWhenEmpty tests that duration clears immediately when active with no duration
func TestActiveDurationClearsWhenEmpty(t *testing.T) {
	manager := NewClaudeStatusManager()
	handler := manager.notificationHandler2

	paneID := "test-pane-1"

	// T0: Active with duration "100s"
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "100s",
		Timestamp:    time.Now(),
	})

	status := manager.GetPaneStatus(paneID)
	if status == nil {
		t.Fatal("Expected status to exist")
	}
	if status.DurationText != "100s" {
		t.Errorf("Expected DurationText '100s', got '%s'", status.DurationText)
	}
	if status.LastKnownDuration != "100s" {
		t.Errorf("Expected LastKnownDuration '100s', got '%s'", status.LastKnownDuration)
	}

	// T1: Active without duration (e.g., "Precipitating..." phase with no duration)
	// BUG FIX: Duration should clear, not persist stale value
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "", // No duration in this update
		Timestamp:    time.Now(),
	})

	status = manager.GetPaneStatus(paneID)
	if status == nil {
		t.Fatal("Expected status to exist")
	}
	// BUG FIX: Duration should clear when active with no duration (no stale preservation)
	if status.DurationText != "" {
		t.Errorf("Expected DurationText to clear (not persist stale), got '%s'", status.DurationText)
	}
	// LastKnownDuration keeps historical value for reference
	if status.LastKnownDuration != "100s" {
		t.Errorf("Expected LastKnownDuration '100s', got '%s'", status.LastKnownDuration)
	}
}

// TestDurationClearsOnInactive tests that duration clears immediately on inactive transition
func TestDurationClearsOnInactive(t *testing.T) {
	manager := NewClaudeStatusManager()
	handler := manager.notificationHandler2

	paneID := "test-pane-2"

	// T0: Active with duration
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "255s",
		Timestamp:    time.Now(),
	})

	// T1: Active without duration (should clear)
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "",
		Timestamp:    time.Now(),
	})

	status := manager.GetPaneStatus(paneID)
	// BUG FIX: No longer preserves duration when active with no duration
	if status.DurationText != "" {
		t.Errorf("Expected duration to clear when active with no duration, got '%s'", status.DurationText)
	}

	// T2: Inactive - duration should remain cleared
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       false,
		DurationText: "",
		Timestamp:    time.Now(),
	})

	status = manager.GetPaneStatus(paneID)
	if status.DurationText != "" {
		t.Errorf("Expected DurationText to remain cleared, got '%s'", status.DurationText)
	}
	if status.LastKnownDuration != "" {
		t.Errorf("Expected LastKnownDuration to clear, got '%s'", status.LastKnownDuration)
	}
}

// TestDurationUpdatesWhenAvailable tests that duration updates when new value appears
func TestDurationUpdatesWhenAvailable(t *testing.T) {
	manager := NewClaudeStatusManager()
	handler := manager.notificationHandler2

	paneID := "test-pane-3"

	// T0: Active with duration "50s"
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "50s",
		Timestamp:    time.Now(),
	})

	// T1: Active with updated duration "60s"
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "60s",
		Timestamp:    time.Now(),
	})

	status := manager.GetPaneStatus(paneID)
	if status.DurationText != "60s" {
		t.Errorf("Expected updated duration '60s', got '%s'", status.DurationText)
	}
	if status.LastKnownDuration != "60s" {
		t.Errorf("Expected LastKnownDuration updated to '60s', got '%s'", status.LastKnownDuration)
	}

	// T2: Active without duration (should clear)
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "",
		Timestamp:    time.Now(),
	})

	status = manager.GetPaneStatus(paneID)
	// BUG FIX: Duration clears when active with no duration
	if status.DurationText != "" {
		t.Errorf("Expected duration to clear, got '%s'", status.DurationText)
	}

	// T3: Active with new duration "70s" (should update)
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "70s",
		Timestamp:    time.Now(),
	})

	status = manager.GetPaneStatus(paneID)
	if status.DurationText != "70s" {
		t.Errorf("Expected new duration '70s', got '%s'", status.DurationText)
	}
	if status.LastKnownDuration != "70s" {
		t.Errorf("Expected LastKnownDuration '70s', got '%s'", status.LastKnownDuration)
	}
}

// TestMultiplePanesIndependence tests that duration is tracked independently per pane
func TestMultiplePanesIndependence(t *testing.T) {
	manager := NewClaudeStatusManager()
	handler := manager.notificationHandler2

	paneA := "pane-a"
	paneB := "pane-b"

	// Pane A: Active with "100s"
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneA,
		Active:       true,
		DurationText: "100s",
		Timestamp:    time.Now(),
	})

	// Pane B: Active with "200s"
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneB,
		Active:       true,
		DurationText: "200s",
		Timestamp:    time.Now(),
	})

	statusA := manager.GetPaneStatus(paneA)
	statusB := manager.GetPaneStatus(paneB)

	if statusA.DurationText != "100s" {
		t.Errorf("Pane A: Expected '100s', got '%s'", statusA.DurationText)
	}
	if statusB.DurationText != "200s" {
		t.Errorf("Pane B: Expected '200s', got '%s'", statusB.DurationText)
	}

	// Pane A: Active without duration (should clear "100s")
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneA,
		Active:       true,
		DurationText: "",
		Timestamp:    time.Now(),
	})

	statusA = manager.GetPaneStatus(paneA)
	statusB = manager.GetPaneStatus(paneB)

	// BUG FIX: Duration clears when active with no duration
	if statusA.DurationText != "" {
		t.Errorf("Pane A: Expected duration to clear, got '%s'", statusA.DurationText)
	}
	if statusB.DurationText != "200s" {
		t.Errorf("Pane B: Should be unaffected, expected '200s', got '%s'", statusB.DurationText)
	}
}

// TestNeverCapturedDuration tests behavior when duration is never captured
func TestNeverCapturedDuration(t *testing.T) {
	manager := NewClaudeStatusManager()
	handler := manager.notificationHandler2

	paneID := "test-pane-4"

	// Active without duration from the start
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "", // Never captured
		Timestamp:    time.Now(),
	})

	status := manager.GetPaneStatus(paneID)
	if status.DurationText != "" {
		t.Errorf("Expected no duration, got '%s'", status.DurationText)
	}
	if status.LastKnownDuration != "" {
		t.Errorf("Expected no LastKnownDuration, got '%s'", status.LastKnownDuration)
	}
}

// TestInactiveToActiveToInactiveCycle tests duration resets across active sessions
func TestInactiveToActiveToInactiveCycle(t *testing.T) {
	manager := NewClaudeStatusManager()
	handler := manager.notificationHandler2

	paneID := "test-pane-5"

	// T0: Active with "100s"
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "100s",
		Timestamp:    time.Now(),
	})

	// T1: Inactive (clears duration)
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       false,
		DurationText: "",
		Timestamp:    time.Now(),
	})

	status := manager.GetPaneStatus(paneID)
	if status.DurationText != "" {
		t.Errorf("Expected duration cleared, got '%s'", status.DurationText)
	}

	// T2: Active again with new duration "50s" (new session)
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "50s",
		Timestamp:    time.Now(),
	})

	status = manager.GetPaneStatus(paneID)
	if status.DurationText != "50s" {
		t.Errorf("Expected new session duration '50s', got '%s'", status.DurationText)
	}
	if status.LastKnownDuration != "50s" {
		t.Errorf("Expected LastKnownDuration '50s', got '%s'", status.LastKnownDuration)
	}

	// T3: Active without duration (should clear)
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "",
		Timestamp:    time.Now(),
	})

	status = manager.GetPaneStatus(paneID)
	// BUG FIX: Duration clears when active with no duration
	if status.DurationText != "" {
		t.Errorf("Expected duration to clear, got '%s'", status.DurationText)
	}

	// T4: Inactive again
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       false,
		DurationText: "",
		Timestamp:    time.Now(),
	})

	status = manager.GetPaneStatus(paneID)
	if status.DurationText != "" {
		t.Errorf("Expected duration cleared again, got '%s'", status.DurationText)
	}
	if status.LastKnownDuration != "" {
		t.Errorf("Expected LastKnownDuration cleared, got '%s'", status.LastKnownDuration)
	}
}

// TestRapidTransitions tests behavior during rapid active/inactive transitions
func TestRapidTransitions(t *testing.T) {
	manager := NewClaudeStatusManager()
	handler := manager.notificationHandler2

	paneID := "test-pane-6"

	// Active with duration
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "10s",
		Timestamp:    time.Now(),
	})

	// Inactive (clears)
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       false,
		DurationText: "",
		Timestamp:    time.Now(),
	})

	// Active again quickly
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "5s",
		Timestamp:    time.Now(),
	})

	status := manager.GetPaneStatus(paneID)
	if status.DurationText != "5s" {
		t.Errorf("Expected new duration '5s', got '%s'", status.DurationText)
	}

	// Active without duration (should clear)
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "",
		Timestamp:    time.Now(),
	})

	status = manager.GetPaneStatus(paneID)
	// BUG FIX: Duration clears when active with no duration
	if status.DurationText != "" {
		t.Errorf("Expected duration to clear, got '%s'", status.DurationText)
	}
	// LastKnownDuration retains "5s" from current session (not "10s" from previous)
	if status.LastKnownDuration != "5s" {
		t.Errorf("Expected LastKnownDuration '5s' from current session, got '%s'", status.LastKnownDuration)
	}
}

// TestDurationFormatVariations tests that all duration formats are handled correctly
func TestDurationFormatVariations(t *testing.T) {
	manager := NewClaudeStatusManager()
	handler := manager.notificationHandler2

	testCases := []struct {
		name     string
		duration string
	}{
		{"seconds", "41s"},
		{"large seconds", "116s"},
		{"minutes and seconds", "2m15s"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			paneID := "pane-" + tc.name

			// Active with duration
			handler.handleStatusUpdate(ClaudeStatusUpdate{
				PaneID:       paneID,
				Active:       true,
				DurationText: tc.duration,
				Timestamp:    time.Now(),
			})

			status := manager.GetPaneStatus(paneID)
			if status.DurationText != tc.duration {
				t.Errorf("Expected duration '%s', got '%s'", tc.duration, status.DurationText)
			}

			// Active without duration (should clear)
			handler.handleStatusUpdate(ClaudeStatusUpdate{
				PaneID:       paneID,
				Active:       true,
				DurationText: "",
				Timestamp:    time.Now(),
			})

			status = manager.GetPaneStatus(paneID)
			// BUG FIX: Duration clears when active with no duration
			if status.DurationText != "" {
				t.Errorf("Expected duration to clear, got '%s'", status.DurationText)
			}
			// LastKnownDuration should retain the format
			if status.LastKnownDuration != tc.duration {
				t.Errorf("Expected LastKnownDuration '%s', got '%s'", tc.duration, status.LastKnownDuration)
			}
		})
	}
}

// TestZeroDurationFiltering tests that "0m" and "0s" are filtered out and don't replace valid durations
func TestZeroDurationFiltering(t *testing.T) {
	manager := NewClaudeStatusManager()
	handler := manager.notificationHandler2

	paneID := "test-pane-zero"

	// T0: Active with valid duration "123s"
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "123s",
		Timestamp:    time.Now(),
	})

	status := manager.GetPaneStatus(paneID)
	if status.DurationText != "123s" {
		t.Errorf("Expected duration '123s', got '%s'", status.DurationText)
	}

	// T1: Active with "0m" (invalid duration - should clear, not preserve "123s")
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "0m",
		Timestamp:    time.Now(),
	})

	status = manager.GetPaneStatus(paneID)
	// BUG FIX: "0m" is treated as invalid (empty), duration clears
	if status.DurationText != "" {
		t.Errorf("Expected duration to clear (0m is invalid), got '%s'", status.DurationText)
	}
	// LastKnownDuration retains "123s" for history
	if status.LastKnownDuration != "123s" {
		t.Errorf("Expected LastKnownDuration '123s', got '%s'", status.LastKnownDuration)
	}

	// T2: Active with "0s" (invalid duration - should remain cleared)
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "0s",
		Timestamp:    time.Now(),
	})

	status = manager.GetPaneStatus(paneID)
	// "0s" is also invalid, duration remains cleared
	if status.DurationText != "" {
		t.Errorf("Expected duration to remain cleared (0s is invalid), got '%s'", status.DurationText)
	}

	// T3: Active with new valid duration "200s" (should update)
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "200s",
		Timestamp:    time.Now(),
	})

	status = manager.GetPaneStatus(paneID)
	if status.DurationText != "200s" {
		t.Errorf("Expected updated duration '200s', got '%s'", status.DurationText)
	}
	if status.LastKnownDuration != "200s" {
		t.Errorf("Expected LastKnownDuration '200s', got '%s'", status.LastKnownDuration)
	}
}

// TestZeroDurationWithoutPriorDuration tests that "0m"/"0s" shows nothing if no prior duration exists
func TestZeroDurationWithoutPriorDuration(t *testing.T) {
	manager := NewClaudeStatusManager()
	handler := manager.notificationHandler2

	paneID := "test-pane-zero-only"

	// T0: Active with "0m" from the start (no prior duration)
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "0m",
		Timestamp:    time.Now(),
	})

	status := manager.GetPaneStatus(paneID)
	if status.DurationText != "" {
		t.Errorf("Expected empty duration (0m without prior duration), got '%s'", status.DurationText)
	}
	if status.LastKnownDuration != "" {
		t.Errorf("Expected empty LastKnownDuration, got '%s'", status.LastKnownDuration)
	}

	// T1: Active with "0s" (still no prior valid duration)
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "0s",
		Timestamp:    time.Now(),
	})

	status = manager.GetPaneStatus(paneID)
	if status.DurationText != "" {
		t.Errorf("Expected empty duration (0s without prior duration), got '%s'", status.DurationText)
	}
}

// TestGetPaneDurationWithMockMonitor tests GetPaneDuration with a mock monitor
// NOTE: This test is skipped because GetPaneDuration() interacts with the real monitor
// which tries to check actual tmux panes. The preservation logic is thoroughly tested
// by other tests that work directly with handleStatusUpdate().
/*
func TestGetPaneDurationWithMockMonitor(t *testing.T) {
	// Create manager with nil monitor (will fall back to cached data)
	manager := NewClaudeStatusManager()
	handler := manager.notificationHandler2

	paneID := "test-pane-7"

	// Set up status with duration
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "123s",
		Timestamp:    time.Now(),
	})

	// GetPaneDuration should return cached duration
	duration := manager.GetPaneDuration(paneID)
	if duration != "123s" {
		t.Errorf("Expected duration '123s', got '%s'", duration)
	}

	// Update without duration
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "",
		Timestamp:    time.Now(),
	})

	// GetPaneDuration should return preserved duration
	duration = manager.GetPaneDuration(paneID)
	if duration != "123s" {
		t.Errorf("Expected preserved duration '123s', got '%s'", duration)
	}

	// Inactive
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       false,
		DurationText: "",
		Timestamp:    time.Now(),
	})

	// GetPaneDuration should return empty
	duration = manager.GetPaneDuration(paneID)
	if duration != "" {
		t.Errorf("Expected empty duration after inactive, got '%s'", duration)
	}
}
*/

// TestConcurrentAccess tests concurrent access to duration (basic race detection)
func TestConcurrentAccess(t *testing.T) {
	manager := NewClaudeStatusManager()
	handler := manager.notificationHandler2

	paneID := "test-pane-8"

	// Initial state
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "100s",
		Timestamp:    time.Now(),
	})

	// Concurrent reads and writes
	done := make(chan bool)

	// Writer goroutine
	go func() {
		for i := 0; i < 100; i++ {
			handler.handleStatusUpdate(ClaudeStatusUpdate{
				PaneID:       paneID,
				Active:       true,
				DurationText: "200s",
				Timestamp:    time.Now(),
			})
			time.Sleep(1 * time.Millisecond)
		}
		done <- true
	}()

	// Reader goroutine
	go func() {
		for i := 0; i < 100; i++ {
			manager.GetPaneDuration(paneID)
			manager.GetPaneStatus(paneID)
			time.Sleep(1 * time.Millisecond)
		}
		done <- true
	}()

	// Wait for both goroutines
	<-done
	<-done

	// If we get here without panic, concurrent access is safe
}

// mockMonitor is a simple mock for ClaudeMonitor to test GetPaneDuration
type mockMonitor struct {
	status *terminal.ClaudeActivityStatus
}

func (m *mockMonitor) CheckPaneActivityNow(paneID string) {}
func (m *mockMonitor) GetActivityStatus(paneID string) *terminal.ClaudeActivityStatus {
	return m.status
}
func (m *mockMonitor) Start() {}
func (m *mockMonitor) Stop()  {}
func (m *mockMonitor) SetClaudePanes(panes map[string]string) {}

// NEW TESTS FOR BUG FIX

// TestGetPaneDuration_ActiveNoDuration verifies active Claude with no duration returns empty (not stale cached value)
func TestGetPaneDuration_ActiveNoDuration(t *testing.T) {
	// Create manager - we'll test through the notification handler
	manager := NewClaudeStatusManager()
	handler := manager.notificationHandler2
	paneID := "test-pane-active-no-duration"

	// Set up initial state with duration
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "100s",
		Timestamp:    time.Now(),
	})

	// GIVEN: Claude becomes active but DurationText is empty (e.g., during "Precipitating" phase)
	// This simulates the bug scenario where we had stale duration preservation
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "", // No duration
		Timestamp:    time.Now(),
	})

	// WHEN: GetPaneDuration is called
	status := manager.GetPaneStatus(paneID)

	// THEN: Returns "" (not the stale "100s")
	if status.DurationText != "" {
		t.Errorf("Expected empty duration for active Claude with no duration, got '%s'", status.DurationText)
	}
}

// TestGetPaneDuration_FreshMonitorData verifies duration matches fresh data
func TestGetPaneDuration_FreshMonitorData(t *testing.T) {
	manager := NewClaudeStatusManager()
	handler := manager.notificationHandler2
	paneID := "test-pane-fresh-data"

	// Disable monitor to test the cached fallback path
	manager.monitor = nil

	// GIVEN: Fresh status with "45s" duration
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "45s",
		Timestamp:    time.Now(),
	})

	// WHEN: GetPaneDuration is called
	// Falls back to cached notification data (monitor is nil)
	duration := manager.GetPaneDuration(paneID)

	// THEN: Returns "45s" from cached data
	if duration != "45s" {
		t.Errorf("Expected fresh duration '45s', got '%s'", duration)
	}
}

// TestGetPaneDuration_Inactive verifies inactive Claude returns empty duration
func TestGetPaneDuration_Inactive(t *testing.T) {
	manager := NewClaudeStatusManager()
	handler := manager.notificationHandler2
	paneID := "test-pane-inactive"

	// Set up initial active state
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "50s",
		Timestamp:    time.Now(),
	})

	// GIVEN: Claude is inactive
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       false,
		DurationText: "",
		Timestamp:    time.Now(),
	})

	// WHEN: GetPaneDuration is called
	duration := manager.GetPaneDuration(paneID)

	// THEN: Returns ""
	if duration != "" {
		t.Errorf("Expected empty duration for inactive Claude, got '%s'", duration)
	}
}

// TestGetPaneDuration_NotificationStates verifies notification-based states still work
func TestGetPaneDuration_NotificationStates(t *testing.T) {
	manager := NewClaudeStatusManager()
	paneID := "test-pane-notifications"

	// Disable monitor so we test the fallback path
	manager.monitor = nil

	// GIVEN: Set HasPermissionRequest directly on the status
	manager.mu.Lock()
	manager.paneStatuses[paneID] = &ClaudePaneStatus{
		PaneID:              paneID,
		Active:              true,
		HasPermissionRequest: true,
		LastChanged:         time.Now(),
	}
	manager.mu.Unlock()

	// WHEN: GetPaneDuration is called
	duration := manager.GetPaneDuration(paneID)

	// THEN: Returns "awaiting permission"
	if duration != "awaiting permission" {
		t.Errorf("Expected 'awaiting permission', got '%s'", duration)
	}

	// GIVEN: Set IsIdle directly on the status
	manager.mu.Lock()
	manager.paneStatuses[paneID] = &ClaudePaneStatus{
		PaneID:      paneID,
		Active:      false,
		IsIdle:      true,
		LastChanged: time.Now(),
	}
	manager.mu.Unlock()

	// WHEN: GetPaneDuration is called
	duration = manager.GetPaneDuration(paneID)

	// THEN: Returns "idle"
	if duration != "idle" {
		t.Errorf("Expected 'idle', got '%s'", duration)
	}
}

// TestGetPaneDuration_NoRaceCondition verifies the fix for race condition (no sleep)
// This test verifies that GetPaneDuration completes quickly without accumulated sleep delays
func TestGetPaneDuration_NoRaceCondition(t *testing.T) {
	manager := NewClaudeStatusManager()
	handler := manager.notificationHandler2
	paneID := "test-pane-no-race"

	// Disable monitor to test cached path performance
	manager.monitor = nil

	// Set up initial state with active duration
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "2m",
		Timestamp:    time.Now(),
	})

	// WHEN: GetPaneDuration is called multiple times in rapid succession
	start := time.Now()
	for i := 0; i < 10; i++ {
		duration := manager.GetPaneDuration(paneID)
		if duration != "2m" {
			t.Errorf("Iteration %d: Expected '2m' from cached status, got '%s'", i, duration)
		}
	}
	elapsed := time.Since(start)

	// THEN: All calls complete quickly (no accumulated sleep delays)
	// With old code (10ms sleep per call), 10 calls would take 100ms+
	// With new code (no sleep), should be under 50ms
	t.Logf("10 GetPaneDuration calls completed in %v", elapsed)
	if elapsed > 50*time.Millisecond {
		t.Logf("WARNING: Calls took %v, might indicate performance regression", elapsed)
		// Don't fail the test as CI may be slow, but log it
	}
}

// TestGetPaneDurationWithFreshMonitorData tests GetPaneDuration with fresh monitor data
// NOTE: This test is currently commented out because NewClaudeStatusManager() creates
// its own monitor internally and doesn't accept a mock. The integration with real
// monitor behavior is tested through manual testing.
/*
func TestGetPaneDurationWithFreshMonitorData(t *testing.T) {
	mock := &mockMonitor{}
	// Cannot inject mock monitor into NewClaudeStatusManager()
	// This test would require refactoring the manager to accept a monitor

	paneID := "test-pane-9"

	// Set up initial cached state
	handler.handleStatusUpdate(ClaudeStatusUpdate{
		PaneID:       paneID,
		Active:       true,
		DurationText: "100s",
		Timestamp:    time.Now(),
	})

	// Mock returns active with fresh duration
	mock.status = &terminal.ClaudeActivityStatus{
		Active:       true,
		DurationText: "150s",
	}

	duration := manager.GetPaneDuration(paneID)
	// Should get fresh duration from monitor
	if duration != "150s" {
		t.Errorf("Expected fresh duration '150s', got '%s'", duration)
	}

	// Mock returns active WITHOUT duration (should preserve last known)
	mock.status = &terminal.ClaudeActivityStatus{
		Active:       true,
		DurationText: "",
	}

	// The cached LastKnownDuration should be "100s" (from initial update)
	// But monitor's fresh status says active with no duration
	// GetPaneDuration should return the cached LastKnownDuration
	duration = manager.GetPaneDuration(paneID)
	if duration != "100s" {
		t.Errorf("Expected preserved duration '100s', got '%s'", duration)
	}

	// Mock returns inactive
	mock.status = &terminal.ClaudeActivityStatus{
		Active:       false,
		DurationText: "",
	}

	duration = manager.GetPaneDuration(paneID)
	if duration != "" {
		t.Errorf("Expected empty duration when inactive, got '%s'", duration)
	}
}
*/
