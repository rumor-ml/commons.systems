// logs.go - Logs panel component for slog integration
//
// ## Metadata
//
// TUI logs panel providing real-time log viewing and exploration.
//
// ### Purpose
//
// Display and explore application logs using Go's slog system, providing visual feedback
// for user actions and system events within the multiplexer interface.
//
// ### Instructions
//
// #### Log Display
//
// ##### Real-time Updates
//
// Display logs in real-time as they're generated, with automatic scrolling and proper
// formatting for readability within the terminal multiplexer interface.
//
// ##### Log Filtering
//
// Support filtering logs by level (debug, info, warn, error) and searching through
// log content for specific events or messages.
//
// ### Dependencies
//
// #### [ICF](https://github.com/rumor-ml/icf)
//
// Core framework providing component patterns and integration guidelines for log
// management and display within the multiplexer ecosystem.

package ui

import (
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/rumor-ml/log/pkg/log"
)

// LogsComponent displays application logs
type LogsComponent struct {
	viewport     viewport.Model
	logs         []LogEntry
	mutex        sync.RWMutex
	width        int
	height       int
	style        lipgloss.Style
	logChan      chan log.Entry
	stopChan     chan struct{}
	logger       log.Logger

	// Log navigation state
	selectedLogIndex  int  // -1 = most recent, 0+ = historical position
	autoScrollEnabled bool // true when at most recent log
}

// LogEntry represents a single log entry
type LogEntry struct {
	Timestamp time.Time
	Level     slog.Level
	Message   string
	Source    string
}

// LogUpdateMsg signals that logs should be refreshed
type LogUpdateMsg struct{}

// NewLogsComponent creates a new logs component
func NewLogsComponent() *LogsComponent {
	vp := viewport.New(120, 5) // Use default sizes initially
	vp.MouseWheelEnabled = false // Disable mouse wheel to prevent confusion
	// Clear the key map to prevent viewport from handling keys
	vp.KeyMap = viewport.KeyMap{}
	// Ensure viewport doesn't have any performance line or headers
	vp.HighPerformanceRendering = false

	lc := &LogsComponent{
		viewport:          vp,
		logs:              make([]LogEntry, 0),
		style:             lipgloss.NewStyle(),
		width:             120,  // Default width
		height:            7,    // Default height (4 truncated + 3 detail)
		stopChan:          make(chan struct{}),
		logger:            log.Get(),
		selectedLogIndex:  -1,   // -1 = most recent
		autoScrollEnabled: true, // Start with auto-scroll enabled
	}

	// Get recent logs first from database
	lc.loadRecentLogs()

	// Set initial content with proper viewport size
	lc.viewport.Width = lc.width
	lc.viewport.Height = lc.height
	lc.updateContent()

	return lc
}

// Init initializes the logs component
func (lc *LogsComponent) Init() tea.Cmd {
	// Fetch initial logs from database
	lc.fetchLogsFromDB()

	// Force an initial update of the viewport content
	lc.updateContent()

	return tea.Batch(
		lc.viewport.Init(),
		lc.startLogPolling(),
	)
}

