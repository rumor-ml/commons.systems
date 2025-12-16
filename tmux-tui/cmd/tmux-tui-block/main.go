package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/commons-systems/tmux-tui/internal/daemon"
	"github.com/commons-systems/tmux-tui/internal/debug"
	"github.com/commons-systems/tmux-tui/internal/tmux"
)

var (
	ErrPanePathFailed  = errors.New("failed to get pane current path")
	ErrGitBranchFailed = errors.New("failed to get current branch")
)

// printErrorHint prints a contextual hint based on error type
func printErrorHint(err error) {
	switch {
	case errors.Is(err, daemon.ErrSocketNotFound):
		fmt.Fprintln(os.Stderr, "Hint: Daemon not running. Start with: tmux-tui-daemon")
	case errors.Is(err, daemon.ErrPermissionDenied):
		fmt.Fprintln(os.Stderr, "Hint: Permission issue accessing daemon socket.")
	case errors.Is(err, daemon.ErrConnectionTimeout), errors.Is(err, daemon.ErrQueryTimeout):
		fmt.Fprintln(os.Stderr, "Hint: Daemon may be slow to respond. Check health with: tmux-tui-daemon health")
	case errors.Is(err, daemon.ErrConnectionFailed):
		fmt.Fprintln(os.Stderr, "Hint: Connection issue. Check if tmux-tui-daemon is running.")
	}
}

// isRetryableError determines if an error should trigger a retry
func isRetryableError(err error) bool {
	return errors.Is(err, daemon.ErrConnectionTimeout) ||
		errors.Is(err, daemon.ErrQueryTimeout) ||
		errors.Is(err, daemon.ErrQueryChannelFull)
}

// queryBlockedStateWithRetry queries blocked state with exponential backoff retries
func queryBlockedStateWithRetry(client branchBlocker, branch string, maxRetries int) (daemon.BlockedState, error) {
	backoff := 100 * time.Millisecond
	maxBackoff := 1 * time.Second

	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			time.Sleep(backoff)
			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
			debug.Log("BLOCK_CLI_QUERY_RETRY attempt=%d branch=%s backoff=%v", attempt+1, branch, backoff)
		}

		state, err := client.QueryBlockedState(branch)
		if err == nil {
			if attempt > 0 {
				debug.Log("BLOCK_CLI_QUERY_RETRY_SUCCESS attempt=%d branch=%s", attempt+1, branch)
			}
			return state, nil
		}

		lastErr = err
		if !isRetryableError(err) {
			// Non-retryable error, fail immediately
			return daemon.BlockedState{}, err
		}
		debug.Log("BLOCK_CLI_QUERY_RETRY_ERROR attempt=%d branch=%s error=%v", attempt+1, branch, err)
	}

	return daemon.BlockedState{}, fmt.Errorf("query failed after %d retries: %w", maxRetries, lastErr)
}

// getCurrentBranch gets the current git branch for the given pane
func getCurrentBranch(executor tmux.CommandExecutor, paneID string) (string, error) {
	output, err := executor.ExecCommandOutput("tmux", "display-message", "-p", "-t", paneID, "#{pane_current_path}")
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrPanePathFailed, err)
	}
	path := strings.TrimSpace(string(output))

	output, err = executor.ExecCommandOutput("git", "-C", path, "rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrGitBranchFailed, err)
	}
	branch := strings.TrimSpace(string(output))

	return branch, nil
}

// branchBlocker defines the interface needed for toggle operations
type branchBlocker interface {
	QueryBlockedState(branch string) (daemon.BlockedState, error)
	UnblockBranch(branch string) error
}

// toggleBlockedState queries the blocked state of a branch and unblocks it if blocked.
//
// Returns true if the branch was blocked and successfully unblocked (operation complete).
// Returns false to show the branch picker in these cases:
//   - Branch is empty (no current branch detected)
//   - Query failed (falls back to picker for user selection)
//   - Branch is not blocked (show picker for blocking it)
func toggleBlockedState(client branchBlocker, paneID, branch string) bool {
	if branch == "" {
		return false
	}

	// Query with retry (max 3 attempts)
	state, err := queryBlockedStateWithRetry(client, branch, 3)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Warning: Could not query blocked state for '%s': %v\n", branch, err)
		printErrorHint(err)
		fmt.Fprintln(os.Stderr, "Showing branch picker as fallback.")
		debug.Log("BLOCK_CLI_QUERY_ERROR paneID=%s branch=%s error=%v", paneID, branch, err)
		return false
	}

	if !state.IsBlocked() {
		return false // Not blocked, show picker
	}

	// Branch is blocked - unblock it
	debug.Log("BLOCK_CLI_UNBLOCK paneID=%s branch=%s blockedBy=%s", paneID, branch, state.BlockedBy())
	if err := client.UnblockBranch(branch); err != nil {
		fmt.Fprintf(os.Stderr, "Error: Failed to unblock branch: %v\n", err)
		printErrorHint(err)
		os.Exit(1)
	}
	debug.Log("BLOCK_CLI_UNBLOCK_SUCCESS paneID=%s branch=%s", paneID, branch)
	return true
}

func main() {
	// Get current pane ID from environment
	paneID := os.Getenv("TMUX_PANE")
	if paneID == "" {
		fmt.Fprintln(os.Stderr, "Error: Not running in a tmux pane (TMUX_PANE not set)")
		os.Exit(1)
	}

	debug.Log("BLOCK_CLI_START paneID=%s", paneID)

	// Get current branch
	executor := &tmux.RealCommandExecutor{}
	branch, err := getCurrentBranch(executor, paneID)
	if err != nil {
		// Provide user feedback based on error type
		if errors.Is(err, ErrPanePathFailed) {
			fmt.Fprintln(os.Stderr, "Warning: Could not detect pane directory. Showing branch picker.")
		} else if errors.Is(err, ErrGitBranchFailed) {
			fmt.Fprintln(os.Stderr, "Warning: Not in a git repository or detached HEAD. Showing branch picker.")
		} else {
			fmt.Fprintln(os.Stderr, "Warning: Could not detect current branch. Showing branch picker.")
		}
		debug.Log("BLOCK_CLI_NO_BRANCH paneID=%s error=%v", paneID, err)
		branch = ""
	} else {
		debug.Log("BLOCK_CLI_BRANCH paneID=%s branch=%s", paneID, branch)
	}

	// Connect to daemon
	client := daemon.NewDaemonClient()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	if err := client.ConnectWithRetry(ctx, 3); err != nil {
		fmt.Fprintf(os.Stderr, "Error: Failed to connect to daemon: %v\n", err)
		printErrorHint(err)
		os.Exit(1)
	}
	defer client.Close()

	// If we have a branch, try to toggle its blocked state
	if toggleBlockedState(client, paneID, branch) {
		return // Successfully unblocked, we're done
	}

	// Send request to show block picker (includes internal wait for daemon processing)
	if err := client.RequestBlockPicker(paneID); err != nil {
		fmt.Fprintf(os.Stderr, "Error: Failed to request block picker: %v\n", err)
		printErrorHint(err)
		os.Exit(1)
	}

	debug.Log("BLOCK_CLI_SUCCESS paneID=%s", paneID)
}
