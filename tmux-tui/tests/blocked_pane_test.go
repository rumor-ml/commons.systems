package tests

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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
	if err := waitForTmuxSocket(socketName, 5*time.Second); err != nil {
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

	// Set environment and run block CLI
	env := os.Environ()
	env = append(env, fmt.Sprintf("TMUX_PANE=%s", featurePane))
	env = append(env, "TMUX_TUI_DEBUG=1")

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

	// List files in directory for debugging
	dirPath := fmt.Sprintf("/tmp/claude/%s", socketName)
	entries, _ := os.ReadDir(dirPath)
	t.Logf("Files in %s:", dirPath)
	for _, e := range entries {
		t.Logf("  - %s", e.Name())
	}

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
	time.Sleep(200 * time.Millisecond)

	// Test 6: Verify unblocked state
	t.Log("Test 6: Verifying unblocked state...")
	blockedData, err = os.ReadFile(blockedFile)
	if err != nil {
		t.Fatalf("Failed to read blocked branches file after unblock: %v", err)
	}

	if err := json.Unmarshal(blockedData, &blockedBranches); err != nil {
		t.Fatalf("Failed to parse blocked branches after unblock: %v", err)
	}

	if _, exists := blockedBranches["feature-branch"]; exists {
		t.Errorf("Branch 'feature-branch' should not be in blocked branches after unblock, got: %v", blockedBranches)
	}
	t.Logf("Blocked branches after unblock: %v", blockedBranches)

	t.Log("All blocked pane tests passed!")
}
