package tests

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/commons-systems/tmux-tui/internal/daemon"
)

// TestPersistenceErrorHandling tests that persistence errors are properly logged
// and broadcast to clients when the blocked branches file becomes unwritable.
func TestPersistenceErrorHandling(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping E2E test in short mode")
	}

	// This test is skipped in CI/full test runs due to file descriptor exhaustion
	// in long test suites. It's primarily useful for local development and isolated testing.
	if os.Getenv("SKIP_PERSISTENCE_ERROR_TESTS") == "1" {
		t.Skip("Skipping persistence error test to avoid file descriptor exhaustion in full test suite")
	}

	// Verify tmux is available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found")
	}

	socketName := uniqueSocketName()
	alertDir := getTestAlertDir(socketName)
	os.MkdirAll(alertDir, 0755)

	// Binaries are already built by the test suite setup
	// Avoid building again to prevent file descriptor exhaustion

	// Create test session
	sessionName := fmt.Sprintf("persist-test-%d", time.Now().Unix())
	cmd := tmuxCmd(socketName, "new-session", "-d", "-s", sessionName, "-x", "120", "-y", "40")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer func() {
		killCmd := tmuxCmd(socketName, "kill-session", "-t", sessionName)
		killCmd.Run()
	}()

	// Wait for tmux socket
	if err := waitForTmuxSocket(socketName, 15*time.Second); err != nil {
		t.Fatalf("Tmux socket not ready: %v", err)
	}

	// Start daemon
	t.Log("Starting daemon...")
	cleanupDaemon := startDaemon(t, socketName, sessionName)
	defer cleanupDaemon()

	// Give daemon time to start
	time.Sleep(500 * time.Millisecond)

	// Set up client connection
	uid := os.Getuid()
	tmuxSocketPath := fmt.Sprintf("/tmp/tmux-%d/%s", uid, socketName)
	tmuxEnv := fmt.Sprintf("%s,%d,0", tmuxSocketPath, os.Getpid())
	os.Setenv("TMUX", tmuxEnv)
	defer os.Unsetenv("TMUX")

	client := daemon.NewDaemonClient()
	if err := client.Connect(); err != nil {
		t.Fatalf("Failed to connect to daemon: %v", err)
	}
	defer client.Close()

	// Test 1: First, verify normal persistence works
	t.Log("Test 1: Verifying normal persistence works...")
	if err := client.BlockBranch("test-branch-1", "main"); err != nil {
		t.Fatalf("Failed to block branch: %v", err)
	}
	time.Sleep(300 * time.Millisecond)

	blockedFile := filepath.Join(alertDir, "tui-blocked-branches.json")
	if _, err := os.Stat(blockedFile); os.IsNotExist(err) {
		t.Fatalf("Blocked branches file not created at %s", blockedFile)
	}
	t.Logf("Blocked branches file created: %s", blockedFile)

	// Test 2: Make file read-only to trigger persistence error
	t.Log("Test 2: Making blocked branches file read-only...")

	// Make the file itself read-only (directory read-only doesn't prevent writing to existing files)
	if err := os.Chmod(blockedFile, 0444); err != nil {
		t.Fatalf("Failed to make blocked branches file read-only: %v", err)
	}
	defer func() {
		// Restore permissions for cleanup
		os.Chmod(blockedFile, 0644)
		os.Chmod(alertDir, 0755)
	}()

	// Test 3: Try to block another branch, which should trigger a persistence error
	t.Log("Test 3: Triggering persistence error by blocking another branch...")

	// This should succeed at the protocol level but fail at persistence
	err := client.BlockBranch("test-branch-2", "main")
	if err != nil {
		t.Logf("BlockBranch returned error: %v", err)
	} else {
		t.Log("BlockBranch call succeeded (expected)")
	}

	// Wait longer for daemon to process and log
	time.Sleep(1 * time.Second)

	// Test 4: Verify error was logged
	t.Log("Test 4: Verifying error was logged...")
	debugLog := "/tmp/claude/tui-debug.log"
	logContent, err := os.ReadFile(debugLog)
	if err != nil {
		t.Fatalf("Could not read debug log: %v", err)
	}

	logStr := string(logContent)
	hasDaemonError := strings.Contains(logStr, "DAEMON_SAVE_BLOCKED_ERROR")
	hasDaemonBlock := strings.Contains(logStr, "DAEMON_BLOCK_BRANCH branch=test-branch-2")
	hasPermissionError := strings.Contains(logStr, "permission denied")
	hasRevertedLog := strings.Contains(logStr, "DAEMON_REVERTED_BLOCK_CHANGE")

	t.Logf("Daemon logs check: DAEMON_SAVE_BLOCKED_ERROR=%v, DAEMON_BLOCK_BRANCH(test-branch-2)=%v, permission_denied=%v, DAEMON_REVERTED=%v",
		hasDaemonError, hasDaemonBlock, hasPermissionError, hasRevertedLog)

	if !hasDaemonError && !hasPermissionError {
		// Show last part of log for debugging
		t.Log("Debug log contents (last 3000 chars):")
		if len(logStr) > 3000 {
			t.Log(logStr[len(logStr)-3000:])
		} else {
			t.Log(logStr)
		}

		if !hasDaemonBlock {
			t.Error("DAEMON_BLOCK_BRANCH message for test-branch-2 not found - the block message may not have reached the daemon")
		} else {
			t.Error("DAEMON_BLOCK_BRANCH found but no persistence error logged - the persistence error may not be triggering")
		}
	} else {
		t.Log("Persistence error was properly logged")
	}

	// Test 5: Restore permissions and verify recovery
	t.Log("Test 5: Restoring permissions and verifying recovery...")
	if err := os.Chmod(blockedFile, 0644); err != nil {
		t.Fatalf("Failed to restore file permissions: %v", err)
	}
	if err := os.Chmod(alertDir, 0755); err != nil {
		t.Fatalf("Failed to restore directory permissions: %v", err)
	}

	// Block a new branch to verify writes work again
	if err := client.BlockBranch("test-branch-3", "develop"); err != nil {
		t.Errorf("Failed to block branch after permission restore: %v", err)
	}
	time.Sleep(300 * time.Millisecond)

	// Verify the file was updated
	data, err := os.ReadFile(blockedFile)
	if err != nil {
		t.Errorf("Failed to read blocked branches file after recovery: %v", err)
	} else {
		if !strings.Contains(string(data), "test-branch-3") {
			t.Errorf("Blocked branches file should contain test-branch-3, got: %s", string(data))
		} else {
			t.Log("Recovery successful - persistence works after permission restore")
		}
	}

	t.Log("All persistence error tests passed!")
}

