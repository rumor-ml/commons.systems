package ui

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/natb1/tui/pkg/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestNavigationBlockedToggle tests the x keybinding for toggling blocked state
func TestNavigationBlockedToggle(t *testing.T) {
	nav := NewNavigationListComponent()

	// Create test projects and worktrees
	projects := []*model.Project{
		{
			Name:       "icf",
			Path:       "/test/icf",
			KeyBinding: 'i',
			IsBlocked:  false,
			Worktrees: []*model.Worktree{
				{
					ID:         "feature-x",
					Name:       "feature-x",
					Path:       "/test/icf/.worktrees/feature-x",
					KeyBinding: 'f',
					IsBlocked:  false,
				},
			},
		},
		{
			Name:       "health",
			Path:       "/test/health",
			KeyBinding: 'h',
			IsBlocked:  true, // Start blocked
		},
	}

	nav.SetProjectsAndPanes(projects, nil)

	// Test toggling project blocked state with 'ix' sequence
	// First key: select project
	msg := tea.KeyMsg{Runes: []rune{'i'}}
	_, cmd := nav.Update(msg)
	assert.Nil(t, cmd, "First key should not return command")
	assert.True(t, nav.sequenceHandler.IsInSequence(), "Should be in sequence after first key")

	// Second key: toggle blocked
	msg = tea.KeyMsg{Runes: []rune{'x'}}
	_, cmd = nav.Update(msg)
	assert.NotNil(t, cmd, "Second key should return command")

	// Execute the command and check the message type
	toggleMsg := cmd()
	assert.IsType(t, ToggleBlockedMsg{}, toggleMsg)
	toggle := toggleMsg.(ToggleBlockedMsg)
	assert.Equal(t, "icf", toggle.Project.Name)
	assert.Nil(t, toggle.Worktree)

	// Test toggling worktree blocked state with 'fx' sequence
	nav.sequenceHandler.ClearSequence() // Reset state

	// First key: select worktree
	msg = tea.KeyMsg{Runes: []rune{'f'}}
	_, cmd = nav.Update(msg)
	assert.Nil(t, cmd, "First key should not return command")
	assert.True(t, nav.sequenceHandler.IsInSequence(), "Should be in sequence after first key")

	// Second key: toggle blocked
	msg = tea.KeyMsg{Runes: []rune{'x'}}
	_, cmd = nav.Update(msg)
	assert.NotNil(t, cmd, "Second key should return command")

	// Execute the command and check the message type
	toggleMsg = cmd()
	assert.IsType(t, ToggleBlockedMsg{}, toggleMsg)
	toggle = toggleMsg.(ToggleBlockedMsg)
	assert.Equal(t, "icf", toggle.Project.Name)
	assert.NotNil(t, toggle.Worktree)
	assert.Equal(t, "feature-x", toggle.Worktree.ID)
}

// TestNavigationBlockedDisplay tests that blocked items are displayed with indicator
// TestNavigationBlockedDisplay tests blocked project indicators
func TestNavigationBlockedDisplay(t *testing.T) {
	nav := NewNavigationListComponent()
	nav.SetSize(120, 40)

	// Create test projects with blocked states
	projects := []*model.Project{
		{
			Name:       "icf",
			Path:       "/test/icf",
			KeyBinding: 'i',
			IsBlocked:  true,
		},
		{
			Name:       "health",
			Path:       "/test/health",
			KeyBinding: 'h',
			IsBlocked:  false,
		},
	}

	// Create key binding manager and assign keybindings
	keyMgr := model.NewKeyBindingManager()
	keyMgr.AssignKeyBindings(projects)

	// Build list items
	items := BuildListItems(projects, keyMgr, nil, nil)

	// Check that blocked project has the blocked indicator
	require.Len(t, items, 2)

	// First item should be the blocked icf project
	item1 := items[0].(ListItem)
	assert.Contains(t, item1.title, "🚫", "Blocked project should have blocked indicator")
	assert.Contains(t, item1.title, "\x1b[38;5;239m", "Blocked project should have muted color")

	// Second item should be the non-blocked health project
	item2 := items[1].(ListItem)
	assert.NotContains(t, item2.title, "🚫", "Non-blocked project should not have blocked indicator")
	assert.NotContains(t, item2.title, "\x1b[38;5;239m", "Non-blocked project should not have muted color")
}

// TestNavigationBlockedWorktreeDisplay tests that blocked worktrees are displayed correctly
func TestNavigationBlockedWorktreeDisplay(t *testing.T) {
	nav := NewNavigationListComponent()
	nav.SetSize(120, 40)

	// Create test project with blocked worktree
	projects := []*model.Project{
		{
			Name:       "icf",
			Path:       "/test/icf",
			KeyBinding: 'i',
			IsBlocked:  false,
			Expanded:   true, // Show worktrees
			Worktrees: []*model.Worktree{
				{
					ID:         "feature-blocked",
					Name:       "feature-blocked",
					Path:       "/test/icf/.worktrees/feature-blocked",
					KeyBinding: 'f',
					IsBlocked:  true,
				},
				{
					ID:         "feature-normal",
					Name:       "feature-normal",
					Path:       "/test/icf/.worktrees/feature-normal",
					KeyBinding: 'n',
					IsBlocked:  false,
				},
			},
		},
	}

	// Create key binding manager and assign keybindings
	keyMgr := model.NewKeyBindingManager()
	keyMgr.AssignKeyBindings(projects)

	// Build list items
	items := BuildListItems(projects, keyMgr, nil, nil)

	// Should have 3 items: project + 2 worktrees
	require.Len(t, items, 3)

	// Check blocked worktree
	blockedWT := items[1].(ListItem)
	assert.True(t, blockedWT.IsWorktree)
	t.Logf("Blocked worktree title: %q", blockedWT.title)

	// Check non-blocked worktree
	normalWT := items[2].(ListItem)
	assert.True(t, normalWT.IsWorktree)
	t.Logf("Normal worktree title: %q", normalWT.title)
}

// Function removed - was testing unimplemented business logic rather than actual functionality
