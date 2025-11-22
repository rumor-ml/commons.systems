package app

import (
	"context"
	"testing"

	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/internal/ui"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// TestShellDiscoveryIntegration tests end-to-end shell discovery and display
func TestShellDiscoveryIntegration(t *testing.T) {
	// Initialize logging
	log.Get().WithComponent("test")

	// Create test projects
	projects := []*model.Project{
		model.NewProject("test-project", "/tmp/test-project"),
		model.NewProject("another-project", "/tmp/another-project"),
	}

	// Add shells to first project
	zshShell := model.NewShell(model.ShellTypeZsh, 12345)
	zshShell.Status = model.ShellStatusRunning
	zshShell.PaneTitle = "editing main file"
	projects[0].MainShells[model.ShellTypeZsh] = zshShell

	claudeShell := model.NewShell(model.ShellTypeClaude, 12346)
	claudeShell.Status = model.ShellStatusRunning
	claudeShell.PaneTitle = "* Model Change"
	projects[0].MainShells[model.ShellTypeClaude] = claudeShell

	// Add worktree with shell to first project
	worktree := model.NewWorktree("wt1", "feature-branch", "/tmp/test-project/.worktrees/wt1", "feature")
	wtShell := model.NewShell(model.ShellTypeZsh, 12347)
	wtShell.Status = model.ShellStatusRunning
	wtShell.PaneTitle = "working on feature"
	worktree.Shells[model.ShellTypeZsh] = wtShell
	projects[0].Worktrees = []*model.Worktree{worktree}
	projects[0].Expanded = true

	// Create tmux manager for testing
	ctx := context.Background()
	tmuxManager := terminal.NewTmuxManager(ctx)

	// Test tmux manager functionality
	if tmuxManager != nil {
		// Test mapping functionality
		mappedProjects, err := tmuxManager.MapSessionsToProjects(projects)
		if err != nil {
			t.Errorf("MapSessionsToProjects failed: %v", err)
		}

		// Should have at least the original projects
		if len(mappedProjects) < len(projects) {
			t.Errorf("Expected at least %d projects, got %d", len(projects), len(mappedProjects))
		}

		// Test that project shells are preserved
		foundTestProject := false
		for _, proj := range mappedProjects {
			if proj.Name == "test-project" {
				foundTestProject = true

				// Check main shells
				if zsh := proj.MainShells[model.ShellTypeZsh]; zsh == nil {
					t.Error("Expected zsh shell on test-project")
				} else if zsh.PaneTitle != "editing main file" {
					t.Errorf("Expected zsh pane title 'editing main file', got '%s'", zsh.PaneTitle)
				}

				if claude := proj.MainShells[model.ShellTypeClaude]; claude == nil {
					t.Error("Expected claude shell on test-project")
				} else if claude.PaneTitle != "* Model Change" {
					t.Errorf("Expected claude pane title '* Model Change', got '%s'", claude.PaneTitle)
				}

				// Check worktree shells
				if len(proj.Worktrees) == 0 {
					t.Error("Expected worktree on test-project")
				} else {
					wt := proj.Worktrees[0]
					if wtZsh := wt.Shells[model.ShellTypeZsh]; wtZsh == nil {
						t.Error("Expected zsh shell on worktree")
					} else if wtZsh.PaneTitle != "working on feature" {
						t.Errorf("Expected worktree zsh pane title 'working on feature', got '%s'", wtZsh.PaneTitle)
					}
				}
			}
		}

		if !foundTestProject {
			t.Error("test-project not found in mapped projects")
		}
	}

	// Test UI integration with navigation component
	navComp := ui.NewNavigationComponent()

	// Set projects and test display
	navComp.SetProjects(projects)

	// Test that projects are set correctly
	retrievedProjects := navComp.GetProjects()
	if len(retrievedProjects) != len(projects) {
		t.Errorf("Expected %d projects in navigation, got %d", len(projects), len(retrievedProjects))
	}

	// Test navigation view rendering (basic check)
	view := navComp.View()
	if view == "" {
		t.Error("Navigation view should not be empty")
	}

	t.Logf("Navigation view:\n%s", view)
}

// TestOtherSessionsIntegration tests Other Sessions functionality
func TestOtherSessionsIntegration(t *testing.T) {
	log.Get().WithComponent("test")

	// Create regular project
	regularProject := model.NewProject("regular", "/tmp/regular")

	// Create Other Sessions project
	otherProject := model.NewOtherSessionsProject()

	// Add some unknown shells to Other Sessions
	unknownShell1 := model.NewShell(model.ShellTypeUnknown, 0)
	unknownShell1.Status = model.ShellStatusRunning
	unknownShell1.PaneTitle = "terminal session 1"
	otherProject.MainShells[model.ShellType("session1:window1")] = unknownShell1

	unknownShell2 := model.NewShell(model.ShellTypeUnknown, 0)
	unknownShell2.Status = model.ShellStatusRunning
	unknownShell2.PaneTitle = "monitoring system"
	otherProject.MainShells[model.ShellType("session2:htop")] = unknownShell2

	projects := []*model.Project{regularProject, otherProject}

	// Test UI with Other Sessions
	navComp := ui.NewNavigationComponent()

	navComp.SetProjects(projects)

	// Check that Other Sessions project is handled correctly
	retrievedProjects := navComp.GetProjects()

	foundOtherSessions := false
	for _, proj := range retrievedProjects {
		if proj.IsOtherSessionsProject() {
			foundOtherSessions = true

			// Check that unknown shells are present
			if len(proj.MainShells) == 0 {
				t.Error("Other Sessions project should have shells")
			}

			// Check specific unknown shells
			foundShell1 := false
			foundShell2 := false
			for _, shell := range proj.MainShells {
				if shell.PaneTitle == "terminal session 1" {
					foundShell1 = true
				}
				if shell.PaneTitle == "monitoring system" {
					foundShell2 = true
				}
			}

			if !foundShell1 {
				t.Error("Expected to find 'terminal session 1' in Other Sessions")
			}
			if !foundShell2 {
				t.Error("Expected to find 'monitoring system' in Other Sessions")
			}
		}
	}

	if !foundOtherSessions {
		t.Error("Other Sessions project not found")
	}

	// Test view rendering
	view := navComp.View()
	if view == "" {
		t.Error("Navigation view should not be empty")
	}

	t.Logf("Other Sessions view:\n%s", view)
}

// TestShellTypeEnumIntegration tests that all shell types work together
func TestShellTypeEnumIntegration(t *testing.T) {
	// Test all shell types
	shellTypes := []model.ShellType{
		model.ShellTypeZsh,
		model.ShellTypeClaude,
		model.ShellTypeUnknown,
	}

	for _, shellType := range shellTypes {
		shell := model.NewShell(shellType, 12345)
		shell.Status = model.ShellStatusRunning
		shell.PaneTitle = "test pane for " + string(shellType)

		// Test shell methods
		if !shell.IsRunning() {
			t.Errorf("Shell of type %s should be running", shellType)
		}

		if shell.PaneTitle == "" {
			t.Errorf("Shell of type %s should have pane title", shellType)
		}

		if shell.Type != shellType {
			t.Errorf("Expected shell type %s, got %s", shellType, shell.Type)
		}
	}
}
