package terminal

import (
	"context"
	"testing"

	"github.com/natb1/tui/pkg/model"
)

func TestTmuxSessionMapping(t *testing.T) {
	ctx := context.Background()
	tm := NewTmuxManager(ctx)

	// Test basic project mapping functionality
	projects := []*model.Project{
		model.NewProject("assistant", "/Users/test/assistant"),
		model.NewProject("finance", "/Users/test/finance"),
	}

	// Since we can't rely on actual tmux being present, test the data structures
	t.Run("MapSessionsToProjects with empty sessions", func(t *testing.T) {
		mappedProjects, err := tm.MapSessionsToProjects(projects)
		if err != nil {
			t.Fatalf("MapSessionsToProjects failed: %v", err)
		}

		// Should return the same projects if no sessions exist
		if len(mappedProjects) != len(projects) {
			t.Errorf("Expected %d projects, got %d", len(projects), len(mappedProjects))
		}
	})
}

func TestTmuxWindowWithPaneTitle(t *testing.T) {
	// Test TmuxWindow structure with pane title
	window := &TmuxWindow{
		Index:     1,
		Name:      "zsh",
		Command:   "zsh",
		PaneTitle: "* Model Change",
		Active:    true,
	}

	if window.PaneTitle != "* Model Change" {
		t.Errorf("Expected PaneTitle '* Model Change', got '%s'", window.PaneTitle)
	}

	if window.Name != "zsh" {
		t.Errorf("Expected Name 'zsh', got '%s'", window.Name)
	}
}

func TestAddSessionShellsToProject(t *testing.T) {
	ctx := context.Background()
	tm := NewTmuxManager(ctx)

	// Create test project
	project := model.NewProject("test-project", "/Users/test/project")

	// Create test session with windows
	session := &TmuxSession{
		Name:    "test-session",
		Project: project,
		Windows: map[string]*TmuxWindow{
			"zsh": {
				Name:      "zsh",
				Command:   "zsh",
				PaneTitle: "editing files",
				Index:     0,
			},
			"claude": {
				Name:      "claude",
				Command:   "claude",
				PaneTitle: "* Model Change",
				Index:     1,
			},
			"unknown": {
				Name:      "terminal-1",
				Command:   "vim",
				PaneTitle: "terminal-session-1",
				Index:     2,
			},
		},
	}

	// Test adding shells to regular project
	tm.addSessionShellsToProject(session, project)

	// Check that zsh shell was added
	if zshShell := project.MainShells[model.ShellTypeZsh]; zshShell == nil {
		t.Error("Expected zsh shell to be added to project")
	} else {
		if zshShell.PaneTitle != "editing files" {
			t.Errorf("Expected zsh PaneTitle 'editing files', got '%s'", zshShell.PaneTitle)
		}
	}

	// Check that claude shell was added
	if claudeShell := project.MainShells[model.ShellTypeClaude]; claudeShell == nil {
		t.Error("Expected claude shell to be added to project")
	} else {
		if claudeShell.PaneTitle != "* Model Change" {
			t.Errorf("Expected claude PaneTitle '* Model Change', got '%s'", claudeShell.PaneTitle)
		}
	}

	// Check that unknown shell was added (for regular projects, it goes under ShellTypeUnknown)
	if unknownShell := project.MainShells[model.ShellTypeUnknown]; unknownShell == nil {
		t.Error("Expected unknown shell to be added to project")
	} else {
		if unknownShell.PaneTitle != "terminal-session-1" {
			t.Errorf("Expected unknown shell PaneTitle 'terminal-session-1', got '%s'", unknownShell.PaneTitle)
		}
		if unknownShell.Type != model.ShellTypeUnknown {
			t.Errorf("Expected shell type 'unknown', got '%s'", unknownShell.Type)
		}
	}
}

func TestAddSessionShellsToOtherSessions(t *testing.T) {
	ctx := context.Background()
	tm := NewTmuxManager(ctx)

	// Create Other Sessions project
	otherProject := model.NewOtherSessionsProject()

	// Create test session with unknown windows
	session := &TmuxSession{
		Name:    "unknown-session",
		Project: otherProject,
		Windows: map[string]*TmuxWindow{
			"window1": {
				Name:      "window1",
				Command:   "vim",
				PaneTitle: "editing config",
				Index:     0,
			},
			"window2": {
				Name:      "window2",
				Command:   "htop",
				PaneTitle: "system monitor",
				Index:     1,
			},
		},
	}

	// Test adding shells to Other Sessions project
	tm.addSessionShellsToProject(session, otherProject)

	// Check that both windows were added as separate shells
	expectedShells := map[string]string{
		"unknown-session:window1": "editing config",
		"unknown-session:window2": "system monitor",
	}

	foundShells := 0
	for shellType, shell := range otherProject.MainShells {
		if expectedTitle, exists := expectedShells[string(shellType)]; exists {
			if shell.PaneTitle != expectedTitle {
				t.Errorf("Expected PaneTitle '%s' for shell '%s', got '%s'",
					expectedTitle, string(shellType), shell.PaneTitle)
			}
			foundShells++
		}
	}

	if foundShells != len(expectedShells) {
		t.Errorf("Expected %d shells, found %d", len(expectedShells), foundShells)
	}
}

func TestGetSessionCwd(t *testing.T) {
	ctx := context.Background()
	tm := NewTmuxManager(ctx)

	// Test handles tmux availability gracefully

	// Test with non-existent session (should return error)
	cwd, err := tm.getSessionCwd("non-existent-session-12345")

	// Either should error OR return empty string (depending on tmux setup)
	if err == nil && cwd != "" {
		t.Errorf("Expected error or empty cwd for non-existent session, got cwd: %s", cwd)
	}

	// This test mainly verifies the method doesn't panic
	t.Logf("getSessionCwd test completed: cwd='%s', err=%v", cwd, err)
}

func TestDiscoverExistingSessions(t *testing.T) {
	ctx := context.Background()
	tm := NewTmuxManager(ctx)

	// Test that DiscoverExistingSessions handles missing tmux gracefully
	err := tm.DiscoverExistingSessions()

	// Should not return an error even if tmux is not available
	if err != nil {
		t.Errorf("DiscoverExistingSessions should handle missing tmux gracefully, got error: %v", err)
	}
}
