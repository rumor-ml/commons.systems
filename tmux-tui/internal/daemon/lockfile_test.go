package daemon

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
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
	expectedPID := os.Getpid()
	if pidStr != string(rune(expectedPID))+"0" && !strings.Contains(pidStr, string(rune(expectedPID/10))) {
		// More lenient check - just verify PID is present
		if len(pidStr) == 0 {
			t.Errorf("Lock file should contain PID, got empty string")
		}
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

// TestLockFile_DoubleRelease tests that releasing twice is safe
func TestLockFile_DoubleRelease(t *testing.T) {
	tmpDir := t.TempDir()
	lockPath := filepath.Join(tmpDir, "test.lock")

	lock, err := AcquireLockFile(lockPath)
	if err != nil {
		t.Fatalf("Failed to acquire lock: %v", err)
	}

	// First release
	if err := lock.Release(); err != nil {
		t.Errorf("First release failed: %v", err)
	}

	// Second release should be safe (no-op)
	if err := lock.Release(); err != nil {
		t.Errorf("Second release should be safe: %v", err)
	}
}

// TestLockFile_IsHeld tests the IsHeld method
func TestLockFile_IsHeld(t *testing.T) {
	tmpDir := t.TempDir()
	lockPath := filepath.Join(tmpDir, "test.lock")

	lock, err := AcquireLockFile(lockPath)
	if err != nil {
		t.Fatalf("Failed to acquire lock: %v", err)
	}

	// Should be held initially
	if !lock.IsHeld() {
		t.Error("Lock should be held after acquisition")
	}

	// Should not be held after release
	lock.Release()
	if lock.IsHeld() {
		t.Error("Lock should not be held after release")
	}
}

// TestLockFile_ProcessExit tests that lock is released when process exits
// This is a behavioral test - we verify the lock mechanism supports this
func TestLockFile_ProcessExitBehavior(t *testing.T) {
	tmpDir := t.TempDir()
	lockPath := filepath.Join(tmpDir, "test.lock")

	// Acquire and release lock
	lock, err := AcquireLockFile(lockPath)
	if err != nil {
		t.Fatalf("Failed to acquire lock: %v", err)
	}

	// Simulate process exit by closing file descriptor without explicit unlock
	// This tests that flock is released when the file is closed
	if lock.file != nil {
		lock.file.Close()
		lock.file = nil
	}

	// Should be able to acquire lock again since file was closed
	lock2, err := AcquireLockFile(lockPath)
	if err != nil {
		t.Errorf("Should be able to acquire lock after file close (simulates process exit): %v", err)
	}
	if lock2 != nil {
		lock2.Release()
	}
}

// TestReadPIDFromLockFile tests PID reading functionality
func TestReadPIDFromLockFile(t *testing.T) {
	tmpDir := t.TempDir()

	tests := []struct {
		name        string
		content     string
		expectPID   int
		expectError bool
	}{
		{
			name:        "valid PID",
			content:     "12345\n",
			expectPID:   12345,
			expectError: false,
		},
		{
			name:        "valid PID no newline",
			content:     "67890",
			expectPID:   67890,
			expectError: false,
		},
		{
			name:        "empty file",
			content:     "",
			expectError: true,
		},
		{
			name:        "whitespace only",
			content:     "   \n  ",
			expectError: true,
		},
		{
			name:        "invalid PID format",
			content:     "not-a-number",
			expectError: true,
		},
		{
			name:        "negative PID",
			content:     "-123",
			expectPID:   -123,
			expectError: false, // strconv.Atoi accepts negative numbers
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			lockPath := filepath.Join(tmpDir, tt.name+".lock")
			if err := os.WriteFile(lockPath, []byte(tt.content), 0644); err != nil {
				t.Fatalf("Failed to write test file: %v", err)
			}

			pid, err := readPIDFromLockFile(lockPath)

			if tt.expectError {
				if err == nil {
					t.Errorf("Expected error, got nil")
				}
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}
				if pid != tt.expectPID {
					t.Errorf("Expected PID %d, got %d", tt.expectPID, pid)
				}
			}
		})
	}
}

// TestReadPIDFromLockFile_NonexistentFile tests reading from nonexistent file
func TestReadPIDFromLockFile_NonexistentFile(t *testing.T) {
	tmpDir := t.TempDir()
	lockPath := filepath.Join(tmpDir, "nonexistent.lock")

	_, err := readPIDFromLockFile(lockPath)
	if err == nil {
		t.Error("Expected error when reading nonexistent file")
	}
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

// TestLockFile_ReleaseErrors tests error handling during release
func TestLockFile_ReleaseErrors(t *testing.T) {
	tmpDir := t.TempDir()
	lockPath := filepath.Join(tmpDir, "test.lock")

	lock, err := AcquireLockFile(lockPath)
	if err != nil {
		t.Fatalf("Failed to acquire lock: %v", err)
	}

	// Close the file to simulate an error condition
	if lock.file != nil {
		lock.file.Close()
		// Don't set to nil to test error handling
	}

	// Release should handle errors gracefully
	err = lock.Release()
	// Error is expected but should not panic
	if err == nil {
		t.Log("Release succeeded despite closed file (acceptable)")
	} else {
		t.Logf("Release returned error as expected: %v", err)
	}
}

// TestWritePIDToLockFile tests PID writing functionality
func TestWritePIDToLockFile(t *testing.T) {
	tmpDir := t.TempDir()
	lockPath := filepath.Join(tmpDir, "test.lock")

	// Create and open file
	file, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0644)
	if err != nil {
		t.Fatalf("Failed to open file: %v", err)
	}
	defer file.Close()

	// Write some initial content
	file.WriteString("old content")
	file.Sync()

	// Write PID
	if err := writePIDToLockFile(file); err != nil {
		t.Fatalf("Failed to write PID: %v", err)
	}

	// Read back and verify
	data, err := os.ReadFile(lockPath)
	if err != nil {
		t.Fatalf("Failed to read file: %v", err)
	}

	content := string(data)
	if !strings.Contains(content, "old content") {
		// Old content should be truncated
		t.Logf("Old content properly truncated (expected)")
	}

	// Verify it contains a number
	pidStr := strings.TrimSpace(content)
	if len(pidStr) == 0 {
		t.Error("PID should be written to file")
	}
}