// Update handles messages for the logs component
func (lc *LogsComponent) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		lc.width = msg.Width
		lc.height = msg.Height
		// No border, so viewport uses full size
		lc.viewport.Width = msg.Width
		lc.viewport.Height = msg.Height
		lc.viewport, cmd = lc.viewport.Update(msg)
		cmds = append(cmds, cmd)

	case LogUpdateMsg:
		// Fetch logs from database when we get the update message
		lc.fetchLogsFromDB()
		lc.updateContent()

		// Continue polling
		cmds = append(cmds, lc.startLogPolling())

		// Return a command that forces a re-render
		return lc, tea.Batch(cmds...)

	case tea.KeyMsg:
		// Handle arrow keys and page keys for log navigation
		switch msg.Type {
		case tea.KeyUp:
			// Navigate to older log (scroll back in history)
			lc.mutex.Lock()
			if lc.selectedLogIndex == -1 {
				// Currently at most recent, move to second-most recent
				if len(lc.logs) > 1 {
					lc.selectedLogIndex = len(lc.logs) - 2
					lc.autoScrollEnabled = false
				}
			} else if lc.selectedLogIndex > 0 {
				lc.selectedLogIndex--
				lc.autoScrollEnabled = false
			}
			lc.mutex.Unlock()

		case tea.KeyDown:
			// Navigate to newer log (scroll forward in history)
			lc.mutex.Lock()
			if lc.selectedLogIndex >= 0 && lc.selectedLogIndex < len(lc.logs)-1 {
				lc.selectedLogIndex++
				// If we've reached the most recent log, re-enable auto-scroll
				if lc.selectedLogIndex >= len(lc.logs)-1 {
					lc.selectedLogIndex = -1
					lc.autoScrollEnabled = true
				}
			}
			lc.mutex.Unlock()

		case tea.KeyPgUp:
			// Page up - scroll back by 5 logs
			lc.mutex.Lock()
			if lc.selectedLogIndex == -1 {
				// Currently at most recent, move back 5 from end
				if len(lc.logs) > 5 {
					lc.selectedLogIndex = len(lc.logs) - 6 // -1 for 0-indexing, -5 for 5 back
				} else if len(lc.logs) > 1 {
					lc.selectedLogIndex = 0 // Go to first log
				}
				lc.autoScrollEnabled = false
			} else if lc.selectedLogIndex > 0 {
				lc.selectedLogIndex -= 5
				if lc.selectedLogIndex < 0 {
					lc.selectedLogIndex = 0
				}
				lc.autoScrollEnabled = false
			}
			lc.mutex.Unlock()

		case tea.KeyPgDown:
			// Page down - scroll forward by 5 logs
			lc.mutex.Lock()
			if lc.selectedLogIndex >= 0 {
				lc.selectedLogIndex += 5
				// If we've reached or passed the most recent log, re-enable auto-scroll
				if lc.selectedLogIndex >= len(lc.logs)-1 {
					lc.selectedLogIndex = -1
					lc.autoScrollEnabled = true
				}
			}
			lc.mutex.Unlock()

		default:
			// Ignore other keys - they're for navigation/commands
		}

	case tea.MouseMsg:
		// Allow viewport to handle mouse input for scrolling
		lc.viewport, cmd = lc.viewport.Update(msg)
		cmds = append(cmds, cmd)
	}

	// Pass other messages to viewport as well
	if _, isKeyMsg := msg.(tea.KeyMsg); !isKeyMsg {
		if _, isMouseMsg := msg.(tea.MouseMsg); !isMouseMsg {
			if _, isWindowSizeMsg := msg.(tea.WindowSizeMsg); !isWindowSizeMsg {
				if _, isLogUpdateMsg := msg.(LogUpdateMsg); !isLogUpdateMsg {
					lc.viewport, cmd = lc.viewport.Update(msg)
					cmds = append(cmds, cmd)
				}
			}
		}
	}

	return lc, tea.Batch(cmds...)
}

// View renders the logs component with split view (4 truncated + 3 detail)
func (lc *LogsComponent) View() string {
	lc.mutex.RLock()
	defer lc.mutex.RUnlock()

	var lines []string

	if len(lc.logs) == 0 {
		// Show placeholder when no logs
		lines = append(lines, "TUI Logs - Waiting for logs...")
		for i := 1; i < lc.height; i++ {
			lines = append(lines, "")
		}
		return strings.Join(lines, "\n")
	}

	// Determine selected index (most recent if -1)
	selectedIdx := lc.selectedLogIndex
	if selectedIdx == -1 || selectedIdx >= len(lc.logs) {
		selectedIdx = len(lc.logs) - 1
	}

	// Render 4 truncated lines (logs before the selected one)
	truncatedLines := lc.renderTruncatedLogs(selectedIdx)
	lines = append(lines, truncatedLines...)

	// Render 3 detail lines (selected log wrapped)
	detailLines := lc.renderDetailLog(selectedIdx)
	lines = append(lines, detailLines...)

	// Ensure exactly 7 lines (4 truncated + 3 detail)
	for len(lines) < lc.height {
		lines = append(lines, "")
	}
	if len(lines) > lc.height {
		lines = lines[:lc.height]
	}

	result := strings.Join(lines, "\n")
	return result
}

