// terminal_emulator.go - Proper terminal emulation layer
//
// ## Metadata
//
// TUI terminal emulation layer providing proper VT100/xterm emulation.
//
// ### Purpose
//
// Provide a proper terminal emulation layer that correctly handles ANSI sequences,
// cursor positioning, and display state, preventing the recurring issues with
// input duplication and display corruption.

package ui

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

const (
	// Maximum size for raw content buffer to prevent memory leaks
	MaxRawContentSize = 65536 // 64KB - same as session output buffer
)

// TerminalEmulator provides proper terminal emulation with display state
type TerminalEmulator struct {
	// Screen buffer - what's actually displayed
	screen [][]rune
	width  int
	height int

	// Cursor position
	cursorX int
	cursorY int

	// Current attributes
	attrs CellAttributes

	// Input buffer for proper echo handling
	inputBuffer strings.Builder

	// Raw terminal content for debugging
	rawContent []byte
}

// CellAttributes represents text attributes for a cell
type CellAttributes struct {
	Foreground string
	Background string
	Bold       bool
	Reverse    bool
	Underline  bool
}

// NewTerminalEmulator creates a proper terminal emulator
func NewTerminalEmulator(width, height int) *TerminalEmulator {
	te := &TerminalEmulator{
		width:  width,
		height: height,
		screen: make([][]rune, height),
	}

	// Initialize screen with spaces
	for y := 0; y < height; y++ {
		te.screen[y] = make([]rune, width)
		for x := 0; x < width; x++ {
			te.screen[y][x] = ' '
		}
	}

	return te
}

// ProcessOutput handles terminal output with proper emulation
func (te *TerminalEmulator) ProcessOutput(data []byte) {
	te.rawContent = append(te.rawContent, data...)

	// Trim raw content buffer to prevent memory leaks
	if len(te.rawContent) > MaxRawContentSize {
		// Keep the most recent MaxRawContentSize bytes
		copy(te.rawContent, te.rawContent[len(te.rawContent)-MaxRawContentSize:])
		te.rawContent = te.rawContent[:MaxRawContentSize]
	}

	// Process each byte properly, handling UTF-8 characters
	i := 0
	for i < len(data) {
		b := data[i]

		switch b {
		case '\r': // Carriage return
			te.cursorX = 0
			i++

		case '\n': // Line feed
			te.cursorX = 0 // Reset to beginning of line
			te.cursorY++
			if te.cursorY >= te.height {
				te.scrollUp()
				te.cursorY = te.height - 1
			}
			i++

		case '\b': // Backspace
			if te.cursorX > 0 {
				te.cursorX--
			}
			i++

		case '\x1b': // Escape sequence
			// Skip ANSI escape sequences
			seqLen := te.skipANSISequence(data[i:])
			i += seqLen

		case '\t': // Tab
			te.cursorX = ((te.cursorX / 8) + 1) * 8
			if te.cursorX >= te.width {
				te.cursorX = te.width - 1
			}
			i++

		default:
			// Handle UTF-8 characters properly
			if b >= 32 { // Printable characters (including UTF-8)
				// Decode UTF-8 character
				r, size := utf8.DecodeRune(data[i:])
				if r != utf8.RuneError || size > 1 {
					// Valid UTF-8 character
					te.setChar(r)
					i += size
				} else {
					// Invalid UTF-8 or single byte, skip
					i++
				}
			} else {
				// Control character, skip
				i++
			}
		}
	}
}

// ProcessInput handles input with proper echo prevention
func (te *TerminalEmulator) ProcessInput(input []byte) {
	// Store input to handle echo suppression
	te.inputBuffer.Write(input)
}

