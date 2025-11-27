package ui

import (
	"strings"
	"testing"
)

func TestRender(t *testing.T) {
	output := Render()

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

func TestRender_ContainsTitle(t *testing.T) {
	output := Render()

	// The title contains the app name placeholder which will be replaced
	// during scaffolding, so just check output is structured
	if !strings.Contains(output, "\n") {
		t.Error("expected output to contain multiple lines")
	}
}

func TestRender_ContainsHelpText(t *testing.T) {
	output := Render()

	if !strings.Contains(output, "Ctrl+C") && !strings.Contains(output, "Esc") {
		t.Error("expected output to contain quit instructions with Ctrl+C or Esc")
	}
}
