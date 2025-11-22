package devserver

import (
	"fmt"
	"os/exec"
	"syscall"
	"time"

	"github.com/rumor-ml/log/pkg/log"
)

// ProcessManager handles server process lifecycle
type ProcessManager struct {
	cmd    *exec.Cmd
	pid    int
	logger log.Logger
}

// NewProcessManager creates a new process manager
func NewProcessManager() *ProcessManager {
	return &ProcessManager{
		logger: log.Get().WithComponent("devserver-process"),
	}
}

// Start starts a new process with the given command
func (pm *ProcessManager) Start(cmd *exec.Cmd) error {
	if pm.cmd != nil && pm.cmd.Process != nil {
		return fmt.Errorf("process already running with PID %d", pm.pid)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start process: %w", err)
	}

	pm.cmd = cmd
	pm.pid = cmd.Process.Pid
	pm.logger.Info("Started process", "pid", pm.pid)

	return nil
}

// Stop stops the running process gracefully
func (pm *ProcessManager) Stop() error {
	if pm.cmd == nil || pm.cmd.Process == nil {
		return nil // No process running
	}

	pm.logger.Info("Stopping process", "pid", pm.pid)

	// Send SIGTERM for graceful shutdown
	if err := pm.cmd.Process.Signal(syscall.SIGTERM); err != nil {
		pm.logger.Warn("Failed to send SIGTERM", "error", err)
	}

	// Wait for graceful shutdown with timeout
	done := make(chan error, 1)
	go func() {
		done <- pm.cmd.Wait()
	}()

	select {
	case <-time.After(5 * time.Second):
		// Force kill after timeout
		pm.logger.Warn("Graceful shutdown timeout, force killing", "pid", pm.pid)
		if err := pm.cmd.Process.Kill(); err != nil {
			return fmt.Errorf("failed to kill process: %w", err)
		}
		<-done // Wait for process to exit after kill
	case err := <-done:
		if err != nil && err.Error() != "signal: terminated" {
			pm.logger.Debug("Process exited with error", "error", err)
		}
	}

	pm.cmd = nil
	pm.pid = 0
	pm.logger.Info("Process stopped successfully")

	return nil
}

// IsRunning checks if the process is currently running
func (pm *ProcessManager) IsRunning() bool {
	if pm.cmd == nil || pm.cmd.Process == nil {
		return false
	}

	// Check if process is still alive
	if err := pm.cmd.Process.Signal(syscall.Signal(0)); err != nil {
		pm.cmd = nil
		pm.pid = 0
		return false
	}

	return true
}

// GetPID returns the current process PID
func (pm *ProcessManager) GetPID() int {
	if pm.IsRunning() {
		return pm.pid
	}
	return 0
}

// Wait waits for the process to exit
func (pm *ProcessManager) Wait() error {
	if pm.cmd == nil {
		return nil
	}
	return pm.cmd.Wait()
}

// KillPortProcess kills any process listening on the specified port
func KillPortProcess(port int) error {
	logger := log.Get().WithComponent("devserver-port")

	// Use lsof to find process on port
	cmd := exec.Command("lsof", "-ti", fmt.Sprintf(":%d", port))
	output, err := cmd.Output()
	if err != nil {
		// No process on port
		return nil
	}

	pids := string(output)
	if pids == "" {
		return nil
	}

	// Kill the process
	killCmd := exec.Command("kill", "-9", pids)
	if err := killCmd.Run(); err != nil {
		return fmt.Errorf("failed to kill process on port %d: %w", port, err)
	}

	logger.Info("Killed process on port", "port", port, "pids", pids)

	// Wait for port to be released
	time.Sleep(500 * time.Millisecond)

	return nil
}