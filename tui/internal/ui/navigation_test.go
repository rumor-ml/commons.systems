package ui

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestNavigationComponentInit tests navigation component initialization
func TestNavigationComponentInit(t *testing.T) {
	nav := NewNavigationComponent()

	assert.NotNil(t, nav)
	assert.NotNil(t, nav.listNav)
	assert.Equal(t, 120, nav.width) // Default width
	assert.Equal(t, 40, nav.height) // Default height

	// Init should return nil command
	cmd := nav.Init()
	assert.Nil(t, cmd)
}

// TestNavigationComponentUpdate tests message handling
func TestNavigationComponentUpdate(t *testing.T) {
	nav := NewNavigationComponent()

	t.Run("WindowSizeMsg", func(t *testing.T) {
		// WindowSizeMsg is now ignored by NavigationComponent
		// Size should be set explicitly via SetSize()
		msg := tea.WindowSizeMsg{
			Width:  100,
			Height: 50,
		}

		nav.SetSize(100, 50)
		updatedModel, cmd := nav.Update(msg)
		updatedNav := updatedModel.(*NavigationComponent)

		assert.Equal(t, 100, updatedNav.width)
		assert.Equal(t, 50, updatedNav.height)
		assert.Nil(t, cmd)
	})

	t.Run("EscapeKey", func(t *testing.T) {
		msg := tea.KeyMsg{Type: tea.KeyEscape}

		_, cmd := nav.Update(msg)
		require.NotNil(t, cmd)

		// Execute the command to get the message
		resultMsg := cmd()
		_, ok := resultMsg.(NavigationCancelMsg)
		assert.True(t, ok, "Should return NavigationCancelMsg")
	})

	t.Run("WorktreeProgressUpdateMsg", func(t *testing.T) {
		msg := WorktreeProgressUpdateMsg{
			InProgress:  true,
			ProjectName: "test-project",
		}

		updatedModel, cmd := nav.Update(msg)
		updatedNav := updatedModel.(*NavigationComponent)

		assert.True(t, updatedNav.worktreeProgress.InProgress)
		assert.Equal(t, "test-project", updatedNav.worktreeProgress.ProjectName)
		assert.Nil(t, cmd)
	})
}

// TestNavigationComponentView tests view rendering
func TestNavigationComponentView(t *testing.T) {
	nav := NewNavigationComponent()

	t.Run("InitialView", func(t *testing.T) {
		// Since nav has default size, it should show list view
		view := nav.View()
		// View should show the navigation component
		assert.NotEmpty(t, view)
	})

	t.Run("WithSizeSet", func(t *testing.T) {
		nav.SetSize(100, 50)
		view := nav.View()
		// Should still show list view
		assert.NotEmpty(t, view)
	})

	t.Run("WorktreeProgress", func(t *testing.T) {
		nav.worktreeProgress = WorktreeProgress{
			InProgress:  true,
			ProjectName: "my-project",
		}

		view := nav.View()
		assert.Contains(t, view, "Creating worktree for my-project...")
		assert.Contains(t, view, "Please wait...")
	})
}

// TestNavigationComponentProjects tests project management
func TestNavigationComponentProjects(t *testing.T) {
	nav := NewNavigationComponent()
	nav.SetSize(100, 50)

	// Create test projects
	projects := []*model.Project{
		{
			Name: "project1",
			Path: "/path/to/project1",
			Worktrees: []*model.Worktree{
				{
					ID:     "feature-branch",
					Branch: "feature-branch",
					Path:   "/path/to/project1/.worktrees/feature-branch",
				},
			},
			Expanded: true,
		},
		{
			Name: "project2",
			Path: "/path/to/project2",
		},
	}

	nav.SetProjects(projects)

	// The list navigation component should have received the projects
	assert.NotNil(t, nav.listNav)
}

