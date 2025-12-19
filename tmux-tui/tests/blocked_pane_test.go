package tests

import (
	"encoding/json"
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

// TestBlockedPaneFlow tests the complete blocked pane feature
func TestBlockedPaneFlow(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping E2E test in short mode")
	}

	// Verify tmux is available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found")
	}

	socketName := uniqueSocketName()
	os.MkdirAll(getTestAlertDir(socketName), 0755)
	tuiDir, _ := filepath.Abs("..")

	// Build all binaries
	t.Log("Building binaries...")
	buildCmd := exec.Command("make", "build")
	buildCmd.Dir = tuiDir
	if output, err := buildCmd.CombinedOutput(); err != nil {
		t.Fatalf("Failed to build: %v\n%s", err, output)
	}

	// Create test session
	sessionName := fmt.Sprintf("block-test-%d", time.Now().Unix())
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

	// Create a window with multiple panes in different branches
	t.Log("Setting up test environment...")

	// Create git repo in temp dir
	tempDir := t.TempDir()
	gitCmd := exec.Command("git", "init")
	gitCmd.Dir = tempDir
	if err := gitCmd.Run(); err != nil {
		t.Fatalf("Failed to init git repo: %v", err)
	}

	// Create main branch
	gitCmd = exec.Command("git", "checkout", "-b", "main")
	gitCmd.Dir = tempDir
	gitCmd.Run()

	// Create a commit
	os.WriteFile(filepath.Join(tempDir, "test.txt"), []byte("test"), 0644)
	gitCmd = exec.Command("git", "add", ".")
	gitCmd.Dir = tempDir
	gitCmd.Run()
	gitCmd = exec.Command("git", "commit", "-m", "initial")
	gitCmd.Dir = tempDir
	gitCmd.Run()

	// Create feature branch
	gitCmd = exec.Command("git", "checkout", "-b", "feature-branch")
	gitCmd.Dir = tempDir
	gitCmd.Run()

	// Get pane ID for first pane (main branch)
	paneCmd := tmuxCmd(socketName, "display-message", "-t", sessionName+":0", "-p", "#{pane_id}")
	paneOutput, _ := paneCmd.Output()
	mainPane := strings.TrimSpace(string(paneOutput))
	t.Logf("Main pane: %s", mainPane)

	// Set pane directory to main branch
	cmd = tmuxCmd(socketName, "send-keys", "-t", mainPane, "cd "+tempDir, "Enter")
	cmd.Run()
	time.Sleep(200 * time.Millisecond)

	// Split to create second pane (feature branch)
	cmd = tmuxCmd(socketName, "split-window", "-t", mainPane, "-h")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to split window: %v", err)
	}
	time.Sleep(200 * time.Millisecond)

	// Get feature pane ID
	listCmd := tmuxCmd(socketName, "list-panes", "-t", sessionName+":0", "-F", "#{pane_id}")
	panesOutput, _ := listCmd.Output()
	paneIDs := strings.Split(strings.TrimSpace(string(panesOutput)), "\n")
	var featurePane string
	for _, p := range paneIDs {
		if p != mainPane && p != "" {
			featurePane = p
			break
		}
	}
	t.Logf("Feature pane: %s", featurePane)

	// Start daemon
	t.Log("Starting daemon...")
	cleanupDaemon := startDaemon(t, socketName, sessionName)
	defer cleanupDaemon()

	// Give daemon time to start
	time.Sleep(500 * time.Millisecond)

	// Test 1: Send block picker request via tmux-tui-block CLI
	t.Log("Test 1: Triggering block picker...")
	blockBinary := filepath.Join(tuiDir, "build", "tmux-tui-block")

	// Set environment and run block CLI in isolated test session
	env := os.Environ()
	env = append(env, fmt.Sprintf("TMUX_PANE=%s", featurePane))
	env = append(env, "TMUX_TUI_DEBUG=1")

	// CRITICAL: Set TMUX env to match test session so daemon client connects to test daemon
	uid := os.Getuid()
	tmuxSocketPath := fmt.Sprintf("/tmp/tmux-%d/%s", uid, socketName)
	// Format: socket_path,pid,session_id (pid can be any number for our purposes)
	tmuxEnv := fmt.Sprintf("%s,%d,0", tmuxSocketPath, os.Getpid())
	env = append(env, fmt.Sprintf("TMUX=%s", tmuxEnv))

	blockCmd := exec.Command(blockBinary)
	blockCmd.Env = env
	output, err := blockCmd.CombinedOutput()
	if err != nil {
		t.Fatalf("Failed to run tmux-tui-block: %v\nOutput: %s", err, output)
	}
	t.Logf("Block CLI output: %s", output)

	// Wait for daemon to process
	time.Sleep(300 * time.Millisecond)

	// Test 2: Verify daemon logged the request
	t.Log("Test 2: Verifying daemon received request...")
	debugLog := "/tmp/claude/tui-debug.log"
	logContent, err := os.ReadFile(debugLog)
	if err != nil {
		t.Logf("Warning: Could not read debug log: %v", err)
	} else {
		logStr := string(logContent)
		if !strings.Contains(logStr, "CLIENT_REQUEST_BLOCK_PICKER") {
			t.Error("Debug log should contain CLIENT_REQUEST_BLOCK_PICKER")
		}
		if !strings.Contains(logStr, "DAEMON_SHOW_PICKER") {
			t.Error("Debug log should contain DAEMON_SHOW_PICKER")
		}
	}

	// Test 3: Block a branch directly via daemon client
	t.Log("Test 3: Blocking branch via daemon client...")

	// Set TMUX env in test process so daemon client connects to test daemon (reuse tmuxEnv from earlier)
	os.Setenv("TMUX", tmuxEnv)
	defer os.Unsetenv("TMUX")

	client := daemon.NewDaemonClient()
	if err := client.Connect(); err != nil {
		t.Fatalf("Failed to connect to daemon: %v", err)
	}
	defer client.Close()

	// Block the feature-branch on "main" branch
	t.Logf("Sending BlockBranch request for branch=feature-branch blockedBy=main")
	if err := client.BlockBranch("feature-branch", "main"); err != nil {
		t.Fatalf("Failed to block branch: %v", err)
	}
	t.Log("BlockBranch request sent successfully")

	// Wait for daemon to persist
	time.Sleep(500 * time.Millisecond)

	// Test 4: Verify blocked state is persisted
	t.Log("Test 4: Verifying blocked state persistence...")
	blockedFile := fmt.Sprintf("/tmp/claude/%s/tui-blocked-branches.json", socketName)
	blockedData, err := os.ReadFile(blockedFile)
	if err != nil {
		t.Fatalf("Failed to read blocked branches file: %v", err)
	}

	var blockedBranches map[string]string
	if err := json.Unmarshal(blockedData, &blockedBranches); err != nil {
		t.Fatalf("Failed to parse blocked branches: %v", err)
	}

	if blockedBranches["feature-branch"] != "main" {
		t.Errorf("Expected branch 'feature-branch' to be blocked by 'main', got: %v", blockedBranches)
	}
	t.Logf("Blocked branches: %v", blockedBranches)

	// Test 5: Unblock the branch
	t.Log("Test 5: Unblocking branch...")
	if err := client.UnblockBranch("feature-branch"); err != nil {
		t.Fatalf("Failed to unblock branch: %v", err)
	}

	// Wait for daemon to persist
	time.Sleep(500 * time.Millisecond)

	// Test 6: Verify unblocked state
	t.Log("Test 6: Verifying unblocked state...")
	blockedData, err = os.ReadFile(blockedFile)
	if err != nil {
		t.Fatalf("Failed to read blocked branches file after unblock: %v", err)
	}

	// Re-declare blockedBranches to avoid reusing stale data from previous unmarshal
	blockedBranches = make(map[string]string)
	if err := json.Unmarshal(blockedData, &blockedBranches); err != nil {
		t.Fatalf("Failed to parse blocked branches after unblock: %v", err)
	}

	if _, exists := blockedBranches["feature-branch"]; exists {
		t.Errorf("Branch 'feature-branch' should not be in blocked branches after unblock, got: %v", blockedBranches)
	}
	t.Logf("Blocked branches after unblock: %v", blockedBranches)

	// Test 7: Query blocked state via QueryBlockedState
	t.Log("Test 7: Testing QueryBlockedState...")

	// First, block the branch again
	if err := client.BlockBranch("feature-branch", "main"); err != nil {
		t.Fatalf("Failed to block branch for query test: %v", err)
	}
	time.Sleep(300 * time.Millisecond)

	// Query the blocked state
	state, err := client.QueryBlockedState("feature-branch")
	if err != nil {
		t.Fatalf("Failed to query blocked state: %v", err)
	}

	if !state.IsBlocked() {
		t.Error("Expected feature-branch to be blocked")
	}

	if state.BlockedBy() != "main" {
		t.Errorf("Expected feature-branch to be blocked by 'main', got '%s'", state.BlockedBy())
	}
	t.Logf("Query result: branch=%s isBlocked=%v blockedBy=%s", "feature-branch", state.IsBlocked(), state.BlockedBy())

	// Query a non-blocked branch
	notBlockedState, err := client.QueryBlockedState("some-other-branch")
	if err != nil {
		t.Fatalf("Failed to query non-blocked branch: %v", err)
	}

	if notBlockedState.IsBlocked() {
		t.Error("Expected some-other-branch to not be blocked")
	}

	if notBlockedState.BlockedBy() != "" {
		t.Errorf("Expected blockedBy to be empty for non-blocked branch, got '%s'", notBlockedState.BlockedBy())
	}
	t.Logf("Query result for non-blocked: branch=%s isBlocked=%v blockedBy=%s", "some-other-branch", notBlockedState.IsBlocked(), notBlockedState.BlockedBy())

	t.Log("All blocked pane tests passed!")
}

