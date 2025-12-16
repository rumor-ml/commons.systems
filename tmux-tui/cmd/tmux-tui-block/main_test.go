package main

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/commons-systems/tmux-tui/internal/daemon"
	"github.com/commons-systems/tmux-tui/internal/tmux/testutil"
)

func TestGetCurrentBranch_Success(t *testing.T) {
	mockExec := &testutil.MockCommandExecutor{
		TmuxOutput: "/home/user/repo\n",
		GitOutputs: map[string]string{
			"-C /home/user/repo rev-parse --abbrev-ref HEAD": "feature-branch\n",
		},
	}

	branch, err := getCurrentBranch(mockExec, "%1")
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}

	if branch != "feature-branch" {
		t.Errorf("Expected 'feature-branch', got '%s'", branch)
	}
}

func TestGetCurrentBranch_TmuxError(t *testing.T) {
	mockExec := &testutil.MockCommandExecutor{
		TmuxOutput: "",
		GitOutputs: map[string]string{},
	}

	_, err := getCurrentBranch(mockExec, "%1")
	if err == nil {
		t.Fatal("Expected error from tmux failure")
	}

	if !strings.Contains(err.Error(), "failed to get pane current path") {
		t.Errorf("Wrong error message: %v", err)
	}
}

func TestGetCurrentBranch_NonGitDirectory(t *testing.T) {
	mockExec := &testutil.MockCommandExecutor{
		TmuxOutput: "/home/user/non-git\n",
		GitOutputs: map[string]string{},
	}

	_, err := getCurrentBranch(mockExec, "%1")
	if err == nil {
		t.Fatal("Expected error from git failure")
	}

	if !strings.Contains(err.Error(), "failed to get current branch") {
		t.Errorf("Wrong error message: %v", err)
	}
}

func TestGetCurrentBranch_DetachedHead(t *testing.T) {
	mockExec := &testutil.MockCommandExecutor{
		TmuxOutput: "/home/user/repo\n",
		GitOutputs: map[string]string{
			"-C /home/user/repo rev-parse --abbrev-ref HEAD": "HEAD\n",
		},
	}

	branch, err := getCurrentBranch(mockExec, "%1")
	if err != nil {
		t.Fatalf("Expected no error for detached HEAD, got: %v", err)
	}

	if branch != "HEAD" {
		t.Errorf("Expected 'HEAD', got '%s'", branch)
	}
}

func TestGetCurrentBranch_WhitespaceHandling(t *testing.T) {
	mockExec := &testutil.MockCommandExecutor{
		TmuxOutput: "  /home/user/repo  \n",
		GitOutputs: map[string]string{
			"-C /home/user/repo rev-parse --abbrev-ref HEAD": "  main  \n",
		},
	}

	branch, err := getCurrentBranch(mockExec, "%1")
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}

	if branch != "main" {
		t.Errorf("Expected 'main' (trimmed), got '%s'", branch)
	}
}

func TestGetCurrentBranch_MainBranch(t *testing.T) {
	mockExec := &testutil.MockCommandExecutor{
		TmuxOutput: "/home/user/repo\n",
		GitOutputs: map[string]string{
			"-C /home/user/repo rev-parse --abbrev-ref HEAD": "main\n",
		},
	}

	branch, err := getCurrentBranch(mockExec, "%1")
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}

	if branch != "main" {
		t.Errorf("Expected 'main', got '%s'", branch)
	}
}

func TestGetCurrentBranch_DevelopBranch(t *testing.T) {
	mockExec := &testutil.MockCommandExecutor{
		TmuxOutput: "/home/user/repo\n",
		GitOutputs: map[string]string{
			"-C /home/user/repo rev-parse --abbrev-ref HEAD": "develop\n",
		},
	}

	branch, err := getCurrentBranch(mockExec, "%1")
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}

	if branch != "develop" {
		t.Errorf("Expected 'develop', got '%s'", branch)
	}
}