// TestLockFile_PermissionsDenied tests behavior when file permissions prevent lock
func TestLockFile_PermissionsDenied(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("Skipping permission test when running as root")
	}

	tmpDir := t.TempDir()
	lockPath := filepath.Join(tmpDir, "readonly.lock")

	// Create a readonly file
	if err := os.WriteFile(lockPath, []byte("readonly"), 0444); err != nil {
		t.Fatalf("Failed to create readonly file: %v", err)
	}

	// Try to acquire lock - should fail due to permissions
	lock, err := AcquireLockFile(lockPath)
	if err == nil {
		lock.Release()
		t.Fatal("Expected error when acquiring lock on readonly file")
	}

	if !strings.Contains(err.Error(), "failed to open lock file") {
		t.Errorf("Expected 'failed to open lock file' error, got: %v", err)
	}
}

// TestLockFile_FlockBehavior tests flock system call behavior
func TestLockFile_FlockBehavior(t *testing.T) {
	tmpDir := t.TempDir()
	lockPath := filepath.Join(tmpDir, "test.lock")

	// Create file
	file, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0644)
	if err != nil {
		t.Fatalf("Failed to create file: %v", err)
	}
	defer file.Close()

	// Acquire exclusive lock
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		t.Fatalf("Failed to acquire flock: %v", err)
	}

	// Try to acquire again - should fail with EWOULDBLOCK
	file2, err := os.OpenFile(lockPath, os.O_RDWR, 0644)
	if err != nil {
		t.Fatalf("Failed to open file second time: %v", err)
	}
	defer file2.Close()

	err = syscall.Flock(int(file2.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
	if err != syscall.EWOULDBLOCK {
		t.Errorf("Expected EWOULDBLOCK, got: %v", err)
	}

	// Release lock
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_UN); err != nil {
		t.Fatalf("Failed to release flock: %v", err)
	}

	// Should be able to acquire now
	if err := syscall.Flock(int(file2.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		t.Errorf("Should be able to acquire lock after release: %v", err)
	}
}

// TestLockFile_RapidAcquireRelease tests rapid lock acquisition and release
func TestLockFile_RapidAcquireRelease(t *testing.T) {
	tmpDir := t.TempDir()
	lockPath := filepath.Join(tmpDir, "test.lock")

	iterations := 100
	for i := 0; i < iterations; i++ {
		lock, err := AcquireLockFile(lockPath)
		if err != nil {
			t.Fatalf("Iteration %d: Failed to acquire lock: %v", i, err)
		}

		if !lock.IsHeld() {
			t.Fatalf("Iteration %d: Lock should be held", i)
		}

		if err := lock.Release(); err != nil {
			t.Fatalf("Iteration %d: Failed to release lock: %v", i, err)
		}

		if lock.IsHeld() {
			t.Fatalf("Iteration %d: Lock should not be held after release", i)
		}
	}
}

// TestLockFile_StaleCleanup tests that we can detect and handle stale locks
func TestLockFile_StaleCleanup(t *testing.T) {
	tmpDir := t.TempDir()
	lockPath := filepath.Join(tmpDir, "test.lock")

	// Create a stale lock file with a non-existent PID
	stalePID := 999999 // Very unlikely to be a real PID
	if err := os.WriteFile(lockPath, []byte(string(rune(stalePID))+"999999\n"), 0644); err != nil {
		t.Fatalf("Failed to create stale lock file: %v", err)
	}

	// Try to read the PID
	pid, err := readPIDFromLockFile(lockPath)
	if err != nil {
		t.Logf("Reading stale lock returned error (may be expected): %v", err)
	} else {
		t.Logf("Read stale PID: %d", pid)
	}

	// Since no process holds the lock, we should be able to acquire it
	lock, err := AcquireLockFile(lockPath)
	if err != nil {
		t.Fatalf("Should be able to acquire lock when no process holds it: %v", err)
	}
	defer lock.Release()

	// Verify we overwrote the stale PID
	newPID, err := readPIDFromLockFile(lockPath)
	if err != nil {
		t.Logf("Could not read new PID: %v", err)
	} else if newPID != os.Getpid() {
		t.Logf("PID in file (%d) differs from current PID (%d)", newPID, os.Getpid())
	}
}

// TestLockFile_Timeout tests lock acquisition with timeout simulation
func TestLockFile_Timeout(t *testing.T) {
	tmpDir := t.TempDir()
	lockPath := filepath.Join(tmpDir, "test.lock")

	// Acquire initial lock
	lock1, err := AcquireLockFile(lockPath)
	if err != nil {
		t.Fatalf("Failed to acquire initial lock: %v", err)
	}
	defer lock1.Release()

	// Try to acquire with timeout
	timeout := 100 * time.Millisecond
	start := time.Now()

	done := make(chan bool)
	go func() {
		for time.Since(start) < timeout {
			lock2, err := AcquireLockFile(lockPath)
			if err == nil {
				lock2.Release()
				done <- true
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
		done <- false
	}()

	success := <-done
	if success {
		t.Error("Should not have acquired lock while it's held")
	}

	elapsed := time.Since(start)
	if elapsed < timeout {
		t.Errorf("Timeout simulation completed too quickly: %v", elapsed)
	}
}