// TestPersistenceErrorBroadcast tests that persistence errors are broadcast to clients
// This is a more targeted test for the broadcast mechanism
func TestPersistenceErrorBroadcast(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping E2E test in short mode")
	}

	// TODO(#326): Fix persistence error test skipping in CI - currently skipped due to fd exhaustion
	// This test is skipped in CI/full test runs due to file descriptor exhaustion
	// in long test suites. It's primarily useful for local development and isolated testing.
	if os.Getenv("SKIP_PERSISTENCE_ERROR_TESTS") == "1" {
		t.Skip("Skipping persistence error test to avoid file descriptor exhaustion in full test suite")
	}

	// Verify tmux is available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found")
	}

	socketName := uniqueSocketName()
	alertDir := getTestAlertDir(socketName)
	os.MkdirAll(alertDir, 0755)

	// Binaries are already built by the test suite setup
	// Avoid building again to prevent file descriptor exhaustion

	// Create test session
	sessionName := fmt.Sprintf("broadcast-test-%d", time.Now().Unix())
	cmd := tmuxCmd(socketName, "new-session", "-d", "-s", sessionName, "-x", "120", "-y", "40")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer func() {
		killCmd := tmuxCmd(socketName, "kill-session", "-t", sessionName)
		killCmd.Run()
	}()

	// Wait for tmux socket
	if err := waitForTmuxSocket(socketName, 15*time.Second); err != nil {
		t.Fatalf("Tmux socket not ready: %v", err)
	}

	// Start daemon
	t.Log("Starting daemon...")
	cleanupDaemon := startDaemon(t, socketName, sessionName)
	defer cleanupDaemon()

	// Give daemon time to start
	time.Sleep(500 * time.Millisecond)

	// Set up client connection
	uid := os.Getuid()
	tmuxSocketPath := fmt.Sprintf("/tmp/tmux-%d/%s", uid, socketName)
	tmuxEnv := fmt.Sprintf("%s,%d,0", tmuxSocketPath, os.Getpid())
	os.Setenv("TMUX", tmuxEnv)
	defer os.Unsetenv("TMUX")

	client := daemon.NewDaemonClient()
	if err := client.Connect(); err != nil {
		t.Fatalf("Failed to connect to daemon: %v", err)
	}
	defer client.Close()

	// Start listening for events in background
	errorReceived := make(chan bool, 1)
	go func() {
		for msg := range client.Events() {
			t.Logf("Received event: Type=%s Error=%s", msg.Type, msg.Error)
			if msg.Type == daemon.MsgTypePersistenceError {
				t.Logf("Received persistence error broadcast: %s", msg.Error)
				errorReceived <- true
				return
			}
		}
	}()

	// First, verify normal persistence works
	t.Log("Setting up initial blocked branch...")
	if err := client.BlockBranch("test-branch-1", "main"); err != nil {
		t.Fatalf("Failed to block branch: %v", err)
	}
	time.Sleep(300 * time.Millisecond)

	// Make the persistence FILE read-only to trigger write error
	blockedFile := fmt.Sprintf("/tmp/claude/%s/tui-blocked-branches.json", socketName)
	t.Logf("Making persistence file read-only: %s", blockedFile)
	if err := os.Chmod(blockedFile, 0444); err != nil {
		t.Fatalf("Failed to make persistence file read-only: %v", err)
	}
	defer func() {
		os.Chmod(blockedFile, 0644)
		os.Chmod(alertDir, 0755)
	}()

	// Trigger persistence error by trying to block another branch
	t.Log("Triggering persistence error by blocking another branch...")
	if err := client.BlockBranch("test-branch-2", "main"); err != nil {
		t.Logf("BlockBranch returned error (expected): %v", err)
	}

	// Wait for persistence error broadcast with longer timeout
	t.Log("Waiting for persistence error broadcast...")
	select {
	case <-errorReceived:
		t.Log("Successfully received persistence error broadcast!")
	case <-time.After(3 * time.Second):
		// On timeout, check debug log for diagnostics
		debugLog := "/tmp/claude/tui-debug.log"
		if logContent, err := os.ReadFile(debugLog); err == nil {
			lastLines := string(logContent)
			if len(lastLines) > 1000 {
				lastLines = lastLines[len(lastLines)-1000:]
			}
			t.Logf("Debug log excerpt (last 1000 chars):\n%s", lastLines)
		}
		t.Error("Timeout waiting for persistence error broadcast - client should receive MsgTypePersistenceError")
	}
}

