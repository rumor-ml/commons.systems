// ansi.go - ANSI escape sequence processing and terminal control
//
// ## Metadata
//
// TUI ANSI escape sequence handling for terminal output processing.
//
// ### Purpose
//
// Process and filter ANSI escape sequences from terminal output to ensure proper
// display within the UI viewport while preserving color and formatting information
// but removing cursor control and positioning sequences that interfere with layout.
//
// ### Instructions
//
// #### ANSI Processing
//
// ##### Sequence Filtering
//
// Strip or preserve ANSI escape sequences based on their function - preserve color
// and formatting sequences while removing cursor positioning and control sequences
// that would interfere with the UI layout and viewport rendering.
//
// ##### Output Sanitization
//
// Clean terminal output for display in UI components while maintaining readability
// and visual formatting without allowing terminal control sequences to disrupt
// the multiplexer interface structure.
//
// ### Dependencies
//
// #### [ICF](https://github.com/rumor-ml/icf)
//
// Core framework providing component integration patterns that inform how ANSI
// processing should integrate with the broader terminal management system.

package ui

import (
	"strings"
	"time"
)

// ANSI processing constants
const (
	InputDebounceTime     = 10 * time.Millisecond
	MaxANSISequenceLength = 32
)

// stripANSI removes ANSI escape sequences (improved implementation)
func (tc *TerminalComponent) stripANSI(s string) string {
	result := strings.Builder{}
	i := 0

	for i < len(s) {
		if i < len(s) && s[i] == '\x1b' {
			// Found escape sequence, skip until we find the end
			i++ // Skip the ESC character
			if i < len(s) && s[i] == '[' {
				i++ // Skip the '['
				// Skip until we find a letter (end of sequence)
				for i < len(s) && !((s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= 'a' && s[i] <= 'z')) {
					i++
				}
				if i < len(s) {
					i++ // Skip the ending letter
				}
			} else {
				// Handle other escape sequences
				for i < len(s) && s[i] != '\x1b' && (s[i] < 'A' || s[i] > 'z') {
					i++
				}
				if i < len(s) && s[i] >= 'A' && s[i] <= 'z' {
					i++
				}
			}
		} else {
			// Regular character, but skip some control characters
			if s[i] == '\r' {
				// Skip standalone carriage return completely
				i++
			} else if s[i] >= 32 || s[i] == '\n' || s[i] == '\t' {
				// Keep printable characters, newlines, and tabs
				result.WriteByte(s[i])
				i++
			} else {
				// Skip other control characters
				i++
			}
		}
	}

	return result.String()
}

// processANSIForDisplay processes ANSI sequences for viewport display
func (tc *TerminalComponent) processANSIForDisplay(s string) string {
	result := strings.Builder{}
	i := 0

	for i < len(s) {
		if i < len(s) && s[i] == '\x1b' {
			// Found escape sequence
			if i+1 < len(s) && s[i+1] == '[' {
				// CSI sequence
				start := i
				i += 2 // Skip ESC and [

				// Read parameters and command
				for i < len(s) && !((s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= 'a' && s[i] <= 'z')) {
					i++
				}

				if i < len(s) {
					command := s[i]
					i++ // Skip command letter

					// Keep color/formatting sequences, remove cursor positioning
					switch command {
					case 'm': // Color/formatting sequences - keep these
						result.WriteString(s[start:i])
					case 'K', 'J': // Clear sequences - remove these
						// Skip these sequences
					case 'H', 'f': // Cursor positioning - remove these
						// Skip these sequences
					case 'A', 'B', 'C', 'D': // Cursor movement - remove these
						// Skip these sequences
					default:
						// For unknown sequences, be conservative and keep them
						result.WriteString(s[start:i])
					}
				}
			} else {
				// Other escape sequences - skip ESC and next char
				i += 2
			}
		} else if s[i] == '\r' {
			// Handle carriage return - convert to proper line handling
			if i+1 < len(s) && s[i+1] == '\n' {
				// \r\n -> \n
				result.WriteByte('\n')
				i += 2
			} else {
				// Standalone \r - skip it (used for cursor positioning)
				i++
			}
		} else if s[i] >= 32 || s[i] == '\n' || s[i] == '\t' {
			// Keep printable characters, newlines, and tabs
			result.WriteByte(s[i])
			i++
		} else {
			// Skip other control characters
			i++
		}
	}

	return result.String()
}

// isANSISequence checks if the byte sequence starting at position is an ANSI escape sequence
func isANSISequence(data []byte, pos int) bool {
	if pos >= len(data) {
		return false
	}

	return data[pos] == '\x1b' && pos+1 < len(data) && data[pos+1] == '['
}

// findANSISequenceEnd finds the end position of an ANSI escape sequence
func findANSISequenceEnd(data []byte, start int) int {
	if start >= len(data) || !isANSISequence(data, start) {
		return start
	}

	pos := start + 2 // Skip ESC and [

	// Find the end of the sequence (a letter)
	for pos < len(data) && pos < start+MaxANSISequenceLength {
		if (data[pos] >= 'A' && data[pos] <= 'Z') || (data[pos] >= 'a' && data[pos] <= 'z') {
			return pos + 1 // Include the ending letter
		}
		pos++
	}

	return start + 2 // Fallback to minimal sequence if no end found
}

// extractANSICommand extracts the command character from an ANSI sequence
func extractANSICommand(data []byte, start int) byte {
	if !isANSISequence(data, start) {
		return 0
	}

	pos := start + 2 // Skip ESC and [

	// Find the command character (the letter at the end)
	for pos < len(data) && pos < start+MaxANSISequenceLength {
		if (data[pos] >= 'A' && data[pos] <= 'Z') || (data[pos] >= 'a' && data[pos] <= 'z') {
			return data[pos]
		}
		pos++
	}

	return 0 // No command found
}
