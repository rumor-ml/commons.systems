package git

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/natb1/tui/pkg/model"
)

func TestNewBranchService(t *testing.T) {
	service := NewBranchService("/path/to/repo")

	if service.repoPath != "/path/to/repo" {
		t.Errorf("Expected repo path '/path/to/repo', got '%s'", service.repoPath)
	}
}

func TestConvertToModelBranch(t *testing.T) {
	service := NewBranchService("/path/to/repo")

	tests := []struct {
		name       string
		branchInfo *BranchInfo
		wantName   string
		wantRemote string
	}{
		{
			name: "local branch",
			branchInfo: &BranchInfo{
				Name:         "main",
				FullName:     "refs/heads/main",
				Remote:       "",
				IsCurrent:    true,
				IsRemoteOnly: false,
				CommitHash:   "abc123",
			},
			wantName:   "main",
			wantRemote: "",
		},
		{
			name: "remote branch",
			branchInfo: &BranchInfo{
				Name:         "feature",
				FullName:     "refs/remotes/origin/feature",
				Remote:       "origin",
				IsCurrent:    false,
				IsRemoteOnly: true,
				CommitHash:   "def456",
			},
			wantName:   "feature",
			wantRemote: "origin",
		},
		{
			name: "branch with worktree",
			branchInfo: &BranchInfo{
				Name:         "develop",
				FullName:     "refs/heads/develop",
				Remote:       "",
				IsCurrent:    false,
				IsRemoteOnly: false,
				CommitHash:   "ghi789",
				WorktreePath: "/path/to/repo/.worktrees/develop",
			},
			wantName:   "develop",
			wantRemote: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			branch := service.ConvertToModelBranch(tt.branchInfo, nil)

			if branch.Name != tt.wantName {
				t.Errorf("Expected name '%s', got '%s'", tt.wantName, branch.Name)
			}

			if branch.Remote != tt.wantRemote {
				t.Errorf("Expected remote '%s', got '%s'", tt.wantRemote, branch.Remote)
			}

			if branch.IsCurrent != tt.branchInfo.IsCurrent {
				t.Errorf("Expected IsCurrent %v, got %v", tt.branchInfo.IsCurrent, branch.IsCurrent)
			}

			if branch.IsRemoteOnly != tt.branchInfo.IsRemoteOnly {
				t.Errorf("Expected IsRemoteOnly %v, got %v", tt.branchInfo.IsRemoteOnly, branch.IsRemoteOnly)
			}

			if branch.CommitHash != tt.branchInfo.CommitHash {
				t.Errorf("Expected CommitHash '%s', got '%s'", tt.branchInfo.CommitHash, branch.CommitHash)
			}

			// Check worktree association
			if tt.branchInfo.WorktreePath != "" && tt.branchInfo.WorktreePath != service.repoPath {
				if branch.Worktree == nil {
					t.Error("Expected branch to have worktree")
				} else {
					if branch.Worktree.Path != tt.branchInfo.WorktreePath {
						t.Errorf("Expected worktree path '%s', got '%s'", tt.branchInfo.WorktreePath, branch.Worktree.Path)
					}
				}
			}
		})
	}
}

func TestBranchDisplayName(t *testing.T) {
	service := NewBranchService("/path/to/repo")

	// Local branch
	localBranch := service.ConvertToModelBranch(&BranchInfo{
		Name:         "main",
		FullName:     "refs/heads/main",
		IsRemoteOnly: false,
	}, nil)

	if localBranch.GetDisplayName() != "main" {
		t.Errorf("Expected local branch display name 'main', got '%s'", localBranch.GetDisplayName())
	}

	// Remote branch
	remoteBranch := service.ConvertToModelBranch(&BranchInfo{
		Name:         "feature",
		Remote:       "origin",
		FullName:     "refs/remotes/origin/feature",
		IsRemoteOnly: true,
	}, nil)

	if remoteBranch.GetDisplayName() != "origin/feature" {
		t.Errorf("Expected remote branch display name 'origin/feature', got '%s'", remoteBranch.GetDisplayName())
	}
}

