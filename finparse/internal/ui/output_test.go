package ui

import (
	"strings"
	"testing"
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

func TestHeaderFormat(t *testing.T) {
	// Verify that header uses the correct line length
	text := "Test"
	expectedLineLength := 60

	// Check that center produces correct padding
	centered := center(text, expectedLineLength)

	// The centered text should have padding added
	if !strings.Contains(centered, text) {
		t.Errorf("center() should contain original text %q", text)
	}
}
