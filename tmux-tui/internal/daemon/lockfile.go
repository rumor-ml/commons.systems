package daemon

import (
	"errors"
	"fmt"
	"os"
	"syscall"

	"github.com/commons-systems/tmux-tui/internal/debug"
)

// LockFile represents an exclusive lock file for daemon singleton enforcement.
type LockFile struct {
	path string
	file *os.File
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
		file.Close()
		if err == syscall.EWOULDBLOCK {
			return nil, fmt.Errorf("daemon already running (lock held)")
		}
		return nil, fmt.Errorf("failed to acquire lock: %w", err)
	}

	// Write our PID to the file for diagnostics
	if err := writePIDToLockFile(file); err != nil {
		syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
		file.Close()
		return nil, err
	}

	debug.Log("LOCKFILE_ACQUIRED path=%s pid=%d", path, os.Getpid())

	return &LockFile{
		path: path,
		file: file,
	}, nil
}

// writePIDToLockFile writes the current process ID to the lock file.
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

	var errs []error

	// Release the lock
	if err := syscall.Flock(int(l.file.Fd()), syscall.LOCK_UN); err != nil {
		debug.Log("LOCKFILE_RELEASE_ERROR path=%s error=%v", l.path, err)
		errs = append(errs, fmt.Errorf("failed to release lock: %w", err))
	}

	// Close the file
	if err := l.file.Close(); err != nil {
		debug.Log("LOCKFILE_CLOSE_ERROR path=%s error=%v", l.path, err)
		errs = append(errs, fmt.Errorf("failed to close file: %w", err))
	}

	debug.Log("LOCKFILE_RELEASED path=%s", l.path)
	l.file = nil

	if len(errs) > 0 {
		return errors.Join(errs...)
	}
	return nil
}