func TestPersistenceFailure_ConcurrentOperations(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping E2E test in short mode")
	}

	// TODO(#326): Fix persistence error test skipping in CI - currently skipped due to fd exhaustion
	// This test is skipped in CI/full test runs due to file descriptor exhaustion
	if os.Getenv("SKIP_PERSISTENCE_ERROR_TESTS") == "1" {
		t.Skip("Skipping persistence error test to avoid file descriptor exhaustion in full test suite")
	}

	// Verify tmux is available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found")
	}

	socketName := uniqueSocketName()
	alertDir := getTestAlertDir(socketName)
	os.MkdirAll(alertDir, 0755)

	// Create test session
	sessionName := fmt.Sprintf("persist-concurrent-%d", time.Now().Unix())
	cmd := tmuxCmd(socketName, "new-session", "-d", "-s", sessionName, "-x", "120", "-y", "40")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer func() {
		killCmd := tmuxCmd(socketName, "kill-session", "-t", sessionName)
		killCmd.Run()
	}()

	// Wait for tmux socket
	if err := waitForTmuxSocket(socketName, 15*time.Second); err != nil {
		t.Fatalf("Tmux socket not ready: %v", err)
	}

	// Start daemon
	t.Log("Starting daemon...")
	cleanupDaemon := startDaemon(t, socketName, sessionName)
	defer cleanupDaemon()

	// Give daemon time to start
	time.Sleep(500 * time.Millisecond)

	// Set up client connection
	uid := os.Getuid()
	tmuxSocketPath := fmt.Sprintf("/tmp/tmux-%d/%s", uid, socketName)
	tmuxEnv := fmt.Sprintf("%s,%d,0", tmuxSocketPath, os.Getpid())
	os.Setenv("TMUX", tmuxEnv)
	defer os.Unsetenv("TMUX")

	// Connect 3 clients
	clients := make([]*daemon.DaemonClient, 3)
	for i := 0; i < 3; i++ {
		clients[i] = daemon.NewDaemonClient()
		if err := clients[i].Connect(); err != nil {
			t.Fatalf("Client %d failed to connect: %v", i, err)
		}
		defer clients[i].Close()
	}

	// Wait for initial full_state messages
	time.Sleep(200 * time.Millisecond)

	// First, block a branch to create the persistence file
	if err := clients[0].BlockBranch("initial-branch", "main"); err != nil {
		t.Fatalf("Failed to create initial blocked branch: %v", err)
	}
	time.Sleep(300 * time.Millisecond)

	// Make persistence file read-only
	persistFile := filepath.Join(alertDir, "tui-blocked-branches.json")
	if err := os.Chmod(persistFile, 0444); err != nil {
		t.Fatalf("Failed to make file read-only: %v", err)
	}
	defer os.Chmod(persistFile, 0644) // Restore permissions

	// 5 concurrent block operations (all should fail + revert)
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			client := clients[idx%3]
			branch := fmt.Sprintf("feature-%d", idx)

			// This should fail due to readonly file
			client.BlockBranch(branch, "main")
		}(i)
	}

	wg.Wait()
	time.Sleep(500 * time.Millisecond) // Allow reverts to propagate

	// Verify ALL clients converged to correct state
	// Only initial-branch should remain (the features should be reverted)
	for i, client := range clients {
		for branchIdx := 0; branchIdx < 5; branchIdx++ {
			branch := fmt.Sprintf("feature-%d", branchIdx)
			state, err := client.QueryBlockedState(branch)
			if err != nil {
				t.Errorf("Client %d query %s failed: %v", i, branch, err)
			}
			if state.IsBlocked() {
				t.Errorf("Client %d: %s still blocked after persistence failure (should be reverted)", i, branch)
			}
		}
	}

	t.Log("Concurrent persistence failure test passed!")
}
