package tmux

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Collector collects tmux and git information
type Collector struct {
	claudeCache *ClaudePaneCache
}

// NewCollector creates a new Collector instance
func NewCollector() (*Collector, error) {
	cache, err := NewClaudePaneCache(30 * time.Second)
	if err != nil {
		return nil, fmt.Errorf("failed to create cache: %w", err)
	}
	return &Collector{
		claudeCache: cache,
	}, nil
}

// GetTree collects all panes from the current tmux session and organizes them into a RepoTree
func (c *Collector) GetTree() (RepoTree, error) {
	// Get the current session from TMUX environment variable
	tmuxEnv := os.Getenv("TMUX")
	if tmuxEnv == "" {
		return nil, fmt.Errorf("not running inside tmux")
	}

	// Query all panes in the current session
	// Format: pane_id|window_id|window_index|window_name|window_active|window_bell_flag|pane_current_path|pane_current_command|pane_title|pane_pid
	cmd := exec.Command("tmux", "list-panes", "-s", "-F", "#{pane_id}|#{window_id}|#{window_index}|#{window_name}|#{window_active}|#{window_bell_flag}|#{pane_current_path}|#{pane_current_command}|#{pane_title}|#{pane_pid}")
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to list panes: %w", err)
	}

	tree := make(RepoTree)
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")

	// Track valid pane PIDs for cache cleanup
	validPIDs := make(map[string]bool)

	for _, line := range lines {
		if line == "" {
			continue
		}

		parts := strings.Split(line, "|")
		if len(parts) != 10 {
			continue
		}

		paneID := parts[0]
		windowID := parts[1]
		windowIndexStr := parts[2]
		// windowName is parts[3] but we don't use it anymore
		windowActiveStr := parts[4]
		windowBellStr := parts[5]
		panePath := parts[6]
		command := parts[7]
		paneTitle := parts[8]
		panePID := parts[9]

		// Skip any pane running tmux-tui
		if command == "tmux-tui" {
			continue
		}

		// Track this PID as valid
		if panePID != "" {
			validPIDs[panePID] = true
		}

		windowIndex, _ := strconv.Atoi(windowIndexStr)
		windowActive := windowActiveStr == "1"
		windowBell := windowBellStr == "1"

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
			WindowBell:   windowBell,
			Command:      command,
			Title:        paneTitle,
			IsClaudePane: c.isClaudePane(panePID),
		}
		tree[repo][branch] = append(tree[repo][branch], pane)
	}

	// Clean up cache entries for panes that no longer exist.
	// This is the primary mechanism preventing unbounded cache growth,
	// called on every GetTree() invocation (typically every 30s).
	// CleanupExcept() removes both invalid PIDs and expired entries.
	c.claudeCache.CleanupExcept(validPIDs)

	return tree, nil
}

// ClearCache clears the Claude pane detection cache, forcing fresh checks on next GetTree.
// Call this when external events suggest cached data may be stale (e.g., receiving
// an alert for a pane that might have just started running Claude).
func (c *Collector) ClearCache() {
	c.claudeCache.Clear()
}

// isClaudePane checks if the pane is running Claude by inspecting child processes
// This version uses caching to prevent expensive process checks on every tick
func (c *Collector) isClaudePane(panePID string) bool {
	// Check cache first
	if result, found := c.claudeCache.Get(panePID); found {
		return result
	}

	// Cache miss - do the expensive check
	result := c.isClaudePaneUncached(panePID)

	// Store in cache
	c.claudeCache.Set(panePID, result)

	return result
}

// isClaudePaneUncached performs the actual process inspection without caching
func (c *Collector) isClaudePaneUncached(panePID string) bool {
	if panePID == "" {
		return false
	}

	// Use pgrep to find child processes of the shell
	cmd := exec.Command("pgrep", "-P", panePID)
	output, err := cmd.Output()
	if err != nil {
		// pgrep returns exit code 1 when no processes found - this is expected
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
			return false
		}
		// Actual error - log it
		fmt.Fprintf(os.Stderr, "Warning: Failed to check for Claude process in pane %s: %v\n", panePID, err)
		return false
	}

	// Check each child PID for "claude" in the command
	childPIDs := strings.Split(strings.TrimSpace(string(output)), "\n")
	for _, childPID := range childPIDs {
		if childPID == "" {
			continue
		}

		// Get the command for this child PID
		cmd = exec.Command("ps", "-o", "command=", "-p", childPID)
		output, err := cmd.Output()
		if err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				if exitErr.ExitCode() == 1 {
					// Expected: process exited between pgrep and ps (TOCTOU race)
					continue
				}
				// Unexpected exit code - system issue
				fmt.Fprintf(os.Stderr, "Warning: ps failed for process %s (exit %d): %v\n",
					childPID, exitErr.ExitCode(), err)
				continue
			}
			// Non-exit error
			fmt.Fprintf(os.Stderr, "Error: Failed to run ps for process %s: %v\n", childPID, err)
			continue
		}

		command := strings.ToLower(strings.TrimSpace(string(output)))
		if strings.Contains(command, "claude") {
			return true
		}
	}

	return false
}

// getGitInfo returns the repository name and branch for a given path
func (c *Collector) getGitInfo(path string) (repo, branch string) {
	// Get repository root using --git-common-dir to handle worktrees correctly
	cmd := exec.Command("git", "-C", path, "rev-parse", "--git-common-dir")
	output, err := cmd.Output()
	if err != nil {
		// Git returns exit code 128 for various errors
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 128 {
			stderr := string(exitErr.Stderr)
			if strings.Contains(stderr, "not a git repository") {
				// Expected - path is not in a git repository
				return "", ""
			}
			// Other 128 errors - log with context for debugging
			fmt.Fprintf(os.Stderr, "Git error for %s: %s\n", path, stderr)
			return "", ""
		}
		fmt.Fprintf(os.Stderr, "Warning: Failed to get git info for %s: %v\n", path, err)
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
		// Git returns exit code 128 for various errors
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 128 {
			stderr := string(exitErr.Stderr)
			if strings.Contains(stderr, "not a git repository") {
				// Expected - path is not in a git repository
				return repo, ""
			}
			// Other 128 errors - log with context for debugging
			fmt.Fprintf(os.Stderr, "Git error getting branch for %s: %s\n", path, stderr)
			return repo, ""
		}
		fmt.Fprintf(os.Stderr, "Warning: Failed to get branch for %s: %v\n", path, err)
		return repo, ""
	}
	branch = strings.TrimSpace(string(output))

	return repo, branch
}

// CacheSize returns the number of entries in the Claude pane cache (for testing)
func (c *Collector) CacheSize() int {
	if c.claudeCache == nil {
		return 0
	}
	return c.claudeCache.Size()
}
