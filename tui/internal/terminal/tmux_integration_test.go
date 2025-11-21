package terminal

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/natb1/tui/pkg/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestTmuxManagerIntegration tests the full tmux manager flow
func TestTmuxManagerIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// Check if we're in a tmux session
	if os.Getenv("TMUX") == "" {
		t.Skip("Test requires being run inside tmux")
	}

	ctx := context.Background()

	// Create TmuxManager using factory
	factory := NewTmuxManagerFactory()
	tm := factory.NewProduction(ctx)
	defer tm.Cleanup()

	// Get current session name
	sessionName, err := tm.getCurrentTmuxSession()
	require.NoError(t, err, "Should get current tmux session")
	require.NotEmpty(t, sessionName, "Session name should not be empty")

	t.Run("WindowCreationAndListing", func(t *testing.T) {
		project := &model.Project{
			Name: "test-integration",
			Path: "/tmp/test-integration",
		}

		// Ensure test directory exists
		os.MkdirAll(project.Path, 0755)
		defer os.RemoveAll(project.Path)

		// Create a project window
		window, _, err := tm.EnsureProjectWindow(project, model.ShellTypeZsh, "grouped")
		require.NoError(t, err, "Should create project window")
		require.NotNil(t, window)

		// List windows and verify our window exists
		windows, err := tm.ListWindows(sessionName)
		require.NoError(t, err, "Should list windows")

		found := false
		for _, w := range windows {
			if w.Name == window.Name {
				found = true
				break
			}
		}
		assert.True(t, found, "Created window should appear in window list")

		// Clean up: Kill the test window
		exec.Command("tmux", "kill-window", "-t", fmt.Sprintf("%s:%d", sessionName, window.Index)).Run()
	})

	t.Run("PaneCreation", func(t *testing.T) {
		project := &model.Project{
			Name: "test-pane",
			Path: "/tmp/test-pane",
		}

		// Ensure test directory exists
		os.MkdirAll(project.Path, 0755)
		defer os.RemoveAll(project.Path)

		// Create a project window
		window, _, err := tm.EnsureProjectWindow(project, model.ShellTypeZsh, "grouped")
		require.NoError(t, err)

		// Create a zsh pane (simpler for testing)
		err = tm.CreatePaneInWindow(window, model.ShellTypeZsh, project)
		assert.NoError(t, err, "Should create pane without error")

		// Clean up: Kill the test window
		exec.Command("tmux", "kill-window", "-t", fmt.Sprintf("%s:%d", sessionName, window.Index)).Run()
	})
}

// TestTmuxPathHandling tests that tmux path discovery works correctly
func TestTmuxPathHandling(t *testing.T) {
	// Test that findTmuxExecutable works
	tmuxPath := findTmuxExecutable(nil)
	require.NotEmpty(t, tmuxPath, "Should find tmux executable")

	// Verify we can execute tmux -V
	cmd := exec.Command(tmuxPath, "-V")
	output, err := cmd.Output()
	require.NoError(t, err, "Should execute tmux -V")
	assert.Contains(t, string(output), "tmux", "Output should contain 'tmux'")

	// Test that the path is accessible
	_, err = os.Stat(tmuxPath)
	require.NoError(t, err, "Tmux path should exist")

	// If in PATH, verify it matches
	if pathTmux, err := exec.LookPath("tmux"); err == nil {
		// Both should work
		cmd1 := exec.Command(pathTmux, "-V")
		output1, err1 := cmd1.Output()

		cmd2 := exec.Command(tmuxPath, "-V")
		output2, err2 := cmd2.Output()

		assert.NoError(t, err1)
		assert.NoError(t, err2)
		assert.Equal(t, string(output1), string(output2), "Both paths should give same tmux version")
	}
}

// TestSessionManagement tests session creation and discovery
func TestSessionManagement(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	if os.Getenv("TMUX") == "" {
		t.Skip("Test requires being run inside tmux")
	}

	ctx := context.Background()
	factory := NewTmuxManagerFactory()
	tm := factory.NewProduction(ctx)
	defer tm.Cleanup()

	t.Run("CreateProjectSession", func(t *testing.T) {
		project := &model.Project{
			Name: "test-session",
			Path: "/tmp/test-session",
		}

		os.MkdirAll(project.Path, 0755)
		defer os.RemoveAll(project.Path)

		// Create session
		session, err := tm.CreateProjectSession(project)
		require.NoError(t, err, "Should create project session")
		require.NotNil(t, session)
		assert.NotEmpty(t, session.Name, "Session should have a name")
		assert.Equal(t, project, session.Project, "Session should reference the project")
	})

	t.Run("DiscoverExistingSessions", func(t *testing.T) {
		// Discover all sessions
		err := tm.DiscoverExistingSessions()
		assert.NoError(t, err, "Should discover existing sessions")

		// List discovered sessions
		sessions, err := tm.ListSessions()
		assert.NoError(t, err, "Should list sessions")
		assert.NotEmpty(t, sessions, "Should have at least one session")

		// Current session should be in the list
		currentSession, err := tm.getCurrentTmuxSession()
		require.NoError(t, err)

		found := false
		for name := range sessions {
			if name == currentSession {
				found = true
				break
			}
		}
		assert.True(t, found, "Current session should be in discovered sessions")
	})
}

