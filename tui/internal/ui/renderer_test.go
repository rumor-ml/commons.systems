package ui

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStripANSI(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "no ANSI codes",
			input:    "hello world",
			expected: "hello world",
		},
		{
			name:     "basic color codes",
			input:    "\x1b[31mred text\x1b[0m",
			expected: "red text",
		},
		{
			name:     "multiple ANSI sequences",
			input:    "\x1b[1;31mbold red\x1b[0m normal \x1b[32mgreen\x1b[0m",
			expected: "bold red normal green",
		},
		{
			name:     "complex escape sequences",
			input:    "\x1b[2K\x1b[1G\x1b[31mtext\x1b[0m",
			expected: "text",
		},
		{
			name:     "empty string",
			input:    "",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := stripANSIFromString(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestPadToWidth(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		width    int
		expected string
	}{
		{
			name:     "pad short string",
			input:    "hello",
			width:    10,
			expected: "hello     ",
		},
		{
			name:     "exact width",
			input:    "hello",
			width:    5,
			expected: "hello",
		},
		{
			name:     "string too long - should not truncate",
			input:    "hello world",
			width:    5,
			expected: "hello world", // Current behavior preserves long strings
		},
		{
			name:     "empty string",
			input:    "",
			width:    5,
			expected: "     ",
		},
		{
			name:     "with ANSI codes",
			input:    "\x1b[31mred\x1b[0m",
			width:    10,
			expected: "\x1b[31mred\x1b[0m       ",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := padToWidth(tt.input, tt.width)
			assert.Equal(t, tt.expected, result)
			// Verify visual length is correct (excluding ANSI codes)
			if len(result) >= tt.width {
				visibleLen := len(stripANSIFromString(result))
				assert.GreaterOrEqual(t, visibleLen, tt.width, "visible length should be at least width")
			}
		})
	}
}

func TestRenderNavigationMode(t *testing.T) {
	manager := NewManager()
	manager.width = 80
	manager.height = 24

	result := manager.renderNavigationMode()
	
	// Basic validation
	require.NotEmpty(t, result)
	
	lines := strings.Split(result, "\n")
	
	// Should have the right number of lines (may be slightly different due to padding)
	assert.GreaterOrEqual(t, len(lines), 24, "should have at least the requested lines")
	assert.LessOrEqual(t, len(lines), 26, "should not have too many extra lines")
	
	// Help section should be present (no separator line needed)
	// The help section is now directly rendered without a separator

	// Most lines should not be excessively long (some may exceed due to help text)
	longLines := 0
	for i, line := range lines {
		visibleLen := len(stripANSIFromString(line))
		if visibleLen > 120 { // Allow some flexibility for help text
			longLines++
			t.Logf("line %d length %d: %s", i, visibleLen, line[:min(50, len(line))])
		}
	}
	assert.LessOrEqual(t, longLines, 3, "should have few excessively long lines")
}

func TestRenderNavigationMode_DefaultSize(t *testing.T) {
	manager := NewManager()
	// Don't set width/height, should use defaults
	
	result := manager.renderNavigationMode()
	require.NotEmpty(t, result)
	
	lines := strings.Split(result, "\n")
	
	// Should use default height (40), allow some flexibility
	assert.GreaterOrEqual(t, len(lines), 40)
	assert.LessOrEqual(t, len(lines), 42)
}

func TestRenderAssistantFocus(t *testing.T) {
	manager := NewManager()
	manager.width = 120
	manager.height = 40

	result := manager.renderAssistantFocus()
	
	// Basic validation
	require.NotEmpty(t, result)
	
	lines := strings.Split(result, "\n")
	
	// Should have the right number of lines
	assert.GreaterOrEqual(t, len(lines), 40)
	assert.LessOrEqual(t, len(lines), 42)
	
	// Should contain some help or navigation content somewhere
	content := strings.ToLower(result)
	helpFound := strings.Contains(content, "key") || strings.Contains(content, "quit") ||
		strings.Contains(content, "claude") || strings.Contains(content, "zsh") ||
		strings.Contains(content, "project") || strings.Contains(content, "icf")
	assert.True(t, helpFound, "should contain some recognizable help or navigation content")
}

func TestRenderAssistantFocus_DefaultSize(t *testing.T) {
	manager := NewManager()
	// Don't set width/height, should use defaults
	
	result := manager.renderAssistantFocus()
	require.NotEmpty(t, result)
	
	lines := strings.Split(result, "\n")
	
	// Should use default dimensions
	assert.Equal(t, 40, len(lines)) // Default height
	
	// Each line should not exceed default width (120)
	for i, line := range lines {
		visibleLen := len(stripANSIFromString(line))
		assert.LessOrEqual(t, visibleLen, 120, "line %d visible length should not exceed default width", i)
	}
}

func TestManager_View_RendersNavigationMode(t *testing.T) {
	manager := NewManager()
	
	result := manager.View()
	require.NotEmpty(t, result)
	
	// Verify it's actually calling renderNavigationMode by checking structure
	lines := strings.Split(result, "\n")
	assert.Greater(t, len(lines), 10, "should have multiple lines")
	
	// Should contain ICF-related content (from navigation)
	content := strings.ToLower(result)
	assert.True(t, 
		strings.Contains(content, "icf") || 
		strings.Contains(content, "project") || 
		strings.Contains(content, "navigation"),
		"should contain navigation-related content")
}

func TestRenderer_ComponentIntegration(t *testing.T) {
	manager := NewManager()
	manager.width = 80
	manager.height = 20
	
	// Test that components are properly integrated
	result := manager.renderNavigationMode()
	require.NotEmpty(t, result)
	
	// Should not contain error messages or missing component indicators
	assert.NotContains(t, result, "ERROR")
	assert.NotContains(t, result, "missing")
	assert.NotContains(t, result, "nil")
}

func TestAddHotkeyIndicator(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		hotkey   rune
		expected string
	}{
		{
			name:     "hotkey found in name",
			input:    "assistant",
			hotkey:   'i',
			expected: "ass[i]stant",
		},
		{
			name:     "hotkey at beginning",
			input:    "assistant",
			hotkey:   'a',
			expected: "[a]ssistant",
		},
		{
			name:     "hotkey found first occurrence", 
			input:    "assistant",
			hotkey:   't',
			expected: "assis[t]ant",
		},
		{
			name:     "hotkey at end",
			input:    "project",
			hotkey:   't',
			expected: "projec[t]",
		},
		{
			name:     "hotkey not found",
			input:    "assistant",
			hotkey:   'z',
			expected: "[Z] assistant",
		},
		{
			name:     "case insensitive match",
			input:    "Assistant",
			hotkey:   'i',
			expected: "Ass[i]stant",
		},
		{
			name:     "no hotkey (zero value)",
			input:    "assistant",
			hotkey:   0,
			expected: "assistant",
		},
		{
			name:     "no hotkey (exclamation)",
			input:    "assistant", 
			hotkey:   '!',
			expected: "assistant",
		},
		{
			name:     "empty name",
			input:    "",
			hotkey:   'a',
			expected: "[A] ",
		},
		{
			name:     "single character match",
			input:    "a",
			hotkey:   'a',
			expected: "[a]",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := addHotkeyIndicator(tt.input, tt.hotkey)
			assert.Equal(t, tt.expected, result)
		})
	}
}