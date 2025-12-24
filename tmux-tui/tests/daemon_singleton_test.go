package tests

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestDaemonSingleton_BasicEnforcement tests that only one daemon can run at a time
func TestDaemonSingleton_BasicEnforcement(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping E2E test in short mode")
	}

	// Cleanup stale sockets
	if err := cleanupStaleSockets(); err != nil {
		t.Logf("Warning: failed to cleanup stale sockets: %v", err)
	}

	socketName := uniqueSocketName()
	defer CleanupAlertFiles(socketName)

	// Create test session
	createCmd := tmuxCmd(socketName, "new-session", "-d", "-s", "test-singleton")
	if err := createCmd.Run(); err != nil {
		t.Fatalf("Failed to create test session: %v", err)
	}
	defer tmuxCmd(socketName, "kill-session", "-t", "test-singleton").Run()

	// Wait for socket to be ready
	if err := waitForTmuxSocket(socketName, 5*time.Second); err != nil {
		t.Fatalf("Tmux socket not ready: %v", err)
	}

	// Start first daemon
	cleanup1 := startDaemon(t, socketName, "test-singleton")
	defer cleanup1()

	// Wait for first daemon to be ready
	time.Sleep(500 * time.Millisecond)

	// Try to start second daemon - should exit gracefully
	daemonBinary := buildDaemon(t)
	uid := os.Getuid()
	tmuxSocketPath := fmt.Sprintf("/tmp/tmux-%d/%s", uid, socketName)
	tmuxEnv := fmt.Sprintf("%s,999999,0", tmuxSocketPath)

	cmd := exec.Command(daemonBinary)
	cmd.Env = append(os.Environ(), fmt.Sprintf("TMUX=%s", tmuxEnv))
	output, err := cmd.CombinedOutput()

	// Second daemon should exit with code 0 (graceful exit)
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			if exitErr.ExitCode() != 0 {
				t.Errorf("Second daemon should exit gracefully (code 0), got code %d", exitErr.ExitCode())
			}
		}
	}

	// Output should mention lock is held
	outputStr := string(output)
	if !strings.Contains(outputStr, "already running") || !strings.Contains(outputStr, "lock held") {
		t.Errorf("Expected 'already running' and 'lock held' in output, got: %s", outputStr)
	}

	t.Logf("Second daemon correctly rejected: %s", outputStr)
}

// TestDaemonSingleton_NamespaceIsolation tests that different namespaces can run separate daemons
func TestDaemonSingleton_NamespaceIsolation(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping E2E test in short mode")
	}

	// Create two separate test sessions (different namespaces)
	socket1 := uniqueSocketName()
	socket2 := uniqueSocketName()
	defer CleanupAlertFiles(socket1)
	defer CleanupAlertFiles(socket2)

	// Create first session
	create1 := tmuxCmd(socket1, "new-session", "-d", "-s", "test-ns1")
	if err := create1.Run(); err != nil {
		t.Fatalf("Failed to create first session: %v", err)
	}
	defer tmuxCmd(socket1, "kill-session", "-t", "test-ns1").Run()

	// Create second session
	create2 := tmuxCmd(socket2, "new-session", "-d", "-s", "test-ns2")
	if err := create2.Run(); err != nil {
		t.Fatalf("Failed to create second session: %v", err)
	}
	defer tmuxCmd(socket2, "kill-session", "-t", "test-ns2").Run()

	if err := waitForTmuxSocket(socket1, 5*time.Second); err != nil {
		t.Fatalf("Socket1 not ready: %v", err)
	}
	if err := waitForTmuxSocket(socket2, 5*time.Second); err != nil {
		t.Fatalf("Socket2 not ready: %v", err)
	}

	// Start daemons in both sessions - both should succeed
	cleanup1 := startDaemon(t, socket1, "test-ns1")
	defer cleanup1()

	cleanup2 := startDaemon(t, socket2, "test-ns2")
	defer cleanup2()

	time.Sleep(500 * time.Millisecond)

	// Verify both daemons are running
	alertDir1 := getTestAlertDir(socket1)
	socketPath1 := filepath.Join(alertDir1, "daemon.sock")
	if _, err := os.Stat(socketPath1); err != nil {
		t.Errorf("First daemon should be running: %v", err)
	}

	alertDir2 := getTestAlertDir(socket2)
	socketPath2 := filepath.Join(alertDir2, "daemon.sock")
	if _, err := os.Stat(socketPath2); err != nil {
		t.Errorf("Second daemon should be running: %v", err)
	}

	t.Log("Both daemons running in isolated namespaces")
}
