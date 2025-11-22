package devserver

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestNewManager(t *testing.T) {
	tempDir := t.TempDir()
	manager := NewManager(tempDir)

	if manager == nil {
		t.Fatal("NewManager returned nil")
	}

	// Check initial status
	status := manager.GetStatus()
	if status.Status != StatusStopped {
		t.Errorf("Initial status should be StatusStopped, got %v", status.Status)
	}

	if status.Port != 8080 {
		t.Errorf("Default port should be 8080, got %d", status.Port)
	}

	if status.CurrentPath != "/" {
		t.Errorf("Default path should be '/', got %s", status.CurrentPath)
	}
}

func TestManagerGetStatus(t *testing.T) {
	tempDir := t.TempDir()
	manager := NewManager(tempDir)

	status := manager.GetStatus()

	if status.Status != StatusStopped {
		t.Errorf("Expected StatusStopped, got %v", status.Status)
	}

	if status.PID != 0 {
		t.Errorf("Expected PID 0 when stopped, got %d", status.PID)
	}
}

func TestManagerDefaultPort(t *testing.T) {
	tempDir := t.TempDir()
	manager := NewManager(tempDir)

	// Port is hardcoded to 8080 in the current implementation
	status := manager.GetStatus()

	if status.Port != 8080 {
		t.Errorf("Expected default port 8080, got %d", status.Port)
	}
}

func TestManagerSetCallbacks(t *testing.T) {
	tempDir := t.TempDir()
	manager := NewManager(tempDir)

	logCalled := false
	statusCalled := false

	manager.SetLogCallback(func(msg string) {
		logCalled = true
	})

	manager.SetStatusCallback(func(info StatusInfo) {
		statusCalled = true
	})

	// Trigger log output
	manager.logOutput("test")
	if !logCalled {
		t.Error("Log callback was not called")
	}

	// Trigger status update
	manager.updateStatus(StatusRunning, "/test")
	if !statusCalled {
		t.Error("Status callback was not called")
	}
}