// renderTruncatedLogs renders the 4 truncated log lines before the selected one
func (lc *LogsComponent) renderTruncatedLogs(selectedIdx int) []string {
	var lines []string

	// Determine which logs to show (4 logs before selected)
	startIdx := selectedIdx - 4
	if startIdx < 0 {
		startIdx = 0
	}
	endIdx := selectedIdx // Don't include the selected log itself

	for i := startIdx; i < endIdx && i < len(lc.logs); i++ {
		entry := lc.logs[i]
		line := lc.formatTruncatedLog(entry)
		lines = append(lines, line)
	}

	// Pad with empty lines if we have fewer than 4 logs to show
	for len(lines) < 4 {
		lines = append(lines, "")
	}

	return lines[:4] // Ensure exactly 4 lines
}

func stripAnsiSimple(s string) string {
	result := ""
	inEscape := false
	for i := 0; i < len(s); i++ {
		if s[i] == '\x1b' && i+1 < len(s) && s[i+1] == '[' {
			inEscape = true
			i++
			continue
		}
		if inEscape {
			if s[i] == 'm' {
				inEscape = false
			}
			continue
		}
		result += string(s[i])
	}
	if len(result) > 60 {
		result = result[:57] + "..."
	}
	return result
}

// renderDetailLog renders the selected log wrapped across 3 lines
func (lc *LogsComponent) renderDetailLog(selectedIdx int) []string {
	if selectedIdx < 0 || selectedIdx >= len(lc.logs) {
		return []string{"", "", ""}
	}

	entry := lc.logs[selectedIdx]

	// Format with timestamp and level
	timestamp := entry.Timestamp.Format("15:04:05")
	levelStr := strings.ToUpper(entry.Level.String())
	if len(levelStr) > 4 {
		levelStr = levelStr[:4]
	} else if len(levelStr) < 4 {
		levelStr = levelStr + strings.Repeat(" ", 4-len(levelStr))
	}

	// Get level color
	var levelColor string
	switch entry.Level {
	case slog.LevelError:
		levelColor = lipgloss.NewStyle().Foreground(lipgloss.Color("9")).Render(levelStr)
	case slog.LevelWarn:
		levelColor = lipgloss.NewStyle().Foreground(lipgloss.Color("11")).Render(levelStr)
	case slog.LevelInfo:
		levelColor = lipgloss.NewStyle().Foreground(lipgloss.Color("10")).Render(levelStr)
	default:
		levelColor = lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Render(levelStr)
	}

	timestampColor := "8" // Gray
	if time.Since(entry.Timestamp) > 10*time.Minute {
		timestampColor = "240" // Dimmer gray for older entries
	}

	// Prefix for the log (timestamp + level)
	prefix := lipgloss.NewStyle().Foreground(lipgloss.Color(timestampColor)).Render(timestamp) +
		" " + levelColor + " "

	// Calculate available width for message
	prefixWidth := 8 + 1 + 4 + 1 // timestamp + space + level + space
	availableWidth := lc.width - prefixWidth

	// Wrap the message to fit within available width over 3 lines
	wrappedLines := lc.wrapText(entry.Message, availableWidth, 3)

	// Format with prefix on first line only
	var detailLines []string
	for i, line := range wrappedLines {
		if i == 0 {
			detailLines = append(detailLines, prefix+line)
		} else {
			// Indent continuation lines to align with message
			indent := strings.Repeat(" ", prefixWidth)
			detailLines = append(detailLines, indent+line)
		}
	}

	// Ensure exactly 3 lines
	for len(detailLines) < 3 {
		detailLines = append(detailLines, "")
	}
	return detailLines[:3]
}

