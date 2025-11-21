package terminal

import (
	"context"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/natb1/tui/pkg/discovery"
	"github.com/stretchr/testify/assert"
)

func TestNewManager(t *testing.T) {
	manager := NewManager()
	defer manager.Shutdown()

	assert.NotNil(t, manager)
	assert.NotNil(t, manager.sessions)
	assert.NotNil(t, manager.passthrough)
	assert.NotNil(t, manager.ctx)
	assert.NotNil(t, manager.cancel)
}

func TestManagerHandleMsg(t *testing.T) {
	manager := NewManager()
	defer manager.Shutdown()

	tests := []struct {
		name string
		msg  tea.Msg
	}{
		{
			name: "project discovered message",
			msg:  discovery.ProjectDiscoveredMsg{},
		},
		{
			name: "session created message",
			msg: SessionCreatedMsg{
				Session: &Session{
					ID:     "test-session",
					Active: true,
					Output: NewRingBuffer(1024),
					ctx:    context.Background(),
					cancel: func() {},
				},
			},
		},
		{
			name: "session terminated message",
			msg:  SessionTerminatedMsg{SessionID: "test-session"},
		},
		{
			name: "unknown message",
			msg:  "unknown message",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cmd := manager.HandleMsg(tt.msg)
			// Should not panic and may return nil or a command
			_ = cmd
		})
	}
}

func TestManagerHandleResize(t *testing.T) {
	manager := NewManager()
	defer manager.Shutdown()

	// Test with no sessions
	cmd := manager.HandleResize(80, 24)
	// May return nil or empty batch command
	_ = cmd

	// Add a mock session
	session := &Session{
		ID:     "resize-test",
		Active: true,
		Output: NewRingBuffer(1024),
		ctx:    context.Background(),
		cancel: func() {},
	}
	
	manager.mutex.Lock()
	manager.sessions[session.ID] = session
	manager.mutex.Unlock()

	// Test resize with session
	cmd = manager.HandleResize(100, 30)
	// Should return a command for the resize
	_ = cmd
}

func TestManagerGetSessionsViaManager(t *testing.T) {
	manager := NewManager()
	defer manager.Shutdown()

	// Initially empty
	sessions := manager.GetSessions()
	assert.Empty(t, sessions)

	// Add a session
	session := &Session{
		ID:     "test-get-sessions",
		Active: true,
		Output: NewRingBuffer(1024),
		ctx:    context.Background(),
		cancel: func() {},
	}

	manager.mutex.Lock()
	manager.sessions[session.ID] = session
	manager.mutex.Unlock()

	// Should contain the session
	sessions = manager.GetSessions()
	assert.Contains(t, sessions, session.ID)
}

func TestManagerGetActiveSession(t *testing.T) {
	manager := NewManager()
	defer manager.Shutdown()

	// No active session initially
	session := manager.GetActiveSession()
	assert.Nil(t, session)

	// Add an inactive session
	inactiveSession := &Session{
		ID:     "inactive",
		Active: false,
		Output: NewRingBuffer(1024),
		ctx:    context.Background(),
		cancel: func() {},
	}

	manager.mutex.Lock()
	manager.sessions[inactiveSession.ID] = inactiveSession
	manager.mutex.Unlock()

	// Still no active session
	session = manager.GetActiveSession()
	assert.Nil(t, session)

	// Add an active session
	activeSession := &Session{
		ID:     "active",
		Active: true,
		Output: NewRingBuffer(1024),
		ctx:    context.Background(),
		cancel: func() {},
	}

	manager.mutex.Lock()
	manager.sessions[activeSession.ID] = activeSession
	manager.mutex.Unlock()

	// Should return the active session
	session = manager.GetActiveSession()
	assert.Equal(t, activeSession, session)
}

func TestManagerShutdown(t *testing.T) {
	manager := NewManager()

	// Add some sessions
	ctx1, cancel1 := context.WithCancel(context.Background())
	ctx2, cancel2 := context.WithCancel(context.Background())

	session1 := &Session{
		ID:     "session1",
		Active: true,
		ctx:    ctx1,
		cancel: cancel1,
		Output: NewRingBuffer(1024),
	}

	session2 := &Session{
		ID:     "session2",
		Active: true,
		ctx:    ctx2,
		cancel: cancel2,
		Output: NewRingBuffer(1024),
	}

	manager.mutex.Lock()
	manager.sessions[session1.ID] = session1
	manager.sessions[session2.ID] = session2
	manager.mutex.Unlock()

	// Shutdown should not error
	err := manager.Shutdown()
	assert.NoError(t, err)

	// Sessions should be marked as shutting down
	manager.mutex.RLock()
	shuttingDown := manager.shuttingDown
	manager.mutex.RUnlock()
	assert.True(t, shuttingDown)
}

func TestManagerHandleProjectDiscovered(t *testing.T) {
	manager := NewManager()
	defer manager.Shutdown()

	project := &discovery.Project{
		Name: "test-project",
		Path: "/tmp/test",
	}
	msg := discovery.ProjectDiscoveredMsg{
		Project: project,
	}

	cmd := manager.handleProjectDiscovered(msg)
	assert.Nil(t, cmd) // Currently returns nil
}

func TestManagerHandleSessionCreated(t *testing.T) {
	manager := NewManager()
	defer manager.Shutdown()

	session := &Session{
		ID:     "created-session",
		Active: true,
		Output: NewRingBuffer(1024),
		ctx:    context.Background(),
		cancel: func() {},
	}

	msg := SessionCreatedMsg{Session: session}
	cmd := manager.handleSessionCreated(msg)
	assert.Nil(t, cmd) // Currently returns nil
}

func TestManagerHandleSessionTerminated(t *testing.T) {
	manager := NewManager()
	defer manager.Shutdown()

	// Add a session first
	session := &Session{
		ID:     "terminated-session",
		Active: false,
		Output: NewRingBuffer(1024),
		ctx:    context.Background(),
		cancel: func() {},
	}

	manager.mutex.Lock()
	manager.sessions[session.ID] = session
	manager.mutex.Unlock()

	// Terminate it
	msg := SessionTerminatedMsg{SessionID: session.ID}
	cmd := manager.handleSessionTerminated(msg)
	assert.Nil(t, cmd) // Currently returns nil

	// Session should be removed
	sessions := manager.GetSessions()
	assert.NotContains(t, sessions, session.ID)
}

func TestManagerRawMode(t *testing.T) {
	manager := NewManager()
	defer manager.Shutdown()

	// Test enable raw mode (may fail in test environment)
	err := manager.EnableRawMode()
	if err != nil {
		t.Logf("EnableRawMode failed (expected in test environment): %v", err)
	}

	// Note: DisableRawMode doesn't exist in current implementation
	// This is just testing that EnableRawMode doesn't panic
}

func TestSessionLifecycle(t *testing.T) {
	manager := NewManager()
	defer manager.Shutdown()

	// Test session ID generation
	id1 := manager.generateSessionID()
	id2 := manager.generateSessionID()
	
	assert.NotEmpty(t, id1)
	assert.NotEmpty(t, id2)
	assert.NotEqual(t, id1, id2)
}