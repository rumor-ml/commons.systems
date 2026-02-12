package model

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestNewModel(t *testing.T) {
	m := NewModel()

	if m.width != 40 {
		t.Errorf("expected default width 40, got %d", m.width)
	}
	if m.height != 24 {
		t.Errorf("expected default height 24, got %d", m.height)
	}
}

func TestModelInit(t *testing.T) {
	m := NewModel()
	cmd := m.Init()

	if cmd != nil {
		t.Errorf("expected Init to return nil, got %v", cmd)
	}
}

func TestModelUpdate_Quit(t *testing.T) {
	tests := []struct {
		name string
		key  string
	}{
		{"ctrl+c quits", "ctrl+c"},
		{"q quits", "q"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := NewModel()
			msg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(tt.key)}

			_, cmd := m.Update(msg)

			if cmd == nil {
				t.Error("expected quit command, got nil")
			}
		})
	}
}

func TestModelUpdate_WindowResize(t *testing.T) {
	m := NewModel()
	msg := tea.WindowSizeMsg{
		Width:  80,
		Height: 50,
	}

	updatedModel, cmd := m.Update(msg)

	if cmd != nil {
		t.Errorf("expected no command on window resize, got %v", cmd)
	}

	updated := updatedModel.(Model)
	if updated.width != 80 {
		t.Errorf("expected width 80, got %d", updated.width)
	}
	if updated.height != 50 {
		t.Errorf("expected height 50, got %d", updated.height)
	}
}

func TestModelUpdate_OtherKeys(t *testing.T) {
	m := NewModel()
	msg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'a'}}

	updatedModel, cmd := m.Update(msg)

	if cmd != nil {
		t.Errorf("expected no command for regular key, got %v", cmd)
	}

	updated := updatedModel.(Model)
	if updated.width != m.width || updated.height != m.height {
		t.Error("model should not change for non-handled keys")
	}
}

func TestModelView_ContainsTitle(t *testing.T) {
	m := NewModel()
	view := m.View()

	if !strings.Contains(view, "WezTerm Navigator") {
		t.Error("view should contain title 'WezTerm Navigator'")
	}
}

func TestModelView_ContainsWelcome(t *testing.T) {
	m := NewModel()
	view := m.View()

	if !strings.Contains(view, "Welcome to WezTerm!") {
		t.Error("view should contain welcome message")
	}
}

func TestModelView_ContainsKeybindings(t *testing.T) {
	m := NewModel()
	view := m.View()

	keybindings := []string{
		"Window Management:",
		"Ctrl+Shift+T",
		"Ctrl+Shift+N",
		"Ctrl+Shift+9",
		"Ctrl+Shift+0",
		"Navigation:",
		"Alt+Left/Right",
		"Ctrl+Shift+Arrow",
		"Splitting:",
		"Ctrl+Shift+%",
		"Closing:",
		"Ctrl+Shift+W",
	}

	for _, kb := range keybindings {
		if !strings.Contains(view, kb) {
			t.Errorf("view should contain keybinding '%s'", kb)
		}
	}
}

func TestModelView_ContainsBothWindowSwitchKeybindings(t *testing.T) {
	m := NewModel()
	view := m.View()

	// Verify both window switching keybindings are present
	// Note: lipgloss may wrap text, so we check for key components separately
	if !strings.Contains(view, "Ctrl+Shift+9") {
		t.Error("view should contain Ctrl+Shift+9 keybinding")
	}
	if !strings.Contains(view, "Switch to navigator") {
		t.Error("view should contain 'Switch to navigator' text")
	}

	if !strings.Contains(view, "Ctrl+Shift+0") {
		t.Error("view should contain Ctrl+Shift+0 keybinding")
	}
	if !strings.Contains(view, "Switch to main") {
		t.Error("view should contain 'Switch to main' text")
	}
}

func TestModelView_ContainsQuitInstructions(t *testing.T) {
	m := NewModel()
	view := m.View()

	if !strings.Contains(view, "Press Ctrl+C or q to quit") {
		t.Error("view should contain quit instructions")
	}
}

func TestModelView_ContainsSingletonMode(t *testing.T) {
	m := NewModel()
	view := m.View()

	if !strings.Contains(view, "Mode: Singleton Window") {
		t.Error("view should contain singleton window mode indicator")
	}
}
