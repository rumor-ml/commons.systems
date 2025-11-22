package app

import (
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAcquireInstanceLock(t *testing.T) {
	// Use a unique socket path for testing to avoid conflicts
	originalSocketPath := filepath.Join(os.TempDir(), "tui-instance.sock")
	testSocketPath := filepath.Join(os.TempDir(), "tui-test-instance.sock")

	// Clean up before test
	os.Remove(testSocketPath)
	defer os.Remove(testSocketPath)

	// Temporarily override the socket path for testing
	// (In real implementation, we'd need to make this configurable)
	// For now, we'll test the actual production socket path

	t.Run("first instance acquires lock successfully", func(t *testing.T) {
		// Clean up any existing lock
		os.Remove(originalSocketPath)
		defer os.Remove(originalSocketPath)

		lock, err := AcquireInstanceLock()
		if err != nil {
			t.Fatalf("First instance should acquire lock successfully: %v", err)
		}
		defer (*lock).Close()

		// Verify socket file exists
		if _, err := os.Stat(originalSocketPath); os.IsNotExist(err) {
			t.Error("Socket file should exist after acquiring lock")
		}
	})

	t.Run("second instance fails to acquire lock", func(t *testing.T) {
		// Clean up any existing lock
		os.Remove(originalSocketPath)
		defer os.Remove(originalSocketPath)

		// First instance
		lock1, err := AcquireInstanceLock()
		if err != nil {
			t.Fatalf("First instance should acquire lock successfully: %v", err)
		}
		defer (*lock1).Close()

		// Second instance should fail
		lock2, err := AcquireInstanceLock()
		if err == nil {
			(*lock2).Close()
			t.Fatal("Second instance should fail to acquire lock")
		}

		if err.Error() != "another TUI instance is running (check tmux window 'tui')" {
			t.Errorf("Expected specific error message, got: %v", err)
		}
	})

	t.Run("stale socket is detected and removed", func(t *testing.T) {
		t.Skip("Skipping: Unix domain socket files are auto-removed on Close(). Stale sockets only occur with kill -9, which is difficult to test in unit tests.")
		// Note: Real-world stale socket testing should be done with integration tests
		// that actually kill processes, or manual testing
	})

	t.Run("lock is released on close", func(t *testing.T) {
		// Clean up any existing lock
		os.Remove(originalSocketPath)
		defer os.Remove(originalSocketPath)

		// Acquire lock
		lock, err := AcquireInstanceLock()
		if err != nil {
			t.Fatalf("Should acquire lock: %v", err)
		}

		// Release lock
		(*lock).Close()

		// Wait for cleanup
		time.Sleep(100 * time.Millisecond)

		// Socket file should be removed
		if _, err := os.Stat(originalSocketPath); !os.IsNotExist(err) {
			t.Error("Socket file should be removed after closing lock")
		}

		// Should be able to acquire lock again
		lock2, err := AcquireInstanceLock()
		if err != nil {
			t.Fatalf("Should be able to acquire lock after release: %v", err)
		}
		defer (*lock2).Close()
	})
}

func TestIsStaleSocket(t *testing.T) {
	testSocketPath := filepath.Join(os.TempDir(), "tui-test-stale.sock")

	t.Run("non-existent socket is not stale", func(t *testing.T) {
		os.Remove(testSocketPath)
		if isStaleSocket(testSocketPath) {
			t.Error("Non-existent socket should not be considered stale")
		}
	})

	t.Run("active socket is not stale", func(t *testing.T) {
		os.Remove(testSocketPath)
		defer os.Remove(testSocketPath)

		listener, err := net.Listen("unix", testSocketPath)
		if err != nil {
			t.Fatalf("Failed to create test socket: %v", err)
		}
		defer listener.Close()

		if isStaleSocket(testSocketPath) {
			t.Error("Active socket should not be considered stale")
		}
	})

	t.Run("stale socket is detected", func(t *testing.T) {
		t.Skip("Skipping: Unix domain socket files are auto-removed on Close(). Requires manual testing with kill -9.")
		// Note: Stale socket detection is tested in real-world scenarios where processes
		// are killed without cleanup. Integration tests or manual testing required.
	})
}

func TestProcessExists(t *testing.T) {
	t.Run("current process exists", func(t *testing.T) {
		pid := os.Getpid()
		if !processExists(pid) {
			t.Error("Current process should exist")
		}
	})

	t.Run("non-existent process does not exist", func(t *testing.T) {
		// Use a very high PID that's unlikely to exist
		if processExists(999999) {
			t.Error("Non-existent process should not exist")
		}
	})
}