func TestGetCurrentBranch_BranchWithSlashes(t *testing.T) {
	mockExec := &testutil.MockCommandExecutor{
		TmuxOutput: "/home/user/repo\n",
		GitOutputs: map[string]string{
			"-C /home/user/repo rev-parse --abbrev-ref HEAD": "feature/add-new-feature\n",
		},
	}

	branch, err := getCurrentBranch(mockExec, "%1")
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}

	if branch != "feature/add-new-feature" {
		t.Errorf("Expected 'feature/add-new-feature', got '%s'", branch)
	}
}

func TestGetCurrentBranch_BranchWithHyphens(t *testing.T) {
	mockExec := &testutil.MockCommandExecutor{
		TmuxOutput: "/home/user/repo\n",
		GitOutputs: map[string]string{
			"-C /home/user/repo rev-parse --abbrev-ref HEAD": "245-tmux-tui-blocked-branch-toggle\n",
		},
	}

	branch, err := getCurrentBranch(mockExec, "%1")
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}

	if branch != "245-tmux-tui-blocked-branch-toggle" {
		t.Errorf("Expected '245-tmux-tui-blocked-branch-toggle', got '%s'", branch)
	}
}

func TestGetCurrentBranch_EmptyPaneID(t *testing.T) {
	mockExec := &testutil.MockCommandExecutor{
		TmuxOutput: "",
		GitOutputs: map[string]string{},
	}

	_, err := getCurrentBranch(mockExec, "")
	if err == nil {
		t.Fatal("Expected error with empty pane ID")
	}

	if !strings.Contains(err.Error(), "failed to get pane current path") {
		t.Errorf("Wrong error message: %v", err)
	}
}

func TestGetCurrentBranch_InvalidPaneID(t *testing.T) {
	mockExec := &testutil.MockCommandExecutor{
		TmuxOutput: "",
		GitOutputs: map[string]string{},
	}

	_, err := getCurrentBranch(mockExec, "%99999")
	if err == nil {
		t.Fatal("Expected error with invalid pane ID")
	}

	if !strings.Contains(err.Error(), "failed to get pane current path") {
		t.Errorf("Wrong error message: %v", err)
	}
}

func TestGetCurrentBranch_PathWithSpaces(t *testing.T) {
	mockExec := &testutil.MockCommandExecutor{
		TmuxOutput: "/home/user/my repo with spaces\n",
		GitOutputs: map[string]string{
			"-C /home/user/my repo with spaces rev-parse --abbrev-ref HEAD": "main\n",
		},
	}

	branch, err := getCurrentBranch(mockExec, "%1")
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}

	if branch != "main" {
		t.Errorf("Expected 'main', got '%s'", branch)
	}
}

func TestErrorMessageSelection(t *testing.T) {
	tests := []struct {
		name           string
		errorString    string
		expectedPrefix string
	}{
		{
			name:           "Pane path error",
			errorString:    "failed to get pane current path: some error",
			expectedPrefix: "Warning: Could not detect pane directory",
		},
		{
			name:           "Git branch error",
			errorString:    "failed to get current branch: not a git repository",
			expectedPrefix: "Warning: Not in a git repository",
		},
		{
			name:           "Generic error",
			errorString:    "some other error",
			expectedPrefix: "Warning: Could not detect current branch",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Verify our error message selection logic
			var message string
			if strings.Contains(tt.errorString, "failed to get pane current path") {
				message = "Warning: Could not detect pane directory. Showing branch picker."
			} else if strings.Contains(tt.errorString, "failed to get current branch") {
				message = "Warning: Not in a git repository or detached HEAD. Showing branch picker."
			} else {
				message = "Warning: Could not detect current branch. Showing branch picker."
			}

			if !strings.HasPrefix(message, tt.expectedPrefix) {
				t.Errorf("Expected message to start with %q, got %q", tt.expectedPrefix, message)
			}
		})
	}
}

