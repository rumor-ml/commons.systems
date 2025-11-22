package model

import (
	"testing"
	"time"
)

func TestNewRepository(t *testing.T) {
	repo := NewRepository("test-repo", "/path/to/repo")

	if repo.Name != "test-repo" {
		t.Errorf("Expected name 'test-repo', got '%s'", repo.Name)
	}

	if repo.Path != "/path/to/repo" {
		t.Errorf("Expected path '/path/to/repo', got '%s'", repo.Path)
	}

	if repo.MainShells == nil {
		t.Error("Expected MainShells to be initialized")
	}

	if repo.Branches == nil {
		t.Error("Expected Branches to be initialized")
	}

	if !repo.Expanded {
		t.Error("Expected repository to be expanded by default")
	}

	if repo.Status != ProjectStatusNormal {
		t.Errorf("Expected status to be Normal, got %s", repo.Status)
	}
}

func TestNewBranch(t *testing.T) {
	branch := NewBranch("main", "refs/heads/main", "")

	if branch.Name != "main" {
		t.Errorf("Expected name 'main', got '%s'", branch.Name)
	}

	if branch.FullName != "refs/heads/main" {
		t.Errorf("Expected full name 'refs/heads/main', got '%s'", branch.FullName)
	}

	if branch.Remote != "" {
		t.Errorf("Expected remote to be empty, got '%s'", branch.Remote)
	}

	if branch.IsRemoteOnly {
		t.Error("Expected local branch to not be remote-only")
	}

	if branch.Status != ProjectStatusNormal {
		t.Errorf("Expected status to be Normal, got %s", branch.Status)
	}
}

func TestNewBranchRemote(t *testing.T) {
	branch := NewBranch("feature", "refs/remotes/origin/feature", "origin")

	if branch.Name != "feature" {
		t.Errorf("Expected name 'feature', got '%s'", branch.Name)
	}

	if branch.Remote != "origin" {
		t.Errorf("Expected remote 'origin', got '%s'", branch.Remote)
	}

	if !branch.IsRemoteOnly {
		t.Error("Expected remote branch to be remote-only")
	}
}

func TestBranchHasWorktree(t *testing.T) {
	// Branch without worktree
	branch1 := NewBranch("main", "refs/heads/main", "")
	if branch1.HasWorktree() {
		t.Error("Expected branch without worktree to return false")
	}

	// Branch with worktree
	branch2 := NewBranch("feature", "refs/heads/feature", "")
	branch2.Worktree = NewWorktree("feature", "feature", "/path/to/worktree", "feature")
	if !branch2.HasWorktree() {
		t.Error("Expected branch with worktree to return true")
	}
}

func TestBranchGetDisplayName(t *testing.T) {
	tests := []struct {
		name     string
		branch   *Branch
		expected string
	}{
		{
			name:     "local branch",
			branch:   NewBranch("main", "refs/heads/main", ""),
			expected: "main",
		},
		{
			name: "remote branch",
			branch: &Branch{
				Name:         "feature",
				Remote:       "origin",
				IsRemoteOnly: true,
			},
			expected: "origin/feature",
		},
		{
			name: "remote branch without remote-only flag",
			branch: &Branch{
				Name:         "develop",
				Remote:       "upstream",
				IsRemoteOnly: false,
			},
			expected: "develop",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.branch.GetDisplayName()
			if got != tt.expected {
				t.Errorf("Expected display name '%s', got '%s'", tt.expected, got)
			}
		})
	}
}

func TestBranchIsBlocked(t *testing.T) {
	branch := NewBranch("main", "refs/heads/main", "")

	if branch.IsBlocked() {
		t.Error("Expected new branch to not be blocked")
	}

	branch.Status = ProjectStatusBlocked
	if !branch.IsBlocked() {
		t.Error("Expected blocked branch to return true")
	}
}

func TestBranchIsTesting(t *testing.T) {
	branch := NewBranch("main", "refs/heads/main", "")

	if branch.IsTesting() {
		t.Error("Expected new branch to not be in testing")
	}

	branch.Status = ProjectStatusTesting
	if !branch.IsTesting() {
		t.Error("Expected testing branch to return true")
	}
}

func TestBranchWithWorktreeFullLifecycle(t *testing.T) {
	// Create a branch
	branch := NewBranch("feature-123", "refs/heads/feature-123", "")
	branch.IsCurrent = false
	branch.CommitHash = "abc123"
	branch.LastModified = time.Now()

	// Initially no worktree
	if branch.HasWorktree() {
		t.Error("Expected new branch to not have worktree")
	}

	// Add a worktree
	worktree := NewWorktree("feature-123", "feature-123", "/repo/.worktrees/feature-123", "feature-123")
	branch.Worktree = worktree

	// Now has worktree
	if !branch.HasWorktree() {
		t.Error("Expected branch with worktree to return true")
	}

	// Set status
	branch.Status = ProjectStatusTesting
	if !branch.IsTesting() {
		t.Error("Expected testing branch to return true")
	}

	// Display name should be simple for local branch
	if branch.GetDisplayName() != "feature-123" {
		t.Errorf("Expected display name 'feature-123', got '%s'", branch.GetDisplayName())
	}
}

func TestRepositoryWithBranches(t *testing.T) {
	repo := NewRepository("monorepo", "/path/to/monorepo")

	// Add main branch
	main := NewBranch("main", "refs/heads/main", "")
	main.IsCurrent = true
	repo.Branches = append(repo.Branches, main)

	// Add feature branch with worktree
	feature := NewBranch("feature", "refs/heads/feature", "")
	feature.Worktree = NewWorktree("feature", "feature", "/path/to/worktree", "feature")
	repo.Branches = append(repo.Branches, feature)

	// Add remote-only branch
	remote := NewBranch("remote-feature", "refs/remotes/origin/remote-feature", "origin")
	repo.Branches = append(repo.Branches, remote)

	// Verify repository structure
	if len(repo.Branches) != 3 {
		t.Errorf("Expected 3 branches, got %d", len(repo.Branches))
	}

	// Verify current branch
	if !repo.Branches[0].IsCurrent {
		t.Error("Expected first branch to be current")
	}

	// Verify worktree association
	if !repo.Branches[1].HasWorktree() {
		t.Error("Expected feature branch to have worktree")
	}

	// Verify remote branch
	if !repo.Branches[2].IsRemoteOnly {
		t.Error("Expected third branch to be remote-only")
	}
}
