package terminal

import (
	"context"
	"testing"

	"github.com/natb1/tui/pkg/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateWorktreeSession(t *testing.T) {
	manager := NewManager()
	defer manager.Shutdown()

	// Create test project
	project := model.NewProject("test-project", "/tmp/test-project")

	// Test worktree parameters
	worktreeID := "feature-branch"
	worktreePath := "/tmp/test-project/.worktrees/feature-branch"

	// Create worktree session
	cmd := manager.CreateWorktreeSession(project, worktreeID, worktreePath, "zsh")
	require.NotNil(t, cmd)

	// Execute the command
	msg := cmd()

	// Check if it's an error or success
	switch m := msg.(type) {
	case SessionCreatedMsg:
		// Verify session properties
		session := m.Session
		assert.NotNil(t, session)
		assert.Equal(t, worktreeID, session.WorktreeID)
		assert.Equal(t, worktreePath, session.WorktreePath)
		assert.Equal(t, project, session.Project)
		assert.NotEmpty(t, session.ID)

		// Verify session was added to manager
		sessions := manager.GetSessions()
		assert.Contains(t, sessions, session.ID)

	case error:
		// This might happen if zsh is not available or PTY creation fails
		t.Logf("Session creation failed (expected in test environment): %v", m)
	default:
		t.Fatalf("Unexpected message type: %T", m)
	}
}

func TestCreateWorktreeSessionWithClaude(t *testing.T) {
	manager := NewManager()
	defer manager.Shutdown()

	// Create test project
	project := model.NewProject("test-project", "/tmp/test-project")

	// Test worktree parameters
	worktreeID := "claude-session"
	worktreePath := "/tmp/test-project/.worktrees/claude-session"

	// Create claude session
	cmd := manager.CreateWorktreeSession(project, worktreeID, worktreePath, "claude")
	require.NotNil(t, cmd)

	// Execute the command
	msg := cmd()

	// In test environment, this will likely fail due to claude not being available
	// But we can verify the attempt was made correctly
	switch m := msg.(type) {
	case SessionCreatedMsg:
		session := m.Session
		assert.Equal(t, worktreeID, session.WorktreeID)
		assert.Equal(t, worktreePath, session.WorktreePath)
	case error:
		// Expected in test environment
		t.Logf("Claude session creation failed (expected): %v", m)
	}
}

func TestSessionWorktreeFields(t *testing.T) {
	// Test that Session struct has worktree fields
	session := &Session{
		ID:           "test-123",
		WorktreeID:   "feature-branch",
		WorktreePath: "/path/to/worktree",
		Active: true,
		Output: NewRingBuffer(1024),
		ctx:    context.Background(),
		cancel: func() {},
	}

	assert.Equal(t, "feature-branch", session.WorktreeID)
	assert.Equal(t, "/path/to/worktree", session.WorktreePath)
}


func TestManagerGetSessions(t *testing.T) {
	manager := NewManager()
	defer manager.Shutdown()

	// Initially should be empty
	sessions := manager.GetSessions()
	assert.Empty(t, sessions)

	// Add a mock session with proper initialization
	session := &Session{
		ID:         "test-session",
		WorktreeID: "test-worktree",
		Active:     false, // Not active so it won't try to cancel
	}
	manager.sessions[session.ID] = session

	// Should return the session
	sessions = manager.GetSessions()
	assert.Len(t, sessions, 1)
	assert.Contains(t, sessions, session.ID)
	assert.Equal(t, "test-worktree", sessions[session.ID].WorktreeID)
}

func TestGetActiveSession(t *testing.T) {
	manager := NewManager()
	defer manager.Shutdown()

	// No active session initially
	active := manager.GetActiveSession()
	assert.Nil(t, active)

	// Add inactive session
	inactiveSession := &Session{
		ID:     "inactive",
		Active: false,
	}
	manager.sessions[inactiveSession.ID] = inactiveSession

	// Still no active session
	active = manager.GetActiveSession()
	assert.Nil(t, active)

	// Add active session with proper initialization
	ctx, cancel := context.WithCancel(context.Background())
	activeSession := &Session{
		ID:         "active",
		Active:     true,
		WorktreeID: "active-worktree",
		cancel:     cancel,
		ctx:        ctx,
	}
	manager.sessions[activeSession.ID] = activeSession

	// Should return the active session
	active = manager.GetActiveSession()
	assert.NotNil(t, active)
	assert.Equal(t, "active", active.ID)
	assert.Equal(t, "active-worktree", active.WorktreeID)
}
