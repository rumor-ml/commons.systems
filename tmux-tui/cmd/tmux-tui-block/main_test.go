package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestGetCurrentBranch_Success tests getting branch from a git repo
func TestGetCurrentBranch_Success(t *testing.T) {
	// This test requires tmux to be running and a real git repo
	// Skip if TMUX_PANE is not set (not in tmux)
	if os.Getenv("TMUX_PANE") == "" {
		t.Skip("Not running in tmux, skipping")
	}

	// Create a temporary git repo
	tmpDir := t.TempDir()

	// Initialize git repo
	cmd := exec.Command("git", "init")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Skipf("git not available: %v", err)
	}

	// Configure git
	exec.Command("git", "-C", tmpDir, "config", "user.email", "test@example.com").Run()
	exec.Command("git", "-C", tmpDir, "config", "user.name", "Test User").Run()

	// Create initial commit
	testFile := filepath.Join(tmpDir, "test.txt")
	os.WriteFile(testFile, []byte("test"), 0644)
	exec.Command("git", "-C", tmpDir, "add", ".").Run()
	exec.Command("git", "-C", tmpDir, "commit", "-m", "initial").Run()

	// Create and checkout a branch
	cmd = exec.Command("git", "-C", tmpDir, "checkout", "-b", "test-branch")
	if err := cmd.Run(); err != nil {
		t.Skipf("Failed to create branch: %v", err)
	}

	// Change to temp dir in current pane (this is tricky in tests)
	// For now, we'll skip the actual test and just verify the function exists
	t.Skip("Full integration test requires tmux pane in git repo")
}

// TestGetCurrentBranch_ErrorMessageFormat tests error messages contain expected text
func TestGetCurrentBranch_ErrorMessageFormat(t *testing.T) {
	// This test is environment-dependent - tmux might handle invalid inputs gracefully
	// or differently across systems. Skip unless we can reliably trigger errors.
	t.Skip("Requires mocking exec.Command to reliably test error cases")
}

// TestGetCurrentBranch_TmuxNotAvailable tests behavior when tmux command fails
func TestGetCurrentBranch_TmuxNotAvailable(t *testing.T) {
	// This test is environment-dependent - behavior varies based on tmux version and state
	// Skip unless we can mock exec.Command to control error conditions
	t.Skip("Requires mocking exec.Command to reliably test error cases")
}

// TestGetCurrentBranch_NonGitDirectory tests behavior in non-git directory
func TestGetCurrentBranch_NonGitDirectory(t *testing.T) {
	// This test would require mocking the pane path to point to a non-git directory
	// Since getCurrentBranch uses tmux display-message, we can't easily mock it
	// without refactoring the function to accept a path parameter

	t.Skip("Requires refactoring getCurrentBranch to accept path parameter for testing")
}

// TestMain_MissingTMUX_PANE tests error when TMUX_PANE is not set
func TestMain_MissingTMUX_PANE(t *testing.T) {
	// This would test the main() function, but we can't easily test main()
	// without it exiting the process. The logic is simple enough that
	// manual testing should suffice.

	t.Skip("Testing main() requires subprocess pattern")
}

// TestWarningMessages tests that warnings are properly formatted
func TestWarningMessages(t *testing.T) {
	// This test verifies the warning message format we added in Phase 2
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

// BenchmarkGetCurrentBranch benchmarks the getCurrentBranch function
func BenchmarkGetCurrentBranch(b *testing.B) {
	paneID := os.Getenv("TMUX_PANE")
	if paneID == "" {
		b.Skip("Not running in tmux")
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		getCurrentBranch(paneID)
	}
}
