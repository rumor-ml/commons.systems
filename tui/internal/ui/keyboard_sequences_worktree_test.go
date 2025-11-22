package ui

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/natb1/tui/pkg/model"
)

func TestHandleKeySequence_CreateWorktreeClaude(t *testing.T) {
	handler := NewKeySequenceHandler()

	// Create test projects
	project := &model.Project{
		Name:       "test-repo",
		Path:       "/path/to/repo",
		MainShells: make(map[model.ShellType]*model.Shell),
		Worktrees:  []*model.Worktree{},
	}

	projects := []*model.Project{project}
	keyMgr := model.NewKeyBindingManager()
	keyMgr.AssignKeyBindings(projects)

	handler.SetProjects(projects, keyMgr)

	// Use the actually assigned keybinding
	if project.KeyBinding == 0 {
		t.Fatal("No keybinding assigned to project")
	}

	// First key: select repository
	msg1 := tea.KeyMsg{
		Type:  tea.KeyRunes,
		Runes: []rune{project.KeyBinding},
	}

	cmd1 := handler.HandleKeySequence(msg1)
	if cmd1 != nil {
		t.Error("Expected first key to not return command")
	}

	if !handler.IsInSequence() {
		t.Error("Expected to be in sequence after first key")
	}

	// Second key: 'C' for create Claude worktree
	msg2 := tea.KeyMsg{
		Type:  tea.KeyRunes,
		Runes: []rune{'C'},
	}

	cmd2 := handler.HandleKeySequence(msg2)
	if cmd2 == nil {
		t.Fatal("Expected second key to return command")
	}

	// Execute the command to get the message
	result := cmd2()

	// Verify it's a CreateWorktreeMsg
	createMsg, ok := result.(CreateWorktreeMsg)
	if !ok {
		t.Fatalf("Expected CreateWorktreeMsg, got %T", result)
	}

	// Verify message contents
	if createMsg.Project.Name != "test-repo" {
		t.Errorf("Expected project name 'test-repo', got '%s'", createMsg.Project.Name)
	}

	if createMsg.ShellType != model.ShellTypeClaude {
		t.Errorf("Expected shell type Claude, got %s", createMsg.ShellType)
	}

	// Verify sequence is cleared
	if handler.IsInSequence() {
		t.Error("Expected sequence to be cleared after valid action")
	}
}

func TestHandleKeySequence_CreateWorktreeZsh(t *testing.T) {
	handler := NewKeySequenceHandler()

	project := &model.Project{
		Name:       "test-repo",
		Path:       "/path/to/repo",
		MainShells: make(map[model.ShellType]*model.Shell),
		Worktrees:  []*model.Worktree{},
	}

	projects := []*model.Project{project}
	keyMgr := model.NewKeyBindingManager()
	keyMgr.AssignKeyBindings(projects)
	handler.SetProjects(projects, keyMgr)

	// Use the actually assigned keybinding
	if project.KeyBinding == 0 {
		t.Fatal("No keybinding assigned to project")
	}

	// First key: select repository
	msg1 := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{project.KeyBinding}}
	handler.HandleKeySequence(msg1)

	// Second key: 'Z' for create Zsh worktree
	msg2 := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'Z'}}
	cmd2 := handler.HandleKeySequence(msg2)

	if cmd2 == nil {
		t.Fatal("Expected second key to return command")
	}

	result := cmd2()
	createMsg, ok := result.(CreateWorktreeMsg)
	if !ok {
		t.Fatalf("Expected CreateWorktreeMsg, got %T", result)
	}

	if createMsg.ShellType != model.ShellTypeZsh {
		t.Errorf("Expected shell type Zsh, got %s", createMsg.ShellType)
	}
}

func TestHandleKeySequence_CreateWorktreeInvalidKey(t *testing.T) {
	handler := NewKeySequenceHandler()

	project := &model.Project{
		Name:       "test-repo",
		Path:       "/path/to/repo",
		MainShells: make(map[model.ShellType]*model.Shell),
		Worktrees:  []*model.Worktree{},
	}

	projects := []*model.Project{project}
	keyMgr := model.NewKeyBindingManager()
	keyMgr.AssignKeyBindings(projects)
	handler.SetProjects(projects, keyMgr)

	// Use the actually assigned keybinding
	if project.KeyBinding == 0 {
		t.Fatal("No keybinding assigned to project")
	}

	// First key: select repository
	msg1 := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{project.KeyBinding}}
	handler.HandleKeySequence(msg1)

	if !handler.IsInSequence() {
		t.Error("Expected to be in sequence")
	}

	// Second key: invalid action key
	msg2 := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'X'}} // Invalid action
	cmd2 := handler.HandleKeySequence(msg2)

	if cmd2 != nil {
		t.Error("Expected invalid key to not return command")
	}

	// Sequence should be cleared
	if handler.IsInSequence() {
		t.Error("Expected sequence to be cleared after invalid action")
	}
}

