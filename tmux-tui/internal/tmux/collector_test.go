package tmux

import (
	"os"
	"testing"

	"github.com/commons-systems/tmux-tui/internal/tmux/testutil"
)

func TestCollectorGetTree(t *testing.T) {
	// Set TMUX environment variable for test
	os.Setenv("TMUX", "/tmp/tmux-test,1234,0")
	defer os.Unsetenv("TMUX")

	// Mock tmux output with proper format
	tmuxOutput := "%1|@1|0|zsh|1|0|/home/user/repo1|zsh|host.local|1001\n" +
		"%2|@2|1|vim|0|0|/home/user/repo2|vim|host.local|1002\n"

	// Mock git outputs for both repos
	gitOutputs := map[string]string{
		"-C /home/user/repo1 rev-parse --git-common-dir":  "/home/user/repo1/.git",
		"-C /home/user/repo1 rev-parse --abbrev-ref HEAD": "main",
		"-C /home/user/repo2 rev-parse --git-common-dir":  "/home/user/repo2/.git",
		"-C /home/user/repo2 rev-parse --abbrev-ref HEAD": "feature-branch",
	}

	mockExec := &testutil.MockCommandExecutor{
		TmuxOutput: tmuxOutput,
		GitOutputs: gitOutputs,
		PgrepPIDs:  "",
		PsCommands: map[string]string{},
	}

	collector, err := NewCollectorWithExecutor(mockExec)
	if err != nil {
		t.Fatalf("NewCollectorWithExecutor() returned error: %v", err)
	}

	tree, err := collector.GetTree()
	if err != nil {
		t.Fatalf("GetTree() returned error: %v", err)
	}

	repos := tree.Repos()
	if len(repos) == 0 {
		t.Fatal("GetTree() returned empty tree")
	}

	// Verify structure
	if !tree.HasRepo("repo1") {
		t.Error("Expected repo1 in tree")
	}
	if !tree.HasRepo("repo2") {
		t.Error("Expected repo2 in tree")
	}

	// Verify branches
	if tree.HasRepo("repo1") {
		if !tree.HasBranch("repo1", "main") {
			t.Error("Expected main branch in repo1")
		}
	}
	if tree.HasRepo("repo2") {
		if !tree.HasBranch("repo2", "feature-branch") {
			t.Error("Expected feature-branch in repo2")
		}
	}

	// Verify panes
	for _, repo := range tree.Repos() {
		for _, branch := range tree.Branches(repo) {
			panes, ok := tree.GetPanes(repo, branch)
			if !ok || len(panes) == 0 {
				t.Errorf("Branch %s/%s has no panes", repo, branch)
			}
			for _, pane := range panes {
				if pane.ID() == "" {
					t.Error("Found pane with empty ID")
				}
				if pane.Path() == "" {
					t.Error("Found pane with empty Path")
				}
				if pane.Command() == "" {
					t.Error("Found pane with empty Command")
				}
			}
		}
	}
}

func TestCollectorExcludesPane(t *testing.T) {
	// Set TMUX environment variable for test
	os.Setenv("TMUX", "/tmp/tmux-test,1234,0")
	defer os.Unsetenv("TMUX")

	// Mock tmux output including a tmux-tui pane
	tmuxOutput := "%1|@1|0|zsh|1|0|/home/user/repo1|zsh|host.local|1001\n" +
		"%2|@1|0|tmux-tui|1|0|/home/user/repo1|tmux-tui|host.local|1002\n" +
		"%3|@2|1|vim|0|0|/home/user/repo2|vim|host.local|1003\n"

	gitOutputs := map[string]string{
		"-C /home/user/repo1 rev-parse --git-common-dir":  "/home/user/repo1/.git",
		"-C /home/user/repo1 rev-parse --abbrev-ref HEAD": "main",
		"-C /home/user/repo2 rev-parse --git-common-dir":  "/home/user/repo2/.git",
		"-C /home/user/repo2 rev-parse --abbrev-ref HEAD": "main",
	}

	mockExec := &testutil.MockCommandExecutor{
		TmuxOutput: tmuxOutput,
		GitOutputs: gitOutputs,
		PgrepPIDs:  "",
		PsCommands: map[string]string{},
	}

	collector, err := NewCollectorWithExecutor(mockExec)
	if err != nil {
		t.Fatalf("NewCollectorWithExecutor() returned error: %v", err)
	}

	tree, err := collector.GetTree()
	if err != nil {
		t.Fatalf("GetTree() returned error: %v", err)
	}

	// Verify that no pane with command "tmux-tui" is present in the tree
	for _, repo := range tree.Repos() {
		for _, branch := range tree.Branches(repo) {
			panes, ok := tree.GetPanes(repo, branch)
			if !ok {
				continue
			}
			for _, pane := range panes {
				if pane.Command() == "tmux-tui" {
					t.Errorf("Found pane with command 'tmux-tui' (ID: %s) in the tree, should be excluded", pane.ID())
				}
			}
		}
	}

	// Verify we still have the other panes
	totalPanes := 0
	for _, repo := range tree.Repos() {
		for _, branch := range tree.Branches(repo) {
			panes, ok := tree.GetPanes(repo, branch)
			if ok {
				totalPanes += len(panes)
			}
		}
	}

	if totalPanes != 2 {
		t.Errorf("Expected 2 panes after exclusion, got %d", totalPanes)
	}
}
