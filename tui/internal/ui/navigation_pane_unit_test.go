package ui

import (
	"testing"

	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
	"github.com/stretchr/testify/assert"
)

// TestBuildListItemsWithPanes tests that BuildListItems correctly includes tmux panes
func TestBuildListItemsWithPanes(t *testing.T) {
	// Create test project
	project := model.NewProject("test-project", "/workspace/test-project")

	// Create test tmux panes
	panes := map[string]*terminal.TmuxPane{
		"test-session:0.0": {
			SessionName:    "test-session",
			WindowIndex:    0,
			PaneIndex:      0,
			PaneTitle:      "✳ Building Project",
			CurrentCommand: "node",
			CurrentPath:    "/workspace/test-project",
			ShellType:      model.ShellTypeClaude,
			Project:        project,
		},
		"test-session:0.1": {
			SessionName:    "test-session",
			WindowIndex:    0,
			PaneIndex:      1,
			PaneTitle:      "git status",
			CurrentCommand: "zsh",
			CurrentPath:    "/workspace/test-project",
			ShellType:      model.ShellTypeZsh,
			Project:        project,
		},
	}

	// Create key binding manager
	keyMgr := model.NewKeyBindingManager()
	keyMgr.AssignKeyBindings([]*model.Project{project})

	// Build list items
	items := BuildListItems([]*model.Project{project}, keyMgr, panes, nil)

	// Should have: 1 project + 2 panes = 3 items
	assert.Len(t, items, 3, "Should have project plus 2 panes")

	// Convert to ListItems for easier checking
	ListItems := make([]ListItem, len(items))
	for i, item := range items {
		ListItem, ok := item.(ListItem)
		assert.True(t, ok, "All items should be ListItems")
		ListItems[i] = ListItem
	}

	// First item should be the project
	assert.Equal(t, "test-project", ListItems[0].Project.Name)
	assert.Empty(t, ListItems[0].paneTarget, "Project item should not have pane target")

	// Second and third items should be panes
	var claudePaneFound, zshPaneFound bool

	for i := 1; i < len(ListItems); i++ {
		item := ListItems[i]
		assert.NotEmpty(t, item.paneTarget, "Pane items should have pane target")
		assert.Equal(t, project, item.Project, "Pane items should reference the project")

		if item.paneTarget == "test-session:0.0" {
			claudePaneFound = true
			assert.Contains(t, item.title, "🤖", "Claude pane should have Claude icon")
			assert.Contains(t, item.title, "Building Project", "Claude pane should show title")
		}

		if item.paneTarget == "test-session:0.1" {
			zshPaneFound = true
			assert.Contains(t, item.title, "⚡", "Zsh pane should have zsh icon")
			assert.Contains(t, item.title, "git status", "Zsh pane should show title")
		}
	}

	assert.True(t, claudePaneFound, "Should find Claude pane")
	assert.True(t, zshPaneFound, "Should find zsh pane")
}

// TestBuildListItemsWithoutPanes tests behavior when no panes are provided
func TestBuildListItemsWithoutPanes(t *testing.T) {
	// Create test project
	project := model.NewProject("test-project", "/workspace/test-project")

	// Create key binding manager
	keyMgr := model.NewKeyBindingManager()
	keyMgr.AssignKeyBindings([]*model.Project{project})

	// Build list items without panes
	items := BuildListItems([]*model.Project{project}, keyMgr, nil, nil)

	// Should have only 1 item (the project)
	assert.Len(t, items, 1, "Should have only project item when no panes")

	// Check the project item
	ListItem, ok := items[0].(ListItem)
	assert.True(t, ok, "Item should be a ListItem")
	assert.Equal(t, "test-project", ListItem.Project.Name)
	assert.Empty(t, ListItem.paneTarget, "Project item should not have pane target")
}