func TestGetSequenceStatus_WithCreateWorktreeOptions(t *testing.T) {
	handler := NewKeySequenceHandler()

	project := &model.Project{
		Name:       "test-repo",
		Path:       "/path/to/repo",
		MainShells: make(map[model.ShellType]*model.Shell),
		Worktrees:  []*model.Worktree{},
	}

	projects := []*model.Project{project}
	keyMgr := model.NewKeyBindingManager()
	keyMgr.AssignKeyBindings(projects)
	handler.SetProjects(projects, keyMgr)

	// Use the actually assigned keybinding
	if project.KeyBinding == 0 {
		t.Fatal("No keybinding assigned to project")
	}

	// Before any sequence
	inSeq, status := handler.GetSequenceStatus()
	if inSeq {
		t.Error("Expected not to be in sequence initially")
	}

	// Start sequence
	msg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{project.KeyBinding}}
	handler.HandleKeySequence(msg)

	// Check status message
	inSeq, status = handler.GetSequenceStatus()
	if !inSeq {
		t.Error("Expected to be in sequence")
	}

	// Status should mention the new keybindings
	expectedSubstrings := []string{
		"test-repo",
		"c=claude",
		"z=zsh",
		"C=new worktree(claude)",
		"Z=new worktree(zsh)",
		"x=blocked",
		"t=testing",
	}

	for _, substr := range expectedSubstrings {
		if !contains(status, substr) {
			t.Errorf("Expected status to contain '%s', got: %s", substr, status)
		}
	}
}

func TestHandleKeySequence_AllValidActions(t *testing.T) {
	tests := []struct {
		name           string
		actionKey      rune
		expectedMsgType string
	}{
		{"Claude shell", 'c', "ProjectShellMsg"},
		{"Zsh shell", 'z', "ProjectShellMsg"},
		{"Create Claude worktree", 'C', "CreateWorktreeMsg"},
		{"Create Zsh worktree", 'Z', "CreateWorktreeMsg"},
		{"Toggle blocked", 'x', "ToggleBlockedMsg"},
		{"Toggle testing", 't', "ToggleTestingMsg"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := NewKeySequenceHandler()

			project := &model.Project{
				Name:       "test-repo",
				Path:       "/path/to/repo",
				MainShells: make(map[model.ShellType]*model.Shell),
				Worktrees:  []*model.Worktree{},
			}

			projects := []*model.Project{project}
			keyMgr := model.NewKeyBindingManager()
			keyMgr.AssignKeyBindings(projects)
			handler.SetProjects(projects, keyMgr)

			// Use the actually assigned keybinding
			if project.KeyBinding == 0 {
				t.Fatal("No keybinding assigned to project")
			}

			// First key: select repository
			msg1 := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{project.KeyBinding}}
			handler.HandleKeySequence(msg1)

			// Second key: action
			msg2 := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{tt.actionKey}}
			cmd := handler.HandleKeySequence(msg2)

			if cmd == nil {
				t.Fatal("Expected command to be returned")
			}

			result := cmd()

			// Check message type
			switch tt.expectedMsgType {
			case "ProjectShellMsg":
				if _, ok := result.(ProjectShellMsg); !ok {
					t.Errorf("Expected ProjectShellMsg, got %T", result)
				}
			case "CreateWorktreeMsg":
				if _, ok := result.(CreateWorktreeMsg); !ok {
					t.Errorf("Expected CreateWorktreeMsg, got %T", result)
				}
			case "ToggleBlockedMsg":
				if _, ok := result.(ToggleBlockedMsg); !ok {
					t.Errorf("Expected ToggleBlockedMsg, got %T", result)
				}
			case "ToggleTestingMsg":
				if _, ok := result.(ToggleTestingMsg); !ok {
					t.Errorf("Expected ToggleTestingMsg, got %T", result)
				}
			}

			// Verify sequence is cleared
			if handler.IsInSequence() {
				t.Error("Expected sequence to be cleared")
			}
		})
	}
}

// Helper function to check if string contains substring
func contains(s, substr string) bool {
	return len(s) >= len(substr) &&
		(s == substr ||
		 (len(s) > len(substr) &&
		  (s[:len(substr)] == substr ||
		   contains(s[1:], substr))))
}
