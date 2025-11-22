package ui

import (
	"fmt"
	"log/slog"
	"os"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/bubbles/viewport"
	"github.com/rumor-ml/log/pkg/log"
	"github.com/stretchr/testify/assert"
)

// TestLogsComponentDisplay tests that the logs component displays logs correctly
func TestLogsComponentDisplay(t *testing.T) {
	// Create logs component
	logs := NewLogsComponent()
	logs.SetSize(80, 10)

	// Manually trigger a database fetch
	logs.fetchLogsFromDB()

	// Get the view
	view := logs.View()

	// The component should show some content
	assert.NotEmpty(t, view, "logs view should not be empty")
}

// TestLogsComponentUpdate tests that logs update when new messages are logged
func TestLogsComponentUpdate(t *testing.T) {
	t.Skip("Skipping database-dependent test - needs proper test database setup")
	// Log a new message with unique content
	testMsg := "Test message at " + time.Now().Format("15:04:05.000")
	logger := log.Get().WithComponent("tui")
	logger.Info(testMsg)

	// Give time for log to be written to database
	time.Sleep(200 * time.Millisecond)

	// Create logs component
	logs := NewLogsComponent()
	logs.SetSize(80, 10)

	// Manually trigger database fetch
	logs.fetchLogsFromDB()

	// Check logs array after fetch
	t.Logf("Number of logs after fetch: %d", len(logs.logs))
	for i, entry := range logs.logs {
		t.Logf("Log %d: %s - %s", i, entry.Timestamp.Format("15:04:05"), entry.Message)
	}

	// Get the view
	view := logs.View()
	t.Logf("View output:\n%s", view)

	// Should contain our test message
	assert.Contains(t, view, testMsg, "should show newly logged message")
}

// TestLogsComponentColorCoding tests that log levels have different colors
func TestLogsComponentColorCoding(t *testing.T) {
	t.Skip("Skipping database-dependent test - needs proper test database setup")
	// Log messages of different levels
	logger := log.Get().WithComponent("tui")
	logger.Info("Info level message")
	logger.Warn("Warning level message")
	logger.Error("Error level message")

	// Give logs time to be written
	time.Sleep(200 * time.Millisecond)

	// Create logs component
	logs := NewLogsComponent()
	logs.SetSize(80, 10)

	// Manually trigger database fetch
	logs.fetchLogsFromDB()

	// Get the view
	view := logs.View()

	// Check for ANSI color codes
	// Error = \x1b[91m (bright red)
	assert.Contains(t, view, "\x1b[91m", "should have red color for ERROR")
	// Warn = \x1b[93m (bright yellow)
	assert.Contains(t, view, "\x1b[93m", "should have yellow color for WARN")
	// Info = \x1b[92m (bright green)
	assert.Contains(t, view, "\x1b[92m", "should have green color for INFO")
}

// TestLogsComponentDatabaseError tests handling when database is unavailable
func TestLogsComponentDatabaseError(t *testing.T) {
	// Create logs component
	logs := NewLogsComponent()
	logs.SetSize(80, 10)

	// Set an invalid database path by using a bad environment variable
	origPath := os.Getenv("ICF_LOG_DB")
	os.Setenv("ICF_LOG_DB", "/invalid/path/to/database.db")
	defer os.Setenv("ICF_LOG_DB", origPath)

	// Force a database fetch
	logs.fetchLogsFromDB()

	// Get the view
	view := logs.View()

	// Should show something even if DB fails
	assert.NotEmpty(t, view, "should show content even if database fails")
}

// TestLogsComponentScrolling tests viewport scrolling
func TestLogsComponentScrolling(t *testing.T) {
	// Create logs component with small height
	logs := NewLogsComponent()
	logs.SetSize(80, 5) // Small height to test scrolling

	// For testing, enable viewport key handling
	logs.viewport.KeyMap = viewport.DefaultKeyMap()

	// Add many test logs directly and update content to trigger initial scroll
	logs.mutex.Lock()
	for i := 0; i < 100; i++ {
		logs.logs = append(logs.logs, LogEntry{
			Timestamp: time.Now(),
			Level:     slog.LevelInfo,
			Message:   fmt.Sprintf("Test log message number %d", i),
			Source:    "test",
		})
	}
	// Update content and explicitly go to bottom for initial state
	logs.updateViewportContentUnsafe()
	logs.viewport.GotoBottom() // Explicitly ensure we start at bottom
	logs.mutex.Unlock()

	// The viewport should be at the bottom (showing newest logs)
	assert.True(t, logs.viewport.AtBottom(), "viewport should start at bottom")

	// Simulate page up key
	logs.viewport, _ = logs.viewport.Update(tea.KeyMsg{Type: tea.KeyPgUp})

	// Should no longer be at bottom
	assert.False(t, logs.viewport.AtBottom(), "viewport should not be at bottom after page up")
}

// TestLogsComponentEmptyState tests the component with no logs
func TestLogsComponentEmptyState(t *testing.T) {
	// Create logs component
	logs := NewLogsComponent()
	logs.SetSize(80, 10)

	// Manually set empty logs to simulate no data
	logs.mutex.Lock()
	logs.logs = []LogEntry{}
	logs.updateViewportContentUnsafe()
	logs.mutex.Unlock()

	// Get the view
	view := logs.View()

	// Should show the loading/empty message
	assert.Contains(t, view, "Waiting", "should show waiting message when no logs")

	// Should not panic or error
	assert.NotContains(t, view, "panic", "should not panic with empty logs")
	assert.NotContains(t, view, "error", "should not error with empty logs")
}

// TestLogsComponentRealDatabase tests with actual database connection
func TestLogsComponentRealDatabase(t *testing.T) {
	t.Skip("Skipping database-dependent test - needs proper test database setup")
	// This test verifies the component works with the real centralized database

	// Log a message with timestamp
	testTime := time.Now()
	testMsg := "Test at " + testTime.Format("15:04:05")
	logger := log.Get().WithComponent("tui")
	logger.Info(testMsg)

	// Give time for log to be written
	time.Sleep(200 * time.Millisecond)

	// Create logs component
	logs := NewLogsComponent()
	logs.SetSize(120, 20)

	// Force a fetch from database
	logs.fetchLogsFromDB()

	// Check that we got some logs
	logs.mutex.RLock()
	logCount := len(logs.logs)
	hasTestMsg := false
	for _, entry := range logs.logs {
		if entry.Message == testMsg {
			hasTestMsg = true
			break
		}
	}
	logs.mutex.RUnlock()

	assert.True(t, logCount > 0, "should have fetched some logs from database")
	assert.True(t, hasTestMsg, "should have fetched our test message")
}