// TestNavigationListKeySequences tests key sequence handling
func TestNavigationListKeySequences(t *testing.T) {
	navList := NewNavigationListComponent()

	// Set up test projects
	projects := []*model.Project{
		model.NewProject("assistant", "/path/to/assistant"),
		model.NewProject("icf", "/path/to/icf"),
	}
	navList.SetProjects(projects)

	t.Run("ProjectSelection", func(t *testing.T) {
		// Clear sequence state before test
		navList.sequenceHandler.ClearSequence()
		
		// Get the actual assigned key for assistant project
		var assistantKey rune
		for _, p := range projects {
			if p.Name == "assistant" {
				assistantKey = p.KeyBinding
				break
			}
		}
		require.NotEqual(t, rune(0), assistantKey, "assistant project should have a key binding")

		// Press the key for assistant project
		msg := tea.KeyMsg{
			Type:  tea.KeyRunes,
			Runes: []rune{assistantKey},
		}

		navList.Update(msg)
		assert.True(t, navList.sequenceHandler.IsInSequence())
		inSequence, hint := navList.sequenceHandler.GetSequenceStatus()
		assert.True(t, inSequence)
		assert.Contains(t, hint, "assistant")
	})

	t.Run("ActionExecution", func(t *testing.T) {
		// Clear sequence state before test
		navList.sequenceHandler.ClearSequence()
		
		// First select assistant project
		var assistantKey rune
		for _, p := range projects {
			if p.Name == "assistant" {
				assistantKey = p.KeyBinding
				break
			}
		}
		
		if assistantKey == 0 {
			t.Fatal("Could not find assistant project key")
		}
		
		// Press project key first
		projectMsg := tea.KeyMsg{
			Type:  tea.KeyRunes,
			Runes: []rune{assistantKey},
		}
		_, cmd1 := navList.Update(projectMsg)
		if cmd1 != nil {
			t.Errorf("Project key should not generate command, got: %v", cmd1)
		}
		
		// Check sequence state
		if !navList.sequenceHandler.IsInSequence() {
			t.Fatal("Should be in sequence after project key")
		}

		// Press 'z' for zsh shell
		msg := tea.KeyMsg{
			Type:  tea.KeyRunes,
			Runes: []rune{'z'},
		}

		_, cmd := navList.Update(msg)
		if cmd == nil {
			t.Fatal("Expected command from 'z' action key, got nil")
		}
		assert.False(t, navList.sequenceHandler.IsInSequence())

		// Execute command to verify message type
		resultMsg := cmd()
		shellMsg, ok := resultMsg.(ProjectShellMsg)
		assert.True(t, ok)
		assert.Equal(t, projects[0], shellMsg.Project)
		assert.Equal(t, model.ShellTypeZsh, shellMsg.ShellType)
	})

	// WorktreeCreation test removed - uppercase key functionality is deprecated
}

