package model

import (
	"testing"
)

func TestNewProject(t *testing.T) {
	project := NewProject("test", "/path/to/test")

	if project.Name != "test" {
		t.Errorf("Expected name 'test', got '%s'", project.Name)
	}

	if project.Path != "/path/to/test" {
		t.Errorf("Expected path '/path/to/test', got '%s'", project.Path)
	}

	// Check initialization
	if project.MainShells == nil {
		t.Error("MainShells should be initialized")
	}

	if project.Worktrees == nil {
		t.Error("Worktrees should be initialized")
	}

	if project.Dashboard != nil {
		t.Error("Dashboard should be nil initially")
	}
}

func TestNewWorktree(t *testing.T) {
	worktree := NewWorktree("wt1", "test-project", "/path/to/worktree", "feature-branch")

	if worktree.ID != "wt1" {
		t.Errorf("Expected ID 'wt1', got '%s'", worktree.ID)
	}

	if worktree.Name != "test-project" {
		t.Errorf("Expected Name 'test-project', got '%s'", worktree.Name)
	}

	if worktree.Path != "/path/to/worktree" {
		t.Errorf("Expected path '/path/to/worktree', got '%s'", worktree.Path)
	}

	if worktree.Branch != "feature-branch" {
		t.Errorf("Expected branch 'feature-branch', got '%s'", worktree.Branch)
	}

	// Check initialization
	if worktree.Shells == nil {
		t.Error("Shells should be initialized")
	}
}

func TestNewShell(t *testing.T) {
	shell := NewShell(ShellTypeZsh, 1234)

	if shell.Type != ShellTypeZsh {
		t.Errorf("Expected type ShellTypeZsh, got %v", shell.Type)
	}

	if shell.ProcessID != 1234 {
		t.Errorf("Expected ProcessID 1234, got %d", shell.ProcessID)
	}

	if shell.Status != ShellStatusStarting {
		t.Errorf("Expected status ShellStatusStarting, got %v", shell.Status)
	}
}

func TestProjectShellMethods(t *testing.T) {
	project := NewProject("test", "/path")

	// Test HasMainShell (should be false initially)
	if project.HasMainShell(ShellTypeZsh) {
		t.Error("Project should not have zsh shell initially")
	}

	// Add a shell and set it to running
	shell := NewShell(ShellTypeZsh, 1234)
	shell.Status = ShellStatusRunning
	project.MainShells[ShellTypeZsh] = shell

	// Test HasMainShell (should be true now)
	if !project.HasMainShell(ShellTypeZsh) {
		t.Error("Project should have zsh shell after adding")
	}

	// Test with non-existent shell type
	if project.HasMainShell(ShellTypeClaude) {
		t.Error("Project should not have claude shell")
	}
}

func TestWorktreeShellMethods(t *testing.T) {
	worktree := NewWorktree("wt1", "test", "/path", "branch")

	// Test HasShell (should be false initially)
	if worktree.HasShell(ShellTypeZsh) {
		t.Error("Worktree should not have zsh shell initially")
	}

	// Add a shell and set it to running
	shell := NewShell(ShellTypeZsh, 1234)
	shell.Status = ShellStatusRunning
	worktree.Shells[ShellTypeZsh] = shell

	// Test HasShell (should be true now)
	if !worktree.HasShell(ShellTypeZsh) {
		t.Error("Worktree should have zsh shell after adding")
	}
}

func TestWorktreeGetDisplayName(t *testing.T) {
	// Test with custom name
	worktree := NewWorktree("wt1", "Custom Name", "/path", "feature-branch")

	if worktree.GetDisplayName() != "Custom Name" {
		t.Errorf("Expected 'Custom Name', got '%s'", worktree.GetDisplayName())
	}

	// Test with empty name (should use branch)
	worktree.Name = ""
	if worktree.GetDisplayName() != "feature-branch" {
		t.Errorf("Expected 'feature-branch', got '%s'", worktree.GetDisplayName())
	}
}

func TestDashboardMethods(t *testing.T) {
	dashboard := &Dashboard{ProcessID: 1234, Status: ShellStatusRunning}

	// Test IsRunning with running status
	if !dashboard.IsRunning() {
		t.Error("Dashboard with running status should be running")
	}

	// Test IsRunning with stopped status
	dashboard.Status = ShellStatusStopped
	if dashboard.IsRunning() {
		t.Error("Dashboard with stopped status should not be running")
	}
}

