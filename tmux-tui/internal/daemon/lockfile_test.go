package daemon

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestAcquireLockFile_Success tests successful lock acquisition
func TestAcquireLockFile_Success(t *testing.T) {
	tmpDir := t.TempDir()
	lockPath := filepath.Join(tmpDir, "test.lock")

	lock, err := AcquireLockFile(lockPath)
	if err != nil {
		t.Fatalf("Failed to acquire lock: %v", err)
	}
	defer lock.Release()

	// Verify lock is held
	if !lock.IsHeld() {
		t.Error("Lock should be held after acquisition")
	}

	// Verify PID was written
	data, err := os.ReadFile(lockPath)
	if err != nil {
		t.Fatalf("Failed to read lock file: %v", err)
	}

	pidStr := strings.TrimSpace(string(data))
	if len(pidStr) == 0 {
		t.Errorf("Lock file should contain PID, got empty string")
	}
}

// TestAcquireLockFile_AlreadyHeld tests that acquiring an already-held lock fails
func TestAcquireLockFile_AlreadyHeld(t *testing.T) {
	tmpDir := t.TempDir()
	lockPath := filepath.Join(tmpDir, "test.lock")

	// Acquire first lock
	lock1, err := AcquireLockFile(lockPath)
	if err != nil {
		t.Fatalf("Failed to acquire first lock: %v", err)
	}
	defer lock1.Release()

	// Try to acquire second lock - should fail
	lock2, err := AcquireLockFile(lockPath)
	if err == nil {
		lock2.Release()
		t.Fatal("Expected error when acquiring already-held lock, got nil")
	}

	// Error should mention the lock is held
	if !strings.Contains(err.Error(), "already running") {
		t.Errorf("Error should mention lock is already running, got: %v", err)
	}

	// Error should include PID information
	if !strings.Contains(err.Error(), "PID") {
		t.Errorf("Error should include PID information, got: %v", err)
	}
}

// TestLockFile_Release tests lock release functionality
func TestLockFile_Release(t *testing.T) {
	tmpDir := t.TempDir()
	lockPath := filepath.Join(tmpDir, "test.lock")

	// Acquire lock
	lock, err := AcquireLockFile(lockPath)
	if err != nil {
		t.Fatalf("Failed to acquire lock: %v", err)
	}

	// Release lock
	if err := lock.Release(); err != nil {
		t.Errorf("Failed to release lock: %v", err)
	}

	// Verify lock is no longer held
	if lock.IsHeld() {
		t.Error("Lock should not be held after release")
	}

	// Should be able to acquire again
	lock2, err := AcquireLockFile(lockPath)
	if err != nil {
		t.Errorf("Should be able to acquire lock after release: %v", err)
	}
	defer lock2.Release()
}

// TestLockFile_ConcurrentAcquisition tests concurrent lock acquisition attempts
func TestLockFile_ConcurrentAcquisition(t *testing.T) {
	tmpDir := t.TempDir()
	lockPath := filepath.Join(tmpDir, "test.lock")

	// Acquire initial lock
	lock1, err := AcquireLockFile(lockPath)
	if err != nil {
		t.Fatalf("Failed to acquire initial lock: %v", err)
	}
	defer lock1.Release()

	// Try concurrent acquisitions
	attempts := 5
	errChan := make(chan error, attempts)

	for i := 0; i < attempts; i++ {
		go func() {
			lock, err := AcquireLockFile(lockPath)
			if err == nil {
				// Should not succeed
				lock.Release()
				errChan <- nil
			} else {
				// Should fail with appropriate error
				errChan <- err
			}
		}()
	}

	// Collect results
	successCount := 0
	for i := 0; i < attempts; i++ {
		err := <-errChan
		if err == nil {
			successCount++
		} else {
			// Verify error message
			if !strings.Contains(err.Error(), "already running") {
				t.Errorf("Expected 'already running' error, got: %v", err)
			}
		}
	}

	if successCount > 0 {
		t.Errorf("Expected 0 concurrent acquisitions to succeed, got %d", successCount)
	}
}
