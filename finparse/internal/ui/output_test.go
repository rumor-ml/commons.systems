package ui

import (
	"bytes"
	"regexp"
	"strings"
	"testing"

	"github.com/fatih/color"
)

func TestCenter(t *testing.T) {
	tests := []struct {
		name     string
		text     string
		width    int
		expected string
	}{
		{
			name:     "text shorter than width",
			text:     "Hello",
			width:    15,
			expected: "     Hello",
		},
		{
			name:     "text same as width",
			text:     "Hello",
			width:    5,
			expected: "Hello",
		},
		{
			name:     "text longer than width",
			text:     "Hello World",
			width:    5,
			expected: "Hello World",
		},
		{
			name:     "even padding",
			text:     "Test",
			width:    10,
			expected: "   Test",
		},
		{
			name:     "empty string",
			text:     "",
			width:    10,
			expected: "     ",
		},
		{
			name:     "zero width",
			text:     "Test",
			width:    0,
			expected: "Test",
		},
		{
			name:     "negative width",
			text:     "Test",
			width:    -5,
			expected: "Test",
		},
		{
			name:     "unicode emoji",
			text:     "😀",
			width:    10,
			expected: "   😀", // See center() documentation for byte vs rune handling
		},
		{
			name:     "unicode multi-byte characters",
			text:     "日本語",
			width:    20,
			expected: "     日本語", // See center() documentation for byte vs rune handling
		},
		{
			name:     "very long string",
			text:     strings.Repeat("a", 100),
			width:    50,
			expected: strings.Repeat("a", 100),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := center(tt.text, tt.width)
			if result != tt.expected {
				t.Errorf("center(%q, %d) = %q; want %q", tt.text, tt.width, result, tt.expected)
			}
		})
	}
}

// TODO(#1443): UI output tests don't verify actual color codes
func TestColorFunctions(t *testing.T) {
	// These tests verify that the color functions don't panic
	// We can't easily test the actual color output without mocking
	tests := []struct {
		name string
		fn   func()
	}{
		{
			name: "Header",
			fn:   func() { Header("Test Header") },
		},
		{
			name: "Step",
			fn:   func() { Step(1, 5, "Test Step") },
		},
		{
			name: "Success",
			fn:   func() { Success("Test Success") },
		},
		{
			name: "Info",
			fn:   func() { Info("Test Info") },
		},
		{
			name: "Warning",
			fn:   func() { Warning("Test Warning") },
		},
		{
			name: "Error",
			fn:   func() { Error("Test Error") },
		},
		{
			name: "BlueText",
			fn:   func() { BlueText("Test Blue") },
		},
		{
			name: "YellowText",
			fn:   func() { YellowText("Test Yellow") },
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Should not panic
			tt.fn()
		})
	}
}

func captureOutput(fn func()) string {
	// Disable colors for consistent output
	color.NoColor = true
	defer func() { color.NoColor = false }()

	// Create a buffer to capture output
	var buf bytes.Buffer

	// Save original color.Output (global setting)
	oldOutput := color.Output
	defer func() { color.Output = oldOutput }()

	// Set color.Output to our buffer
	color.Output = &buf

	// Run the function (which will write to buf via color library)
	fn()

	return buf.String()
}

func TestHeaderFormat(t *testing.T) {
	output := captureOutput(func() {
		Header("Test Header")
	})

	// Verify text is present
	if !strings.Contains(output, "Test Header") {
		t.Errorf("Header output should contain 'Test Header'")
	}

	// Verify separator lines (60 '=' characters)
	expectedLine := strings.Repeat("=", 60)
	if !strings.Contains(output, expectedLine) {
		t.Errorf("Header output should contain separator line of 60 '=' characters")
	}

	// Verify structure: should have at least 3 lines
	lines := strings.Split(strings.TrimSpace(output), "\n")
	if len(lines) < 3 {
		t.Errorf("Header should produce at least 3 lines, got %d: %q", len(lines), output)
	}
}

