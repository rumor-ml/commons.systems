package model

import (
	"sort"
	"strings"
	"unicode"
)

// KeyBindingManager manages keybinding assignment and conflict resolution
type KeyBindingManager struct {
	usedKeys     map[rune]bool
	conflictKeys map[rune]bool
	reservedKeys map[rune]bool
}

// NewKeyBindingManager creates a new keybinding manager
func NewKeyBindingManager() *KeyBindingManager {
	// Reserved keys that should be avoided for project/worktree bindings
	reserved := map[rune]bool{
		'q': true, 'Q': true, // Quit
		'?': true, // Help
	}

	return &KeyBindingManager{
		usedKeys:     make(map[rune]bool),
		conflictKeys: make(map[rune]bool),
		reservedKeys: reserved,
	}
}

// AssignKeyBindings assigns keybindings to all projects and their worktrees
func (k *KeyBindingManager) AssignKeyBindings(projects []*Project) {
	// Reset for fresh assignment
	k.usedKeys = make(map[rune]bool)
	k.conflictKeys = make(map[rune]bool)

	// Sort projects by name to ensure deterministic key binding assignment
	// This prevents key bindings from changing due to race conditions
	sortedProjects := make([]*Project, len(projects))
	copy(sortedProjects, projects)
	sort.Slice(sortedProjects, func(i, j int) bool {
		return sortedProjects[i].Name < sortedProjects[j].Name
	})

	// First pass: assign project keybindings in sorted order
	for _, project := range sortedProjects {
		project.KeyBinding = k.chooseKeyForName(project.Name)
	}

	// Second pass: assign worktree keybindings in sorted order
	for _, project := range sortedProjects {
		// Sort worktrees within each project for deterministic assignment
		sortedWorktrees := make([]*Worktree, len(project.Worktrees))
		copy(sortedWorktrees, project.Worktrees)
		sort.Slice(sortedWorktrees, func(i, j int) bool {
			return sortedWorktrees[i].GetDisplayName() < sortedWorktrees[j].GetDisplayName()
		})

		for _, worktree := range sortedWorktrees {
			worktree.KeyBinding = k.chooseKeyForName(worktree.GetDisplayName())
		}
	}
}

// chooseKeyForName chooses the best available key for a given name
func (k *KeyBindingManager) chooseKeyForName(name string) rune {
	name = strings.ToLower(name)

	// Strategy 1: Try first letter if available and not reserved
	if len(name) > 0 {
		firstChar := rune(name[0])
		if k.isAvailable(firstChar) {
			k.usedKeys[firstChar] = true
			return firstChar
		}
	}

	// Strategy 2: Try each letter in the name
	for _, char := range name {
		if unicode.IsLetter(char) && k.isAvailable(char) {
			k.usedKeys[char] = true
			return char
		}
	}

	// Strategy 3: Try digits
	for _, char := range name {
		if unicode.IsDigit(char) && k.isAvailable(char) {
			k.usedKeys[char] = true
			return char
		}
	}

	// Strategy 4: Find any available letter a-z
	for char := 'a'; char <= 'z'; char++ {
		if k.isAvailable(char) {
			k.usedKeys[char] = true
			return char
		}
	}

	// Strategy 5: Find any available digit 0-9
	for char := '0'; char <= '9'; char++ {
		if k.isAvailable(char) {
			k.usedKeys[char] = true
			return char
		}
	}

	// Fallback: use a conflict marker
	conflictChar := '!'
	k.conflictKeys[conflictChar] = true
	return conflictChar
}

// isAvailable returns true if the key is available for assignment
func (k *KeyBindingManager) isAvailable(char rune) bool {
	// Convert to lowercase for consistency
	char = unicode.ToLower(char)

	// Check if reserved
	if k.reservedKeys[char] {
		return false
	}

	// Check if already used
	if k.usedKeys[char] {
		return false
	}

	// Check if in conflict
	if k.conflictKeys[char] {
		return false
	}

	return true
}

// GetKeyBindingDisplay returns the display string for a keybinding
// Returns the character wrapped in brackets for chord mode highlighting
func (k *KeyBindingManager) GetKeyBindingDisplay(char rune, inChordMode bool) string {
	if inChordMode {
		return "[" + string(char) + "]"
	}
	return string(char)
}

// HasConflicts returns true if there are any keybinding conflicts
func (k *KeyBindingManager) HasConflicts() bool {
	return len(k.conflictKeys) > 0
}

// GetConflictKeys returns a list of keys with conflicts
func (k *KeyBindingManager) GetConflictKeys() []rune {
	var conflicts []rune
	for key := range k.conflictKeys {
		conflicts = append(conflicts, key)
	}
	return conflicts
}
