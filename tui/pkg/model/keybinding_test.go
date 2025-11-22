package model

import (
	"testing"
)

func TestNewKeyBindingManager(t *testing.T) {
	manager := NewKeyBindingManager()

	if manager.usedKeys == nil {
		t.Error("usedKeys should be initialized")
	}

	if manager.reservedKeys == nil {
		t.Error("reservedKeys should be initialized")
	}

	if manager.conflictKeys == nil {
		t.Error("conflictKeys should be initialized")
	}

	// Check that reserved keys are set correctly
	expectedReserved := []rune{'q', 'Q', '?'}
	for _, key := range expectedReserved {
		if !manager.reservedKeys[key] {
			t.Errorf("Key '%c' should be reserved", key)
		}
	}

	// Check that keys that are NOT reserved anymore
	notReserved := []rune{'h', 'c', 't', 'a', 's', 'p'}
	for _, key := range notReserved {
		if manager.reservedKeys[key] {
			t.Errorf("Key '%c' should NOT be reserved", key)
		}
	}
}

func TestChooseKeyForName(t *testing.T) {
	manager := NewKeyBindingManager()

	// Test key assignment - 'a' is no longer reserved
	key := manager.chooseKeyForName("assistant")
	if key == 0 {
		t.Error("Should assign some key for 'assistant'")
	}
	// 'a' is not reserved anymore, so it should be assigned
	if key != 'a' {
		t.Errorf("Expected 'a' for 'assistant', got '%c'", key)
	}

	// Test conflict handling - first key is now used
	key2 := manager.chooseKeyForName("another")
	if key2 == key {
		t.Error("Should not reuse the same key for 'another'")
	}

	// Test that a key is assigned
	key3 := manager.chooseKeyForName("backup")
	if key3 == 0 {
		t.Error("Should assign some key for 'backup'")
	}
}

func TestAssignKeyBindings(t *testing.T) {
	manager := NewKeyBindingManager()

	// Create test projects
	projects := []*Project{
		NewProject("assistant", "/path1"),
		NewProject("icf", "/path2"),
		NewProject("health", "/path3"),
		NewProject("finance", "/path4"),
	}

	// Add worktrees to first project
	projects[0].Worktrees = []*Worktree{
		NewWorktree("wt1", "assistant", "/path/wt1", "feature1"),
		NewWorktree("wt2", "assistant", "/path/wt2", "feature2"),
	}

	manager.AssignKeyBindings(projects)

	// Check that all projects have key bindings
	for _, project := range projects {
		if project.KeyBinding == 0 {
			t.Errorf("Project '%s' should have a key binding", project.Name)
		}
	}

	// Check that all worktrees have key bindings
	for _, worktree := range projects[0].Worktrees {
		if worktree.KeyBinding == 0 {
			t.Errorf("Worktree '%s' should have a key binding", worktree.GetDisplayName())
		}
	}

	// Check for uniqueness
	usedKeys := make(map[rune]bool)
	for _, project := range projects {
		if usedKeys[project.KeyBinding] {
			t.Errorf("Duplicate key binding '%c' for project '%s'", project.KeyBinding, project.Name)
		}
		usedKeys[project.KeyBinding] = true

		for _, worktree := range project.Worktrees {
			if usedKeys[worktree.KeyBinding] {
				t.Errorf("Duplicate key binding '%c' for worktree '%s'", worktree.KeyBinding, worktree.GetDisplayName())
			}
			usedKeys[worktree.KeyBinding] = true
		}
	}
}

func TestIsAvailable(t *testing.T) {
	manager := NewKeyBindingManager()

	// Test available key
	if !manager.isAvailable('x') {
		t.Error("Key 'x' should be available initially")
	}

	// Test reserved key
	if manager.isAvailable('q') {
		t.Error("Key 'q' should not be available (reserved)")
	}

	// Mark a key as used
	manager.usedKeys['x'] = true
	if manager.isAvailable('x') {
		t.Error("Key 'x' should not be available after being used")
	}

	// Mark a key as conflicted
	manager.conflictKeys['y'] = true
	if manager.isAvailable('y') {
		t.Error("Key 'y' should not be available when conflicted")
	}
}

func TestGetKeyBindingDisplay(t *testing.T) {
	manager := NewKeyBindingManager()

	// Test normal mode
	display := manager.GetKeyBindingDisplay('a', false)
	if display != "a" {
		t.Errorf("Expected 'a' in normal mode, got '%s'", display)
	}

	// Test chord mode
	display = manager.GetKeyBindingDisplay('a', true)
	if display != "[a]" {
		t.Errorf("Expected '[a]' in chord mode, got '%s'", display)
	}
}

func TestHasConflicts(t *testing.T) {
	manager := NewKeyBindingManager()

	// Initially no conflicts
	if manager.HasConflicts() {
		t.Error("Should not have conflicts initially")
	}

	// Add a conflict
	manager.conflictKeys['x'] = true
	if !manager.HasConflicts() {
		t.Error("Should have conflicts after adding one")
	}
}

func TestGetConflictKeys(t *testing.T) {
	manager := NewKeyBindingManager()

	// Add some conflicts
	manager.conflictKeys['x'] = true
	manager.conflictKeys['y'] = true

	conflicts := manager.GetConflictKeys()
	if len(conflicts) != 2 {
		t.Errorf("Expected 2 conflicts, got %d", len(conflicts))
	}

	// Check that both keys are in the result
	foundX, foundY := false, false
	for _, key := range conflicts {
		if key == 'x' {
			foundX = true
		}
		if key == 'y' {
			foundY = true
		}
	}

	if !foundX || !foundY {
		t.Error("Both conflict keys should be in the result")
	}
}

func TestEdgeCasesKeyAssignment(t *testing.T) {
	manager := NewKeyBindingManager()

	// Test with empty name
	key := manager.chooseKeyForName("")
	if key == 0 {
		t.Error("Should assign some key even for empty name")
	}

	// Test with name containing only reserved characters
	key = manager.chooseKeyForName("?? ")
	if key == 0 {
		t.Error("Should assign some key even for reserved characters")
	}

	// Test with numeric name
	key = manager.chooseKeyForName("123")
	if key != '1' {
		t.Errorf("Expected '1' for numeric name, got '%c'", key)
	}
}

func TestExhaustKeySpace(t *testing.T) {
	manager := NewKeyBindingManager()

	// Try to exhaust the key space
	var projects []*Project

	// Create more projects than available keys (26 letters + 10 digits - reserved = ~32 keys)
	for i := 0; i < 40; i++ {
		name := string(rune('a' + i%26))
		projects = append(projects, NewProject(name, "/path"))
	}

	manager.AssignKeyBindings(projects)

	// All projects should still get some key (fallback should work)
	for i, project := range projects {
		if project.KeyBinding == 0 {
			t.Errorf("Project %d should have received a key binding", i)
		}
	}
}
