// terminal_content_processor.go - Content processing functionality for terminal component

package ui

import (
	"strings"

	"github.com/charmbracelet/bubbles/viewport"
	"github.com/natb1/tui/internal/terminal"
	"github.com/rumor-ml/log/pkg/log"
)

// TerminalContentProcessor handles terminal output processing and content updates
type TerminalContentProcessor struct {
	viewport      *viewport.Model
	emulator      *TerminalEmulator
	manager       terminal.ManagerInterface
	sessionID     string
	width         int
	height        int
	lastOutputLen int
}

// NewTerminalContentProcessor creates a new content processor
func NewTerminalContentProcessor(vp *viewport.Model, emulator *TerminalEmulator, manager terminal.ManagerInterface) *TerminalContentProcessor {
	return &TerminalContentProcessor{
		viewport: vp,
		emulator: emulator,
		manager:  manager,
	}
}

// SetSession updates the session ID for content processing
func (tcp *TerminalContentProcessor) SetSession(sessionID string) {
	tcp.sessionID = sessionID
}

// SetSize updates the dimensions for content processing
func (tcp *TerminalContentProcessor) SetSize(width, height int) {
	tcp.width = width
	tcp.height = height
}

// GetLastOutputLen returns the last processed output length
func (tcp *TerminalContentProcessor) GetLastOutputLen() int {
	return tcp.lastOutputLen
}

// SetLastOutputLen sets the last processed output length
func (tcp *TerminalContentProcessor) SetLastOutputLen(length int) {
	tcp.lastOutputLen = length
}

// UpdateContent processes and updates terminal content
func (tcp *TerminalContentProcessor) UpdateContent() {
	if tcp.sessionID == "" || tcp.manager == nil {
		return
	}

	output, err := tcp.manager.GetSessionOutput(tcp.sessionID)
	if err != nil {
		tcp.viewport.SetContent("Error reading terminal output: " + err.Error())
		return
	}

	// Check if we have new output to process
	if len(output) == tcp.lastOutputLen {
		return // No new content
	}

	// Detect if this looks like a TUI application based on output content
	content := string(output)
	isTUIApp := tcp.detectTUIApplication(content)

	// Log TUI detection to database for Claude debugging
	if len(output) > tcp.lastOutputLen {
		logger := log.Get()
		logger.Info("TUI detection result",
			"sessionID", tcp.sessionID,
			"isTUIApp", isTUIApp,
			"contentLength", len(content),
			"hasWelcomeText", strings.Contains(content, "Welcome to Claude Code!"),
			"hasAltScreenBuffer", strings.Contains(content, "\x1b[?1049h"),
			"hasCursorHide", strings.Contains(content, "\x1b[?25l"))
	}

	if isTUIApp {
		tcp.processTUIContent(content, output)
	} else {
		tcp.processShellContent(output)
	}
}

// processTUIContent handles TUI application content
func (tcp *TerminalContentProcessor) processTUIContent(content string, output []byte) {
	// For TUI applications like Claude, pass through raw output
	// This preserves ANSI escape sequences and screen management
	tcp.viewport.SetContent(content)
	tcp.lastOutputLen = len(output)

	// For TUI apps, position viewport at top to show full screen content
	tcp.viewport.GotoTop()

	// Force resize TUI app to use full available space
	// This is critical for apps like Claude that need to know terminal size
	if tcp.manager != nil && tcp.width > 0 && tcp.height > 0 {
		// Log the resize for debugging
		logger := log.Get()
		logger.Info("Forcing TUI app resize",
			"sessionID", tcp.sessionID,
			"width", tcp.width,
			"height", tcp.height)
		tcp.manager.ResizeSessionImmediate(tcp.sessionID, tcp.width, tcp.height)

		// No special handling for Claude - let it manage its own display
	}
}

// processShellContent handles shell/command line content
func (tcp *TerminalContentProcessor) processShellContent(output []byte) {
	// For shells, use terminal emulator to handle ANSI sequences properly
	// but ensure we show the full buffer by sizing it large enough
	var newBytes []byte
	if len(output) < tcp.lastOutputLen {
		// Buffer was replaced - process entire new buffer
		tcp.emulator.Clear()
		// Resize emulator to be much larger to preserve more history
		tcp.emulator.Resize(tcp.width, tcp.height*3) // 3x viewport height for history
		newBytes = output
		tcp.lastOutputLen = len(output)
	} else {
		// Process only NEW bytes to prevent duplication
		newBytes = output[tcp.lastOutputLen:]
		tcp.lastOutputLen = len(output)
	}

	if len(newBytes) > 0 {
		tcp.emulator.ProcessOutput(newBytes)
		display := tcp.emulator.GetDisplay()
		tcp.viewport.SetContent(display)
		// For shells, show the bottom to see recent activity
		tcp.viewport.GotoBottom()
	}
}

// detectTUIApplication determines if the terminal output indicates a TUI application
func (tcp *TerminalContentProcessor) detectTUIApplication(content string) bool {
	// Look for specific TUI application indicators that shells typically don't use
	tuiIndicators := []string{
		"\x1b[?1049h",             // Alternative screen buffer (strong TUI indicator)
		"\x1b[?25l",               // Hide cursor (TUI apps manage cursor)
		"Welcome to Claude Code!", // Claude-specific text
		"\x1b[?1000h",             // Enable mouse reporting (TUI apps only)
		"\x1b[?1002h",             // Enable button event mouse tracking
		"\x1b[?1006h",             // Enable SGR mouse mode
		"\x1b[2J\x1b[H",           // Clear screen + home cursor (common TUI pattern)
		"\x1b[?47h",               // Alternative screen buffer (xterm)
	}

	for _, indicator := range tuiIndicators {
		if strings.Contains(content, indicator) {
			return true
		}
	}

	// Additional heuristic: if we see multiple TUI-like patterns
	tuiPatterns := 0
	if strings.Contains(content, "\x1b[2J") {
		tuiPatterns++
	} // Clear screen
	if strings.Contains(content, "\x1b[H") {
		tuiPatterns++
	} // Home cursor
	if strings.Contains(content, "\x1b[?") {
		tuiPatterns++
	} // Private sequences
	if strings.Count(content, "\x1b[") > 10 {
		tuiPatterns++
	} // Lots of sequences

	// If we see multiple TUI patterns, likely a TUI app
	return tuiPatterns >= 3
}

// HasNewOutput checks if there is new output to process
func (tcp *TerminalContentProcessor) HasNewOutput() bool {
	if tcp.sessionID == "" || tcp.manager == nil {
		return false
	}

	output, err := tcp.manager.GetSessionOutput(tcp.sessionID)
	if err != nil {
		return false
	}

	return len(output) != tcp.lastOutputLen
}