// formatTruncatedLog formats a log entry as a single truncated line
func (lc *LogsComponent) formatTruncatedLog(entry LogEntry) string {
	timestamp := entry.Timestamp.Format("15:04:05")
	levelStr := strings.ToUpper(entry.Level.String())
	if len(levelStr) > 4 {
		levelStr = levelStr[:4]
	} else if len(levelStr) < 4 {
		levelStr = levelStr + strings.Repeat(" ", 4-len(levelStr))
	}

	// Color code by level
	var levelColor string
	switch entry.Level {
	case slog.LevelError:
		levelColor = lipgloss.NewStyle().Foreground(lipgloss.Color("9")).Render(levelStr)
	case slog.LevelWarn:
		levelColor = lipgloss.NewStyle().Foreground(lipgloss.Color("11")).Render(levelStr)
	case slog.LevelInfo:
		levelColor = lipgloss.NewStyle().Foreground(lipgloss.Color("10")).Render(levelStr)
	default:
		levelColor = lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Render(levelStr)
	}

	timestampColor := "8" // Gray
	if time.Since(entry.Timestamp) > 10*time.Minute {
		timestampColor = "240" // Dimmer gray
	}

	// Build the line with colors first
	timestampColored := lipgloss.NewStyle().Foreground(lipgloss.Color(timestampColor)).Render(timestamp)
	prefix := timestampColored + " " + levelColor + " "

	// Calculate how much space is available for the message
	// Prefix visual width is: timestamp (8) + space (1) + level (4) + space (1) = 14
	prefixVisualWidth := 14
	maxMsgLen := lc.width - prefixVisualWidth

	// Truncate message to fit, adding ellipses if needed
	msg := entry.Message

	// First truncation based on expected width
	if len(msg) > maxMsgLen && maxMsgLen > 3 {
		msg = msg[:maxMsgLen-3] + "..."
	}

	// Final safety check: measure actual visual width with ANSI codes
	fullLine := prefix + msg
	visualWidth := len(stripAnsi(fullLine))

	// If still too long, truncate more but ALWAYS end with ellipses
	if visualWidth > lc.width {
		excess := visualWidth - lc.width
		// Remove the excess, but preserve the "..." at the end
		if strings.HasSuffix(msg, "...") {
			// Remove ellipses temporarily
			msgWithoutEllipses := msg[:len(msg)-3]
			// Truncate more
			if len(msgWithoutEllipses) > excess {
				msgWithoutEllipses = msgWithoutEllipses[:len(msgWithoutEllipses)-excess]
			} else {
				msgWithoutEllipses = ""
			}
			// Re-add ellipses
			msg = msgWithoutEllipses + "..."
		} else {
			// No ellipses yet, truncate and add them
			if len(msg) > excess+3 {
				msg = msg[:len(msg)-excess-3] + "..."
			} else {
				msg = "..."
			}
		}
	}

	return prefix + msg
}

// wrapText wraps text to fit within maxWidth, returning up to maxLines
func (lc *LogsComponent) wrapText(text string, maxWidth, maxLines int) []string {
	if maxWidth <= 0 {
		return []string{text}
	}

	var lines []string
	words := strings.Fields(text)

	if len(words) == 0 {
		return []string{""}
	}

	currentLine := ""
	for _, word := range words {
		// If this is the first word on the line
		if currentLine == "" {
			currentLine = word
		} else {
			// Check if adding this word would exceed width
			testLine := currentLine + " " + word
			if len(testLine) <= maxWidth {
				currentLine = testLine
			} else {
				// Start a new line
				lines = append(lines, currentLine)
				if len(lines) >= maxLines {
					break
				}
				currentLine = word
			}
		}

		// If a single word is longer than maxWidth, break it
		if len(currentLine) > maxWidth {
			lines = append(lines, currentLine[:maxWidth])
			if len(lines) >= maxLines {
				break
			}
			currentLine = currentLine[maxWidth:]
		}
	}

	// Add the last line if we haven't hit maxLines
	if currentLine != "" && len(lines) < maxLines {
		lines = append(lines, currentLine)
	}

	// If text was truncated, add "..." to last line
	if len(lines) >= maxLines && len(words) > len(strings.Fields(strings.Join(lines, " "))) {
		lastLine := lines[maxLines-1]
		if len(lastLine) > 3 {
			lines[maxLines-1] = lastLine[:len(lastLine)-3] + "..."
		}
	}

	return lines
}

// AddLog is deprecated - logs come from database only
func (lc *LogsComponent) AddLog(level slog.Level, message, source string) {
	// Do nothing - this method exists only for interface compatibility
}

// updateContent refreshes the log display
func (lc *LogsComponent) updateContent() {
	lc.mutex.RLock()
	defer lc.mutex.RUnlock()
	lc.updateViewportContent()
}

// updateViewportContent updates the viewport with current logs (with lock)
func (lc *LogsComponent) updateViewportContent() {
	lc.updateViewportContentUnsafe()
}