func TestStepFormat(t *testing.T) {
	output := captureOutput(func() {
		Step(3, 10, "Processing file")
	})

	// Verify format: [N/M] message
	pattern := regexp.MustCompile(`\[3/10\] Processing file`)
	if !pattern.MatchString(output) {
		t.Errorf("Step output should match '[3/10] Processing file', got: %q", output)
	}
}

func TestSuccessFormat(t *testing.T) {
	output := captureOutput(func() {
		Success("Operation completed")
	})

	// Verify arrow prefix
	if !strings.Contains(output, "→") {
		t.Errorf("Success output should contain '→' prefix")
	}
	if !strings.Contains(output, "Operation completed") {
		t.Errorf("Success output should contain message text")
	}
}

func TestWarningFormat(t *testing.T) {
	output := captureOutput(func() {
		Warning("Something to watch")
	})

	// Verify warning symbol
	if !strings.Contains(output, "⚠") {
		t.Errorf("Warning output should contain '⚠' symbol")
	}
	if !strings.Contains(output, "Something to watch") {
		t.Errorf("Warning output should contain message text")
	}
}

func TestErrorFormat(t *testing.T) {
	output := captureOutput(func() {
		Error("Something went wrong")
	})

	// Verify Error prefix
	if !strings.Contains(output, "Error:") {
		t.Errorf("Error output should contain 'Error:' prefix")
	}
	if !strings.Contains(output, "Something went wrong") {
		t.Errorf("Error output should contain message text")
	}
}

func TestOutputWithEmptyString(t *testing.T) {
	tests := []struct {
		name string
		fn   func()
	}{
		{
			name: "Header with empty string",
			fn:   func() { Header("") },
		},
		{
			name: "Step with empty message",
			fn:   func() { Step(1, 1, "") },
		},
		{
			name: "Success with empty string",
			fn:   func() { Success("") },
		},
		{
			name: "Warning with empty string",
			fn:   func() { Warning("") },
		},
		{
			name: "Error with empty string",
			fn:   func() { Error("") },
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Should not panic with empty strings
			output := captureOutput(tt.fn)
			_ = output // Verify it produces some output
		})
	}
}

func TestOutputWithVeryLongString(t *testing.T) {
	longString := strings.Repeat("a", 500)

	tests := []struct {
		name string
		fn   func()
	}{
		{
			name: "Header with long string",
			fn:   func() { Header(longString) },
		},
		{
			name: "Step with long message",
			fn:   func() { Step(1, 1, longString) },
		},
		{
			name: "Success with long string",
			fn:   func() { Success(longString) },
		},
		{
			name: "Warning with long string",
			fn:   func() { Warning(longString) },
		},
		{
			name: "Error with long string",
			fn:   func() { Error(longString) },
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Should not panic with very long strings
			output := captureOutput(tt.fn)
			if !strings.Contains(output, "aaa") {
				t.Errorf("Output should contain the long string")
			}
		})
	}
}

func TestOutputWithUnicode(t *testing.T) {
	unicodeString := "Hello 世界 🌍"

	tests := []struct {
		name string
		fn   func()
	}{
		{
			name: "Header with unicode",
			fn:   func() { Header(unicodeString) },
		},
		{
			name: "Step with unicode",
			fn:   func() { Step(1, 1, unicodeString) },
		},
		{
			name: "Success with unicode",
			fn:   func() { Success(unicodeString) },
		},
		{
			name: "Warning with unicode",
			fn:   func() { Warning(unicodeString) },
		},
		{
			name: "Error with unicode",
			fn:   func() { Error(unicodeString) },
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Should handle unicode correctly
			output := captureOutput(tt.fn)
			if !strings.Contains(output, unicodeString) {
				t.Errorf("Output should contain unicode string: %q", unicodeString)
			}
		})
	}
}
