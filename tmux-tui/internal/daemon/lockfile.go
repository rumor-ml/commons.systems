package daemon

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"syscall"

	"github.com/commons-systems/tmux-tui/internal/debug"
)

// LockFile represents an exclusive lock file for daemon singleton enforcement.
type LockFile struct {
	path string
	file *os.File
}

// readPIDFromLockFile reads the process ID from an existing lock file for diagnostic purposes.
//
// This function is called when lock acquisition fails to provide a more helpful error message
// indicating which process currently holds the lock. The PID is written by writePIDToLockFile()
// when a daemon successfully acquires the lock.
//
// Return Values:
//   - (pid, nil): Successfully read a valid PID from the lock file
//   - (0, error): Failed to read or parse the PID
//
// Error Cases:
//   - File read errors (permission denied, file not found, I/O errors)
//   - Empty lock file (no PID written)
//   - Invalid PID string (non-numeric content)
//
// Important Notes:
//   - The PID may be stale if the process terminated without cleaning up the lock file
//   - The PID may be invalid if it was reused by the OS for a different process
//   - This function is for diagnostics only - do not use it to determine lock validity
//   - Lock validity is determined solely by the flock() system call in AcquireLockFile()
func readPIDFromLockFile(path string) (int, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, fmt.Errorf("failed to read lock file: %w", err)
	}

	pidStr := strings.TrimSpace(string(data))
	if pidStr == "" {
		return 0, fmt.Errorf("lock file is empty")
	}

	pid, err := strconv.Atoi(pidStr)
	if err != nil {
		return 0, fmt.Errorf("invalid PID in lock file: %w", err)
	}

	return pid, nil
}

// AcquireLockFile attempts to acquire an exclusive lock on the daemon lock file.
// Returns the lock file handle on success, or an error if the lock is already held.
// The lock is automatically released when the file is closed or the process exits.
func AcquireLockFile(path string) (*LockFile, error) {
	// Open the lock file (create if doesn't exist)
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0644)
	if err != nil {
		return nil, fmt.Errorf("failed to open lock file: %w", err)
	}

	// Try to acquire exclusive lock (non-blocking)
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		if closeErr := file.Close(); closeErr != nil {
			debug.Log("LOCKFILE_CLOSE_ERROR_ON_ACQUIRE_FAILURE path=%s close_error=%v", path, closeErr)
		}
		if err == syscall.EWOULDBLOCK {
			// Lock is held - try to read the PID for better error message
			if existingPID, readErr := readPIDFromLockFile(path); readErr == nil {
				return nil, fmt.Errorf("daemon already running (lock held by PID %d at %s)", existingPID, path)
			}
			return nil, fmt.Errorf("daemon already running (lock held at %s)", path)
		}
		return nil, fmt.Errorf("failed to acquire lock: %w", err)
	}

	// Write our PID to the file for diagnostics
	if err := writePIDToLockFile(file); err != nil {
		syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
		if closeErr := file.Close(); closeErr != nil {
			debug.Log("LOCKFILE_CLOSE_ERROR_ON_WRITE_FAILURE path=%s write_error=%v close_error=%v", path, err, closeErr)
		}
		return nil, err
	}

	debug.Log("LOCKFILE_ACQUIRED path=%s pid=%d", path, os.Getpid())

	return &LockFile{
		path: path,
		file: file,
	}, nil
}

// writePIDToLockFile writes the current process ID to the lock file for diagnostic identification.
//
// This function stores the daemon's PID in the lock file so that readPIDFromLockFile() can provide
// helpful error messages when lock acquisition fails. The PID helps users identify which daemon
// instance is running.
//
// Process:
//  1. Truncate the file to 0 bytes (clear any previous content)
//  2. Seek to the beginning of the file
//  3. Write the current PID followed by a newline
//  4. Sync the file to ensure the PID is persisted to disk
//
// Error Cases:
//   - Truncate failure: Unable to clear file contents
//   - Seek failure: Unable to position file pointer
//   - Write failure: Unable to write PID string
//   - Sync failure: Unable to flush to disk
//
// Important Notes:
//   - The PID is for diagnostic purposes only and is not used for lock validation
//   - Lock validity depends on the flock() system call, not the PID content
//   - All errors are returned to the caller (AcquireLockFile) which handles cleanup
//   - If this function fails, the lock is released and the daemon startup is aborted
func writePIDToLockFile(file *os.File) error {
	if err := file.Truncate(0); err != nil {
		return fmt.Errorf("failed to truncate lock file: %w", err)
	}
	if _, err := file.Seek(0, 0); err != nil {
		return fmt.Errorf("failed to seek lock file: %w", err)
	}
	if _, err := fmt.Fprintf(file, "%d\n", os.Getpid()); err != nil {
		return fmt.Errorf("failed to write PID to lock file: %w", err)
	}
	if err := file.Sync(); err != nil {
		return fmt.Errorf("failed to sync lock file: %w", err)
	}
	return nil
}

// IsHeld returns true if the lock is currently held.
func (l *LockFile) IsHeld() bool {
	return l.file != nil
}

// Release releases the lock file and closes the file handle.
func (l *LockFile) Release() error {
	if l.file == nil {
		return nil
	}

	// Release the lock
	var unlockErr error
	if err := syscall.Flock(int(l.file.Fd()), syscall.LOCK_UN); err != nil {
		debug.Log("LOCKFILE_RELEASE_ERROR path=%s error=%v", l.path, err)
		unlockErr = fmt.Errorf("failed to release lock: %w", err)
	}

	// Close the file
	var closeErr error
	if err := l.file.Close(); err != nil {
		debug.Log("LOCKFILE_CLOSE_ERROR path=%s error=%v", l.path, err)
		closeErr = fmt.Errorf("failed to close file: %w", err)
	}

	debug.Log("LOCKFILE_RELEASED path=%s", l.path)
	l.file = nil

	return errors.Join(unlockErr, closeErr)
}
