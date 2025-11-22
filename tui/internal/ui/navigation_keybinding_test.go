package ui

import (
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/exp/teatest"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// TestNavigationKeyBindingAccuracy verifies that key bindings map to correct projects/worktrees
func TestNavigationKeyBindingAccuracy(t *testing.T) {
	log.Get().WithComponent("test")

	// Create test projects with specific key bindings
	projects := []*model.Project{
		{
			Name:       "assistant",
			Path:       "/workspace/assistant",
			KeyBinding: 'a',
		},
		{
			Name:       "finance",
			Path:       "/workspace/finance",
			KeyBinding: 'f',
			Worktrees: []*model.Worktree{
				{
					ID:         "finance-tools-migration",
					Branch:     "tools-migration",
					Path:       "/workspace/finance/.worktrees/finance-tools-migration",
					KeyBinding: 't',
				},
			},
		},
		{
			Name:       "health",
			Path:       "/workspace/health",
			KeyBinding: 'h',
		},
	}

	// Create key binding manager
	keyMgr := model.NewKeyBindingManager()

	// Test each project key binding
	testCases := []struct {
		name           string
		key            rune
		expectTarget   string
		expectWorktree bool
		expectCommand  bool
	}{
		{"Select assistant project", 'a', "assistant", false, false}, // First key should not generate command
		{"Select finance project", 'f', "finance", false, false},
		{"Select health project", 'h', "health", false, false},
		{"Select finance worktree", 't', "finance-tools-migration", true, false},
		{"Invalid key", 'z', "", false, false}, // Should not change state
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Create fresh KeySequenceHandler
			handler := NewKeySequenceHandler()
			handler.SetProjects(projects, keyMgr)

			// Send first key
			keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{tc.key}}
			cmd := handler.HandleKeySequence(keyMsg)

			if tc.expectTarget == "" {
				// Should not be in sequence for invalid keys
				if handler.IsInSequence() {
					t.Errorf("Expected not to be in sequence for invalid key '%c'", tc.key)
				}
				return
			}

			// Should be in sequence after valid first key
			if !handler.IsInSequence() {
				t.Errorf("Expected to be in sequence after key '%c'", tc.key)
				return
			}

			// Should not generate command on first key
			if cmd != nil {
				t.Errorf("Expected no command from first key '%c', got: %v", tc.key, cmd)
			}

			// Check sequence status contains expected target name
			inSequence, status := handler.GetSequenceStatus()
			if !inSequence {
				t.Error("GetSequenceStatus should indicate in sequence")
			}
			
			if tc.expectWorktree {
				if !strings.Contains(status, tc.expectTarget) {
					t.Errorf("Expected status to contain worktree ID %s, got: %s", tc.expectTarget, status)
				}
			} else {
				if !strings.Contains(status, tc.expectTarget) {
					t.Errorf("Expected status to contain project name %s, got: %s", tc.expectTarget, status)
				}
			}

			// Test that we can complete the sequence with an action
			actionMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'z'}} // zsh action
			actionCmd := handler.HandleKeySequence(actionMsg)
			if actionCmd == nil {
				t.Error("Expected command from action key")
			}

			// Should exit sequence after action
			if handler.IsInSequence() {
				t.Error("Expected to exit sequence after action")
			}
		})
	}
}

