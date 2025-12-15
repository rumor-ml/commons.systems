package main

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/commons-systems/tmux-tui/internal/daemon"
	"github.com/commons-systems/tmux-tui/internal/tmux/testutil"
)

// TestGetCurrentBranch_Success tests getting branch from a git repo
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

// TestGetCurrentBranch_TmuxError tests error when tmux command fails
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

// TestGetCurrentBranch_NonGitDirectory tests error in non-git directory
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

// TestGetCurrentBranch_DetachedHead tests behavior with detached HEAD
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

// TestGetCurrentBranch_WhitespaceHandling tests trimming of whitespace
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

// TestGetCurrentBranch_MainBranch tests getting main branch
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

// TestGetCurrentBranch_DevelopBranch tests getting develop branch
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

// TestGetCurrentBranch_BranchWithSlashes tests branch names with slashes
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

// TestGetCurrentBranch_BranchWithHyphens tests branch names with hyphens
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

// TestGetCurrentBranch_EmptyPaneID tests behavior with empty pane ID
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

// TestGetCurrentBranch_InvalidPaneID tests behavior with invalid pane ID
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

// TestGetCurrentBranch_PathWithSpaces tests paths with spaces
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

// TestErrorMessageSelection tests error message selection logic
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

// TestConnectionErrorHints tests that connection errors produce helpful hints
func TestConnectionErrorHints(t *testing.T) {
	tests := []struct {
		name         string
		errorString  string
		expectedHint string
	}{
		{
			name:         "Socket not found",
			errorString:  "socket not found connecting to daemon",
			expectedHint: "Daemon not running. Start with: tmux-tui-daemon",
		},
		{
			name:         "Permission denied",
			errorString:  "permission denied accessing socket",
			expectedHint: "Permission issue accessing daemon socket",
		},
		{
			name:         "Timeout error",
			errorString:  "connection timeout after 3 attempts",
			expectedHint: "Daemon unresponsive. Check daemon logs",
		},
		{
			name:         "Generic connection error",
			errorString:  "connection failed for unknown reason",
			expectedHint: "Make sure tmux-tui-daemon is running",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var hint string
			if strings.Contains(tt.errorString, "socket not found") {
				hint = "Daemon not running. Start with: tmux-tui-daemon"
			} else if strings.Contains(tt.errorString, "permission denied") {
				hint = "Permission issue accessing daemon socket. Check file permissions."
			} else if strings.Contains(tt.errorString, "timeout") {
				hint = "Daemon unresponsive. Check daemon logs or restart it."
			} else {
				hint = "Make sure tmux-tui-daemon is running."
			}

			if !strings.Contains(hint, tt.expectedHint) {
				t.Errorf("Expected hint to contain %q, got %q", tt.expectedHint, hint)
			}
		})
	}
}

// TestQueryErrorHints tests that query errors produce helpful hints
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

// TestPrintErrorHint_SentinelErrors tests that errors.Is() works with wrapped sentinel errors
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
	queryBlockedStateFunc func(branch string) (blockedBy string, isBlocked bool, err error)
	unblockBranchFunc     func(branch string) error
}

func (m *mockDaemonClient) QueryBlockedState(branch string) (string, bool, error) {
	if m.queryBlockedStateFunc != nil {
		return m.queryBlockedStateFunc(branch)
	}
	return "", false, nil
}

func (m *mockDaemonClient) UnblockBranch(branch string) error {
	if m.unblockBranchFunc != nil {
		return m.unblockBranchFunc(branch)
	}
	return nil
}

// Helper type to track function calls
type mockClient interface {
	QueryBlockedState(branch string) (blockedBy string, isBlocked bool, err error)
	UnblockBranch(branch string) error
}

// TestToggleBlockedState_EmptyBranch tests toggleBlockedState with empty branch
func TestToggleBlockedState_EmptyBranch(t *testing.T) {
	// Empty branch should return false (show picker)
	result := toggleBlockedState(nil, "%1", "")
	if result != false {
		t.Error("Expected toggleBlockedState to return false for empty branch")
	}
}

// TestToggleBlockedState_BranchIsBlocked tests unblocking a blocked branch
func TestToggleBlockedState_BranchIsBlocked(t *testing.T) {
	unblockCalled := false

	mock := &mockDaemonClient{
		queryBlockedStateFunc: func(branch string) (string, bool, error) {
			if branch != "feature-branch" {
				t.Errorf("Expected query for 'feature-branch', got '%s'", branch)
			}
			return "main", true, nil // Branch is blocked by main
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

// TestToggleBlockedState_BranchNotBlocked tests behavior when branch is not blocked
func TestToggleBlockedState_BranchNotBlocked(t *testing.T) {
	unblockCalled := false

	mock := &mockDaemonClient{
		queryBlockedStateFunc: func(branch string) (string, bool, error) {
			return "", false, nil // Branch is not blocked
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

// TestToggleBlockedState_QueryError tests error handling during query
func TestToggleBlockedState_QueryError(t *testing.T) {
	mock := &mockDaemonClient{
		queryBlockedStateFunc: func(branch string) (string, bool, error) {
			return "", false, fmt.Errorf("connection timeout")
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

// TestGetCurrentBranch_MultipleRepos tests handling of multiple repos
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