// TestToggleUnblockFlow tests the toggle behavior of block/unblock/block cycles
func TestToggleUnblockFlow(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping E2E test in short mode")
	}

	// Verify tmux is available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found")
	}

	socketName := uniqueSocketName()
	os.MkdirAll(getTestAlertDir(socketName), 0755)
	tuiDir, _ := filepath.Abs("..")

	// Build all binaries
	t.Log("Building binaries...")
	buildCmd := exec.Command("make", "build")
	buildCmd.Dir = tuiDir
	if output, err := buildCmd.CombinedOutput(); err != nil {
		t.Fatalf("Failed to build: %v\n%s", err, output)
	}

	// Create test session
	sessionName := fmt.Sprintf("toggle-test-%d", time.Now().Unix())
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

	// Set TMUX env in test process so daemon client connects to test daemon
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

	// Test cycle: Block -> Query (verify blocked) -> Unblock -> Query (verify unblocked) -> Block again
	testBranch := "test-branch"
	blockingBranch := "main"

	// Step 1: Block the branch
	t.Logf("Step 1: Blocking %s with %s", testBranch, blockingBranch)
	if err := client.BlockBranch(testBranch, blockingBranch); err != nil {
		t.Fatalf("Failed to block branch: %v", err)
	}
	time.Sleep(300 * time.Millisecond)

	// Step 2: Query to verify blocked
	t.Log("Step 2: Querying blocked state (should be blocked)")
	state, err := client.QueryBlockedState(testBranch)
	if err != nil {
		t.Fatalf("Failed to query blocked state: %v", err)
	}
	if !state.IsBlocked() {
		t.Errorf("Expected %s to be blocked, but it was not", testBranch)
	}
	if state.BlockedBy() != blockingBranch {
		t.Errorf("Expected %s to be blocked by %s, got %s", testBranch, blockingBranch, state.BlockedBy())
	}
	t.Logf("Verified: %s is blocked by %s", testBranch, state.BlockedBy())

	// Step 3: Unblock the branch
	t.Logf("Step 3: Unblocking %s", testBranch)
	if err := client.UnblockBranch(testBranch); err != nil {
		t.Fatalf("Failed to unblock branch: %v", err)
	}
	time.Sleep(300 * time.Millisecond)

	// Step 4: Query to verify unblocked
	t.Log("Step 4: Querying blocked state (should be unblocked)")
	state2, err := client.QueryBlockedState(testBranch)
	if err != nil {
		t.Fatalf("Failed to query blocked state after unblock: %v", err)
	}
	if state2.IsBlocked() {
		t.Errorf("Expected %s to be unblocked, but it was blocked by %s", testBranch, state2.BlockedBy())
	}
	if state2.BlockedBy() != "" {
		t.Errorf("Expected blockedBy to be empty for unblocked branch, got %s", state2.BlockedBy())
	}
	t.Logf("Verified: %s is unblocked", testBranch)

	// Step 5: Block again to verify the cycle works
	t.Logf("Step 5: Blocking %s again with %s", testBranch, blockingBranch)
	if err := client.BlockBranch(testBranch, blockingBranch); err != nil {
		t.Fatalf("Failed to block branch second time: %v", err)
	}
	time.Sleep(300 * time.Millisecond)

	// Step 6: Query to verify blocked again
	t.Log("Step 6: Querying blocked state (should be blocked again)")
	state3, err := client.QueryBlockedState(testBranch)
	if err != nil {
		t.Fatalf("Failed to query blocked state after second block: %v", err)
	}
	if !state3.IsBlocked() {
		t.Errorf("Expected %s to be blocked again, but it was not", testBranch)
	}
	if state3.BlockedBy() != blockingBranch {
		t.Errorf("Expected %s to be blocked by %s again, got %s", testBranch, blockingBranch, state3.BlockedBy())
	}
	t.Logf("Verified: %s is blocked by %s again", testBranch, state3.BlockedBy())

	t.Log("Toggle-unblock flow test passed!")
}