// TestNavigationKeySequenceStates tests the state machine for key sequences
func TestNavigationKeySequenceStates(t *testing.T) {
	log.Get().WithComponent("test")

	projects := []*model.Project{
		{Name: "assistant", Path: "/workspace/assistant", KeyBinding: 'a'},
	}

	handler := NewKeySequenceHandler()
	keyMgr := model.NewKeyBindingManager()
	handler.SetProjects(projects, keyMgr)

	// Test initial state
	if handler.IsInSequence() {
		t.Error("Expected initial state to be StateNone (not in sequence)")
	}

	// Test first key sequence - should enter StateAwaitingAction
	firstKeyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'a'}}
	cmd1 := handler.HandleKeySequence(firstKeyMsg)
	
	// First key should not generate command
	if cmd1 != nil {
		t.Errorf("Expected no command from first key, got: %v", cmd1)
	}

	// State should be awaiting action
	if !handler.IsInSequence() {
		t.Error("Expected to be in sequence after first key")
	}

	inSequence, status := handler.GetSequenceStatus()
	if !inSequence {
		t.Error("GetSequenceStatus should indicate in sequence")
	}
	if !strings.Contains(status, "assistant") {
		t.Errorf("Expected status to contain 'assistant', got: %s", status)
	}

	// Test action key - should generate command and reset state
	actionKeyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'z'}}
	cmd2 := handler.HandleKeySequence(actionKeyMsg)

	// Action should generate command
	if cmd2 == nil {
		t.Error("Expected command from action key")
	}

	// Verify the command generates the correct message
	msg := cmd2()
	projectShellMsg, ok := msg.(ProjectShellMsg)
	if !ok {
		t.Errorf("Expected ProjectShellMsg, got %T", msg)
	} else {
		if projectShellMsg.Project.Name != "assistant" {
			t.Errorf("Expected project name 'assistant', got: %s", projectShellMsg.Project.Name)
		}
		if projectShellMsg.ShellType != model.ShellTypeZsh {
			t.Errorf("Expected ShellTypeZsh, got: %v", projectShellMsg.ShellType)
		}
	}

	// State should be reset after action
	if handler.IsInSequence() {
		t.Error("Expected to exit sequence after action")
	}

	// Test invalid action key - should reset state without command
	handler.HandleKeySequence(firstKeyMsg) // Enter sequence again
	if !handler.IsInSequence() {
		t.Error("Should be in sequence after first key")
	}

	invalidActionMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'q'}} // Invalid action
	cmd3 := handler.HandleKeySequence(invalidActionMsg)

	// Invalid action should not generate command and should reset state
	if cmd3 != nil {
		t.Errorf("Expected no command from invalid action key, got: %v", cmd3)
	}
	if handler.IsInSequence() {
		t.Error("Expected to exit sequence after invalid action")
	}
}

// TestNavigationKeySequenceWithTeatest tests key sequences using teatest
func TestNavigationKeySequenceWithTeatest(t *testing.T) {
	log.Get().WithComponent("test")

	projects := []*model.Project{
		{Name: "assistant", Path: "/workspace/assistant", KeyBinding: 'a'},
		{Name: "finance", Path: "/workspace/finance", KeyBinding: 'f'},
	}

	nav := NewNavigationListComponent()
	nav.SetProjects(projects)

	// Create teatest model
	tm := teatest.NewTestModel(
		t, nav,
		teatest.WithInitialTermSize(40, 20),
	)

	// Test project selection and action
	t.Run("SelectProjectZsh", func(t *testing.T) {
		// Send project key
		tm.Send(tea.KeyMsg{
			Type:  tea.KeyRunes,
			Runes: []rune{'a'},
		})

		// Small delay for state update
		time.Sleep(10 * time.Millisecond)

		// Send action key
		tm.Send(tea.KeyMsg{
			Type:  tea.KeyRunes,
			Runes: []rune{'z'},
		})

		// Wait for render
		teatest.WaitFor(t, tm.Output(), func(bts []byte) bool {
			// Just verify it renders without panic
			return len(bts) > 0
		}, teatest.WithDuration(100*time.Millisecond))
	})

	t.Run("CancelSequenceWithEsc", func(t *testing.T) {
		// Reset
		nav := NewNavigationListComponent()
		nav.SetProjects(projects)
		tm := teatest.NewTestModel(t, nav)

		// Start sequence
		tm.Send(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'f'}})
		time.Sleep(10 * time.Millisecond)

		// Cancel with ESC
		tm.Send(tea.KeyMsg{Type: tea.KeyEsc})
		time.Sleep(10 * time.Millisecond)

		// Try new sequence
		tm.Send(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'a'}})
		time.Sleep(10 * time.Millisecond)
		tm.Send(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'c'}})

		// Verify it completes
		teatest.WaitFor(t, tm.Output(), func(bts []byte) bool {
			return len(bts) > 0
		}, teatest.WithDuration(100*time.Millisecond))
	})
}