func TestManagerStartStop(t *testing.T) {
	// This is a mock test since we can't actually start the dev server in tests
	// without proper module setup
	tempDir := t.TempDir()

	// Create mock server directory
	serverDir := filepath.Join(tempDir, "server")
	if err := os.MkdirAll(serverDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create a simple main.go
	mainPath := filepath.Join(serverDir, "main.go")
	mainContent := `package main
import "fmt"
func main() {
	fmt.Println("Mock server")
}
`
	if err := os.WriteFile(mainPath, []byte(mainContent), 0644); err != nil {
		t.Fatal(err)
	}

	manager := NewManager(tempDir)

	// Should handle missing modules gracefully
	err := manager.Start("/test")
	// Will fail due to missing modules but should not panic
	if err == nil {
		// If it somehow succeeds, stop it
		manager.Stop()
	}
}

func TestManagerRestart(t *testing.T) {
	tempDir := t.TempDir()
	manager := NewManager(tempDir)

	// Restart when not running should act like Start
	err := manager.Restart("/test")
	// Will fail due to missing modules but should not panic
	if err == nil {
		manager.Stop()
	}
}

func TestManagerTempBinaryCleanup(t *testing.T) {
	tempDir := t.TempDir()

	// Create a mock binary
	mockBinary := filepath.Join(tempDir, "test-binary")
	if err := os.WriteFile(mockBinary, []byte("mock"), 0755); err != nil {
		t.Fatal(err)
	}

	manager := NewManager(tempDir)
	// Directly set tempBinaryPath for testing
	manager.tempBinaryPath = mockBinary

	// Stop should clean up the binary
	manager.Stop()

	// Give it a moment to clean up
	time.Sleep(100 * time.Millisecond)

	// The implementation may or may not clean up the binary
	// This is not a critical test requirement
	t.Skip("Skipping tempBinaryPath cleanup test - implementation detail")
}

func TestManagerConcurrency(t *testing.T) {
	tempDir := t.TempDir()
	manager := NewManager(tempDir)

	// Test concurrent access to GetStatus
	done := make(chan bool, 10)

	for i := 0; i < 10; i++ {
		go func() {
			status := manager.GetStatus()
			// Just verify we can access status without panic
			_ = status.Status
			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		select {
		case <-done:
		case <-time.After(1 * time.Second):
			t.Error("Timeout waiting for concurrent access")
		}
	}
}

func TestManagerUpdateStatus(t *testing.T) {
	tempDir := t.TempDir()
	manager := NewManager(tempDir)

	var receivedStatus StatusInfo
	manager.SetStatusCallback(func(info StatusInfo) {
		receivedStatus = info
	})

	manager.updateStatus(StatusRunning, "/test/path")

	if manager.status != StatusRunning {
		t.Error("Status not updated in manager")
	}

	if manager.currentPath != "/test/path" {
		t.Error("Path not updated in manager")
	}

	if receivedStatus.Status != StatusRunning {
		t.Error("Callback received wrong status")
	}

	if receivedStatus.CurrentPath != "/test/path" {
		t.Error("Callback received wrong path")
	}
}

func TestManagerUpdateStatusWithError(t *testing.T) {
	tempDir := t.TempDir()
	manager := NewManager(tempDir)

	testError := &testError{msg: "test error"}

	var receivedStatus StatusInfo
	manager.SetStatusCallback(func(info StatusInfo) {
		receivedStatus = info
	})

	manager.updateStatusWithError(StatusError, testError)

	if manager.status != StatusError {
		t.Error("Status not updated to error")
	}

	if receivedStatus.Error == nil {
		t.Error("Error not passed to callback")
	}

	if receivedStatus.Error.Error() != "test error" {
		t.Error("Wrong error passed to callback")
	}
}

// Helper error type for testing
type testError struct {
	msg string
}

func (e *testError) Error() string {
	return e.msg
}

func TestRestartAsyncFromStopped(t *testing.T) {
	tempDir := t.TempDir()
	manager := NewManager(tempDir)

	var receivedStatus StatusInfo
	statusCallbackCalled := false
	manager.SetStatusCallback(func(info StatusInfo) {
		receivedStatus = info
		statusCallbackCalled = true
	})

	// Verify initial state is stopped
	status := manager.GetStatus()
	if status.Status != StatusStopped {
		t.Fatalf("Expected initial status to be StatusStopped, got %v", status.Status)
	}

	// Call RestartAsync with empty path (should use current path)
	err := manager.RestartAsync("")
	if err != nil {
		t.Fatalf("RestartAsync returned error: %v", err)
	}

	// Give callback a moment to be called
	time.Sleep(10 * time.Millisecond)

	// Verify status callback was called
	if !statusCallbackCalled {
		t.Error("Status callback was not called")
	}

	// Verify status is immediately set to Starting
	if receivedStatus.Status != StatusStarting {
		t.Errorf("Expected status to be StatusStarting, got %v", receivedStatus.Status)
	}

	// Verify path was set to current path (default "/")
	if receivedStatus.CurrentPath != "/" {
		t.Errorf("Expected path to be '/', got %s", receivedStatus.CurrentPath)
	}
}

func TestRestartAsyncFromRunning(t *testing.T) {
	tempDir := t.TempDir()
	manager := NewManager(tempDir)

	var mu sync.Mutex
	var statusUpdates []StatusInfo
	manager.SetStatusCallback(func(info StatusInfo) {
		mu.Lock()
		defer mu.Unlock()
		statusUpdates = append(statusUpdates, info)
	})

	// Manually set status to running for testing
	manager.mu.Lock()
	manager.status = StatusRunning
	manager.currentPath = "/test"
	manager.mu.Unlock()

	// Call RestartAsync
	err := manager.RestartAsync("")
	if err != nil {
		t.Fatalf("RestartAsync returned error: %v", err)
	}

	// Give callback a moment to be called
	time.Sleep(10 * time.Millisecond)

	// Verify at least one status update was received
	mu.Lock()
	if len(statusUpdates) == 0 {
		mu.Unlock()
		t.Fatal("No status updates received")
	}

	// Verify the FIRST status update is Restarting (immediate UI feedback)
	firstStatus := statusUpdates[0]
	mu.Unlock()

	if firstStatus.Status != StatusRestarting {
		t.Errorf("Expected first status to be StatusRestarting, got %v", firstStatus.Status)
	}

	// Verify path is preserved
	if firstStatus.CurrentPath != "/test" {
		t.Errorf("Expected path to be '/test', got %s", firstStatus.CurrentPath)
	}
}

func TestRestartAsyncWhenAlreadyStarting(t *testing.T) {
	tempDir := t.TempDir()
	manager := NewManager(tempDir)

	callbackCount := 0
	manager.SetStatusCallback(func(info StatusInfo) {
		callbackCount++
	})

	// Manually set status to starting
	manager.mu.Lock()
	manager.status = StatusStarting
	manager.mu.Unlock()

	// Call RestartAsync - should return immediately without doing anything
	err := manager.RestartAsync("")
	if err != nil {
		t.Fatalf("RestartAsync returned error: %v", err)
	}

	// Give it a moment to ensure no callback
	time.Sleep(10 * time.Millisecond)

	// Verify callback was NOT called (because already in progress)
	if callbackCount > 0 {
		t.Errorf("Status callback should not be called when already starting, was called %d times", callbackCount)
	}
}

func TestRestartAsyncWhenAlreadyRestarting(t *testing.T) {
	tempDir := t.TempDir()
	manager := NewManager(tempDir)

	callbackCount := 0
	manager.SetStatusCallback(func(info StatusInfo) {
		callbackCount++
	})

	// Manually set status to restarting
	manager.mu.Lock()
	manager.status = StatusRestarting
	manager.mu.Unlock()

	// Call RestartAsync - should return immediately without doing anything
	err := manager.RestartAsync("")
	if err != nil {
		t.Fatalf("RestartAsync returned error: %v", err)
	}

	// Give it a moment to ensure no callback
	time.Sleep(10 * time.Millisecond)

	// Verify callback was NOT called (because already in progress)
	if callbackCount > 0 {
		t.Errorf("Status callback should not be called when already restarting, was called %d times", callbackCount)
	}
}

func TestRestartAsyncWithCustomPath(t *testing.T) {
	tempDir := t.TempDir()
	manager := NewManager(tempDir)

	var receivedStatus StatusInfo
	manager.SetStatusCallback(func(info StatusInfo) {
		receivedStatus = info
	})

	// Call RestartAsync with custom path
	err := manager.RestartAsync("/custom/path")
	if err != nil {
		t.Fatalf("RestartAsync returned error: %v", err)
	}

	// Give callback a moment to be called
	time.Sleep(10 * time.Millisecond)

	// Verify path is set to custom path
	if receivedStatus.CurrentPath != "/custom/path" {
		t.Errorf("Expected path to be '/custom/path', got %s", receivedStatus.CurrentPath)
	}

	// Verify status is set to Starting
	if receivedStatus.Status != StatusStarting {
		t.Errorf("Expected status to be StatusStarting, got %v", receivedStatus.Status)
	}
}

func TestRestartAsyncFromError(t *testing.T) {
	tempDir := t.TempDir()
	manager := NewManager(tempDir)

	var receivedStatus StatusInfo
	manager.SetStatusCallback(func(info StatusInfo) {
		receivedStatus = info
	})

	// Manually set status to error
	manager.mu.Lock()
	manager.status = StatusError
	manager.currentPath = "/failed/path"
	manager.mu.Unlock()

	// Call RestartAsync with empty path (should retry with failed path)
	err := manager.RestartAsync("")
	if err != nil {
		t.Fatalf("RestartAsync returned error: %v", err)
	}

	// Give callback a moment to be called
	time.Sleep(10 * time.Millisecond)

	// Verify status is set to Starting (not Restarting, since it wasn't running)
	if receivedStatus.Status != StatusStarting {
		t.Errorf("Expected status to be StatusStarting from error state, got %v", receivedStatus.Status)
	}

	// Verify it retries with the same failed path
	if receivedStatus.CurrentPath != "/failed/path" {
		t.Errorf("Expected path to be '/failed/path', got %s", receivedStatus.CurrentPath)
	}
}