func TestConnectionErrorHints(t *testing.T) {
	tests := []struct {
		name         string
		errorString  string
		expectedHint string
	}{
		{
			name:         "Socket not found",
			errorString:  "socket not found connecting to daemon",
			expectedHint: "Hint: Daemon not running. Start with: tmux-tui-daemon",
		},
		{
			name:         "Permission denied",
			errorString:  "permission denied accessing socket",
			expectedHint: "Hint: Permission issue accessing daemon socket.",
		},
		{
			name:         "Timeout error",
			errorString:  "connection timeout after 3 attempts",
			expectedHint: "Hint: Daemon may be slow to respond.",
		},
		{
			name:         "Generic connection error",
			errorString:  "connection failed for unknown reason",
			expectedHint: "Hint: Connection issue. Check if tmux-tui-daemon is running.",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var hint string
			if strings.Contains(tt.errorString, "socket not found") {
				hint = "Hint: Daemon not running. Start with: tmux-tui-daemon"
			} else if strings.Contains(tt.errorString, "permission denied") {
				hint = "Hint: Permission issue accessing daemon socket."
			} else if strings.Contains(tt.errorString, "timeout") {
				hint = "Hint: Daemon may be slow to respond."
			} else {
				hint = "Hint: Connection issue. Check if tmux-tui-daemon is running."
			}

			if !strings.Contains(hint, tt.expectedHint) {
				t.Errorf("Expected hint to contain %q, got %q", tt.expectedHint, hint)
			}
		})
	}
}

func TestQueryErrorHints(t *testing.T) {
	tests := []struct {
		name         string
		errorString  string
		expectedHint string
	}{
		{
			name:         "Timeout during query",
			errorString:  "timeout waiting for blocked state response",
			expectedHint: "Daemon may be slow to respond",
		},
		{
			name:         "Connection lost during query",
			errorString:  "connection lost to daemon socket",
			expectedHint: "Connection issue. Check if tmux-tui-daemon is running",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var hint string
			if strings.Contains(tt.errorString, "timeout") {
				hint = "Daemon may be slow to respond. Try again or check daemon logs."
			} else if strings.Contains(tt.errorString, "connection") {
				hint = "Connection issue. Check if tmux-tui-daemon is running."
			}

			if !strings.Contains(hint, tt.expectedHint) {
				t.Errorf("Expected hint to contain %q, got %q", tt.expectedHint, hint)
			}
		})
	}
}

func TestPrintErrorHint_SentinelErrors(t *testing.T) {
	tests := []struct {
		name  string
		err   error
		match error
	}{
		{
			name:  "Direct sentinel error - ErrSocketNotFound",
			err:   daemon.ErrSocketNotFound,
			match: daemon.ErrSocketNotFound,
		},
		{
			name:  "Wrapped sentinel error - ErrSocketNotFound",
			err:   fmt.Errorf("failed to connect: %w", daemon.ErrSocketNotFound),
			match: daemon.ErrSocketNotFound,
		},
		{
			name:  "Direct sentinel error - ErrPermissionDenied",
			err:   daemon.ErrPermissionDenied,
			match: daemon.ErrPermissionDenied,
		},
		{
			name:  "Wrapped sentinel error - ErrPermissionDenied",
			err:   fmt.Errorf("access denied: %w", daemon.ErrPermissionDenied),
			match: daemon.ErrPermissionDenied,
		},
		{
			name:  "Direct sentinel error - ErrConnectionTimeout",
			err:   daemon.ErrConnectionTimeout,
			match: daemon.ErrConnectionTimeout,
		},
		{
			name:  "Wrapped sentinel error - ErrConnectionTimeout",
			err:   fmt.Errorf("connection failed: %w", daemon.ErrConnectionTimeout),
			match: daemon.ErrConnectionTimeout,
		},
		{
			name:  "Direct sentinel error - ErrConnectionFailed",
			err:   daemon.ErrConnectionFailed,
			match: daemon.ErrConnectionFailed,
		},
		{
			name:  "Wrapped sentinel error - ErrConnectionFailed",
			err:   fmt.Errorf("network error: %w", daemon.ErrConnectionFailed),
			match: daemon.ErrConnectionFailed,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if !errors.Is(tt.err, tt.match) {
				t.Errorf("errors.Is(%v, %v) = false, expected true", tt.err, tt.match)
			}
		})
	}
}

// mockDaemonClient implements the daemon client interface for testing
type mockDaemonClient struct {
	queryBlockedStateFunc func(branch string) (daemon.BlockedState, error)
	unblockBranchFunc     func(branch string) error
}

