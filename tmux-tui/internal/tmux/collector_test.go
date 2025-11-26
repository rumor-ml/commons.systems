package tmux

import (
	"os"
	"testing"
)

func TestCollectorGetTree(t *testing.T) {
	// Skip if not in tmux
	if os.Getenv("TMUX") == "" {
		t.Skip("Not running inside tmux, skipping test")
	}

	collector := NewCollector()
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
	for repo, branches := range tree {
		if repo == "" {
			t.Error("Found empty repo name")
		}
		for branch, panes := range branches {
			if branch == "" {
				t.Error("Found empty branch name")
			}
			if len(panes) == 0 {
				t.Errorf("Branch %s has no panes", branch)
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
