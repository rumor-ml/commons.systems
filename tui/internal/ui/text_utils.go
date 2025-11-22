// text_utils.go - Text processing utilities for UI components

package ui

import (
	"strings"
	"unicode"
)

// stripANSIFromString removes ANSI escape sequences from a string
func stripANSIFromString(s string) string {
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
			// Regular character
			result.WriteByte(s[i])
			i++
		}
	}

	return result.String()
}

// addHotkeyIndicator adds [] brackets around the hotkey character in the name
func addHotkeyIndicator(name string, hotkey rune) string {
	if hotkey == 0 || hotkey == '!' {
		return name // No valid hotkey
	}

	lowerName := strings.ToLower(name)
	lowerHotkey := unicode.ToLower(hotkey)

	// Find the position of the hotkey character in the name
	for i, char := range lowerName {
		if char == lowerHotkey {
			// Found the character, wrap it in brackets
			result := ""
			if i > 0 {
				result += name[:i]
			}
			result += "[" + string(name[i]) + "]"
			if i+1 < len(name) {
				result += name[i+1:]
			}
			return result
		}
	}

	// If hotkey character not found in name, prepend it with brackets
	return "[" + string(unicode.ToUpper(hotkey)) + "] " + name
}

// padToWidth pads a string to exactly the specified visible width
func padToWidth(s string, width int) string {
	// Get visible length without stripping ANSI codes
	visibleLen := len(stripANSIFromString(s))

	if visibleLen >= width {
		// Truncate while preserving ANSI codes
		// For now, don't truncate to avoid breaking ANSI codes
		return s
	}

	// Pad with spaces (preserve original ANSI codes)
	return s + strings.Repeat(" ", width-visibleLen)
}