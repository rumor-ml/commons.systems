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
		{"string panic with send on closed channel", "send on closed channel", true},
		{"error panic with send on closed channel", errors.New("send on closed channel during cleanup"), true},
		{"string panic without send on closed channel", "nil pointer dereference", false},
		{"error panic without send on closed channel", errors.New("nil pointer"), false},
		{"nil panic", nil, false},
		{"int panic", 42, false},
		{"empty string", "", false},
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
