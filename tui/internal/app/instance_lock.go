// instance_lock.go - Single instance enforcement using Unix domain sockets
//
// ## Metadata
//
// Single-instance lock mechanism to prevent multiple TUI processes from running
// simultaneously and competing for marker files.
//
// ### Purpose
//
// Ensures only one TUI instance runs at a time, preventing orphaned processes from
// previous `go run main.go` sessions from intercepting marker files intended for
// the current instance.
//
// ### Implementation
//
// Uses Unix domain socket binding as a lock mechanism. Socket binding is atomic and
// the socket file is automatically removed when the process exits (even on crashes).
// Stale sockets (from `kill -9`) are detected and removed automatically.

package app

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"

	"github.com/rumor-ml/log/pkg/log"
)

// AcquireInstanceLock attempts to acquire a single-instance lock using a Unix domain socket.
// Returns the listener (which must be kept open) and an error if lock cannot be acquired.
//
// The socket file is automatically removed when the process exits normally. For crashes
// (kill -9), stale sockets are detected by checking if the process still exists.
func AcquireInstanceLock() (*net.Listener, error) {
	logger := log.Get().WithComponent("instance-lock")

	socketPath := filepath.Join(os.TempDir(), "tui-instance.sock")
	logger.Info("Attempting to acquire instance lock", "socket_path", socketPath)

	// Try to bind to the socket
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		// Bind failed - either another instance is running, or stale socket exists
		logger.Debug("Initial bind failed", "error", err)

		// Check if this is a stale socket from a crashed process
		if isStaleSocket(socketPath) {
			logger.Info("Detected stale socket from crashed process, removing")
			if err := os.Remove(socketPath); err != nil {
				logger.Error("Failed to remove stale socket", "error", err)
				return nil, fmt.Errorf("failed to remove stale socket: %w", err)
			}

			// Retry binding after removing stale socket
			listener, err = net.Listen("unix", socketPath)
			if err != nil {
				logger.Error("Failed to bind after removing stale socket", "error", err)
				return nil, fmt.Errorf("failed to acquire lock after removing stale socket: %w", err)
			}

			logger.Info("Successfully acquired lock after removing stale socket")
			return &listener, nil
		}

		// Not a stale socket - another instance is actually running
		pid := getPIDHoldingSocket(socketPath)
		pidInfo := ""
		if pid > 0 {
			pidInfo = fmt.Sprintf(" (PID: %d)", pid)
		}
		logger.Warn("Another TUI instance is running", "pid", pid)
		return nil, fmt.Errorf("another TUI instance is running%s\n\nTroubleshooting:\n  - Kill the running instance: kill %d\n  - Or remove stale lock: rm -f %s", pidInfo, pid, socketPath)
	}

	logger.Info("Successfully acquired instance lock")
	return &listener, nil
}

// isStaleSocket checks if a socket file exists but the process holding it is no longer running.
// This can happen when a process is killed with SIGKILL (kill -9) and doesn't clean up.
func isStaleSocket(socketPath string) bool {
	logger := log.Get().WithComponent("instance-lock")

	// Check if socket file exists
	if _, err := os.Stat(socketPath); os.IsNotExist(err) {
		return false
	}

	// Try to connect to the socket to see if it's alive
	// If connection succeeds, another instance is running
	// If connection fails, socket is stale
	conn, err := net.Dial("unix", socketPath)
	if err == nil {
		// Connection succeeded - socket is alive, not stale
		conn.Close()
		logger.Debug("Socket is alive (connection succeeded)")
		return false
	}

	// Connection failed - check if it's because the socket is stale
	// or because of other reasons (permissions, etc.)
	if isConnectionRefused(err) {
		logger.Debug("Socket connection refused - likely stale")
		return true
	}

	logger.Debug("Socket connection failed but not clearly stale", "error", err)
	return false
}

// isConnectionRefused checks if an error is a connection refused error,
// which indicates the socket file exists but no process is listening.
func isConnectionRefused(err error) bool {
	if opErr, ok := err.(*net.OpError); ok {
		if syscallErr, ok := opErr.Err.(*os.SyscallError); ok {
			return syscallErr.Err == syscall.ECONNREFUSED
		}
	}
	// Also check for string match as fallback
	return strings.Contains(err.Error(), "connection refused")
}

// getPIDFromLockFile attempts to read a PID from a lock file (legacy PID file approach).
// This function is kept for potential future use but not currently used since we rely
// on socket connection testing instead.
func getPIDFromLockFile(lockFile string) (int, error) {
	data, err := os.ReadFile(lockFile)
	if err != nil {
		return 0, err
	}

	pidStr := strings.TrimSpace(string(data))
	pid, err := strconv.Atoi(pidStr)
	if err != nil {
		return 0, fmt.Errorf("invalid PID in lock file: %w", err)
	}

	return pid, nil
}

// processExists checks if a process with the given PID is running.
// This function is kept for potential future use but not currently used.
func processExists(pid int) bool {
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}

	// On Unix, FindProcess always succeeds, so we need to send signal 0
	// to check if the process actually exists
	err = process.Signal(syscall.Signal(0))
	return err == nil
}

// getPIDHoldingSocket attempts to find the PID of the process holding a socket file.
// Returns 0 if the PID cannot be determined.
func getPIDHoldingSocket(socketPath string) int {
	logger := log.Get().WithComponent("instance-lock")

	// Use lsof to find the process holding the socket
	cmd := exec.Command("lsof", "-t", socketPath)
	output, err := cmd.Output()
	if err != nil {
		logger.Debug("Failed to get PID from lsof", "error", err)
		return 0
	}

	pidStr := strings.TrimSpace(string(output))
	pid, err := strconv.Atoi(pidStr)
	if err != nil {
		logger.Debug("Failed to parse PID from lsof output", "output", pidStr, "error", err)
		return 0
	}

	return pid
}
