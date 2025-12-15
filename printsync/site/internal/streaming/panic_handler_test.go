package streaming

import (
	"errors"
	"os"
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

func TestHandlePanic_DevelopmentMode(t *testing.T) {
	// Unset GO_ENV for development mode
	os.Unsetenv("GO_ENV")

	// Should re-panic unexpected errors
	defer func() {
		r := recover()
		if r == nil {
			t.Error("Expected panic to be re-raised in development mode")
		}
		if !strings.Contains(r.(string), "unexpected error") {
			t.Errorf("Expected panic message 'unexpected error', got: %v", r)
		}
	}()

	HandlePanic("unexpected error", "test context")
}

func TestHandlePanic_ProductionMode(t *testing.T) {
	// Set production mode
	os.Setenv("GO_ENV", "production")
	defer os.Unsetenv("GO_ENV")

	// Should NOT re-panic
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("Unexpected panic in production mode: %v", r)
		}
	}()

	HandlePanic("unexpected error", "test context")
	// If we get here, panic was suppressed successfully
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
