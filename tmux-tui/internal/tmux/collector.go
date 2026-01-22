package tmux

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/commons-systems/tmux-tui/internal/debug"
)

// Collector collects tmux and git information
type Collector struct {
	claudeCache *ClaudePaneCache
	executor    CommandExecutor
}

// NewCollector creates a new Collector instance
func NewCollector() (*Collector, error) {
	cache, err := NewClaudePaneCache(30 * time.Second)
	if err != nil {
		return nil, fmt.Errorf("failed to create cache: %w", err)
	}
	return &Collector{
		claudeCache: cache,
		executor:    &RealCommandExecutor{},
	}, nil
}

// NewCollectorWithExecutor creates a new Collector instance with a custom executor (for testing)
func NewCollectorWithExecutor(executor CommandExecutor) (*Collector, error) {
	cache, err := NewClaudePaneCache(30 * time.Second)
	if err != nil {
		return nil, fmt.Errorf("failed to create cache: %w", err)
	}
	return &Collector{
		claudeCache: cache,
		executor:    executor,
	}, nil
}

// GetTree collects all panes from the current tmux session and organizes them into a RepoTree
func (c *Collector) GetTree() (RepoTree, error) {
	// Get the current session from TMUX environment variable
	tmuxEnv := os.Getenv("TMUX")
	if tmuxEnv == "" {
		return RepoTree{}, fmt.Errorf("not running inside tmux")
	}

	// Query all panes in the current session
	// Format: pane_id|window_id|window_index|window_name|window_active|window_bell_flag|pane_current_path|pane_current_command|pane_title|pane_pid
	output, err := c.executor.ExecCommandOutput("tmux", "list-panes", "-s", "-F", "#{pane_id}|#{window_id}|#{window_index}|#{window_name}|#{window_active}|#{window_bell_flag}|#{pane_current_path}|#{pane_current_command}|#{pane_title}|#{pane_pid}")
	if err != nil {
		return RepoTree{}, fmt.Errorf("failed to list panes: %w", err)
	}

	tree := NewRepoTree()
	// Temporary map to collect panes before using SetPanes
	tempMap := make(map[string]map[string][]Pane)
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

		// Skip only the TUI pane itself, not other panes in the same window
		// (including Claude panes that receive alerts)
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
		if tempMap[repo] == nil {
			tempMap[repo] = make(map[string][]Pane)
		}

		// Add pane to the temporary map (flattened - no window grouping)
		pane, err := NewPane(paneID, panePath, windowID, windowIndex, windowActive, windowBell, command, paneTitle, c.isClaudePane(panePID))
		if err != nil {
			// Log validation error but continue processing other panes
			debug.Log("COLLECTOR_PANE_VALIDATION_ERROR paneID=%s error=%v", paneID, err)
			continue
		}
		tempMap[repo][branch] = append(tempMap[repo][branch], pane)
	}

	// Clean up cache entries for panes that no longer exist.
	// This is the primary mechanism preventing unbounded cache growth,
	// called on every GetTree() invocation (typically every 30s).
	// CleanupExcept() removes both invalid PIDs and expired entries.
	c.claudeCache.CleanupExcept(validPIDs)

	// Populate tree from tempMap using SetPanes for encapsulation
	for repo, branches := range tempMap {
		for branch, panes := range branches {
			if err := tree.SetPanes(repo, branch, panes); err != nil {
				// This shouldn't happen since we validate repo/branch names above
				debug.Log("COLLECTOR_SETPANES_ERROR repo=%s branch=%s error=%v", repo, branch, err)
			}
		}
	}

	// Debug: Log all panes found in the tree
	for _, repo := range tree.Repos() {
		for _, branch := range tree.Branches(repo) {
			panes, ok := tree.GetPanes(repo, branch)
			if !ok {
				continue
			}
			for _, pane := range panes {
				debug.Log("COLLECTOR_PANE repo=%s branch=%s paneID=%s command=%s isClaudePane=%v", repo, branch, pane.ID(), pane.Command(), pane.IsClaudePane())
			}
		}
	}

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
	debug.Log("CLAUDE_PANE_PGREP panePID=%s", panePID)
	output, err := c.executor.ExecCommandOutput("pgrep", "-P", panePID)
	if err != nil {
		// pgrep returns exit code 1 when no processes found - this is expected
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
			debug.Log("CLAUDE_PANE_NO_CHILDREN panePID=%s", panePID)
			return false
		}
		// Actual error - log it
		fmt.Fprintf(os.Stderr, "Warning: Failed to check for Claude process in pane %s: %v\n", panePID, err)
		debug.Log("CLAUDE_PANE_PGREP_ERROR panePID=%s error=%v", panePID, err)
		return false
	}

	childPIDsStr := strings.TrimSpace(string(output))
	debug.Log("CLAUDE_PANE_CHILDREN panePID=%s children=%s", panePID, childPIDsStr)

	// Check each child PID for "claude" in the command
	childPIDs := strings.Split(childPIDsStr, "\n")
	for _, childPID := range childPIDs {
		if childPID == "" {
			continue
		}

		// Get the command for this child PID
		output, err := c.executor.ExecCommandOutput("ps", "-o", "command=", "-p", childPID)
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
		debug.Log("CLAUDE_PANE_CHECK panePID=%s childPID=%s command=%s", panePID, childPID, command)
		if strings.Contains(command, "claude") {
			debug.Log("CLAUDE_PANE_DETECTED panePID=%s childPID=%s", panePID, childPID)
			return true
		}
	}

	return false
}

// getGitInfo returns the repository name and branch for a given path
func (c *Collector) getGitInfo(path string) (repo, branch string) {
	// Get repository root using --git-common-dir to handle worktrees correctly
	output, err := c.executor.ExecCommandOutput("git", "-C", path, "rev-parse", "--git-common-dir")
	if err != nil {
		// Check for GitError from mock executor
		if gitErr, ok := err.(*GitError); ok {
			if gitErr.NotARepo {
				return "", ""
			}
			fmt.Fprintf(os.Stderr, "Git error for %s: %s\n", path, gitErr.Stderr)
			return "", ""
		}
		// Real exec.ExitError handling
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
	output, err = c.executor.ExecCommandOutput("git", "-C", path, "rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		// Check for GitError from mock executor
		if gitErr, ok := err.(*GitError); ok {
			if gitErr.NotARepo {
				return repo, ""
			}
			fmt.Fprintf(os.Stderr, "Git error getting branch for %s: %s\n", path, gitErr.Stderr)
			return repo, ""
		}
		// Real exec.ExitError handling
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

// GetPaneTitle queries tmux for the current title of a specific pane.
// Returns the trimmed title string (leading/trailing whitespace removed) or error if the query fails.
func (c *Collector) GetPaneTitle(paneID string) (string, error) {
	output, err := c.executor.ExecCommandOutput("tmux", "display-message", "-p", "-t", paneID, "#{pane_title}")
	if err != nil {
		// Check for common failure modes to provide better error context
		// TODO(#1483): Error wrapping may suppress unexpected error types (permission denied, timeout, etc.)
		errStr := err.Error()
		if strings.Contains(errStr, "can't find pane") {
			return "", fmt.Errorf("pane %s not found (likely deleted): %w", paneID, err)
		}
		if strings.Contains(errStr, "no server running") {
			return "", fmt.Errorf("tmux server not running: %w", err)
		}
		return "", fmt.Errorf("failed to get pane title for %s: %w", paneID, err)
	}
	return strings.TrimSpace(string(output)), nil
}