func TestBlockedBranchPersistence_DaemonRestart(t *testing.T) {
	t.Skip("Flaky test: Failed to reconnect after daemon restart (issue #241)")
	if testing.Short() {
		t.Skip("Skipping E2E test in short mode")
	}

	// Verify tmux is available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found")
	}

	socketName := uniqueSocketName()
	os.MkdirAll(getTestAlertDir(socketName), 0755)
	tuiDir, _ := filepath.Abs("..")

	// Build binaries
	t.Log("Building binaries...")
	buildCmd := exec.Command("make", "build")
	buildCmd.Dir = tuiDir
	if output, err := buildCmd.CombinedOutput(); err != nil {
		t.Fatalf("Failed to build: %v\n%s", err, output)
	}

	// Create test session
	sessionName := fmt.Sprintf("restart-test-%d", time.Now().Unix())
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

	// Phase 1: Start daemon and block branches
	t.Log("Phase 1: Starting daemon and blocking branches...")
	cleanupDaemon := startDaemon(t, socketName, sessionName)
	time.Sleep(500 * time.Millisecond)

	// Set TMUX env for client connection
	uid := os.Getuid()
	tmuxSocketPath := fmt.Sprintf("/tmp/tmux-%d/%s", uid, socketName)
	tmuxEnv := fmt.Sprintf("%s,%d,0", tmuxSocketPath, os.Getpid())
	os.Setenv("TMUX", tmuxEnv)
	defer os.Unsetenv("TMUX")

	// Connect and block multiple branches
	client := daemon.NewDaemonClient()
	if err := client.Connect(); err != nil {
		t.Fatalf("Failed to connect to daemon: %v", err)
	}

	// Block 3 different branches
	testCases := []struct {
		branch    string
		blockedBy string
	}{
		{"feature-1", "main"},
		{"feature-2", "develop"},
		{"bugfix-123", "release-1.0"},
	}

	for _, tc := range testCases {
		if err := client.BlockBranch(tc.branch, tc.blockedBy); err != nil {
			t.Fatalf("Failed to block %s: %v", tc.branch, err)
		}
	}
	time.Sleep(300 * time.Millisecond) // Allow persistence

	// Verify persistence file exists and has correct content
	blockedFile := fmt.Sprintf("/tmp/claude/%s/tui-blocked-branches.json", socketName)
	data, err := os.ReadFile(blockedFile)
	if err != nil {
		t.Fatalf("Persistence file should exist: %v", err)
	}

	var blockedBranches map[string]string
	if err := json.Unmarshal(data, &blockedBranches); err != nil {
		t.Fatalf("Failed to parse persistence file: %v", err)
	}

	if len(blockedBranches) != 3 {
		t.Errorf("Expected 3 blocked branches in file, got %d", len(blockedBranches))
	}
	for _, tc := range testCases {
		if blockedBranches[tc.branch] != tc.blockedBy {
			t.Errorf("Persistence file: expected %s blocked by %s, got %s",
				tc.branch, tc.blockedBy, blockedBranches[tc.branch])
		}
	}
	t.Logf("Verified persistence file contains all 3 blocked branches")

	// Close client
	client.Close()
	time.Sleep(200 * time.Millisecond)

	// Phase 2: Stop daemon gracefully
	t.Log("Phase 2: Stopping daemon...")
	cleanupDaemon() // Kills daemon window
	time.Sleep(500 * time.Millisecond)

	// Note: Daemon socket may not be immediately removed when window is killed
	// This is acceptable - the important part is that persistence file survives

	// Verify persistence file still exists (not deleted on shutdown)
	if _, err := os.ReadFile(blockedFile); err != nil {
		t.Errorf("Persistence file should survive daemon shutdown: %v", err)
	}

	// Phase 3: Restart daemon
	t.Log("Phase 3: Restarting daemon...")
	cleanupDaemon2 := startDaemon(t, socketName, sessionName)
	defer cleanupDaemon2()
	time.Sleep(500 * time.Millisecond)

	// Phase 4: Connect new client and verify state was loaded
	t.Log("Phase 4: Verifying state loaded from disk...")
	client2 := daemon.NewDaemonClient()
	if err := client2.Connect(); err != nil {
		t.Fatalf("Failed to reconnect after restart: %v", err)
	}
	defer client2.Close()

	// Wait for full state message
	timeout := time.After(2 * time.Second)
	var fullStateMsg daemon.Message
	select {
	case fullStateMsg = <-client2.Events():
		if fullStateMsg.Type != daemon.MsgTypeFullState {
			t.Errorf("Expected full_state, got %s", fullStateMsg.Type)
		}
	case <-timeout:
		t.Fatal("Timeout waiting for full_state after reconnect")
	}

	// Verify full state contains all 3 blocked branches
	if len(fullStateMsg.BlockedBranches) != 3 {
		t.Errorf("Expected 3 blocked branches in full_state, got %d",
			len(fullStateMsg.BlockedBranches))
	}

	for _, tc := range testCases {
		if fullStateMsg.BlockedBranches[tc.branch] != tc.blockedBy {
			t.Errorf("Full state: expected %s blocked by %s, got %s",
				tc.branch, tc.blockedBy, fullStateMsg.BlockedBranches[tc.branch])
		}
	}

	// Phase 5: Query each branch to double-check
	t.Log("Phase 5: Querying individual branches...")
	for _, tc := range testCases {
		state, err := client2.QueryBlockedState(tc.branch)
		if err != nil {
			t.Errorf("Failed to query %s: %v", tc.branch, err)
			continue
		}
		if !state.IsBlocked() {
			t.Errorf("Branch %s should be blocked after restart", tc.branch)
		}
		if state.BlockedBy() != tc.blockedBy {
			t.Errorf("Branch %s: expected blocked by %s, got %s",
				tc.branch, tc.blockedBy, state.BlockedBy())
		}
	}

	t.Log("All persistence tests passed!")
}