// updateViewportContentUnsafe updates viewport without locking (caller must hold lock)
func (lc *LogsComponent) updateViewportContentUnsafe() {
	var lines []string

	if len(lc.logs) == 0 {
		lines = append(lines, "TUI Logs - No logs found in database")
	} else {
		// Show ALL logs - let the viewport handle the scrolling
		for i := 0; i < len(lc.logs); i++ {
			entry := lc.logs[i]
			timestamp := entry.Timestamp.Format("15:04:05")
			levelStr := strings.ToUpper(entry.Level.String())

			// Check if this is an older log entry (more than 10 minutes ago)
			isOlder := time.Since(entry.Timestamp) > 10*time.Minute

			// Color code by level
			var levelColor string
			switch entry.Level {
			case slog.LevelError:
				levelColor = lipgloss.NewStyle().Foreground(lipgloss.Color("9")).Render(levelStr)
			case slog.LevelWarn:
				levelColor = lipgloss.NewStyle().Foreground(lipgloss.Color("11")).Render(levelStr)
			case slog.LevelInfo:
				levelColor = lipgloss.NewStyle().Foreground(lipgloss.Color("10")).Render(levelStr)
			default:
				levelColor = lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Render(levelStr)
			}

			// Use slightly dimmer color for older timestamps to indicate they're from earlier
			timestampColor := "8" // Default gray
			if isOlder {
				timestampColor = "240" // Dimmer gray for older entries
			}

			line := lipgloss.NewStyle().Foreground(lipgloss.Color(timestampColor)).Render(timestamp) +
				" " + levelColor + " " + entry.Message

			// Only show source if it's not the default "app"
			if entry.Source != "" && entry.Source != "app" {
				line += lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Render(" [" + entry.Source + "]")
			}

			// Truncate line if it's too long to prevent wrapping
			if len(line) > lc.width {
				// Strip ANSI codes for length calculation
				plainLine := stripAnsi(line)
				if len(plainLine) > lc.width {
					// Truncate and keep colors by rebuilding
					maxMsgLen := lc.width - len(timestamp) - len(levelStr) - 2 // 2 spaces
					if maxMsgLen > 0 && len(entry.Message) > maxMsgLen {
						truncatedMsg := entry.Message[:maxMsgLen-3] + "..."
						line = lipgloss.NewStyle().Foreground(lipgloss.Color(timestampColor)).Render(timestamp) +
							" " + levelColor + " " + truncatedMsg
					}
				}
			}

			lines = append(lines, line)
		}
	}

	// Check if we were at bottom before setting new content
	wasAtBottom := lc.viewport.AtBottom()

	// Join lines and set content - only show what fits
	contentStr := strings.Join(lines, "\n")
	lc.viewport.SetContent(contentStr)

	// Only auto-scroll if we were already at the bottom and have content
	// This allows users to scroll up and stay there, but auto-scrolls for new content
	if wasAtBottom && len(lc.logs) > 0 {
		lc.viewport.GotoBottom()
	}
}

// stripAnsi removes ANSI escape codes from a string
func stripAnsi(str string) string {
	// Simple ANSI stripping - not perfect but good enough
	result := str
	for strings.Contains(result, "\x1b[") {
		start := strings.Index(result, "\x1b[")
		end := strings.Index(result[start:], "m")
		if end > 0 {
			result = result[:start] + result[start+end+1:]
		} else {
			break
		}
	}
	return result
}

// startLogPolling starts polling for log updates from database
func (lc *LogsComponent) startLogPolling() tea.Cmd {
	return tea.Tick(250*time.Millisecond, func(t time.Time) tea.Msg {
		// Reload logs from database - this needs to happen in Update()
		// not here in the Tick function
		return LogUpdateMsg{}
	})
}

// SetSize updates the component size
func (lc *LogsComponent) SetSize(width, height int) {
	// Only update if size actually changed
	if lc.width == width && lc.height == height {
		return
	}

	lc.width = width
	lc.height = height
	// Update viewport size
	lc.viewport.Width = width
	lc.viewport.Height = height
	// Re-render content with new height
	lc.mutex.Lock()
	lc.updateViewportContentUnsafe()
	// Ensure we start at bottom when first setting size
	lc.viewport.GotoBottom()
	lc.mutex.Unlock()
}

