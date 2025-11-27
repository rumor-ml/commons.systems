package ui

import (
	"strings"
	"testing"
)

func TestNewRenderer(t *testing.T) {
	r := NewRenderer(80)
	if r == nil {
		t.Fatal("expected renderer to be non-nil")
	}
	if r.width != 80 {
		t.Errorf("expected width 80, got %d", r.width)
	}
}

func TestSetWidth(t *testing.T) {
	r := NewRenderer(80)
	r.SetWidth(120)
	if r.width != 120 {
		t.Errorf("expected width 120, got %d", r.width)
	}
}

func TestRender(t *testing.T) {
	r := NewRenderer(80)
	output := r.Render()

	if output == "" {
		t.Error("expected non-empty output")
	}

	// Check that output contains expected content
	if !strings.Contains(output, "Welcome") {
		t.Error("expected output to contain 'Welcome'")
	}

	if !strings.Contains(output, "quit") {
		t.Error("expected output to contain quit instructions")
	}
}