func TestBlockedBranchPersistence_CorruptedFileRecovery(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping E2E test in short mode")
	}

	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found")
	}

	socketName := uniqueSocketName()
	os.MkdirAll(getTestAlertDir(socketName), 0755)
	tuiDir, _ := filepath.Abs("..")

	// Build binaries
	buildCmd := exec.Command("make", "build")
	buildCmd.Dir = tuiDir
	if output, err := buildCmd.CombinedOutput(); err != nil {
		t.Fatalf("Failed to build: %v\n%s", err, output)
	}

	// Create test session
	sessionName := fmt.Sprintf("corrupt-test-%d", time.Now().Unix())
	cmd := tmuxCmd(socketName, "new-session", "-d", "-s", sessionName, "-x", "120", "-y", "40")
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create tmux session: %v", err)
	}
	defer func() {
		killCmd := tmuxCmd(socketName, "kill-session", "-t", sessionName)
		killCmd.Run()
	}()

	if err := waitForTmuxSocket(socketName, 15*time.Second); err != nil {
		t.Fatalf("Tmux socket not ready: %v", err)
	}

	// Start daemon and block a branch
	t.Log("Starting daemon and creating valid state...")
	cleanupDaemon := startDaemon(t, socketName, sessionName)
	time.Sleep(500 * time.Millisecond)

	uid := os.Getuid()
	tmuxSocketPath := fmt.Sprintf("/tmp/tmux-%d/%s", uid, socketName)
	tmuxEnv := fmt.Sprintf("%s,%d,0", tmuxSocketPath, os.Getpid())
	os.Setenv("TMUX", tmuxEnv)
	defer os.Unsetenv("TMUX")

	client := daemon.NewDaemonClient()
	if err := client.Connect(); err != nil {
		t.Fatalf("Failed to connect: %v", err)
	}

	if err := client.BlockBranch("feature-1", "main"); err != nil {
		t.Fatalf("Failed to block branch: %v", err)
	}
	time.Sleep(300 * time.Millisecond)

	client.Close()
	cleanupDaemon()
	time.Sleep(500 * time.Millisecond)

	// Corrupt the persistence file
	t.Log("Corrupting persistence file...")
	blockedFile := fmt.Sprintf("/tmp/claude/%s/tui-blocked-branches.json", socketName)
	corruptedContent := `{"feature-1": "main", INVALID_JSON`
	if err := os.WriteFile(blockedFile, []byte(corruptedContent), 0644); err != nil {
		t.Fatalf("Failed to corrupt file: %v", err)
	}

	// Try to restart daemon - should fail to start due to corrupted file
	t.Log("Attempting to restart daemon with corrupted file...")
	// We expect the daemon to fail to start, so we'll start it in a window
	// and check that the socket is never created
	daemonBinary := filepath.Join(tuiDir, "build", "tmux-tui-daemon")
	uid2 := os.Getuid()
	tmuxSocketPath2 := fmt.Sprintf("/tmp/tmux-%d/%s", uid2, socketName)
	tmuxEnv2 := fmt.Sprintf("%s,$$,0", tmuxSocketPath2)

	// Create daemon window
	createWindowCmd := tmuxCmd(socketName, "new-window", "-t", sessionName, "-n", "daemon2", "-d")
	if err := createWindowCmd.Run(); err != nil {
		t.Fatalf("Failed to create daemon window: %v", err)
	}

	// Start daemon
	daemonTarget := fmt.Sprintf("%s:daemon2", sessionName)
	startCmd := fmt.Sprintf("TMUX='%s' TMUX_TUI_DEBUG=1 %s", tmuxEnv2, daemonBinary)
	sendKeysCmd := tmuxCmd(socketName, "send-keys", "-t", daemonTarget, startCmd, "Enter")
	if err := sendKeysCmd.Run(); err != nil {
		t.Fatalf("Failed to start daemon: %v", err)
	}

	// Wait and verify daemon socket is NOT created (daemon failed to start)
	t.Log("Verifying daemon fails to start with corrupted file...")
	daemonSocket := filepath.Join(getTestAlertDir(socketName), "daemon.sock")
	time.Sleep(1 * time.Second) // Give daemon time to fail

	if _, err := os.Stat(daemonSocket); err == nil {
		t.Error("Daemon socket should not exist - daemon should have failed to start with corrupted file")
	} else if !os.IsNotExist(err) {
		t.Errorf("Unexpected error checking socket: %v", err)
	}

	// Clean up daemon window
	killCmd := tmuxCmd(socketName, "kill-window", "-t", fmt.Sprintf("%s:daemon2", sessionName))
	killCmd.Run()

	// Fix the corrupted file and verify daemon can start with clean state
	t.Log("Fixing corrupted file and restarting daemon...")
	if err := os.WriteFile(blockedFile, []byte("{}"), 0644); err != nil {
		t.Fatalf("Failed to write fixed file: %v", err)
	}

	// Now daemon should start successfully
	cleanupDaemon3 := startDaemon(t, socketName, sessionName)
	defer cleanupDaemon3()
	time.Sleep(500 * time.Millisecond)

	// Connect and verify empty state
	client3 := daemon.NewDaemonClient()
	if err := client3.Connect(); err != nil {
		t.Fatalf("Failed to connect after fixing file: %v", err)
	}
	defer client3.Close()

	timeout := time.After(2 * time.Second)
	select {
	case msg := <-client3.Events():
		if msg.Type != daemon.MsgTypeFullState {
			t.Errorf("Expected full_state, got %s", msg.Type)
		}
		if len(msg.BlockedBranches) != 0 {
			t.Errorf("Expected empty state after file fix, got %d branches", len(msg.BlockedBranches))
		}
		t.Logf("Daemon started successfully with empty state after file fix")
	case <-timeout:
		t.Fatal("Timeout waiting for full_state after file fix")
	}

	t.Log("Corrupted file recovery test passed!")
}