// TestShellStatusDisplay tests shell status display formatting
func TestShellStatusDisplay(t *testing.T) {
	// navList := NewNavigationListComponent()
	keyMgr := model.NewKeyBindingManager()

	t.Run("ProjectWithRunningShells", func(t *testing.T) {
		project := model.NewProject("test", "/path")
		project.KeyBinding = 't'

		// Create tmux panes instead of using MainShells
		tmuxPanes := map[string]*terminal.TmuxPane{
			"test:0.0": {
				SessionName:    "test",
				WindowIndex:    0,
				PaneIndex:      0,
				Project:        project,
				ShellType:      model.ShellTypeZsh,
				CurrentCommand: "npm run dev",
			},
			"test:0.1": {
				SessionName: "test",
				WindowIndex: 0,
				PaneIndex:   1,
				Project:     project,
				ShellType:   model.ShellTypeClaude,
			},
		}

		items := BuildListItems([]*model.Project{project}, keyMgr, tmuxPanes, nil)
		// Should have 3 items: project + 2 shell lines
		assert.Len(t, items, 3)

		// Check project item
		projectItem := items[0].(ListItem)
		assert.Equal(t, "[t]est", projectItem.title)

		// Check shell items (order may vary due to map iteration)
		shellTitles := []string{items[1].(ListItem).title, items[2].(ListItem).title}
		assert.Contains(t, shellTitles, "    ⚡ npm run dev")
		assert.Contains(t, shellTitles, "    🤖 Claude")
	})

	t.Run("WorktreeWithShells", func(t *testing.T) {
		project := model.NewProject("test", "/path")
		project.Expanded = true
		project.KeyBinding = 't'

		worktree := model.NewWorktree("feature", "feature", "/path/.worktrees/feature", "feature")
		worktree.KeyBinding = 'f'
		project.Worktrees = append(project.Worktrees, worktree)

		// Create tmux pane for worktree
		tmuxPanes := map[string]*terminal.TmuxPane{
			"test:1.0": {
				SessionName:    "test",
				WindowIndex:    1,
				PaneIndex:      0,
				Project:        project,
				Worktree:       worktree,
				ShellType:      model.ShellTypeZsh,
				CurrentCommand: "go test",
			},
		}

		items := BuildListItems([]*model.Project{project}, keyMgr, tmuxPanes, nil)
		assert.Len(t, items, 3) // Project + worktree + shell line

		// Check worktree item
		wtItem := items[1].(ListItem)
		assert.Equal(t, "  🌿 [f]eature", wtItem.title)

		// Check worktree shell line
		wtShellItem := items[2].(ListItem)
		assert.Equal(t, "    ⚡ go test", wtShellItem.title)
	})

	t.Run("MultipleCommandsDisplay", func(t *testing.T) {
		project := model.NewProject("test", "/path")
		project.KeyBinding = 't'

		// Create tmux panes with commands
		tmuxPanes := map[string]*terminal.TmuxPane{
			"test:0.0": {
				SessionName:    "test",
				WindowIndex:    0,
				PaneIndex:      0,
				Project:        project,
				ShellType:      model.ShellTypeZsh,
				CurrentCommand: "npm run dev",
			},
			"test:0.1": {
				SessionName:    "test",
				WindowIndex:    0,
				PaneIndex:      1,
				Project:        project,
				ShellType:      model.ShellTypeClaude,
				CurrentCommand: "claude code",
			},
		}

		items := BuildListItems([]*model.Project{project}, keyMgr, tmuxPanes, nil)
		// Should have 3 items: project + 2 shell lines
		assert.Len(t, items, 3)

		// Check shell lines show proper commands (order may vary due to map iteration)
		shellTitles := []string{items[1].(ListItem).title, items[2].(ListItem).title}
		assert.Contains(t, shellTitles, "    ⚡ npm run dev")
		assert.Contains(t, shellTitles, "    🤖 claude code")
	})

	t.Run("NoCommandDisplay", func(t *testing.T) {
		project := model.NewProject("test", "/path")
		project.KeyBinding = 't'

		// Create tmux pane with default shell command
		tmuxPanes := map[string]*terminal.TmuxPane{
			"test:0.0": {
				SessionName:    "test",
				WindowIndex:    0,
				PaneIndex:      0,
				Project:        project,
				ShellType:      model.ShellTypeZsh,
				CurrentCommand: "zsh", // Default shell command should not display
			},
		}

		items := BuildListItems([]*model.Project{project}, keyMgr, tmuxPanes, nil)
		// Default "zsh" command is filtered out as boring, so only project item appears
		assert.Len(t, items, 1) // Project only (zsh pane is skipped)

		// Verify it's just the project
		projectItem := items[0].(ListItem)
		assert.Equal(t, "[t]est", projectItem.title)
	})
}

// TestNavigationRefreshDisplay tests the refresh display functionality
func TestNavigationRefreshDisplay(t *testing.T) {
	nav := NewNavigationComponent()
	nav.SetSize(100, 50)

	// Set initial projects
	projects := []*model.Project{
		{
			Name: "project1",
			Path: "/path/to/project1",
		},
	}
	nav.SetProjects(projects)

	// Modify project state
	projects[0].Expanded = false

	// Refresh display
	nav.RefreshDisplay()

	// The view should now include the shell status
	view := nav.View()
	assert.NotEqual(t, "Navigation Loading...", view)
}

// TestNavigationGetProjects tests project retrieval
func TestNavigationGetProjects(t *testing.T) {
	nav := NewNavigationComponent()

	// Initially no projects
	assert.Nil(t, nav.GetProjects())

	// Set projects
	projects := []*model.Project{
		{Name: "project1"},
		{Name: "project2"},
	}
	nav.SetProjects(projects)

	// Should return the same projects
	retrieved := nav.GetProjects()
	assert.Len(t, retrieved, 2)
	assert.Equal(t, "project1", retrieved[0].Name)
	assert.Equal(t, "project2", retrieved[1].Name)
}
