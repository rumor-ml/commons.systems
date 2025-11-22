package ui

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestKeyBindingRegistry(t *testing.T) {
	t.Run("NewKeyBindingRegistry creates registry with default bindings", func(t *testing.T) {
		registry := NewKeyBindingRegistry()
		require.NotNil(t, registry)

		// Check that quit binding exists and is correct
		quitBinding := registry.GetBinding("ctrl+d")
		require.NotNil(t, quitBinding)
		assert.Equal(t, ActionQuit, quitBinding.Action)
		assert.Equal(t, "quit", quitBinding.Description)
		assert.Equal(t, "global", quitBinding.Context)
	})

	t.Run("GetAction returns correct actions", func(t *testing.T) {
		registry := NewKeyBindingRegistry()

		assert.Equal(t, ActionQuit, registry.GetAction("ctrl+d"))
		assert.Equal(t, ActionScreenshot, registry.GetAction("ctrl+s"))
		assert.Equal(t, ActionClaudeShell, registry.GetAction("c"))
		assert.Equal(t, ActionZshShell, registry.GetAction("z"))
		assert.Equal(t, ActionCancel, registry.GetAction("esc"))
		assert.Equal(t, KeyAction(""), registry.GetAction("nonexistent"))
	})

	t.Run("ShouldHandle works for different contexts", func(t *testing.T) {
		registry := NewKeyBindingRegistry()

		// Global keys should work in any context
		assert.True(t, registry.ShouldHandle("ctrl+d", "global"))
		assert.True(t, registry.ShouldHandle("ctrl+d", "navigation"))
		assert.True(t, registry.ShouldHandle("ctrl+d", "terminal"))

		// Navigation keys should only work in navigation context or global
		assert.True(t, registry.ShouldHandle("c", "navigation"))
		assert.False(t, registry.ShouldHandle("c", "terminal"))
		assert.False(t, registry.ShouldHandle("c", "global"))
	})

	t.Run("Register adds new bindings", func(t *testing.T) {
		registry := NewKeyBindingRegistry()

		newBinding := &KeyBinding{
			Key:         "ctrl+t",
			Action:      "test_action",
			Description: "test description",
			Context:     "test",
		}

		err := registry.Register(newBinding)
		require.NoError(t, err)

		assert.Equal(t, KeyAction("test_action"), registry.GetAction("ctrl+t"))
		assert.True(t, registry.ShouldHandle("ctrl+t", "test"))
		assert.False(t, registry.ShouldHandle("ctrl+t", "other"))
	})

	t.Run("Register detects conflicts", func(t *testing.T) {
		registry := NewKeyBindingRegistry()

		conflictBinding := &KeyBinding{
			Key:         "ctrl+d", // Conflicts with existing quit binding
			Action:      "different_action",
			Description: "different description",
			Context:     "different",
		}

		err := registry.Register(conflictBinding)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "key binding conflict")
	})
}

func TestKeyToString(t *testing.T) {
	tests := []struct {
		name     string
		keyMsg   tea.KeyMsg
		expected string
	}{
		{
			name:     "ctrl+d",
			keyMsg:   tea.KeyMsg{Type: tea.KeyCtrlD},
			expected: "ctrl+d",
		},
		{
			name:     "ctrl+s",
			keyMsg:   tea.KeyMsg{Type: tea.KeyCtrlS},
			expected: "ctrl+s",
		},
		{
			name:     "ctrl+c",
			keyMsg:   tea.KeyMsg{Type: tea.KeyCtrlC},
			expected: "ctrl+c",
		},
		{
			name:     "escape",
			keyMsg:   tea.KeyMsg{Type: tea.KeyEsc},
			expected: "esc",
		},
		{
			name:     "enter",
			keyMsg:   tea.KeyMsg{Type: tea.KeyEnter},
			expected: "enter",
		},
		{
			name:     "regular character",
			keyMsg:   tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'c'}},
			expected: "c",
		},
		{
			name:     "regular character z",
			keyMsg:   tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'z'}},
			expected: "z",
		},
		{
			name:     "space",
			keyMsg:   tea.KeyMsg{Type: tea.KeySpace},
			expected: "space",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := KeyToString(tt.keyMsg)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestGetNavigationHints(t *testing.T) {
	registry := NewKeyBindingRegistry()
	hints := registry.GetNavigationHints()

	// Should contain key components
	assert.Contains(t, hints, "c(laude)")
	assert.Contains(t, hints, "z(sh)")
	assert.Contains(t, hints, "r(estart)")
	assert.Contains(t, hints, "/(path)")
	assert.Contains(t, hints, "x(blocked)")
	assert.Contains(t, hints, "ctrl+d(quit)")
	assert.Contains(t, hints, "esc(cancel)")
}
