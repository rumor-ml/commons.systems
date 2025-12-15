package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/commons-systems/tmux-tui/internal/daemon"
	"github.com/commons-systems/tmux-tui/internal/debug"
	"github.com/commons-systems/tmux-tui/internal/namespace"
)

func main() {
	// Auto-detect namespace from $TMUX environment variable
	ns := namespace.GetSessionNamespace()
	debug.Log("DAEMON_MAIN namespace=%s", ns)

	// Acquire lock file FIRST - this enforces singleton across all worktrees
	lockPath := namespace.DaemonLockFile()
	lockFile, err := daemon.AcquireLockFile(lockPath)
	if err != nil {
		// Lock already held - another daemon is running
		// Exit gracefully (code 0) - this is expected behavior
		debug.Log("DAEMON_MAIN lock_held path=%s", lockPath)
		fmt.Fprintf(os.Stderr, "Daemon already running (lock held at %s)\n", lockPath)
		os.Exit(0)
	}
	defer func() {
		if err := lockFile.Release(); err != nil {
			debug.Log("DAEMON_MAIN_LOCKFILE_RELEASE_ERROR error=%v", err)
		}
	}()

	// Create and start daemon
	d, err := daemon.NewAlertDaemon()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to create daemon: %v\n", err)
		os.Exit(1)
	}

	if err := d.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to start daemon: %v\n", err)
		os.Exit(1)
	}

	// Handle signals for graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	fmt.Printf("Daemon started (namespace: %s)\n", ns)
	debug.Log("DAEMON_MAIN started namespace=%s", ns)

	// Wait for signal
	sig := <-sigCh
	debug.Log("DAEMON_MAIN signal=%v", sig)
	fmt.Printf("Received signal %v, shutting down...\n", sig)

	// Stop daemon
	if err := d.Stop(); err != nil {
		fmt.Fprintf(os.Stderr, "Error stopping daemon: %v\n", err)
		os.Exit(1)
	}

	debug.Log("DAEMON_MAIN stopped")
	fmt.Println("Daemon stopped")
}
