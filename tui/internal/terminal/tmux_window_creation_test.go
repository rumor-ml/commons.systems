package terminal

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"testing"

	"github.com/natb1/tui/pkg/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestTmuxExecutableFinding tests that we can find the correct tmux executable
func TestTmuxExecutableFinding(t *testing.T) {
	t.Skip("findTmuxExecutable is not accessible from this package")

	// logger := log.Get().WithComponent("test")

	// Test finding tmux executable
	// tmuxPath := findTmuxExecutable(logger)
	// require.NotEmpty(t, tmuxPath, "Should find tmux executable")

	// Verify the executable exists
	// _, err := os.Stat(tmuxPath)
	// require.NoError(t, err, "Tmux executable should exist at found path")

	// Verify we can run it
	// cmd := exec.Command(tmuxPath, "-V")
	// output, err := cmd.Output()
	// require.NoError(t, err, "Should be able to run tmux -V")
	// assert.Contains(t, string(output), "tmux", "Output should contain 'tmux'")
}

// TestTmuxWindowCreation tests creating windows in tmux sessions
func TestTmuxWindowCreation(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// Check if we're in a tmux session
	if os.Getenv("TMUX") == "" {
		t.Skip("Test requires being run inside tmux session. Run: tmux new-session 'go test -v ./internal/terminal -run TestTmuxWindowCreation'")
	}

	ctx := context.Background()

	// Create TmuxManager using factory
	factory := NewTmuxManagerFactory()
	tm := factory.NewProduction(ctx)
	defer tm.Cleanup()

	// Create a test project
	project := &model.Project{
		Name: "test-project",
		Path: "/tmp/test-project",
	}

	// Ensure test directory exists
	os.MkdirAll(project.Path, 0755)
	defer os.RemoveAll(project.Path)

	t.Run("EnsureProjectWindow", func(t *testing.T) {
		// Test creating a project window
		window, isNew, err := tm.EnsureProjectWindow(project, model.ShellTypeZsh, "grouped")
		require.NoError(t, err, "Should create project window without error")
		require.NotNil(t, window, "Window should not be nil")
		assert.True(t, isNew, "First call should create new window")

		// Verify window properties
		assert.NotEmpty(t, window.Name, "Window should have a name")
		assert.GreaterOrEqual(t, window.Index, 0, "Window index should be non-negative")

		// Test that calling again returns the same window (in grouped mode)
		window2, isNew2, err := tm.EnsureProjectWindow(project, model.ShellTypeZsh, "grouped")
		require.NoError(t, err, "Should get existing window without error")
		assert.Equal(t, window.Name, window2.Name, "Should return same window in grouped mode")
		assert.False(t, isNew2, "Second call should find existing window")

		// Clean up: Kill the test window
		sessionName, _ := tm.getCurrentTmuxSession()
		exec.Command("tmux", "kill-window", "-t", fmt.Sprintf("%s:%d", sessionName, window.Index)).Run()
	})

	t.Run("CreatePaneInWindow", func(t *testing.T) {
		// Get or create window
		window, _, err := tm.EnsureProjectWindow(project, model.ShellTypeZsh, "grouped")
		require.NoError(t, err, "Should get window")

		// Get current session for cleanup
		sessionName, err := tm.getCurrentTmuxSession()
		require.NoError(t, err)

		// Create a zsh pane in the window (simpler than claude for testing)
		err = tm.CreatePaneInWindow(window, model.ShellTypeZsh, project)
		assert.NoError(t, err, "Should create pane without error")

		// Clean up: Kill the test window
		exec.Command("tmux", "kill-window", "-t", fmt.Sprintf("%s:%d", sessionName, window.Index)).Run()
	})
}

// TestTmuxSessionDiscovery tests session discovery and window listing
func TestTmuxSessionDiscovery(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// Check if we're in a tmux session
	if os.Getenv("TMUX") == "" {
		t.Skip("Test requires being run inside tmux")
	}

	ctx := context.Background()

	// Create TmuxManager
	factory := NewTmuxManagerFactory()
	tm := factory.NewProduction(ctx)
	defer tm.Cleanup()

	t.Run("GetCurrentSession", func(t *testing.T) {
		sessionName, err := tm.getCurrentTmuxSession()
		require.NoError(t, err, "Should get current session without error")
		assert.NotEmpty(t, sessionName, "Session name should not be empty")
		t.Logf("Current session: %s", sessionName)
	})

	t.Run("ListWindows", func(t *testing.T) {
		sessionName, err := tm.getCurrentTmuxSession()
		require.NoError(t, err, "Should get current session")

		windows, err := tm.ListWindows(sessionName)
		assert.NoError(t, err, "Should list windows without error")
		assert.NotEmpty(t, windows, "Should have at least one window")

		for _, window := range windows {
			t.Logf("Window: %s (index: %d, active: %v)",
				window.Name, window.Index, window.Active)
		}
	})

	t.Run("GetWindowsWithDetails", func(t *testing.T) {
		sessionName, err := tm.getCurrentTmuxSession()
		require.NoError(t, err, "Should get current session")

		windows, err := tm.GetWindowsWithDetails(sessionName)
		assert.NoError(t, err, "Should get windows with details without error")
		assert.NotEmpty(t, windows, "Should have at least one window")

		for _, window := range windows {
			t.Logf("Detailed Window: %s (index: %d, command: %s, paneTitle: %s)",
				window.Name, window.Index, window.Command, window.PaneTitle)
		}
	})
}

// TestTmuxPathCompatibility tests that both nix store paths are handled
func TestTmuxPathCompatibility(t *testing.T) {
	t.Skip("findTmuxExecutable is not accessible from this package")

	// logger := log.Get().WithComponent("test")

	// Test that findTmuxExecutable returns a valid path
	// tmuxPath := findTmuxExecutable(logger)
	// require.NotEmpty(t, tmuxPath, "Should find tmux executable")

	// Test that the path is one of the expected ones
	// validPaths := []string{
	// 	"/nix/store/nns9f4cgm1ciaiyxpm0n60ihbnbz1h69-tmux-3.5a/bin/tmux",
	// 	"/nix/store/hj4r6y5nd1kh25c6xil1p4vxqvv5r7zk-tmux-3.5a/bin/tmux",
	// 	"/opt/homebrew/bin/tmux",
	// 	"/usr/local/bin/tmux",
	// 	"/usr/bin/tmux",
	// }

	// found := false
	// for _, validPath := range validPaths {
	// 	if tmuxPath == validPath {
	// 		found = true
	// 		break
	// 	}
	// 	// Also check if it's from PATH (could be any path)
	// 	if _, err := exec.LookPath("tmux"); err == nil {
	// 		if output, err := exec.Command("which", "tmux").Output(); err == nil {
	// 			if string(output) == tmuxPath+"\n" {
	// 				found = true
	// 				break
	// 			}
	// 		}
	// 	}
	// }

	// assert.True(t, found, fmt.Sprintf("Tmux path %s should be a valid/expected path", tmuxPath))
}