// TestPaneShellTypeIcons tests that different shell types get correct icons
func TestPaneShellTypeIcons(t *testing.T) {
	// Create test project
	project := model.NewProject("test-project", "/workspace/test-project")

	// Create panes with different shell types
	panes := map[string]*terminal.TmuxPane{
		"session:0.0": {
			SessionName:    "session",
			WindowIndex:    0,
			PaneIndex:      0,
			PaneTitle:      "Terminal Session",
			CurrentCommand: "bash",
			CurrentPath:    "/workspace/test-project",
			ShellType:      model.ShellTypeUnknown,
			Project:        project,
		},
		"session:0.1": {
			SessionName:    "session",
			WindowIndex:    0,
			PaneIndex:      1,
			PaneTitle:      "Code Generation",
			CurrentCommand: "node",
			CurrentPath:    "/workspace/test-project",
			ShellType:      model.ShellTypeClaude,
			Project:        project,
		},
		"session:0.2": {
			SessionName:    "session",
			WindowIndex:    0,
			PaneIndex:      2,
			PaneTitle:      "Shell Session",
			CurrentCommand: "zsh",
			CurrentPath:    "/workspace/test-project",
			ShellType:      model.ShellTypeZsh,
			Project:        project,
		},
	}

	// Create key binding manager
	keyMgr := model.NewKeyBindingManager()
	keyMgr.AssignKeyBindings([]*model.Project{project})

	// Build list items
	items := BuildListItems([]*model.Project{project}, keyMgr, panes, nil)

	// Should have: 1 project + 3 panes = 4 items
	assert.Len(t, items, 4, "Should have project plus 3 panes")

	// Check that panes have correct icons
	var unknownFound, claudeFound, zshFound bool

	for _, item := range items {
		ListItem, ok := item.(ListItem)
		assert.True(t, ok, "All items should be ListItems")

		if ListItem.paneTarget == "session:0.0" {
			unknownFound = true
			assert.Contains(t, ListItem.title, "Terminal Session", "Unknown pane should show title")
			assert.NotContains(t, ListItem.title, "🤖", "Unknown pane should not have Claude icon")
			assert.NotContains(t, ListItem.title, "⚡", "Unknown pane should not have zsh icon")
		}

		if ListItem.paneTarget == "session:0.1" {
			claudeFound = true
			assert.Contains(t, ListItem.title, "🤖", "Claude pane should have Claude icon")
			assert.Contains(t, ListItem.title, "Code Generation", "Claude pane should show title")
		}

		if ListItem.paneTarget == "session:0.2" {
			zshFound = true
			assert.Contains(t, ListItem.title, "⚡", "Zsh pane should have zsh icon")
			assert.Contains(t, ListItem.title, "Shell Session", "Zsh pane should show title")
		}
	}

	assert.True(t, unknownFound, "Should find unknown shell pane")
	assert.True(t, claudeFound, "Should find Claude pane")
	assert.True(t, zshFound, "Should find zsh pane")
}

// TestPaneWorktreeMapping tests that panes are correctly mapped to worktrees
func TestPaneWorktreeMapping(t *testing.T) {
	// Create test project with worktree
	project := model.NewProject("test-project", "/workspace/test-project")
	worktree := model.NewWorktree("feature-branch", "feature-branch", "/workspace/test-project/.worktrees/feature-branch", "feature-branch")
	project.Worktrees = append(project.Worktrees, worktree)

	// Create panes - one in main project, one in worktree
	panes := map[string]*terminal.TmuxPane{
		"session:0.0": {
			SessionName:    "session",
			WindowIndex:    0,
			PaneIndex:      0,
			PaneTitle:      "Main Project",
			CurrentCommand: "zsh",
			CurrentPath:    "/workspace/test-project",
			ShellType:      model.ShellTypeZsh,
			Project:        project,
			Worktree:       nil, // Main project
		},
		"session:1.0": {
			SessionName:    "session",
			WindowIndex:    1,
			PaneIndex:      0,
			PaneTitle:      "Feature Work",
			CurrentCommand: "zsh",
			CurrentPath:    "/workspace/test-project/.worktrees/feature-branch",
			ShellType:      model.ShellTypeZsh,
			Project:        project,
			Worktree:       worktree,
		},
	}

	// Expand project to show worktrees
	project.Expanded = true

	// Create key binding manager
	keyMgr := model.NewKeyBindingManager()
	keyMgr.AssignKeyBindings([]*model.Project{project})

	// Build list items
	items := BuildListItems([]*model.Project{project}, keyMgr, panes, nil)

	// Should have: project + main pane + worktree + worktree pane
	assert.GreaterOrEqual(t, len(items), 4, "Should have at least project, main pane, worktree, and worktree pane")

	// Check that both panes are present with correct indentation
	var mainPaneFound, worktreePaneFound bool

	for _, item := range items {
		ListItem, ok := item.(ListItem)
		assert.True(t, ok, "All items should be ListItems")

		if ListItem.paneTarget == "session:0.0" {
			mainPaneFound = true
			assert.Equal(t, ListItem.Worktree, (*model.Worktree)(nil), "Main project pane should not have worktree")
			assert.Contains(t, ListItem.title, "⚡", "Main pane should have zsh icon")
			assert.Contains(t, ListItem.title, "Main Project", "Main pane should show title")
		}

		if ListItem.paneTarget == "session:1.0" {
			worktreePaneFound = true
			assert.Equal(t, ListItem.Worktree, worktree, "Worktree pane should reference the correct worktree")
			assert.Contains(t, ListItem.title, "⚡", "Worktree pane should have zsh icon")
			assert.Contains(t, ListItem.title, "Feature Work", "Worktree pane should show title")
		}
	}

	assert.True(t, mainPaneFound, "Should find main project pane")
	assert.True(t, worktreePaneFound, "Should find worktree pane")
}
