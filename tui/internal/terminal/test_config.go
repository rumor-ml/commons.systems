// Package terminal provides tmux session coordination and management for ICF projects.
// This file provides test configuration and builder pattern for clean test setup.

package terminal

// TmuxTestConfig encapsulates test configuration for TmuxManager.
type TmuxTestConfig struct {
	MockExecutor        TmuxExecutor
	MockSessionProvider *MockSessionProvider
	InitialPanes        []*TmuxPane
	CurrentSession      string
	PresetSessions      map[string]*TmuxSession
	SessionCwds         map[string]string
}

// TmuxTestConfigBuilder provides fluent API for test configuration.
type TmuxTestConfigBuilder struct {
	config *TmuxTestConfig
}

// NewTmuxTestConfig creates a new test configuration builder.
func NewTmuxTestConfig() *TmuxTestConfigBuilder {
	return &TmuxTestConfigBuilder{
		config: &TmuxTestConfig{
			MockExecutor:        NewMockTmuxExecutor(),
			MockSessionProvider: NewMockSessionProvider(),
			InitialPanes:        make([]*TmuxPane, 0),
			PresetSessions:      make(map[string]*TmuxSession),
			SessionCwds:         make(map[string]string),
		},
	}
}

// WithExecutor sets the mock executor for testing.
func (b *TmuxTestConfigBuilder) WithExecutor(executor TmuxExecutor) *TmuxTestConfigBuilder {
	b.config.MockExecutor = executor
	return b
}

// WithPane adds a pane to the test configuration.
func (b *TmuxTestConfigBuilder) WithPane(pane *TmuxPane) *TmuxTestConfigBuilder {
	b.config.InitialPanes = append(b.config.InitialPanes, pane)
	return b
}

// WithPanes adds multiple panes to the test configuration.
func (b *TmuxTestConfigBuilder) WithPanes(panes ...*TmuxPane) *TmuxTestConfigBuilder {
	b.config.InitialPanes = append(b.config.InitialPanes, panes...)
	return b
}

// WithCurrentSession sets the current session for testing.
func (b *TmuxTestConfigBuilder) WithCurrentSession(session string) *TmuxTestConfigBuilder {
	b.config.CurrentSession = session
	return b
}

// WithSession adds a preset session to the test configuration.
func (b *TmuxTestConfigBuilder) WithSession(session *TmuxSession, cwd string) *TmuxTestConfigBuilder {
	b.config.PresetSessions[session.Name] = session
	b.config.SessionCwds[session.Name] = cwd
	return b
}

// WithSessionProvider sets a custom mock session provider.
func (b *TmuxTestConfigBuilder) WithSessionProvider(provider *MockSessionProvider) *TmuxTestConfigBuilder {
	b.config.MockSessionProvider = provider
	return b
}

// Build creates the final test configuration.
func (b *TmuxTestConfigBuilder) Build() TmuxTestConfig {
	// Set up mock session provider with preset sessions
	if b.config.MockSessionProvider != nil && b.config.CurrentSession != "" {
		b.config.MockSessionProvider.SetCurrentSessionOverride(b.config.CurrentSession)
	}

	for name, session := range b.config.PresetSessions {
		if b.config.MockSessionProvider != nil {
			cwd := b.config.SessionCwds[name]
			b.config.MockSessionProvider.SetSession(session, cwd)
		}
	}

	return *b.config
}

// QuickTestConfig creates a simple test configuration with minimal setup.
func QuickTestConfig() TmuxTestConfig {
	return NewTmuxTestConfig().Build()
}

// TestConfigWithPane creates a test configuration with a single pane.
func TestConfigWithPane(pane *TmuxPane) TmuxTestConfig {
	return NewTmuxTestConfig().
		WithPane(pane).
		Build()
}

// TestConfigWithSession creates a test configuration with a session and panes.
func TestConfigWithSession(sessionName string, panes ...*TmuxPane) TmuxTestConfig {
	builder := NewTmuxTestConfig().
		WithCurrentSession(sessionName)

	for _, pane := range panes {
		builder = builder.WithPane(pane)
	}

	return builder.Build()
}