package ui

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// TestWorktreeShellSelection verifies correct worktree and shell type selection
func TestWorktreeShellSelection(t *testing.T) {
	log.Get().WithComponent("test")

	// Create projects with worktrees
	projects := []*model.Project{
		{
			Name:       "assistant",
			Path:       "/workspace/assistant",
			KeyBinding: 'a',
			Worktrees: []*model.Worktree{
				{
					ID:         "feature-xyz",
					Branch:     "feature/xyz",
					Path:       "/workspace/assistant/.worktrees/feature-xyz",
					KeyBinding: 'x',
				},
			},
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
	}

	nav := NewNavigationListComponent()
	nav.SetProjects(projects)

	testCases := []struct {
		name            string
		worktreeKey     rune
		actionKey       rune
		expectMsgType   interface{}
		expectProject   string
		expectWorktree  string
		expectShellType model.ShellType
	}{
		{
			name:            "Assistant feature-xyz zsh",
			worktreeKey:     'x',
			actionKey:       'z',
			expectMsgType:   WorktreeShellMsg{},
			expectProject:   "assistant",
			expectWorktree:  "feature-xyz",
			expectShellType: model.ShellTypeZsh,
		},
		{
			name:            "Finance tools-migration claude",
			worktreeKey:     't',
			actionKey:       'c', 
			expectMsgType:   WorktreeShellMsg{},
			expectProject:   "finance",
			expectWorktree:  "finance-tools-migration",
			expectShellType: model.ShellTypeClaude,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Clear any previous state
			nav.sequenceHandler.ClearSequence()
			
			// Debug: Check what keys are actually assigned
			for _, p := range projects {
				t.Logf("Project %s has key '%c'", p.Name, p.KeyBinding)
				for _, w := range p.Worktrees {
					t.Logf("  Worktree %s has key '%c'", w.ID, w.KeyBinding)
				}
			}
			
			// Find the actual assigned key for this test
			var actualKey rune
			for _, p := range projects {
				for _, w := range p.Worktrees {
					if w.ID == tc.expectWorktree {
						actualKey = w.KeyBinding
						break
					}
				}
				if actualKey != 0 {
					break
				}
			}
			
			if actualKey == 0 {
				t.Fatalf("Could not find worktree %s", tc.expectWorktree)
			}
			
			t.Logf("Using actual key '%c' for worktree %s", actualKey, tc.expectWorktree)
			
			// First key: select worktree
			worktreeKeyMsg := tea.KeyMsg{
				Type:  tea.KeyRunes,
				Runes: []rune{actualKey},
			}
			_, cmd1 := nav.Update(worktreeKeyMsg)
			if cmd1 != nil {
				t.Errorf("First key should not generate command, got: %v", cmd1)
			}

			// Verify we're in sequence
			if !nav.sequenceHandler.IsInSequence() {
				t.Fatalf("Should be in sequence after first key (key '%c')", actualKey)
			}

			// Second key: action
			actionKeyMsg := tea.KeyMsg{
				Type:  tea.KeyRunes,
				Runes: []rune{tc.actionKey},
			}
			_, cmd2 := nav.Update(actionKeyMsg)
			if cmd2 == nil {
				t.Fatal("Expected command from action key")
			}

			// Execute command and verify message type
			msg := cmd2()
			wtMsg, ok := msg.(WorktreeShellMsg)
			if !ok {
				t.Errorf("Expected WorktreeShellMsg, got %T", msg)
				return
			}

			// Verify message content
			if wtMsg.Project.Name != tc.expectProject {
				t.Errorf("Expected project %s, got %s", tc.expectProject, wtMsg.Project.Name)
			}
			if wtMsg.Worktree.ID != tc.expectWorktree {
				t.Errorf("Expected worktree %s, got %s", tc.expectWorktree, wtMsg.Worktree.ID)
			}
			if wtMsg.ShellType != tc.expectShellType {
				t.Errorf("Expected shell type %v, got %v", tc.expectShellType, wtMsg.ShellType)
			}

			// Verify sequence is cleared after action
			if nav.sequenceHandler.IsInSequence() {
				t.Error("Sequence should be cleared after action")
			}
		})
	}
}

// TestWorktreeVsProjectSelection verifies distinction between project and worktree selection
func TestWorktreeVsProjectSelection(t *testing.T) {
	log.Get().WithComponent("test")

	projects := []*model.Project{
		{
			Name:       "finance",
			Path:       "/workspace/finance",
			KeyBinding: 'f',
			Worktrees: []*model.Worktree{
				{
					ID:         "finance-tools",
					Branch:     "tools",
					Path:       "/workspace/finance/.worktrees/finance-tools",
					KeyBinding: 't',
				},
			},
		},
	}

	nav := NewNavigationListComponent()
	nav.SetProjects(projects)

	t.Run("ProjectSelection", func(t *testing.T) {
		nav.sequenceHandler.ClearSequence()
		
		// First key: select project 'f'
		projectKeyMsg := tea.KeyMsg{
			Type:  tea.KeyRunes,
			Runes: []rune{'f'},
		}
		_, cmd1 := nav.Update(projectKeyMsg)
		if cmd1 != nil {
			t.Errorf("First key should not generate command, got: %v", cmd1)
		}

		// Second key: action 'z' (zsh shell)
		actionKeyMsg := tea.KeyMsg{
			Type:  tea.KeyRunes,
			Runes: []rune{'z'},
		}
		_, cmd2 := nav.Update(actionKeyMsg)
		if cmd2 == nil {
			t.Fatal("Expected command from action key")
		}

		msg := cmd2()
		if _, ok := msg.(ProjectShellMsg); !ok {
			t.Errorf("Expected ProjectShellMsg, got %T", msg)
		}
	})

	t.Run("WorktreeSelection", func(t *testing.T) {
		nav.sequenceHandler.ClearSequence()
		
		// First key: select worktree 't'
		worktreeKeyMsg := tea.KeyMsg{
			Type:  tea.KeyRunes,
			Runes: []rune{'t'},
		}
		_, cmd1 := nav.Update(worktreeKeyMsg)
		if cmd1 != nil {
			t.Errorf("First key should not generate command, got: %v", cmd1)
		}

		// Second key: action 'z' (zsh shell)
		actionKeyMsg := tea.KeyMsg{
			Type:  tea.KeyRunes,
			Runes: []rune{'z'},
		}
		_, cmd2 := nav.Update(actionKeyMsg)
		if cmd2 == nil {
			t.Fatal("Expected command from action key")
		}

		msg := cmd2()
		if _, ok := msg.(WorktreeShellMsg); !ok {
			t.Errorf("Expected WorktreeShellMsg, got %T", msg)
		}
	})
}