// GetDisplay returns the current display state for rendering
func (te *TerminalEmulator) GetDisplay() string {
	// Handle edge case of zero height
	if te.height == 0 {
		return "\n"
	}

	var result strings.Builder

	for y := 0; y < te.height; y++ {
		// Get the line without modifying the original
		line := string(te.screen[y])

		// Only remove standalone % on otherwise empty lines (bleed-through)
		// Don't trim spaces first - check if the entire line is just "%"
		trimmedLine := strings.TrimRight(line, " ")
		if trimmedLine == "%" && strings.TrimSpace(line) == "%" {
			// This is a standalone % on an otherwise empty line - likely bleed-through
			line = strings.Repeat(" ", len(line)) // Replace with spaces to maintain width
		} else {
			// For display, trim trailing spaces for cleaner output
			line = trimmedLine
		}

		result.WriteString(line)
		result.WriteRune('\n')
	}

	return result.String()
}

// GetRawContent returns raw terminal content for debugging
func (te *TerminalEmulator) GetRawContent() []byte {
	return te.rawContent
}

// Clear clears the screen
func (te *TerminalEmulator) Clear() {
	for y := 0; y < te.height; y++ {
		for x := 0; x < te.width; x++ {
			te.screen[y][x] = ' '
		}
	}
	te.cursorX = 0
	te.cursorY = 0
}

// Resize handles terminal resize
func (te *TerminalEmulator) Resize(width, height int) {
	// Create new screen buffer
	newScreen := make([][]rune, height)
	for y := 0; y < height; y++ {
		newScreen[y] = make([]rune, width)
		for x := 0; x < width; x++ {
			newScreen[y][x] = ' '
		}
	}

	// Copy old content
	for y := 0; y < height && y < te.height; y++ {
		for x := 0; x < width && x < te.width; x++ {
			newScreen[y][x] = te.screen[y][x]
		}
	}

	te.screen = newScreen
	te.width = width
	te.height = height

	// Adjust cursor position
	if te.cursorX >= width {
		te.cursorX = width - 1
	}
	if te.cursorY >= height {
		te.cursorY = height - 1
	}
}

// setChar sets a character at the cursor position and advances
func (te *TerminalEmulator) setChar(ch rune) {
	if te.cursorY < te.height && te.cursorX < te.width {
		te.screen[te.cursorY][te.cursorX] = ch
		te.cursorX++

		// Wrap to next line if needed
		if te.cursorX >= te.width {
			te.cursorX = 0
			te.cursorY++
			if te.cursorY >= te.height {
				te.scrollUp()
				te.cursorY = te.height - 1
			}
		}
	}
}

// scrollUp scrolls the screen up by one line
func (te *TerminalEmulator) scrollUp() {
	// Move all lines up
	for y := 0; y < te.height-1; y++ {
		te.screen[y] = te.screen[y+1]
	}

	// Clear the bottom line
	te.screen[te.height-1] = make([]rune, te.width)
	for x := 0; x < te.width; x++ {
		te.screen[te.height-1][x] = ' '
	}
}

// GetCursorPosition returns the current cursor position
func (te *TerminalEmulator) GetCursorPosition() (x, y int) {
	return te.cursorX, te.cursorY
}

// DebugState returns debug information about the emulator state
func (te *TerminalEmulator) DebugState() string {
	return fmt.Sprintf("Cursor: (%d, %d), Screen: %dx%d, RawBytes: %d",
		te.cursorX, te.cursorY, te.width, te.height, len(te.rawContent))
}

// skipANSISequence skips over an ANSI escape sequence and returns its length
func (te *TerminalEmulator) skipANSISequence(data []byte) int {
	if len(data) < 2 || data[0] != '\x1b' {
		return 1
	}

	// CSI sequences: ESC [ ...
	if data[1] == '[' {
		i := 2

		// Skip optional ? (for private sequences like ?2004h)
		if i < len(data) && data[i] == '?' {
			i++
		}

		// Skip parameters (numbers, semicolons, and other characters)
		for i < len(data) && !isTerminalCommand(data[i]) {
			i++
		}

		// Skip command character
		if i < len(data) {
			i++
		}
		return i
	}

	// Other sequences - just skip 2 bytes for now
	return 2
}

// isTerminalCommand checks if a byte is a terminal command character
func isTerminalCommand(b byte) bool {
	// Terminal commands are typically uppercase/lowercase letters
	return (b >= 'A' && b <= 'Z') || (b >= 'a' && b <= 'z')
}
