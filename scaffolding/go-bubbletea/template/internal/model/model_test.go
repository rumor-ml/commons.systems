package model

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestNew(t *testing.T) {
	m := New()
	if m.width != 80 {
		t.Errorf("expected width 80, got %d", m.width)
	}
	if m.height != 24 {
		t.Errorf("expected height 24, got %d", m.height)
	}
	if m.renderer == nil {
		t.Error("expected renderer to be initialized")
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
	model := newModel.(Model)

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
}
