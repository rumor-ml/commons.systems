package ui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
	"github.com/stretchr/testify/require"
)

// TestNavigationXKeyDebug tests the 'x' key handling in detail
func TestNavigationXKeyDebug(t *testing.T) {
	log.Get().WithComponent("test")

	// Create navigation component
	nav := NewNavigationComponent()

	// Set up test projects
	projects := []*model.Project{
		model.NewProject("assistant", "/Users/n8/intent/assistant"),
	}
	nav.SetProjects(projects)
	nav.SetSize(80, 25)

	listNav := nav.listNav

	t.Run("XKeyAlone", func(t *testing.T) {
		listNav.sequenceHandler.ClearSequence()
		
		// Press 'x' key
		keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'x'}}
		_, cmd := listNav.Update(keyMsg)

		// 'x' key alone should not generate a command or change state
		if cmd != nil {
			t.Errorf("Expected no command from 'x' key alone, got: %v", cmd)
		}

		inSequence, _ := listNav.sequenceHandler.GetSequenceStatus()
		if inSequence {
			t.Error("'x' key alone should not change sequence state")
		}
	})

	t.Run("ValidSequenceWithX", func(t *testing.T) {
		listNav.sequenceHandler.ClearSequence()

		// Get the actual key for assistant project
		var assistantKey rune
		for _, p := range projects {
			if p.Name == "assistant" {
				assistantKey = p.KeyBinding
				break
			}
		}

		// First press project key
		projectKeyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{assistantKey}}
		_, cmd1 := listNav.Update(projectKeyMsg)
		if cmd1 != nil {
			t.Errorf("Project key should not generate command, got: %v", cmd1)
		}

		inSequence, hint := listNav.sequenceHandler.GetSequenceStatus()
		if !inSequence {
			t.Error("Should be in sequence after project key")
		}
		if !strings.Contains(hint, "assistant") {
			t.Errorf("Status hint should contain 'assistant', got: %s", hint)
		}

		// Then press 'x' key (should work if mapped to an action)
		xKeyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'x'}}
		_, _ = listNav.Update(xKeyMsg)

		inSequence, _ = listNav.sequenceHandler.GetSequenceStatus()
		if inSequence {
			t.Error("Should exit sequence after action key")
		}

		// 'x' is typically mapped to some action, so we might get a command
		// The specific behavior depends on the KeySequenceHandler implementation
	})
}

// TestNavigationXKeySequenceStates tests all the sequence states
func TestNavigationXKeySequenceStates(t *testing.T) {
	log.Get().WithComponent("test")

	nav := NewNavigationComponent()
	nav.SetSize(120, 40)

	// Create test projects
	projects := []*model.Project{
		{
			Name:      "assistant",
			Path:      "/test/assistant",
			IsBlocked: false,
		},
		{
			Name:      "icf",
			Path:      "/test/icf", 
			IsBlocked: false,
		},
	}

	nav.SetProjects(projects)
	listNav := nav.listNav
	require.NotNil(t, listNav)

	testCases := []struct {
		name          string
		keys          []rune
		expectCommand bool
		expectInSequence bool
	}{
		{
			name:          "Direct x key press",
			keys:          []rune{'x'},
			expectCommand: false,
			expectInSequence: false,
		},
		{
			name:          "Valid project then invalid action",
			keys:          []rune{'a', 'q'}, // 'a' for assistant, 'q' invalid action
			expectCommand: false,
			expectInSequence: false, // Should exit sequence on invalid action
		},
		{
			name:          "Valid project then valid action",
			keys:          []rune{'a', 'z'}, // 'a' for assistant, 'z' for zsh
			expectCommand: true,
			expectInSequence: false, // Should exit sequence after action
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Reset state
			listNav.sequenceHandler.ClearSequence()

			var finalCmd tea.Cmd
			for _, key := range tc.keys {
				keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{key}}
				_, cmd := listNav.Update(keyMsg)
				if cmd != nil {
					finalCmd = cmd
				}
			}

			inSequence, _ := listNav.sequenceHandler.GetSequenceStatus()
			if tc.expectInSequence != inSequence {
				t.Errorf("Expected in sequence: %v, got: %v", tc.expectInSequence, inSequence)
			}

			if tc.expectCommand {
				if finalCmd == nil {
					t.Error("Expected command but got none")
				}
			} else {
				if finalCmd != nil {
					t.Errorf("Expected no command but got: %v", finalCmd)
				}
			}
		})
	}
}