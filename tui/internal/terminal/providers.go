// Package terminal provides tmux session coordination and management for ICF projects.
// This file defines provider interfaces for clean dependency injection and testing.

package terminal

import (
	"errors"
	"strings"
	"sync"

	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// Define errors for provider operations
var (
	ErrPaneAlreadyExists = errors.New("pane already exists")
	ErrSessionNotFound   = errors.New("session not found")
)

// PaneProvider abstracts pane data source for production vs test implementations.
// This interface enables clean separation between real tmux discovery and controlled test data.
type PaneProvider interface {
	// GetAllPanes returns current pane snapshot.
	// Thread-safe, returns defensive copy of internal data.
	GetAllPanes() map[string]*TmuxPane

	// DiscoverPanes refreshes pane data from source.
	// Returns error if discovery fails.
	DiscoverPanes(executor TmuxExecutor, tmuxPath string) error

	// RefreshPanes updates project mappings for discovered panes.
	// Idempotent operation that maintains consistency.
	RefreshPanes(projects []*model.Project) error

	// AddPane adds a pane to the provider (primarily for testing).
	// Returns error if pane already exists.
	AddPane(pane *TmuxPane) error

	// Clear removes all panes from the provider.
	Clear()
}

// SessionProvider abstracts session state for production vs test implementations.
// This interface enables testing without real tmux sessions.
type SessionProvider interface {
	// GetCurrentSession returns the current tmux session name.
	// Returns error if not in a tmux session or detection fails.
	GetCurrentSession(executor TmuxExecutor, tmuxPath string) (string, error)

	// ListSessions returns all tmux sessions with metadata.
	// Returns error if tmux command fails.
	ListSessions(executor TmuxExecutor, tmuxPath string) (map[string]*TmuxSession, error)

	// GetSessionCwd returns the current working directory of a session.
	// Returns error if session doesn't exist or command fails.
	GetSessionCwd(executor TmuxExecutor, tmuxPath string, sessionName string) (string, error)

	// SetCurrentSessionOverride sets an override for the current session (testing only).
	SetCurrentSessionOverride(sessionName string)
}

// ProductionPaneProvider implements PaneProvider using real tmux discovery.
type ProductionPaneProvider struct {
	panes    map[string]*TmuxPane
	mutex    sync.RWMutex
	logger   log.Logger
}

// NewProductionPaneProvider creates a production pane provider.
func NewProductionPaneProvider(logger log.Logger) *ProductionPaneProvider {
	return &ProductionPaneProvider{
		panes:  make(map[string]*TmuxPane),
		logger: logger,
	}
}

// GetAllPanes returns a copy of all discovered panes.
func (p *ProductionPaneProvider) GetAllPanes() map[string]*TmuxPane {
	p.mutex.RLock()
	defer p.mutex.RUnlock()

	result := make(map[string]*TmuxPane, len(p.panes))
	for k, v := range p.panes {
		result[k] = v
	}
	return result
}

// DiscoverPanes discovers panes from real tmux.
func (p *ProductionPaneProvider) DiscoverPanes(executor TmuxExecutor, tmuxPath string) error {
	p.mutex.Lock()
	defer p.mutex.Unlock()

	// Use existing discovery logic
	discovery := NewPaneDiscovery(tmuxPath, p.logger, executor)

	discoveredPanes, _, err := discovery.DiscoverAllPanes()
	if err != nil {
		return err
	}

	p.panes = discoveredPanes
	return nil
}

// RefreshPanes updates project mappings.
func (p *ProductionPaneProvider) RefreshPanes(projects []*model.Project) error {
	p.mutex.Lock()
	defer p.mutex.Unlock()

	// Project mapping logic would go here
	// For now, just return nil to maintain compatibility
	return nil
}

// AddPane adds a pane (not typically used in production).
func (p *ProductionPaneProvider) AddPane(pane *TmuxPane) error {
	p.mutex.Lock()
	defer p.mutex.Unlock()

	if _, exists := p.panes[pane.GetTmuxTarget()]; exists {
		return ErrPaneAlreadyExists
	}

	p.panes[pane.GetTmuxTarget()] = pane
	return nil
}

// Clear removes all panes.
func (p *ProductionPaneProvider) Clear() {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	p.panes = make(map[string]*TmuxPane)
}

// ProductionSessionProvider implements SessionProvider using real tmux.
type ProductionSessionProvider struct {
	logger                 log.Logger
	currentSessionOverride string // For backward compatibility during migration
	mutex                  sync.RWMutex
}

// NewProductionSessionProvider creates a production session provider.
func NewProductionSessionProvider(logger log.Logger) *ProductionSessionProvider {
	return &ProductionSessionProvider{
		logger: logger,
	}
}

// GetCurrentSession returns the current tmux session.
func (p *ProductionSessionProvider) GetCurrentSession(executor TmuxExecutor, tmuxPath string) (string, error) {
	p.mutex.RLock()
	defer p.mutex.RUnlock()

	// Check for test override (temporary for migration)
	if p.currentSessionOverride != "" {
		return p.currentSessionOverride, nil
	}

	// Use real tmux detection
	output, err := executor.Execute("display-message", "-p", "#{session_name}")
	if err != nil {
		return "", err
	}

	return strings.TrimSpace(string(output)), nil
}

// ListSessions returns all tmux sessions.
func (p *ProductionSessionProvider) ListSessions(executor TmuxExecutor, tmuxPath string) (map[string]*TmuxSession, error) {
	// For now, return empty map until we implement proper session listing
	// The SessionDiscovery doesn't have a direct DiscoverSessions method exposed
	// TODO: Implement proper session discovery
	return make(map[string]*TmuxSession), nil
}

// GetSessionCwd returns the working directory of a session.
func (p *ProductionSessionProvider) GetSessionCwd(executor TmuxExecutor, tmuxPath string, sessionName string) (string, error) {
	output, err := executor.Execute("display-message", "-t", sessionName, "-p", "#{pane_current_path}")
	if err != nil {
		return "", err
	}

	return strings.TrimSpace(string(output)), nil
}

// SetCurrentSessionOverride sets an override for testing (temporary).
func (p *ProductionSessionProvider) SetCurrentSessionOverride(sessionName string) {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	p.currentSessionOverride = sessionName
}

// TestPaneProvider implements PaneProvider for controlled testing.
type TestPaneProvider struct {
	panes  map[string]*TmuxPane
	mutex  sync.RWMutex
	logger log.Logger
}

// NewTestPaneProvider creates a test pane provider.
func NewTestPaneProvider(logger log.Logger) *TestPaneProvider {
	return &TestPaneProvider{
		panes:  make(map[string]*TmuxPane),
		logger: logger,
	}
}

// GetAllPanes returns test panes.
func (p *TestPaneProvider) GetAllPanes() map[string]*TmuxPane {
	p.mutex.RLock()
	defer p.mutex.RUnlock()

	result := make(map[string]*TmuxPane, len(p.panes))
	for k, v := range p.panes {
		result[k] = v
	}
	return result
}

// DiscoverPanes is a no-op for test provider.
func (p *TestPaneProvider) DiscoverPanes(executor TmuxExecutor, tmuxPath string) error {
	// Test provider doesn't discover, panes are added manually
	return nil
}

// RefreshPanes is a no-op for test provider.
func (p *TestPaneProvider) RefreshPanes(projects []*model.Project) error {
	// Test provider doesn't need refresh
	return nil
}

// AddPane adds a test pane.
func (p *TestPaneProvider) AddPane(pane *TmuxPane) error {
	p.mutex.Lock()
	defer p.mutex.Unlock()

	if _, exists := p.panes[pane.GetTmuxTarget()]; exists {
		return ErrPaneAlreadyExists
	}

	p.panes[pane.GetTmuxTarget()] = pane
	return nil
}

// Clear removes all test panes.
func (p *TestPaneProvider) Clear() {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	p.panes = make(map[string]*TmuxPane)
}

// MockSessionProvider implements SessionProvider for testing.
type MockSessionProvider struct {
	currentSession string
	sessions       map[string]*TmuxSession
	sessionCwds    map[string]string
	mutex          sync.RWMutex
}

// NewMockSessionProvider creates a mock session provider.
func NewMockSessionProvider() *MockSessionProvider {
	return &MockSessionProvider{
		sessions:    make(map[string]*TmuxSession),
		sessionCwds: make(map[string]string),
	}
}

// GetCurrentSession returns the mocked current session.
func (p *MockSessionProvider) GetCurrentSession(executor TmuxExecutor, tmuxPath string) (string, error) {
	p.mutex.RLock()
	defer p.mutex.RUnlock()
	return p.currentSession, nil
}

// ListSessions returns mocked sessions.
func (p *MockSessionProvider) ListSessions(executor TmuxExecutor, tmuxPath string) (map[string]*TmuxSession, error) {
	p.mutex.RLock()
	defer p.mutex.RUnlock()

	result := make(map[string]*TmuxSession, len(p.sessions))
	for k, v := range p.sessions {
		result[k] = v
	}
	return result, nil
}

// GetSessionCwd returns mocked session working directory.
func (p *MockSessionProvider) GetSessionCwd(executor TmuxExecutor, tmuxPath string, sessionName string) (string, error) {
	p.mutex.RLock()
	defer p.mutex.RUnlock()

	if cwd, ok := p.sessionCwds[sessionName]; ok {
		return cwd, nil
	}
	return "", ErrSessionNotFound
}

// SetCurrentSessionOverride sets the current session for testing.
func (p *MockSessionProvider) SetCurrentSessionOverride(sessionName string) {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	p.currentSession = sessionName
}

// SetSession adds a session to the mock.
func (p *MockSessionProvider) SetSession(session *TmuxSession, cwd string) {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	p.sessions[session.Name] = session
	p.sessionCwds[session.Name] = cwd
}