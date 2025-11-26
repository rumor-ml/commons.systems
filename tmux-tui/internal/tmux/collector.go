package tmux

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// Collector collects tmux and git information
type Collector struct{}

// NewCollector creates a new Collector instance
func NewCollector() *Collector {
	return &Collector{}
}

// GetTree collects all panes from the current tmux session and organizes them into a RepoTree
func (c *Collector) GetTree() (RepoTree, error) {
	// Get the current session from TMUX environment variable
	tmuxEnv := os.Getenv("TMUX")
	if tmuxEnv == "" {
		return nil, fmt.Errorf("not running inside tmux")
	}

	// Query all panes in the current session
	// Format: pane_id|window_id|window_index|window_name|window_active|pane_current_path|pane_current_command
	cmd := exec.Command("tmux", "list-panes", "-s", "-F", "#{pane_id}|#{window_id}|#{window_index}|#{window_name}|#{window_active}|#{pane_current_path}|#{pane_current_command}")
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to list panes: %w", err)
	}

	tree := make(RepoTree)
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")

	for _, line := range lines {
		if line == "" {
			continue
		}

		parts := strings.Split(line, "|")
		if len(parts) != 7 {
			continue
		}

		paneID := parts[0]
		windowID := parts[1]
		windowIndexStr := parts[2]
		// windowName is parts[3] but we don't use it anymore
		windowActiveStr := parts[4]
		panePath := parts[5]
		command := parts[6]

		windowIndex, _ := strconv.Atoi(windowIndexStr)
		windowActive := windowActiveStr == "1"

		// Get git info for this path
		repo, branch := c.getGitInfo(panePath)

		// Use "unknown" if not in a git repo
		if repo == "" {
			repo = "unknown"
		}
		if branch == "" {
			branch = "unknown"
		}

		// Initialize nested maps if needed
		if tree[repo] == nil {
			tree[repo] = make(map[string][]Pane)
		}

		// Add pane to the tree (flattened - no window grouping)
		pane := Pane{
			ID:           paneID,
			Path:         panePath,
			WindowID:     windowID,
			WindowIndex:  windowIndex,
			WindowActive: windowActive,
			Command:      command,
		}
		tree[repo][branch] = append(tree[repo][branch], pane)
	}

	return tree, nil
}

// getGitInfo returns the repository name and branch for a given path
func (c *Collector) getGitInfo(path string) (repo, branch string) {
	// Get repository root using --git-common-dir to handle worktrees correctly
	cmd := exec.Command("git", "-C", path, "rev-parse", "--git-common-dir")
	output, err := cmd.Output()
	if err != nil {
		return "", ""
	}
	gitCommonDir := strings.TrimSpace(string(output))

	// Resolve to absolute path if relative (e.g., ".git" from main repo)
	if !filepath.IsAbs(gitCommonDir) {
		gitCommonDir = filepath.Join(path, gitCommonDir)
	}

	// Get the parent directory of .git (the actual repo name)
	repoPath := filepath.Dir(gitCommonDir)
	repo = filepath.Base(repoPath)

	// Get current branch
	cmd = exec.Command("git", "-C", path, "rev-parse", "--abbrev-ref", "HEAD")
	output, err = cmd.Output()
	if err != nil {
		return repo, ""
	}
	branch = strings.TrimSpace(string(output))

	return repo, branch
}
