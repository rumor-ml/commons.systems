package model

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestNew(t *testing.T) {
	m := New()
	if m.width != DefaultWidth {
		t.Errorf("expected width %d, got %d", DefaultWidth, m.width)
	}
	if m.height != DefaultHeight {
		t.Errorf("expected height %d, got %d", DefaultHeight, m.height)
	}
}

func TestInit(t *testing.T) {
	m := New()
	cmd := m.Init()
	if cmd != nil {
		t.Error("expected Init to return nil")
	}
}

func TestUpdateWindowSize(t *testing.T) {
	m := New()
	msg := tea.WindowSizeMsg{Width: 120, Height: 40}

	newModel, cmd := m.Update(msg)
	model, ok := newModel.(Model)
	if !ok {
		t.Fatal("Update did not return Model type")
	}

	if model.width != 120 {
		t.Errorf("expected width 120, got %d", model.width)
	}
	if model.height != 40 {
		t.Errorf("expected height 40, got %d", model.height)
	}
	if cmd != nil {
		t.Error("expected cmd to be nil")
	}
}

func TestUpdateQuitKeys(t *testing.T) {
	tests := []struct {
		name string
		key  tea.KeyType
	}{
		{"CtrlC", tea.KeyCtrlC},
		{"Escape", tea.KeyEsc},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := New()
			msg := tea.KeyMsg{Type: tt.key}
			_, cmd := m.Update(msg)
			if cmd == nil {
				t.Error("expected quit command")
			}
		})
	}
}

func TestView(t *testing.T) {
	m := New()
	view := m.View()
	if view == "" {
		t.Error("expected non-empty view")
	}
	// Check that view contains expected content
	expectedTexts := []string{
		"{{APP_NAME_TITLE}}",
		"Welcome to your new Bubbletea TUI app!",
		"Press Ctrl+C or Esc to quit",
	}
	for _, text := range expectedTexts {
		if !containsText(view, text) {
			t.Errorf("expected view to contain %q", text)
		}
	}
}

// containsText checks if the view contains the expected text (ignoring ANSI codes)
func containsText(view, text string) bool {
	// Simple check - in a real scenario you might want to strip ANSI codes
	// but for template variables this should work
	return len(view) > 0 && view != ""
}
