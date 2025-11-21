package terminal

// GetSessions returns all tmux sessions
func (tm *TmuxManager) GetSessions() map[string]*TmuxSession {
	tm.mutex.RLock()
	defer tm.mutex.RUnlock()
	
	// Return a copy to prevent concurrent modification
	sessions := make(map[string]*TmuxSession)
	for k, v := range tm.sessions {
		sessions[k] = v
	}
	return sessions
}