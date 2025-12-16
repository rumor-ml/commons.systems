package streaming

import (
	"errors"
	"strings"
	"testing"
)

func TestIsExpectedPanic(t *testing.T) {
	tests := []struct {
		name  string
		panic interface{}
		want  bool
	}{
		// Expected shutdown-related panics
		{"string panic with send on closed channel", "send on closed channel", true},
		{"error panic with send on closed channel", errors.New("send on closed channel during cleanup"), true},
		{"close of closed channel - string", "close of closed channel", true},
		{"close of closed channel - error", errors.New("panic: close of closed channel"), true},
		{"write broken pipe - string", "write: broken pipe", true},
		{"write broken pipe - error", errors.New("write: broken pipe"), true},
		{"use of closed network connection - string", "use of closed network connection", true},
		{"use of closed network connection - error", errors.New("use of closed network connection"), true},

		// Unexpected panics
		{"string panic without send on closed channel", "nil pointer dereference", false},
		{"error panic without send on closed channel", errors.New("nil pointer"), false},
		{"nil panic", nil, false},
		{"int panic", 42, false},
		{"empty string", "", false},
		{"runtime error - nil pointer", "runtime error: invalid memory address or nil pointer dereference", false},
		{"runtime error - index out of range", "runtime error: index out of range", false},
		{"custom application error", errors.New("database connection failed"), false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsExpectedPanic(tt.panic)
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
	// Expected panics should always be suppressed
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("Expected panic should be suppressed: %v", r)
		}
	}()

	HandlePanic("send on closed channel", "test context")
}

func TestHandlePanic_AllExpectedPatterns(t *testing.T) {
	// Test all expected panic patterns are suppressed
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

			HandlePanic(panicMsg, "test context")
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
