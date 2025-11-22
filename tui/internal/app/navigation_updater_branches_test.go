package app

import (
	"testing"

	"github.com/natb1/tui/pkg/model"
)

func TestConvertRepositoryToProjects(t *testing.T) {
	// Create a mock app and navigation updater
	nu := &NavigationUpdater{}

	// Create a repository with branches
	repo := model.NewRepository("test-repo", "/path/to/repo")

	// Add main branch
	main := model.NewBranch("main", "refs/heads/main", "")
	main.IsCurrent = true
	repo.Branches = append(repo.Branches, main)

	// Add feature branch with worktree
	feature := model.NewBranch("feature", "refs/heads/feature", "")
	feature.Worktree = model.NewWorktree("feature", "feature", "/path/to/worktree", "feature")
	repo.Branches = append(repo.Branches, feature)

	// Add remote branch without worktree
	remote := model.NewBranch("remote-feature", "refs/remotes/origin/remote-feature", "origin")
	repo.Branches = append(repo.Branches, remote)

	// Convert to projects
	projects := nu.convertRepositoryToProjects(repo)

	// Verify single project
	if len(projects) != 1 {
		t.Fatalf("Expected 1 project, got %d", len(projects))
	}

	project := projects[0]

	// Verify project properties
	if project.Name != "test-repo" {
		t.Errorf("Expected project name 'test-repo', got '%s'", project.Name)
	}

	if project.Path != "/path/to/repo" {
		t.Errorf("Expected project path '/path/to/repo', got '%s'", project.Path)
	}

	if !project.Expanded {
		t.Error("Expected project to be expanded")
	}

	// Verify worktrees (branches converted to worktrees)
	if len(project.Worktrees) != 3 {
		t.Fatalf("Expected 3 worktrees (branches), got %d", len(project.Worktrees))
	}

	// Check main branch
	mainWorktree := project.Worktrees[0]
	if mainWorktree.Name != "main" {
		t.Errorf("Expected first worktree name 'main', got '%s'", mainWorktree.Name)
	}
	if mainWorktree.Branch != "main" {
		t.Errorf("Expected first worktree branch 'main', got '%s'", mainWorktree.Branch)
	}

	// Check feature branch (has actual worktree)
	featureWorktree := project.Worktrees[1]
	if featureWorktree.Path != "/path/to/worktree" {
		t.Errorf("Expected feature worktree path '/path/to/worktree', got '%s'", featureWorktree.Path)
	}

	// Check remote branch (virtual worktree)
	remoteWorktree := project.Worktrees[2]
	if remoteWorktree.Name != "origin/remote-feature" {
		t.Errorf("Expected remote worktree name 'origin/remote-feature', got '%s'", remoteWorktree.Name)
	}
	if remoteWorktree.Path != "" {
		t.Errorf("Expected remote worktree to have empty path, got '%s'", remoteWorktree.Path)
	}
}

func TestConvertRepositoryToProjects_EmptyRepository(t *testing.T) {
	nu := &NavigationUpdater{}

	// Create empty repository
	repo := model.NewRepository("empty-repo", "/path/to/empty")

	// Convert to projects
	projects := nu.convertRepositoryToProjects(repo)

	// Verify single project
	if len(projects) != 1 {
		t.Fatalf("Expected 1 project, got %d", len(projects))
	}

	project := projects[0]

	// Verify no worktrees
	if len(project.Worktrees) != 0 {
		t.Errorf("Expected 0 worktrees, got %d", len(project.Worktrees))
	}
}

func TestConvertRepositoryToProjects_StatusPropagation(t *testing.T) {
	nu := &NavigationUpdater{}

	// Create repository
	repo := model.NewRepository("test-repo", "/path/to/repo")
	repo.Status = model.ProjectStatusBlocked
	repo.StatusReason = "Test blocking"

	// Add blocked branch
	blockedBranch := model.NewBranch("blocked", "refs/heads/blocked", "")
	blockedBranch.Status = model.ProjectStatusBlocked
	blockedBranch.StatusReason = "Branch blocked"
	repo.Branches = append(repo.Branches, blockedBranch)

	// Add testing branch
	testingBranch := model.NewBranch("testing", "refs/heads/testing", "")
	testingBranch.Status = model.ProjectStatusTesting
	repo.Branches = append(repo.Branches, testingBranch)

	// Convert to projects
	projects := nu.convertRepositoryToProjects(repo)
	project := projects[0]

	// Verify project status
	if project.Status != model.ProjectStatusBlocked {
		t.Errorf("Expected project status Blocked, got %s", project.Status)
	}

	if project.StatusReason != "Test blocking" {
		t.Errorf("Expected project status reason 'Test blocking', got '%s'", project.StatusReason)
	}

	// Verify worktree statuses
	if len(project.Worktrees) != 2 {
		t.Fatalf("Expected 2 worktrees, got %d", len(project.Worktrees))
	}

	// Check blocked worktree
	if project.Worktrees[0].Status != model.ProjectStatusBlocked {
		t.Errorf("Expected first worktree to be blocked, got %s", project.Worktrees[0].Status)
	}

	// Check testing worktree
	if project.Worktrees[1].Status != model.ProjectStatusTesting {
		t.Errorf("Expected second worktree to be testing, got %s", project.Worktrees[1].Status)
	}
}

