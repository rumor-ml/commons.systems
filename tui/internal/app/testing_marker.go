// testing_marker.go - Marker file detection system for tmux testing integration

package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/rumor-ml/log/pkg/log"
)

const (
	markerDir  = "/tmp/tui-testing-markers"
	markerFile = "mark-testing-request"
)

// TestingMarkerCheckMsg triggers checking for testing marker files
type TestingMarkerCheckMsg struct{}

// MarkProjectTestingMsg indicates a project should be marked as testing
// based on tmux session/window information
type MarkProjectTestingMsg struct {
	SessionName string
	WindowIndex int
}

// checkTestingMarker reads marker file and returns message if found
func checkTestingMarker() tea.Msg {
	logger := log.Get().WithComponent("testing-marker")

	// PID-specific marker file to ensure only this TUI instance processes it
	targetPID := os.Getpid()
	markerFileName := fmt.Sprintf("mark-testing-request-%d", targetPID)
	markerPath := filepath.Join(markerDir, markerFileName)

	data, err := os.ReadFile(markerPath)
	if err != nil {
		// No marker file - this is normal, return check message to continue ticker
		return TestingMarkerCheckMsg{}
	}

	logger.Debug("Marker file found", "path", markerPath, "pid", targetPID, "content", string(data))

	// Parse session:window from marker
	sessionWindow := strings.TrimSpace(string(data))
	parts := strings.Split(sessionWindow, ":")
	if len(parts) != 2 {
		logger.Warn("Invalid testing marker format", "content", sessionWindow)
		os.Remove(markerPath) // Clean up bad marker
		return TestingMarkerCheckMsg{} // Continue ticker
	}

	sessionName := parts[0]
	windowIndexStr := parts[1]

	// Parse window index as integer
	var windowIndex int
	if _, err := fmt.Sscanf(windowIndexStr, "%d", &windowIndex); err != nil {
		logger.Warn("Invalid window index in testing marker", "window", windowIndexStr, "error", err)
		os.Remove(markerPath) // Clean up bad marker
		return TestingMarkerCheckMsg{} // Continue ticker
	}

	// Remove marker file immediately after reading
	if err := os.Remove(markerPath); err != nil {
		logger.Warn("Failed to remove testing marker file", "error", err)
	}

	logger.Info("Found testing marker - sending message", "session", sessionName, "window", windowIndex)

	return MarkProjectTestingMsg{
		SessionName: sessionName,
		WindowIndex: windowIndex,
	}
}

// tickTestingMarkerCheck returns a command to periodically check for markers
func tickTestingMarkerCheck() tea.Cmd {
	return tea.Tick(500*time.Millisecond, func(t time.Time) tea.Msg {
		return checkTestingMarker()
	})
}
