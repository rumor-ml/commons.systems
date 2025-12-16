package streaming

import (
	"errors"
	"strings"
	"testing"
)

func TestIsExpectedPanic(t *testing.T) {
	tests := []struct {
		name    string
		panic   interface{}
		context string
		want    bool
	}{
		// Expected shutdown-related panics (shutdown context + pattern)
		{"string panic with send on closed channel in broadcast", "send on closed channel", "broadcast", true},
		{"error panic with send on closed channel in session callback", errors.New("send on closed channel during cleanup"), "session subscription callback", true},
		{"close of closed channel in file callback", "close of closed channel", "file subscription callback", true},
		{"write broken pipe in broadcast", "write: broken pipe", "broadcast", true},
		{"use of closed network connection in progress forwarder", "use of closed network connection", "progress forwarder", true},

		// Same panics but NOT in shutdown contexts - should NOT be suppressed
		{"send on closed channel in normal context", "send on closed channel", "normal operation", false},
		{"close of closed channel in handler", "close of closed channel", "request handler", false},

		// Unexpected panics (even in shutdown contexts)
		{"nil pointer in shutdown context", "nil pointer dereference", "broadcast", false},
		{"index out of range in shutdown context", "runtime error: index out of range", "session subscription callback", false},

		// Nil and non-shutdown contexts
		{"nil panic", nil, "any context", false},
		{"int panic", 42, "broadcast", false},
		{"empty string", "", "broadcast", false},
		{"runtime error - nil pointer", "runtime error: invalid memory address or nil pointer dereference", "normal context", false},
		{"custom application error", errors.New("database connection failed"), "broadcast", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsExpectedPanic(tt.panic, tt.context)
			if got != tt.want {
				t.Errorf("IsExpectedPanic() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestHandlePanic_UnexpectedPanics(t *testing.T) {
	// Should always re-panic unexpected errors (regardless of environment)
	defer func() {
		r := recover()
		if r == nil {
			t.Error("Expected panic to be re-raised for unexpected errors")
		}
		if !strings.Contains(r.(string), "unexpected error") {
			t.Errorf("Expected panic message 'unexpected error', got: %v", r)
		}
	}()

	HandlePanic("unexpected error", "test context")
}

func TestHandlePanic_ExpectedPanics(t *testing.T) {
	// Expected panics should be suppressed when in shutdown context
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("Expected panic should be suppressed: %v", r)
		}
	}()

	HandlePanic("send on closed channel", "broadcast")
}

func TestHandlePanic_AllExpectedPatterns(t *testing.T) {
	// Test all expected panic patterns are suppressed in shutdown contexts
	expectedPanics := []string{
		"send on closed channel",
		"close of closed channel",
		"write: broken pipe",
		"use of closed network connection",
	}

	for _, panicMsg := range expectedPanics {
		t.Run(panicMsg, func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("Expected panic %q should be suppressed, but got re-panic: %v", panicMsg, r)
				}
			}()

			HandlePanic(panicMsg, "broadcast") // Use a shutdown context
		})
	}
}

func TestHandlePanic_NilPanic(t *testing.T) {
	// Should handle nil gracefully without panicking
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("HandlePanic should not panic on nil: %v", r)
		}
	}()

	HandlePanic(nil, "test context")
}

func TestExpectedPanicPatterns_Count(t *testing.T) {
	// Verify we have exactly 4 expected panic patterns as documented
	expectedCount := 4
	if len(expectedPanicPatterns) != expectedCount {
		t.Errorf("expectedPanicPatterns has %d patterns, expected %d", len(expectedPanicPatterns), expectedCount)
	}
}

func TestExpectedPanicPatterns_Coverage(t *testing.T) {
	// Verify all required patterns are present
	requiredPatterns := []string{
		"send on closed channel",
		"close of closed channel",
		"write: broken pipe",
		"use of closed network connection",
	}

	for _, required := range requiredPatterns {
		found := false
		for _, pattern := range expectedPanicPatterns {
			if pattern == required {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("Required pattern %q not found in expectedPanicPatterns", required)
		}
	}
}
