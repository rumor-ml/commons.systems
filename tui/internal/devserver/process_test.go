package devserver

import (
	"os/exec"
	"testing"
	"time"
)

func TestProcessManager(t *testing.T) {
	pm := NewProcessManager()

	if pm == nil {
		t.Fatal("NewProcessManager returned nil")
	}

	if pm.IsRunning() {
		t.Error("New process manager should not be running")
	}

	if pm.GetPID() != 0 {
		t.Error("PID should be 0 when not running")
	}
}

func TestProcessManagerStartStop(t *testing.T) {
	pm := NewProcessManager()

	// Create a simple command that runs for a while
	cmd := exec.Command("sleep", "10")

	// Start the process
	err := pm.Start(cmd)
	if err != nil {
		t.Fatalf("Failed to start process: %v", err)
	}

	// Check it's running
	if !pm.IsRunning() {
		t.Error("Process should be running after start")
	}

	if pm.GetPID() == 0 {
		t.Error("PID should not be 0 when running")
	}

	// Stop the process
	err = pm.Stop()
	if err != nil {
		t.Errorf("Failed to stop process: %v", err)
	}

	// Give it a moment to stop
	time.Sleep(100 * time.Millisecond)

	// Check it's stopped
	if pm.IsRunning() {
		t.Error("Process should not be running after stop")
	}
}

func TestProcessManagerWait(t *testing.T) {
	pm := NewProcessManager()

	// Create a command that exits quickly
	cmd := exec.Command("echo", "test")

	err := pm.Start(cmd)
	if err != nil {
		t.Fatalf("Failed to start process: %v", err)
	}

	// Wait for it to finish
	err = pm.Wait()
	if err != nil {
		t.Errorf("Wait returned error: %v", err)
	}

	// Should not be running anymore
	if pm.IsRunning() {
		t.Error("Process should not be running after wait")
	}
}

func TestProcessManagerDoubleStop(t *testing.T) {
	pm := NewProcessManager()

	// Stopping when not running should not return error (graceful)
	err := pm.Stop()
	if err != nil {
		t.Errorf("Stop on non-running process returned error: %v", err)
	}
}

func TestProcessManagerDoubleStart(t *testing.T) {
	pm := NewProcessManager()

	// Start a long-running process
	cmd1 := exec.Command("sleep", "10")
	err := pm.Start(cmd1)
	if err != nil {
		t.Fatalf("Failed to start first process: %v", err)
	}

	// Try to start another without stopping
	cmd2 := exec.Command("sleep", "10")
	err = pm.Start(cmd2)
	if err == nil {
		t.Error("Expected error when starting while already running")
	}

	// Clean up
	pm.Stop()
}