func TestConcurrentQuerySameBranch(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping E2E test in short mode")
	}

	// Verify tmux is available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not found")
	}

	socketName := uniqueSocketName()
	sessionName := fmt.Sprintf("concurrent-query-%d", time.Now().Unix())

	// Create test session
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
	cleanupDaemon := startDaemon(t, socketName, sessionName)
	defer cleanupDaemon()

	// Give daemon time to start
	time.Sleep(500 * time.Millisecond)

	// Set up TMUX env for daemon client connection
	uid := os.Getuid()
	tmuxSocketPath := fmt.Sprintf("/tmp/tmux-%d/%s", uid, socketName)
	tmuxEnv := fmt.Sprintf("%s,%d,0", tmuxSocketPath, os.Getpid())
	os.Setenv("TMUX", tmuxEnv)
	defer os.Unsetenv("TMUX")

	// Block a branch using setup client
	client1 := daemon.NewDaemonClient()
	if err := client1.Connect(); err != nil {
		t.Fatalf("Failed to connect setup client: %v", err)
	}
	defer client1.Close()

	if err := client1.BlockBranch("feature", "main"); err != nil {
		t.Fatalf("Failed to block branch: %v", err)
	}
	time.Sleep(100 * time.Millisecond)

	// 10 concurrent queries for SAME branch
	const numClients = 10
	var wg sync.WaitGroup
	errors := make(chan error, numClients)
	results := make(chan daemon.BlockedState, numClients)

	for i := 0; i < numClients; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()

			client := daemon.NewDaemonClient()
			if err := client.Connect(); err != nil {
				errors <- fmt.Errorf("client %d connect: %w", id, err)
				return
			}
			defer client.Close()

			state, err := client.QueryBlockedState("feature")
			if err != nil {
				errors <- fmt.Errorf("client %d query: %w", id, err)
				return
			}
			results <- state
		}(i)
	}

	wg.Wait()
	close(errors)
	close(results)

	// Verify all succeeded
	for err := range errors {
		t.Errorf("Concurrent query error: %v", err)
	}

	// Verify all got correct state
	for state := range results {
		if !state.IsBlocked() || state.BlockedBy() != "main" {
			t.Errorf("Got incorrect state: blocked=%v, by=%s", state.IsBlocked(), state.BlockedBy())
		}
	}

	t.Log("Concurrent same-branch query test passed!")
}
