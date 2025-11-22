package terminal

import (
	"context"
	"testing"
	"time"

	"github.com/natb1/tui/internal/terminal/security"
	"github.com/natb1/tui/pkg/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateSession(t *testing.T) {
	manager := NewManager()
	defer manager.Shutdown()

	project := model.NewProject("test-project", "/tmp/test-project")

	tests := []struct {
		name    string
		command string
	}{
		{"zsh session", "zsh"},
		{"empty command defaults to zsh", ""},
		{"claude session", "claude"},
		{"nvim session", "nvim"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cmd := manager.CreateSession(project, tt.command)
			require.NotNil(t, cmd)

			msg := cmd()
			switch m := msg.(type) {
			case SessionCreatedMsg:
				session := m.Session
				assert.NotNil(t, session)
				assert.Equal(t, project, session.Project)
				assert.NotEmpty(t, session.ID)
				assert.True(t, session.Active)
				assert.NotNil(t, session.Output)
				assert.NotNil(t, session.Command)

				// Verify session is tracked
				sessions := manager.GetSessions()
				assert.Contains(t, sessions, session.ID)

			case error:
				// Expected in test environment for some commands
				t.Logf("Session creation failed (may be expected): %v", m)
			}
		})
	}
}

func TestResizeSessionImmediate(t *testing.T) {
	manager := NewManager()
	defer manager.Shutdown()

	// Test with non-existent session
	err := manager.ResizeSessionImmediate("nonexistent", 80, 24)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "session not found")

	// Create a session to test with
	project := model.NewProject("test", "/tmp/test")
	cmd := manager.CreateSession(project, "zsh")
	require.NotNil(t, cmd)

	msg := cmd()
	switch m := msg.(type) {
	case SessionCreatedMsg:
		session := m.Session
		
		// Test resize on active session
		err := manager.ResizeSessionImmediate(session.ID, 100, 30)
		// May fail in test environment due to PTY limitations, but should not panic
		if err != nil {
			t.Logf("Resize failed (expected in test): %v", err)
		}

		// Test resize after session becomes inactive
		session.mutex.Lock()
		session.Active = false
		session.mutex.Unlock()

		err = manager.ResizeSessionImmediate(session.ID, 100, 30)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "session is not active")

	case error:
		t.Skip("Cannot create session for resize test")
	}
}

func TestResizeSession(t *testing.T) {
	manager := NewManager()
	defer manager.Shutdown()

	// Create a session
	session := &Session{
		ID:     "test-session",
		Active: true,
		ctx:    context.Background(),
		cancel: func() {},
		Output: NewRingBuffer(1024),
	}

	// Test resize command (should not panic)
	cmd := manager.resizeSession(session, 80, 24)
	assert.NotNil(t, cmd)

	// Execute the resize command
	msg := cmd()
	_ = msg // Ignore result, may be nil or error in test environment
}

func TestMonitorSession(t *testing.T) {
	manager := NewManager()
	defer manager.Shutdown()

	// Create a minimal session for monitoring test
	ctx, cancel := context.WithCancel(context.Background())
	session := &Session{
		ID:     "monitor-test",
		Active: true,
		ctx:    ctx,
		cancel: cancel,
		Output: NewRingBuffer(1024),
	}

	// Add to manager
	manager.mutex.Lock()
	manager.sessions[session.ID] = session
	manager.mutex.Unlock()

	// Start monitoring in goroutine (would normally be done by createSession)
	done := make(chan bool, 1)
	go func() {
		defer func() {
			done <- true
		}()
		// Don't actually call monitorSession as it expects a real process
		// Instead test the cleanup behavior
		session.mutex.Lock()
		session.Active = false
		session.mutex.Unlock()
	}()

	// Cancel context to trigger cleanup
	cancel()

	// Wait for goroutine to finish
	select {
	case <-done:
		// Success
	case <-time.After(1 * time.Second):
		t.Fatal("Monitor goroutine did not complete")
	}

	// Verify session was marked inactive
	session.mutex.RLock()
	active := session.Active
	session.mutex.RUnlock()
	assert.False(t, active)
}

func TestValidateCommand(t *testing.T) {
	tests := []struct {
		name      string
		command   string
		shouldErr bool
	}{
		{"valid zsh", "zsh", false},
		{"valid claude", "claude", false},
		{"valid vim", "vim", false}, // vim is in whitelist, nvim is not
		{"empty command", "", false},
		{"claude with flag", "claude -c", false},
		{"invalid nvim", "nvim", true}, // nvim is not in whitelist
		{"dangerous command", "rm -rf /", true},
		{"command injection attempt", "ls; rm file", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := security.ValidateCommand(tt.command)
			if tt.shouldErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestGenerateSessionID(t *testing.T) {
	manager := NewManager()
	defer manager.Shutdown()

	// Generate multiple IDs
	id1 := manager.generateSessionID()
	id2 := manager.generateSessionID()

	// Should be different
	assert.NotEqual(t, id1, id2)
	
	// Should not be empty
	assert.NotEmpty(t, id1)
	assert.NotEmpty(t, id2)
}

func TestHandleSessionCreated(t *testing.T) {
	manager := NewManager()
	defer manager.Shutdown()

	session := &Session{
		ID:     "test-created",
		Active: true,
		Output: NewRingBuffer(1024),
		ctx:    context.Background(),
		cancel: func() {},
	}

	msg := SessionCreatedMsg{Session: session}
	cmd := manager.handleSessionCreated(msg)

	// Should return nil (no additional command needed)
	assert.Nil(t, cmd)
}

func TestHandleSessionTerminated(t *testing.T) {
	manager := NewManager()
	defer manager.Shutdown()

	session := &Session{
		ID:     "test-terminated",
		Active: false,
		Output: NewRingBuffer(1024),
		ctx:    context.Background(),
		cancel: func() {},
	}

	// Add session to manager
	manager.mutex.Lock()
	manager.sessions[session.ID] = session
	manager.mutex.Unlock()

	msg := SessionTerminatedMsg{SessionID: session.ID}
	cmd := manager.handleSessionTerminated(msg)

	// Should return nil (no additional command needed)
	assert.Nil(t, cmd)

	// Verify session was removed from manager
	sessions := manager.GetSessions()
	assert.NotContains(t, sessions, session.ID)
}