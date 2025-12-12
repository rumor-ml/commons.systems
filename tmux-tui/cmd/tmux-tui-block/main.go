package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/commons-systems/tmux-tui/internal/daemon"
	"github.com/commons-systems/tmux-tui/internal/debug"
)

// getCurrentBranch gets the current git branch for the given pane
func getCurrentBranch(paneID string) (string, error) {
	// Get pane current path
	cmd := exec.Command("tmux", "display-message", "-p", "-t", paneID, "#{pane_current_path}")
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get pane current path: %w", err)
	}
	path := strings.TrimSpace(string(output))

	// Get current branch
	cmd = exec.Command("git", "-C", path, "rev-parse", "--abbrev-ref", "HEAD")
	output, err = cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get current branch: %w", err)
	}
	branch := strings.TrimSpace(string(output))

	return branch, nil
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
	branch, err := getCurrentBranch(paneID)
	if err != nil {
		// If we can't get the branch, just show the picker
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
		fmt.Fprintln(os.Stderr, "Make sure tmux-tui-daemon is running.")
		os.Exit(1)
	}
	defer client.Close()

	// If we have a branch, query its blocked state
	if branch != "" {
		blockedBy, isBlocked, err := client.QueryBlockedState(branch)
		if err != nil {
			debug.Log("BLOCK_CLI_QUERY_ERROR paneID=%s branch=%s error=%v", paneID, branch, err)
			// Fall through to show picker
		} else if isBlocked {
			// Branch is blocked - unblock it
			debug.Log("BLOCK_CLI_UNBLOCK paneID=%s branch=%s blockedBy=%s", paneID, branch, blockedBy)
			if err := client.UnblockBranch(branch); err != nil {
				fmt.Fprintf(os.Stderr, "Error: Failed to unblock branch: %v\n", err)
				os.Exit(1)
			}
			debug.Log("BLOCK_CLI_UNBLOCK_SUCCESS paneID=%s branch=%s", paneID, branch)
			return
		}
		// Branch is not blocked - fall through to show picker
	}

	// Send request to show block picker (includes internal wait for daemon processing)
	if err := client.RequestBlockPicker(paneID); err != nil {
		fmt.Fprintf(os.Stderr, "Error: Failed to request block picker: %v\n", err)
		os.Exit(1)
	}

	debug.Log("BLOCK_CLI_SUCCESS paneID=%s", paneID)
}
