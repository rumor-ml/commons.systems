package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/commons-systems/tmux-tui/internal/daemon"
	"github.com/commons-systems/tmux-tui/internal/debug"
)

func main() {
	// Get current pane ID from environment
	paneID := os.Getenv("TMUX_PANE")
	if paneID == "" {
		fmt.Fprintln(os.Stderr, "Error: Not running in a tmux pane (TMUX_PANE not set)")
		os.Exit(1)
	}

	debug.Log("BLOCK_CLI_START paneID=%s", paneID)

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

	// Send request to show block picker
	if err := client.RequestBlockPicker(paneID); err != nil {
		fmt.Fprintf(os.Stderr, "Error: Failed to request block picker: %v\n", err)
		os.Exit(1)
	}

	debug.Log("BLOCK_CLI_SUCCESS paneID=%s", paneID)
}
