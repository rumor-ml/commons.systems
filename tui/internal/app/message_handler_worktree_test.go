package app

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/natb1/tui/internal/git"
	"github.com/natb1/tui/internal/ui"
	"github.com/natb1/tui/pkg/model"
)

func TestCreateWorktreeMsg_Structure(t *testing.T) {
	// Test that CreateWorktreeMsg has the correct structure
	project := &model.Project{
		Name: "test-repo",
		Path: "/path/to/repo",
	}

	msg := ui.CreateWorktreeMsg{
		Project:   project,
		ShellType: model.ShellTypeClaude,
	}

	if msg.Project.Name != "test-repo" {
		t.Errorf("Expected project name 'test-repo', got '%s'", msg.Project.Name)
	}

	if msg.ShellType != model.ShellTypeClaude {
		t.Errorf("Expected shell type Claude, got %s", msg.ShellType)
	}
}

func TestRemoteBranchSelectedMsg_Structure(t *testing.T) {
	project := &model.Project{
		Name: "test-repo",
		Path: "/path/to/repo",
	}

	msg := ui.RemoteBranchSelectedMsg{
		Project:    project,
		BranchName: "feature-123",
		ShellType:  model.ShellTypeZsh,
	}

	if msg.Project.Name != "test-repo" {
		t.Errorf("Expected project name 'test-repo', got '%s'", msg.Project.Name)
	}

	if msg.BranchName != "feature-123" {
		t.Errorf("Expected branch name 'feature-123', got '%s'", msg.BranchName)
	}

	if msg.ShellType != model.ShellTypeZsh {
		t.Errorf("Expected shell type Zsh, got %s", msg.ShellType)
	}
}

func TestWorktreeCreatedMsg_Structure(t *testing.T) {
	project := &model.Project{
		Name: "test-repo",
		Path: "/path/to/repo",
	}

	msg := ui.WorktreeCreatedMsg{
		Project:      project,
		WorktreePath: "/path/to/worktree",
		BranchName:   "feature-123",
	}

	if msg.Project.Name != "test-repo" {
		t.Errorf("Expected project name 'test-repo', got '%s'", msg.Project.Name)
	}

	if msg.WorktreePath != "/path/to/worktree" {
		t.Errorf("Expected worktree path '/path/to/worktree', got '%s'", msg.WorktreePath)
	}

	if msg.BranchName != "feature-123" {
		t.Errorf("Expected branch name 'feature-123', got '%s'", msg.BranchName)
	}
}

// Integration test for worktree creation flow
func TestWorktreeCreationFlow_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// Check if git is available
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("Git not available, skipping integration test")
	}

	// Create a temporary git repo
	tmpDir, err := os.MkdirTemp("", "worktree-flow-test-*")
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

	// Create a remote branch (simulate with local branch that we'll pretend is remote)
	exec.Command("git", "-C", tmpDir, "branch", "feature-remote").Run()

	// Test the branch service
	branchService := git.NewBranchService(tmpDir)

	// List all branches
	branches, err := branchService.ListAllBranches()
	if err != nil {
		t.Fatalf("Failed to list branches: %v", err)
	}

	if len(branches) < 1 {
		t.Fatal("Expected at least one branch")
	}

	// Find the feature branch
	var featureBranch *git.BranchInfo
	for _, b := range branches {
		if b.Name == "feature-remote" {
			featureBranch = b
			break
		}
	}

	if featureBranch == nil {
		t.Fatal("Feature branch not found")
	}

	// Create worktree
	worktreePath, err := branchService.CreateWorktreeForBranch(featureBranch, "feature-remote")
	if err != nil {
		t.Fatalf("Failed to create worktree: %v", err)
	}

	// Verify worktree was created
	if _, err := os.Stat(worktreePath); os.IsNotExist(err) {
		t.Errorf("Worktree path does not exist: %s", worktreePath)
	}

	// Verify worktree appears in git worktree list
	listBranches := []*git.BranchInfo{{Name: "feature-remote", FullName: "refs/heads/feature-remote"}}
	err = branchService.GetWorktreesForBranches(listBranches)
	if err != nil {
		t.Fatalf("Failed to get worktrees: %v", err)
	}

	if listBranches[0].WorktreePath == "" {
		t.Error("Expected feature branch to have worktree path")
	}
}

func TestBranchServiceErrorHandling(t *testing.T) {
	// Test with non-existent repo
	service := git.NewBranchService("/nonexistent/path")

	_, err := service.ListAllBranches()
	if err == nil {
		t.Error("Expected error for non-existent repo")
	}
}

func TestConvertToModelBranchWithWorktree(t *testing.T) {
	service := git.NewBranchService("/path/to/repo")

	branchInfo := &git.BranchInfo{
		Name:         "feature",
		FullName:     "refs/heads/feature",
		Remote:       "",
		IsCurrent:    false,
		IsRemoteOnly: false,
		CommitHash:   "abc123",
		WorktreePath: "/path/to/repo/.worktrees/feature",
	}

	branch := service.ConvertToModelBranch(branchInfo, nil)

	// Verify branch has worktree
	if branch.Worktree == nil {
		t.Fatal("Expected branch to have worktree")
	}

	if branch.Worktree.Path != "/path/to/repo/.worktrees/feature" {
		t.Errorf("Expected worktree path '/path/to/repo/.worktrees/feature', got '%s'", branch.Worktree.Path)
	}

	if branch.Worktree.Branch != "feature" {
		t.Errorf("Expected worktree branch 'feature', got '%s'", branch.Worktree.Branch)
	}
}

func TestGetRemoteBranchesWithoutWorktrees_FiltersCorrectly(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// Check if git is available
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("Git not available, skipping integration test")
	}

	// Create a temporary git repo
	tmpDir, err := os.MkdirTemp("", "remote-branches-test-*")
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

	// Create a local branch with worktree
	worktreeDir := filepath.Join(tmpDir, ".worktrees", "local-wt")
	os.MkdirAll(filepath.Dir(worktreeDir), 0755)
	exec.Command("git", "-C", tmpDir, "worktree", "add", "-b", "local-wt", worktreeDir).Run()

	// Create a local branch without worktree
	exec.Command("git", "-C", tmpDir, "branch", "local-no-wt").Run()

	// Test GetRemoteBranchesWithoutWorktrees
	service := git.NewBranchService(tmpDir)
	remoteBranches, err := service.GetRemoteBranchesWithoutWorktrees()
	if err != nil {
		t.Fatalf("GetRemoteBranchesWithoutWorktrees failed: %v", err)
	}

	// Verify no local branches are included
	for _, branch := range remoteBranches {
		if !branch.IsRemoteOnly {
			t.Errorf("Expected only remote branches, found local branch: %s", branch.Name)
		}
	}
}
