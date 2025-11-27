package handlers

import (
	"context"
	"sync"

	"github.com/commons-systems/filesync"
)

// RunningSession represents an active extraction session
type RunningSession struct {
	SessionID  string
	Cancel     context.CancelFunc
	ProgressCh <-chan filesync.Progress
}

// SessionRegistry tracks active extraction sessions for cancellation and SSE streaming
type SessionRegistry struct {
	mu       sync.RWMutex
	sessions map[string]*RunningSession
}

// NewSessionRegistry creates a new session registry
func NewSessionRegistry() *SessionRegistry {
	return &SessionRegistry{
		sessions: make(map[string]*RunningSession),
	}
}

// Register adds a running session to the registry
func (r *SessionRegistry) Register(sessionID string, session *RunningSession) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sessions[sessionID] = session
}

// Get retrieves a running session by ID
func (r *SessionRegistry) Get(sessionID string) (*RunningSession, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	session, ok := r.sessions[sessionID]
	return session, ok
}

// Remove removes a session from the registry
func (r *SessionRegistry) Remove(sessionID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.sessions, sessionID)
}

// IsRunning checks if a session is currently running
func (r *SessionRegistry) IsRunning(sessionID string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, exists := r.sessions[sessionID]
	return exists
}
