package worktree

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/natb1/tui/pkg/discovery"
	"github.com/rumor-ml/carriercommons/pkg/worktree"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewService(t *testing.T) {
	tempDir := t.TempDir()
	service := NewService(tempDir)

	assert.NotNil(t, service)
	assert.Equal(t, tempDir, service.workspaceRoot)
	assert.NotNil(t, service.projects)
	assert.NotNil(t, service.sessions)
	assert.NotNil(t, service.ctx)

	// Cleanup
	service.Shutdown()
}

func TestDiscoverWorktrees(t *testing.T) {
	tempDir := t.TempDir()
	service := NewService(tempDir)
	defer service.Shutdown()

	// Create a test project with git repo
	projectPath := filepath.Join(tempDir, "test-project")
	require.NoError(t, os.MkdirAll(projectPath, 0755))

	// Initialize git repo
	cmd := exec.Command("git", "init")
	cmd.Dir = projectPath
	require.NoError(t, cmd.Run())

	// Create initial commit
	testFile := filepath.Join(projectPath, "test.txt")
	require.NoError(t, os.WriteFile(testFile, []byte("test"), 0644))

	cmd = exec.Command("git", "add", ".")
	cmd.Dir = projectPath
	require.NoError(t, cmd.Run())

	cmd = exec.Command("git", "commit", "-m", "Initial commit")
	cmd.Dir = projectPath
	require.NoError(t, cmd.Run())

	// Create a worktree
	worktreePath := filepath.Join(projectPath, ".worktrees", "test-wt")
	cmd = exec.Command("git", "worktree", "add", "-b", "test-branch", worktreePath)
	cmd.Dir = projectPath
	require.NoError(t, cmd.Run())

	// Create test projects
	projects := []*discovery.Project{
		{
			Name: "test-project",
			Path: projectPath,
		},
	}

	// Convert to ProjectInfo slice
	projectInfos := make([]ProjectInfo, len(projects))
	for i, p := range projects {
		projectInfos[i] = p
	}
	
	// Discover worktrees
	err := service.DiscoverWorktrees(projectInfos)
	assert.NoError(t, err)

	// Verify manager was created
	manager := service.GetManager(projectPath)
	assert.NotNil(t, manager)

	// Verify worktree was discovered
	worktrees, err := manager.ListWorktrees()
	assert.NoError(t, err)
	assert.Greater(t, len(worktrees), 0)
}

func TestRegisterSession(t *testing.T) {
	tempDir := t.TempDir()
	service := NewService(tempDir)
	defer service.Shutdown()

	// Create a test project with worktree
	projectPath := filepath.Join(tempDir, "test-project")
	require.NoError(t, os.MkdirAll(projectPath, 0755))

	// Initialize git repo and create worktree (simplified for test)
	manager := worktree.NewManager(projectPath)
	service.projects[projectPath] = manager

	// Mock worktree data
	worktreeID := "test-worktree"
	sessionID := "test-session"

	// Register session (will fail because worktree doesn't exist, but tests the flow)
	err := service.RegisterSession(worktreeID, sessionID, projectPath, "zsh")

	// In a real scenario with actual worktrees, this would succeed
	// For now, we just verify the error handling works
	assert.Error(t, err) // Expected because we didn't create actual worktree
}

// TestSessionPersistence removed - persistence is no longer file-based

func TestGetWorktreeSessions(t *testing.T) {
	tempDir := t.TempDir()
	service := NewService(tempDir)
	defer service.Shutdown()

	// Add some test sessions
	worktreeID := "test-wt"
	service.sessions[worktreeID] = []string{"session1", "session2", "session3"}

	// Get sessions
	sessions := service.GetWorktreeSessions(worktreeID)
	assert.Len(t, sessions, 3)
	assert.Contains(t, sessions, "session1")
	assert.Contains(t, sessions, "session2")
	assert.Contains(t, sessions, "session3")

	// Test non-existent worktree
	sessions = service.GetWorktreeSessions("non-existent")
	assert.Len(t, sessions, 0)
}
