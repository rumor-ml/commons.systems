package tmux

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

// MockCommandExecutor implements CommandExecutor for testing
type MockCommandExecutor struct {
	TmuxOutput string
	GitOutputs map[string]string // key: command args, value: output
	PgrepPIDs  string
	PsCommands map[string]string // key: PID, value: command
}

func (m *MockCommandExecutor) ExecCommand(name string, args ...string) ([]byte, error) {
	return m.ExecCommandOutput(name, args...)
}

func (m *MockCommandExecutor) ExecCommandOutput(name string, args ...string) ([]byte, error) {
	switch name {
	case "tmux":
		if m.TmuxOutput == "" {
			return nil, fmt.Errorf("tmux command failed")
		}
		return []byte(m.TmuxOutput), nil

	case "git":
		key := strings.Join(args, " ")
		if output, ok := m.GitOutputs[key]; ok {
			return []byte(output), nil
		}
		// Return "not a git repository" error
		return nil, &GitError{
			NotARepo: true,
			Stderr:   "fatal: not a git repository",
		}

	case "pgrep":
		if m.PgrepPIDs == "" {
			// No processes found - simulate exit code 1
			return nil, fmt.Errorf("no processes found")
		}
		return []byte(m.PgrepPIDs), nil

	case "ps":
		if len(args) >= 3 {
			pid := args[len(args)-1]
			if cmd, ok := m.PsCommands[pid]; ok {
				return []byte(cmd), nil
			}
		}
		return nil, fmt.Errorf("process not found")
	}

	return nil, fmt.Errorf("unknown command: %s", name)
}

func TestCollectorGetTree(t *testing.T) {
	// Set TMUX environment variable for test
	os.Setenv("TMUX", "/tmp/tmux-test,1234,0")
	defer os.Unsetenv("TMUX")

	// Mock tmux output with proper format
	tmuxOutput := "%1|@1|0|zsh|1|0|/home/user/repo1|zsh|host.local|1001\n" +
		"%2|@2|1|vim|0|0|/home/user/repo2|vim|host.local|1002\n"

	// Mock git outputs for both repos
	gitOutputs := map[string]string{
		"-C /home/user/repo1 rev-parse --git-common-dir": "/home/user/repo1/.git",
		"-C /home/user/repo1 rev-parse --abbrev-ref HEAD": "main",
		"-C /home/user/repo2 rev-parse --git-common-dir": "/home/user/repo2/.git",
		"-C /home/user/repo2 rev-parse --abbrev-ref HEAD": "feature-branch",
	}

	mockExec := &MockCommandExecutor{
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

	if tree == nil {
		t.Fatal("GetTree() returned nil tree")
	}

	if len(tree) == 0 {
		t.Fatal("GetTree() returned empty tree")
	}

	// Verify structure
	if _, ok := tree["repo1"]; !ok {
		t.Error("Expected repo1 in tree")
	}
	if _, ok := tree["repo2"]; !ok {
		t.Error("Expected repo2 in tree")
	}

	// Verify branches
	if branches, ok := tree["repo1"]; ok {
		if _, ok := branches["main"]; !ok {
			t.Error("Expected main branch in repo1")
		}
	}
	if branches, ok := tree["repo2"]; ok {
		if _, ok := branches["feature-branch"]; !ok {
			t.Error("Expected feature-branch in repo2")
		}
	}

	// Verify panes
	for repo, branches := range tree {
		for branch, panes := range branches {
			if len(panes) == 0 {
				t.Errorf("Branch %s/%s has no panes", repo, branch)
			}
			for _, pane := range panes {
				if pane.ID == "" {
					t.Error("Found pane with empty ID")
				}
				if pane.Path == "" {
					t.Error("Found pane with empty Path")
				}
				if pane.Command == "" {
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
		"-C /home/user/repo1 rev-parse --git-common-dir": "/home/user/repo1/.git",
		"-C /home/user/repo1 rev-parse --abbrev-ref HEAD": "main",
		"-C /home/user/repo2 rev-parse --git-common-dir": "/home/user/repo2/.git",
		"-C /home/user/repo2 rev-parse --abbrev-ref HEAD": "main",
	}

	mockExec := &MockCommandExecutor{
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
	for _, branches := range tree {
		for _, panes := range branches {
			for _, pane := range panes {
				if pane.Command == "tmux-tui" {
					t.Errorf("Found pane with command 'tmux-tui' (ID: %s) in the tree, should be excluded", pane.ID)
				}
			}
		}
	}

	// Verify we still have the other panes
	totalPanes := 0
	for _, branches := range tree {
		for _, panes := range branches {
			totalPanes += len(panes)
		}
	}

	if totalPanes != 2 {
		t.Errorf("Expected 2 panes after exclusion, got %d", totalPanes)
	}
}