// TestWindowValidation tests the window validation logic
func TestWindowValidation(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	if os.Getenv("TMUX") == "" {
		t.Skip("Test requires being run inside tmux")
	}

	ctx := context.Background()
	factory := NewTmuxManagerFactory()
	tm := factory.NewProduction(ctx)
	defer tm.Cleanup()

	project := &model.Project{
		Name: "test-validation",
		Path: "/tmp/test-validation",
	}

	os.MkdirAll(project.Path, 0755)
	defer os.RemoveAll(project.Path)

	// Create a window for the project
	window, isNew, err := tm.EnsureProjectWindow(project, model.ShellTypeZsh, "grouped")
	require.NoError(t, err)
	require.NotNil(t, window)
	assert.True(t, isNew, "First call should create new window")

	// Test that calling EnsureProjectWindow again returns the same window in grouped mode
	window2, isNew2, err := tm.EnsureProjectWindow(project, model.ShellTypeZsh, "grouped")
	require.NoError(t, err)
	assert.Equal(t, window.Name, window2.Name, "Should return same window in grouped mode")
	assert.Equal(t, window.Index, window2.Index, "Should have same index")
	assert.False(t, isNew2, "Second call should find existing window")

	// In unsplit mode, it would create a new window each time
	window3, isNew3, err := tm.EnsureProjectWindow(project, model.ShellTypeZsh, "unsplit")
	assert.True(t, isNew3, "Unsplit mode should create new window")
	require.NoError(t, err)
	// In unsplit mode, window names include shell type
	assert.Contains(t, window3.Name, project.Name, "Window name should contain project name")
}

// TestMultiplePanesInWindow tests creating multiple panes in a window
func TestMultiplePanesInWindow(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	if os.Getenv("TMUX") == "" {
		t.Skip("Test requires being run inside tmux")
	}

	ctx := context.Background()
	factory := NewTmuxManagerFactory()
	tm := factory.NewProduction(ctx)
	defer tm.Cleanup()

	project := &model.Project{
		Name: "test-multi-pane",
		Path: "/tmp/test-multi-pane",
	}

	os.MkdirAll(project.Path, 0755)
	defer os.RemoveAll(project.Path)

	// Create a window
	window, _, err := tm.EnsureProjectWindow(project, model.ShellTypeZsh, "grouped")
	require.NoError(t, err)

	// Create multiple panes of different types
	shellTypes := []model.ShellType{
		model.ShellTypeClaude,
		model.ShellTypeNvim,
	}

	for _, shellType := range shellTypes {
		t.Run(string(shellType), func(t *testing.T) {
			// Check if pane already exists
			existingPane, err := tm.FindProjectPaneByType(window, shellType)
			assert.NoError(t, err)

			if existingPane == "" {
				// Create the pane
				err = tm.CreatePaneInWindow(window, shellType, project)
				assert.NoError(t, err, "Should create %s pane", shellType)

				// Wait for creation
				time.Sleep(500 * time.Millisecond)
			}

			// Verify pane exists
			paneID, err := tm.FindProjectPaneByType(window, shellType)
			assert.NoError(t, err)
			assert.NotEmpty(t, paneID, "Should find %s pane", shellType)
		})
	}

	// Verify window has multiple panes using tmux list-panes
	sessionName, err := tm.getCurrentTmuxSession()
	require.NoError(t, err)

	tmuxPath := findTmuxExecutable(nil)
	cmd := exec.Command(tmuxPath, "list-panes", "-t",
		strings.Join([]string{sessionName, ":", string(rune(window.Index))}, ""))
	output, err := cmd.Output()
	require.NoError(t, err, "Should list panes")

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	assert.GreaterOrEqual(t, len(lines), 2, "Window should have at least 2 panes")
}