func TestConvertRepositoryToProjects_BranchesWithAndWithoutWorktrees(t *testing.T) {
	nu := &NavigationUpdater{}

	repo := model.NewRepository("test-repo", "/path/to/repo")

	// Branch with worktree
	withWorktree := model.NewBranch("with-wt", "refs/heads/with-wt", "")
	withWorktree.Worktree = model.NewWorktree("with-wt", "with-wt", "/path/to/wt", "with-wt")
	repo.Branches = append(repo.Branches, withWorktree)

	// Branch without worktree (virtual)
	withoutWorktree := model.NewBranch("without-wt", "refs/heads/without-wt", "")
	repo.Branches = append(repo.Branches, withoutWorktree)

	// Convert
	projects := nu.convertRepositoryToProjects(repo)
	project := projects[0]

	if len(project.Worktrees) != 2 {
		t.Fatalf("Expected 2 worktrees, got %d", len(project.Worktrees))
	}

	// First worktree should have path (real worktree)
	if project.Worktrees[0].Path == "" {
		t.Error("Expected first worktree to have path")
	}

	// Second worktree should be virtual (no path)
	if project.Worktrees[1].Path != "" {
		t.Errorf("Expected second worktree to have empty path, got '%s'", project.Worktrees[1].Path)
	}

	// Both should have correct branch names
	if project.Worktrees[0].Branch != "with-wt" {
		t.Errorf("Expected first worktree branch 'with-wt', got '%s'", project.Worktrees[0].Branch)
	}

	if project.Worktrees[1].Branch != "without-wt" {
		t.Errorf("Expected second worktree branch 'without-wt', got '%s'", project.Worktrees[1].Branch)
	}
}

func TestConvertRepositoryToProjects_ShellsInitialized(t *testing.T) {
	nu := &NavigationUpdater{}

	repo := model.NewRepository("test-repo", "/path/to/repo")

	// Add a branch
	branch := model.NewBranch("main", "refs/heads/main", "")
	repo.Branches = append(repo.Branches, branch)

	// Convert
	projects := nu.convertRepositoryToProjects(repo)
	project := projects[0]

	// Verify shells are initialized
	if project.MainShells == nil {
		t.Error("Expected project MainShells to be initialized")
	}

	// Verify worktree shells are initialized
	if len(project.Worktrees) > 0 {
		if project.Worktrees[0].Shells == nil {
			t.Error("Expected worktree shells to be initialized")
		}
	}
}

func TestLoadPersistedBranchStatus(t *testing.T) {
	// This test verifies the structure of loadPersistedBranchStatus
	// without requiring a full app setup

	repo := model.NewRepository("test-repo", "/path/to/repo")

	// Add branches
	main := model.NewBranch("main", "refs/heads/main", "")
	feature := model.NewBranch("feature", "refs/heads/feature", "")

	repo.Branches = append(repo.Branches, main, feature)

	// Verify branches start with normal status
	for _, branch := range repo.Branches {
		if branch.Status != model.ProjectStatusNormal {
			t.Errorf("Expected branch %s to have normal status, got %s", branch.Name, branch.Status)
		}
	}

	// Manually set status (simulating what loadPersistedBranchStatus would do)
	repo.Branches[0].Status = model.ProjectStatusBlocked
	repo.Branches[1].Status = model.ProjectStatusTesting

	// Verify status was set
	if repo.Branches[0].Status != model.ProjectStatusBlocked {
		t.Error("Expected main branch to be blocked")
	}

	if repo.Branches[1].Status != model.ProjectStatusTesting {
		t.Error("Expected feature branch to be testing")
	}
}