// loadRecentLogs loads recent logs from the log module
func (lc *LogsComponent) loadRecentLogs() {
	// Use the log module's GetRecent API
	entries := lc.logger.GetRecent(100)

	lc.mutex.Lock()
	defer lc.mutex.Unlock()

	// Clear existing logs and reload
	lc.logs = make([]LogEntry, 0, len(entries))

	// Convert log.Entry to LogEntry
	for _, entry := range entries {
		lc.logs = append(lc.logs, LogEntry{
			Timestamp: entry.Time,
			Level:     convertLogLevel(entry.Level),
			Message:   entry.Message,
			Source:    entry.Component,
		})
	}

	// If no logs, show a status message
	if len(lc.logs) == 0 {
		lc.logs = []LogEntry{{
			Timestamp: time.Now(),
			Level:     slog.LevelInfo,
			Message:   "TUI logging active - waiting for logs",
			Source:    "logs",
		}}
	}
}

// watchLogs watches for new log entries from the subscription
func (lc *LogsComponent) watchLogs() {
	for {
		select {
		case entry, ok := <-lc.logChan:
			if !ok {
				return
			}

			// Add new log entry
			lc.mutex.Lock()
			lc.logs = append(lc.logs, LogEntry{
				Timestamp: entry.Time,
				Level:     convertLogLevel(entry.Level),
				Message:   entry.Message,
				Source:    entry.Component,
			})

			// Keep only last 100 logs to prevent memory growth
			if len(lc.logs) > 100 {
				lc.logs = lc.logs[len(lc.logs)-100:]
			}

			// Update the viewport
			lc.updateViewportContentUnsafe()
			lc.mutex.Unlock()

		case <-lc.stopChan:
			// Unsubscribe and cleanup
			if lc.logChan != nil {
				lc.logger.Unsubscribe(lc.logChan)
			}
			return
		}
	}
}

// convertLogLevel converts log.Level to slog.Level
func convertLogLevel(level log.Level) slog.Level {
	switch level {
	case log.DEBUG:
		return slog.LevelDebug
	case log.INFO:
		return slog.LevelInfo
	case log.WARN:
		return slog.LevelWarn
	case log.ERROR:
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// fetchLogsFromDB fetches logs from the database
func (lc *LogsComponent) fetchLogsFromDB() {
	// Query database directly to get ALL component logs (not just from memory buffer)
	store := log.GetStore()
	entries, err := store.Query(log.QueryOptions{
		Limit: 100,
	})
	if err != nil {
		lc.logger.Error("Failed to query logs from database", "error", err)
		return
	}

	lc.mutex.Lock()
	defer lc.mutex.Unlock()

	// Preserve selected log if we're not auto-scrolling
	var selectedTimestamp time.Time
	var selectedMessage string
	if !lc.autoScrollEnabled && lc.selectedLogIndex >= 0 && lc.selectedLogIndex < len(lc.logs) {
		selectedTimestamp = lc.logs[lc.selectedLogIndex].Timestamp
		selectedMessage = lc.logs[lc.selectedLogIndex].Message
	}

	// Clear and reload
	lc.logs = make([]LogEntry, 0, len(entries))

	// Convert log.Entry to LogEntry
	// Query returns logs in DESC order (newest first), so reverse them to chronological order
	for i := len(entries) - 1; i >= 0; i-- {
		entry := entries[i]
		lc.logs = append(lc.logs, LogEntry{
			Timestamp: entry.Time,
			Level:     convertLogLevel(entry.Level),
			Message:   entry.Message,
			Source:    entry.Component,
		})
	}

	// Restore selected log position if we were not auto-scrolling
	if !lc.autoScrollEnabled && !selectedTimestamp.IsZero() {
		// Find the selected log by timestamp and message
		found := false
		for i, log := range lc.logs {
			if log.Timestamp.Equal(selectedTimestamp) && log.Message == selectedMessage {
				lc.selectedLogIndex = i
				found = true
				break
			}
		}

		// If the selected log is no longer in the array (aged out), reset to auto-scroll
		if !found {
			lc.selectedLogIndex = -1
			lc.autoScrollEnabled = true
		}
	}

	// Update the viewport
	lc.updateViewportContentUnsafe()
}

// Cleanup stops the log watching goroutine and unsubscribes
func (lc *LogsComponent) Cleanup() {
	// No longer needed since we're not running a goroutine
	// if lc.stopChan != nil {
	//     close(lc.stopChan)
	// }
}