func TestShellConstants(t *testing.T) {
	// Test that shell type constants are different
	if ShellTypeZsh == ShellTypeClaude {
		t.Error("Shell type constants should be different")
	}

	if ShellTypeZsh == ShellTypeUnknown {
		t.Error("Shell type constants should be different")
	}

	if ShellTypeClaude == ShellTypeUnknown {
		t.Error("Shell type constants should be different")
	}

	// Test specific values
	if ShellTypeZsh != "zsh" {
		t.Errorf("Expected ShellTypeZsh to be 'zsh', got '%s'", ShellTypeZsh)
	}

	if ShellTypeClaude != "claude" {
		t.Errorf("Expected ShellTypeClaude to be 'claude', got '%s'", ShellTypeClaude)
	}

	if ShellTypeUnknown != "unknown" {
		t.Errorf("Expected ShellTypeUnknown to be 'unknown', got '%s'", ShellTypeUnknown)
	}

	// Test that shell status constants are different
	if ShellStatusStarting == ShellStatusRunning {
		t.Error("Shell status constants should be different")
	}

	if ShellStatusRunning == ShellStatusStopped {
		t.Error("Shell status constants should be different")
	}
}

func TestShellPaneTitle(t *testing.T) {
	shell := NewShell(ShellTypeZsh, 12345)

	// Test initial empty pane title
	if shell.PaneTitle != "" {
		t.Errorf("Expected empty PaneTitle initially, got '%s'", shell.PaneTitle)
	}

	// Test setting pane title
	shell.PaneTitle = "* Model Change"
	if shell.PaneTitle != "* Model Change" {
		t.Errorf("Expected PaneTitle '* Model Change', got '%s'", shell.PaneTitle)
	}

	// Test with different shell types
	claudeShell := NewShell(ShellTypeClaude, 12346)
	claudeShell.PaneTitle = "Building project..."
	if claudeShell.PaneTitle != "Building project..." {
		t.Errorf("Expected PaneTitle 'Building project...', got '%s'", claudeShell.PaneTitle)
	}

	unknownShell := NewShell(ShellTypeUnknown, 0)
	unknownShell.PaneTitle = "terminal-session-1"
	if unknownShell.PaneTitle != "terminal-session-1" {
		t.Errorf("Expected PaneTitle 'terminal-session-1', got '%s'", unknownShell.PaneTitle)
	}
}

func TestOtherSessionsProject(t *testing.T) {
	project := NewOtherSessionsProject()

	// Test that it has the correct name
	if project.Name != OtherSessionsProjectName {
		t.Errorf("Expected name '%s', got '%s'", OtherSessionsProjectName, project.Name)
	}

	// Test that it has no path (virtual project)
	if project.Path != "" {
		t.Errorf("Expected empty path for virtual project, got '%s'", project.Path)
	}

	// Test that it's always expanded
	if !project.Expanded {
		t.Error("Other Sessions project should always be expanded")
	}

	// Test that MainShells is initialized
	if project.MainShells == nil {
		t.Error("MainShells should be initialized")
	}

	// Test that Worktrees is initialized
	if project.Worktrees == nil {
		t.Error("Worktrees should be initialized")
	}

	// Test IsOtherSessionsProject method
	if !project.IsOtherSessionsProject() {
		t.Error("IsOtherSessionsProject() should return true for Other Sessions project")
	}

	// Test with regular project
	regularProject := NewProject("regular", "/path")
	if regularProject.IsOtherSessionsProject() {
		t.Error("IsOtherSessionsProject() should return false for regular project")
	}
}

func TestShellTypeUnknown(t *testing.T) {
	// Test creating unknown shell
	shell := NewShell(ShellTypeUnknown, 0)

	if shell.Type != ShellTypeUnknown {
		t.Errorf("Expected shell type 'unknown', got '%s'", shell.Type)
	}

	// Test that unknown shells can have pane titles
	shell.PaneTitle = "terminal-session-1"
	if shell.PaneTitle != "terminal-session-1" {
		t.Errorf("Expected PaneTitle 'terminal-session-1', got '%s'", shell.PaneTitle)
	}

	// Test that unknown shells start with "starting" status
	if shell.Status != ShellStatusStarting {
		t.Errorf("Expected status 'starting', got '%s'", shell.Status)
	}
}