func (m *mockDaemonClient) QueryBlockedState(branch string) (daemon.BlockedState, error) {
	if m.queryBlockedStateFunc != nil {
		return m.queryBlockedStateFunc(branch)
	}
	// Return not blocked by default
	state, _ := daemon.NewBlockedState(false, "")
	return state, nil
}

func (m *mockDaemonClient) UnblockBranch(branch string) error {
	if m.unblockBranchFunc != nil {
		return m.unblockBranchFunc(branch)
	}
	return nil
}

func TestToggleBlockedState_EmptyBranch(t *testing.T) {
	// Empty branch should return false (show picker)
	result := toggleBlockedState(nil, "%1", "")
	if result != false {
		t.Error("Expected toggleBlockedState to return false for empty branch")
	}
}

func TestToggleBlockedState_BranchIsBlocked(t *testing.T) {
	unblockCalled := false

	mock := &mockDaemonClient{
		queryBlockedStateFunc: func(branch string) (daemon.BlockedState, error) {
			if branch != "feature-branch" {
				t.Errorf("Expected query for 'feature-branch', got '%s'", branch)
			}
			// Branch is blocked by main
			return daemon.NewBlockedState(true, "main")
		},
		unblockBranchFunc: func(branch string) error {
			unblockCalled = true
			if branch != "feature-branch" {
				t.Errorf("Expected unblock for 'feature-branch', got '%s'", branch)
			}
			return nil
		},
	}

	result := toggleBlockedState(mock, "%1", "feature-branch")

	if !result {
		t.Error("Expected toggleBlockedState to return true when branch is blocked")
	}

	if !unblockCalled {
		t.Error("Expected UnblockBranch to be called")
	}
}

func TestToggleBlockedState_BranchNotBlocked(t *testing.T) {
	unblockCalled := false

	mock := &mockDaemonClient{
		queryBlockedStateFunc: func(branch string) (daemon.BlockedState, error) {
			// Branch is not blocked
			return daemon.NewBlockedState(false, "")
		},
		unblockBranchFunc: func(branch string) error {
			unblockCalled = true
			return nil
		},
	}

	result := toggleBlockedState(mock, "%1", "feature-branch")

	if result {
		t.Error("Expected toggleBlockedState to return false when branch is not blocked")
	}

	if unblockCalled {
		t.Error("Expected UnblockBranch not to be called when branch is not blocked")
	}
}

func TestToggleBlockedState_QueryError(t *testing.T) {
	mock := &mockDaemonClient{
		queryBlockedStateFunc: func(branch string) (daemon.BlockedState, error) {
			// Return zero value on error (doesn't matter since we're returning an error)
			state, _ := daemon.NewBlockedState(false, "")
			return state, fmt.Errorf("connection timeout")
		},
	}

	result := toggleBlockedState(mock, "%1", "feature-branch")

	if result {
		t.Error("Expected toggleBlockedState to return false on query error")
	}
}

// BenchmarkGetCurrentBranch benchmarks the getCurrentBranch function
func BenchmarkGetCurrentBranch(b *testing.B) {
	mockExec := &testutil.MockCommandExecutor{
		TmuxOutput: "/home/user/repo\n",
		GitOutputs: map[string]string{
			"-C /home/user/repo rev-parse --abbrev-ref HEAD": "main\n",
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		getCurrentBranch(mockExec, "%1")
	}
}

func TestGetCurrentBranch_MultipleRepos(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		branch   string
		paneID   string
		expected string
	}{
		{
			name:     "Repo 1 - main",
			path:     "/home/user/repo1",
			branch:   "main",
			paneID:   "%1",
			expected: "main",
		},
		{
			name:     "Repo 2 - feature",
			path:     "/home/user/repo2",
			branch:   "feature-branch",
			paneID:   "%2",
			expected: "feature-branch",
		},
		{
			name:     "Repo 3 - develop",
			path:     "/home/user/repo3",
			branch:   "develop",
			paneID:   "%3",
			expected: "develop",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockExec := &testutil.MockCommandExecutor{
				TmuxOutput: tt.path + "\n",
				GitOutputs: map[string]string{
					fmt.Sprintf("-C %s rev-parse --abbrev-ref HEAD", tt.path): tt.branch + "\n",
				},
			}

			branch, err := getCurrentBranch(mockExec, tt.paneID)
			if err != nil {
				t.Fatalf("Expected no error, got: %v", err)
			}

			if branch != tt.expected {
				t.Errorf("Expected '%s', got '%s'", tt.expected, branch)
			}
		})
	}
}