// Integration tests - only run if git is available
func TestListAllBranches_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// Check if git is available
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("Git not available, skipping integration test")
	}

	// Create a temporary git repo
	tmpDir, err := os.MkdirTemp("", "git-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Initialize git repo
	cmd := exec.Command("git", "init")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to init git repo: %v", err)
	}

	// Configure git user
	exec.Command("git", "-C", tmpDir, "config", "user.email", "test@example.com").Run()
	exec.Command("git", "-C", tmpDir, "config", "user.name", "Test User").Run()

	// Create initial commit
	testFile := filepath.Join(tmpDir, "test.txt")
	os.WriteFile(testFile, []byte("test"), 0644)
	exec.Command("git", "-C", tmpDir, "add", "test.txt").Run()
	exec.Command("git", "-C", tmpDir, "commit", "-m", "initial commit").Run()

	// Create a feature branch
	exec.Command("git", "-C", tmpDir, "branch", "feature").Run()

	// Test ListAllBranches
	service := NewBranchService(tmpDir)
	branches, err := service.ListAllBranches()
	if err != nil {
		t.Fatalf("ListAllBranches failed: %v", err)
	}

	if len(branches) < 1 {
		t.Errorf("Expected at least 1 branch, got %d", len(branches))
	}

	// Check for main/master branch
	foundMain := false
	for _, branch := range branches {
		if branch.Name == "main" || branch.Name == "master" {
			foundMain = true
			if !branch.IsCurrent {
				t.Error("Expected main/master branch to be current")
			}
			if branch.IsRemoteOnly {
				t.Error("Expected main/master branch to be local, not remote-only")
			}
		}
	}

	if !foundMain {
		t.Error("Expected to find main or master branch")
	}
}

func TestGetWorktreesForBranches_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// Check if git is available
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("Git not available, skipping integration test")
	}

	// Create a temporary git repo
	tmpDir, err := os.MkdirTemp("", "git-worktree-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Initialize git repo
	cmd := exec.Command("git", "init")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to init git repo: %v", err)
	}

	// Configure git
	exec.Command("git", "-C", tmpDir, "config", "user.email", "test@example.com").Run()
	exec.Command("git", "-C", tmpDir, "config", "user.name", "Test User").Run()

	// Create initial commit
	testFile := filepath.Join(tmpDir, "test.txt")
	os.WriteFile(testFile, []byte("test"), 0644)
	exec.Command("git", "-C", tmpDir, "add", "test.txt").Run()
	exec.Command("git", "-C", tmpDir, "commit", "-m", "initial commit").Run()

	// Create a worktree
	worktreeDir := filepath.Join(tmpDir, ".worktrees", "feature")
	os.MkdirAll(filepath.Dir(worktreeDir), 0755)
	cmd = exec.Command("git", "worktree", "add", "-b", "feature", worktreeDir)
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create worktree: %v", err)
	}

	// Test GetWorktreesForBranches
	service := NewBranchService(tmpDir)
	branches := []*BranchInfo{
		{
			Name:     "feature",
			FullName: "refs/heads/feature",
		},
	}

	err = service.GetWorktreesForBranches(branches)
	if err != nil {
		t.Fatalf("GetWorktreesForBranches failed: %v", err)
	}

	// Check if worktree was mapped
	if branches[0].WorktreePath == "" {
		t.Error("Expected feature branch to have worktree path")
	}
}

func TestBranchStatusPropagation(t *testing.T) {
	service := NewBranchService("/path/to/repo")

	branchInfo := &BranchInfo{
		Name:         "feature",
		FullName:     "refs/heads/feature",
		WorktreePath: "/path/to/worktree",
	}

	branch := service.ConvertToModelBranch(branchInfo, nil)

	// Set status on branch
	branch.Status = model.ProjectStatusBlocked

	// Check status propagates to worktree
	if branch.Worktree == nil {
		t.Fatal("Expected branch to have worktree")
	}

	// Initially worktree has its own status
	if branch.Worktree.Status != model.ProjectStatusNormal {
		t.Errorf("Expected worktree to have normal status initially, got %s", branch.Worktree.Status)
	}

	// But branch status should be blocked
	if !branch.IsBlocked() {
		t.Error("Expected branch to be blocked")
	}
}

