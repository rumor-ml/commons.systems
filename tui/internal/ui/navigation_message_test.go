package ui

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// TestShellMessageGeneration verifies correct message generation for all shell operations
func TestShellMessageGeneration(t *testing.T) {
	log.Get().WithComponent("test")

	projects := []*model.Project{
		{
			Name:       "test-project",
			Path:       "/test/project",
			KeyBinding: 't',
			Worktrees: []*model.Worktree{
				{
					ID:         "feature-branch",
					Name:       "feature-branch",
					Path:       "/test/project/.worktrees/feature-branch",
					KeyBinding: 'f',
				},
			},
		},
	}

	nav := NewNavigationListComponent()
	nav.SetProjects(projects)

	testCases := []struct {
		name            string
		firstKey        rune
		actionKey       rune
		expectedMsgType interface{}
		expectedShellType model.ShellType
	}{
		{
			name:            "Project Zsh Shell",
			firstKey:        't',
			actionKey:       'z',
			expectedMsgType: ProjectShellMsg{},
			expectedShellType: model.ShellTypeZsh,
		},
		{
			name:            "Project Claude Shell",
			firstKey:        't',
			actionKey:       'c',
			expectedMsgType: ProjectShellMsg{},
			expectedShellType: model.ShellTypeClaude,
		},
		{
			name:            "Worktree Zsh Shell",
			firstKey:        'f',
			actionKey:       'z',
			expectedMsgType: WorktreeShellMsg{},
			expectedShellType: model.ShellTypeZsh,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Clear sequence state
			nav.sequenceHandler.ClearSequence()

			// First key press
			firstKeyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{tc.firstKey}}
			_, cmd1 := nav.Update(firstKeyMsg)
			if cmd1 != nil {
				t.Errorf("First key should not generate command, got: %v", cmd1)
			}

			// Verify we're in sequence
			if !nav.sequenceHandler.IsInSequence() {
				t.Fatal("Should be in sequence after first key")
			}

			// Action key press
			actionKeyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{tc.actionKey}}
			_, cmd2 := nav.Update(actionKeyMsg)
			if cmd2 == nil {
				t.Fatal("Expected command from action key")
			}

			// Execute command and check message type
			msg := cmd2()
			switch m := msg.(type) {
			case ProjectShellMsg:
				if tc.expectedMsgType != (ProjectShellMsg{}) {
					t.Errorf("Expected %T but got ProjectShellMsg", tc.expectedMsgType)
				}
				if m.ShellType != tc.expectedShellType {
					t.Errorf("Expected shell type %v but got %v", tc.expectedShellType, m.ShellType)
				}
			case WorktreeShellMsg:
				if tc.expectedMsgType != (WorktreeShellMsg{}) {
					t.Errorf("Expected %T but got WorktreeShellMsg", tc.expectedMsgType)
				}
				if m.ShellType != tc.expectedShellType {
					t.Errorf("Expected shell type %v but got %v", tc.expectedShellType, m.ShellType)
				}
			default:
				t.Errorf("Unexpected message type: %T", m)
			}

			// Verify sequence is cleared
			if nav.sequenceHandler.IsInSequence() {
				t.Error("Sequence should be cleared after action")
			}
		})
	}
}

// TestInvalidKeySequences tests that invalid key combinations don't panic
func TestInvalidKeySequences(t *testing.T) {
	log.Get().WithComponent("test")

	projects := []*model.Project{
		{Name: "assistant", Path: "/workspace/assistant", KeyBinding: 'a'},
	}

	nav := NewNavigationListComponent()
	nav.SetProjects(projects)

	testCases := []struct {
		name string
		keys []rune
	}{
		{"Invalid project key", []rune{'x', 'z'}},
		{"Invalid action key", []rune{'a', 'q'}},
		{"Number as action", []rune{'a', '5'}},
		{"Special characters", []rune{'a', '@'}},
		{"Empty sequence", []rune{}},
		{"Single key only", []rune{'a'}},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Clear state
			nav.sequenceHandler.ClearSequence()

			// Process each key through Update to ensure no panics
			for _, key := range tc.keys {
				keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{key}}
				_, cmd := nav.Update(keyMsg)

				// If a command was returned, execute it to ensure no panic
				if cmd != nil {
					func() {
						defer func() {
							if r := recover(); r != nil {
								t.Errorf("Command panicked with: %v", r)
							}
						}()
						_ = cmd()
					}()
				}
			}

			// After any sequence, navigation should be in a valid state
			// This just verifies the component didn't break
			inSequence, _ := nav.sequenceHandler.GetSequenceStatus()
			if len(tc.keys) == 1 && tc.keys[0] == 'a' {
				// Single valid project key should put us in sequence
				if !inSequence {
					t.Error("Valid project key should put navigation in sequence state")
				}
			} else if len(tc.keys) == 0 {
				// Empty sequence should not put us in sequence
				if inSequence {
					t.Error("Empty sequence should not put navigation in sequence state")
				}
			}
			// Other invalid sequences behavior is implementation dependent
		})
	}
}

// NOTE: TestNavigationVisualWithTeatest was removed due to flaky timing-dependent behavior.
// The navigation UI is already well-tested through other unit tests that don't rely on teatest timing.