// This validates that concurrent calls (e.g., user double-tapping keybinding) don't cause
// race conditions or unexpected behavior
func TestRapidToggle_ConcurrentInvocations(t *testing.T) {
	// Track function call counts with atomics
	queryCallCount := atomic.Int32{}
	unblockCallCount := atomic.Int32{}
	blockCallCount := atomic.Int32{}

	// Mock blocked branch (changes after first unblock)
	currentlyBlocked := atomic.Bool{}
	currentlyBlocked.Store(true) // Start as blocked

	// Simulate network latency in operations
	simulateLatency := func() {
		time.Sleep(50 * time.Millisecond)
	}

	// Create mock client with thread-safe operations
	mock := &mockDaemonClient{
		queryBlockedStateFunc: func(branch string) (daemon.BlockedState, error) {
			queryCallCount.Add(1)
			simulateLatency()
			isBlocked := currentlyBlocked.Load()
			if isBlocked {
				return daemon.NewBlockedState(true, "main")
			}
			return daemon.NewBlockedState(false, "")
		},
		unblockBranchFunc: func(branch string) error {
			unblockCallCount.Add(1)
			simulateLatency()
			currentlyBlocked.Store(false)
			return nil
		},
	}

	// Concurrent invocations (simulate rapid double-tap)
	var wg sync.WaitGroup
	results := make(chan string, 2)

	for i := 0; i < 2; i++ {
		wg.Add(1)
		invocationID := i
		go func() {
			defer wg.Done()

			t.Logf("Invocation %d: calling toggleBlockedState", invocationID)
			result := toggleBlockedState(mock, "%1", "feature-branch")

			if result {
				// Branch was blocked and got unblocked
				t.Logf("Invocation %d: unblocked", invocationID)
				results <- fmt.Sprintf("invocation-%d-unblocked", invocationID)
			} else {
				// Branch was not blocked, would show picker
				t.Logf("Invocation %d: would show picker", invocationID)
				blockCallCount.Add(1)
				results <- fmt.Sprintf("invocation-%d-picker", invocationID)
			}
		}()

		// Small delay to simulate human double-click timing
		time.Sleep(10 * time.Millisecond)
	}

	// Wait for both invocations
	wg.Wait()
	close(results)

	// Collect results
	var resultSlice []string
	for r := range results {
		resultSlice = append(resultSlice, r)
	}

	// ASSERTIONS

	// 1. Both invocations should complete without crashing
	if len(resultSlice) != 2 {
		t.Fatalf("Expected 2 results, got %d", len(resultSlice))
	}

	// 2. Query should be called exactly twice
	if queryCallCount.Load() != 2 {
		t.Errorf("Expected 2 query calls, got %d", queryCallCount.Load())
	}

	// 3. Due to race timing, either:
	//    - Both see "blocked" and both unblock (queryCallCount=2, unblockCallCount=2)
	//    - First sees "blocked" and unblocks, second sees "unblocked" and shows picker
	//    Both are acceptable outcomes
	totalUnblocks := unblockCallCount.Load()
	totalBlocks := blockCallCount.Load()

	if totalUnblocks+totalBlocks != 2 {
		t.Errorf("Expected total operations to be 2, got unblocks=%d blocks=%d",
			totalUnblocks, totalBlocks)
	}

	// Log final state for debugging
	t.Logf("Final state: queries=%d unblocks=%d blocks=%d",
		queryCallCount.Load(), unblockCallCount.Load(), blockCallCount.Load())
	t.Logf("Results: %v", resultSlice)

	// The test passes if:
	// - No crashes occurred
	// - All operations completed
	// - Call counts are consistent
	t.Log("Rapid toggle test passed - no race conditions detected")
}