func TestListRemoteBranchesAndWorktrees_Filtering(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// Check if git is available
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("Git not available, skipping integration test")
	}

	// Create a temporary git repo
	tmpDir, err := os.MkdirTemp("", "git-remote-filter-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Initialize git repo
	cmd := exec.Command("git", "init")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to init git repo: %v", err)
	}

	// Configure git
	exec.Command("git", "-C", tmpDir, "config", "user.email", "test@example.com").Run()
	exec.Command("git", "-C", tmpDir, "config", "user.name", "Test User").Run()
	exec.Command("git", "-C", tmpDir, "config", "commit.gpgsign", "false").Run()

	// Create initial commit and set up main branch
	testFile := filepath.Join(tmpDir, "test.txt")
	os.WriteFile(testFile, []byte("test"), 0644)
	exec.Command("git", "-C", tmpDir, "add", "test.txt").Run()

	// Create main branch and initial commit
	exec.Command("git", "-C", tmpDir, "config", "init.defaultBranch", "main").Run()
	cmd = exec.Command("git", "-C", tmpDir, "commit", "-m", "initial commit")
	if _, err := cmd.CombinedOutput(); err != nil {
		// Try with -b main if default branch wasn't set
		exec.Command("git", "-C", tmpDir, "checkout", "-b", "main").Run()
		cmd = exec.Command("git", "-C", tmpDir, "commit", "-m", "initial commit")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("Failed to create initial commit: %v, output: %s", err, string(output))
		}
	}

	// Create a stale local branch (no worktree)
	cmd = exec.Command("git", "-C", tmpDir, "branch", "stale-local")
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Logf("Failed to create stale-local branch: %v, output: %s", err, string(output))
	}

	// Create a local branch with worktree
	worktreeDir := filepath.Join(tmpDir, ".worktrees", "active-wt")
	os.MkdirAll(filepath.Dir(worktreeDir), 0755)
	cmd = exec.Command("git", "-C", tmpDir, "worktree", "add", "-b", "active-wt", worktreeDir)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("Failed to create worktree: %v, output: %s", err, string(output))
	}

	// List branches manually to see what git sees
	cmd = exec.Command("git", "-C", tmpDir, "branch", "-a")
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Logf("Git branch list error: %v", err)
	} else {
		t.Logf("Git branches:\n%s", string(output))
	}

	// Test ListRemoteBranchesAndWorktrees
	service := NewBranchService(tmpDir)

	// First, check what all branches look like
	allBranches, err := service.ListAllBranches()
	if err != nil {
		t.Fatalf("ListAllBranches failed: %v", err)
	}
	service.GetWorktreesForBranches(allBranches)

	t.Logf("All branches before filtering (count=%d):", len(allBranches))
	for _, branch := range allBranches {
		t.Logf("  Branch: %s, Remote: %s, IsRemoteOnly: %v, WorktreePath: %s",
			branch.Name, branch.Remote, branch.IsRemoteOnly, branch.WorktreePath)
	}

	filtered, err := service.ListRemoteBranchesAndWorktrees()
	if err != nil {
		t.Fatalf("ListRemoteBranchesAndWorktrees failed: %v", err)
	}

	// Log filtered branches for debugging
	t.Logf("Filtered branches (count=%d):", len(filtered))
	for _, branch := range filtered {
		t.Logf("  Branch: %s, Remote: %s, IsRemoteOnly: %v, WorktreePath: %s",
			branch.Name, branch.Remote, branch.IsRemoteOnly, branch.WorktreePath)
	}

	// Check that stale local branch is NOT included
	foundStaleLocal := false
	for _, branch := range filtered {
		if branch.Name == "stale-local" && !branch.IsRemoteOnly {
			foundStaleLocal = true
		}
	}
	if foundStaleLocal {
		t.Error("Expected stale local branch to be filtered out")
	}

	// Check that active worktree branch IS included
	foundActiveWorktree := false
	for _, branch := range filtered {
		if branch.Name == "active-wt" {
			t.Logf("Found active-wt branch: IsRemoteOnly=%v, WorktreePath=%s", branch.IsRemoteOnly, branch.WorktreePath)
			if branch.WorktreePath != "" {
				foundActiveWorktree = true
			}
		}
	}
	if !foundActiveWorktree {
		t.Error("Expected active worktree branch to be included")
	}
}

func TestFetchFromRemote_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// Check if git is available
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("Git not available, skipping integration test")
	}

	// Create a temporary git repo
	tmpDir, err := os.MkdirTemp("", "git-fetch-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Initialize git repo
	cmd := exec.Command("git", "init")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to init git repo: %v", err)
	}

	// Configure git
	exec.Command("git", "-C", tmpDir, "config", "user.email", "test@example.com").Run()
	exec.Command("git", "-C", tmpDir, "config", "user.name", "Test User").Run()
	exec.Command("git", "-C", tmpDir, "config", "commit.gpgsign", "false").Run()

	// Create initial commit
	testFile := filepath.Join(tmpDir, "test.txt")
	os.WriteFile(testFile, []byte("test"), 0644)
	exec.Command("git", "-C", tmpDir, "add", "test.txt").Run()
	exec.Command("git", "-C", tmpDir, "commit", "-m", "initial commit").Run()

	// Test FetchFromRemote (will fail without remote, but shouldn't crash)
	service := NewBranchService(tmpDir)
	err = service.FetchFromRemote()

	// It's OK if fetch fails when there's no remote configured
	// The important thing is that it doesn't crash
	if err != nil {
		t.Logf("Fetch failed as expected without remote: %v", err)
	}
}
