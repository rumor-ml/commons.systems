package namespace

import (
	"os"
	"path/filepath"
	"strings"
)

const (
	baseDir        = "/tmp/claude"
	defaultSession = "default"
)

// GetSessionNamespace returns the namespace directory for the current tmux session.
// Parses $TMUX environment variable to extract the socket name.
// Falls back to "default" if $TMUX is not set.
//
// The $TMUX format is: /path/to/socket,pid,pane_index
// For example: /tmp/tmux-1000/default,12345,0
// Socket name is extracted from the socket path basename.
func GetSessionNamespace() string {
	tmuxEnv := os.Getenv("TMUX")
	if tmuxEnv == "" {
		return filepath.Join(baseDir, defaultSession)
	}

	// Split on comma to get socket path
	parts := strings.Split(tmuxEnv, ",")
	if len(parts) < 3 {
		// Invalid format, use default
		return filepath.Join(baseDir, defaultSession)
	}

	// Extract socket name from path
	// /tmp/tmux-1000/default -> default
	// /tmp/tmux-1000/e2e-test-123 -> e2e-test-123
	socketPath := parts[0]
	socketName := filepath.Base(socketPath)

	return filepath.Join(baseDir, socketName)
}

// AlertDir returns the directory where alert files are stored for this session.
// Alert files are named: tui-alert-{paneID}
func AlertDir() string {
	return GetSessionNamespace()
}

// DaemonSocket returns the Unix socket path for the daemon in this session.
func DaemonSocket() string {
	return filepath.Join(GetSessionNamespace(), "daemon.sock")
}

// DaemonPID returns the PID file path for the daemon in this session.
func DaemonPID() string {
	return filepath.Join(GetSessionNamespace(), "daemon.pid")
}

// BlockedPanesFile returns the path to the blocked panes JSON file for this session.
// Deprecated: Use BlockedBranchesFile instead.
func BlockedPanesFile() string {
	return filepath.Join(GetSessionNamespace(), "tui-blocked-panes.json")
}

// BlockedBranchesFile returns the path to the blocked branches JSON file for this session.
func BlockedBranchesFile() string {
	return filepath.Join(GetSessionNamespace(), "tui-blocked-branches.json")
}
