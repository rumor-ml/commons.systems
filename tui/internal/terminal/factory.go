// Package terminal provides tmux session coordination and management for ICF projects.
// This file implements factory pattern for clean TmuxManager construction.

package terminal

import (
	"context"

	"github.com/rumor-ml/log/pkg/log"
)

// TmuxManagerConfig encapsulates all dependencies for clean injection.
type TmuxManagerConfig struct {
	Executor         TmuxExecutor
	PaneProvider     PaneProvider
	SessionProvider  SessionProvider
	Navigator        *TmuxNavigator
	SessionDiscovery *SessionDiscovery
	PaneDiscovery    *PaneDiscovery
	Logger           log.Logger
	Context          context.Context
	TmuxPath         string
}

// TmuxManagerFactory provides different construction strategies.
type TmuxManagerFactory interface {
	NewProduction(ctx context.Context) *TmuxManager
	NewTesting(ctx context.Context, config TmuxTestConfig) *TmuxManager
}

// DefaultTmuxManagerFactory is the standard factory implementation.
type DefaultTmuxManagerFactory struct {
	logger log.Logger
}

// NewTmuxManagerFactory creates a new factory instance.
func NewTmuxManagerFactory() TmuxManagerFactory {
	return &DefaultTmuxManagerFactory{
		logger: log.Get(),
	}
}

// NewProduction creates a production TmuxManager with real tmux integration.
func (f *DefaultTmuxManagerFactory) NewProduction(ctx context.Context) *TmuxManager {
	tmuxCtx, cancel := context.WithCancel(ctx)
	tmuxPath := FindTmuxExecutable(f.logger)
	executor := NewRealTmuxExecutor(tmuxPath)

	// Create production providers
	paneProvider := NewProductionPaneProvider(f.logger)
	sessionProvider := NewProductionSessionProvider(f.logger)

	// Create TmuxManager with production dependencies
	tm := &TmuxManager{
		sessions:         make(map[string]*TmuxSession),
		panes:            make(map[string]*TmuxPane),
		paneRegistry:     NewPaneRegistry(),
		ctx:              tmuxCtx,
		cancel:           cancel,
		logger:           f.logger,
		tmuxPath:         tmuxPath,
		executor:         executor,
		paneProvider:     paneProvider,
		sessionProvider:  sessionProvider,
		navigator:        NewTmuxNavigator(tmuxPath, f.logger, executor),
	}

	// Initialize other managers
	tm.sessionManager = NewTmuxSessionManager(tmuxPath, f.logger, executor)
	tm.windowManager = NewTmuxWindowManager(tmuxPath, f.logger, executor)
	tm.config = NewTmuxConfig(tmuxPath, f.logger, executor)
	tm.projectMapper = NewTmuxProjectMapper(f.logger)
	tm.sessionDiscovery = NewSessionDiscovery(tmuxPath, f.logger, executor)
	tm.paneDiscovery = NewPaneDiscovery(tmuxPath, f.logger, executor)
	tm.operations = NewTmuxOperations(tmuxPath, f.logger, tm.windowManager, executor)
	tm.discovery = NewTmuxDiscovery(tmuxPath, f.logger, tm.projectMapper)
	tm.finder = NewTmuxFinder(f.logger)
	tm.advancedOps = NewTmuxAdvancedOperations(tmuxPath, f.logger, executor)

	// Set up global keybinding for ctrl-space navigation
	if err := tm.config.setupGlobalKeybinding(); err != nil {
		f.logger.Warn("Failed to setup global keybinding", "error", err)
		// Don't fail initialization if keybinding setup fails
	}

	return tm
}

// NewTesting creates a test TmuxManager with mocked dependencies.
func (f *DefaultTmuxManagerFactory) NewTesting(ctx context.Context, config TmuxTestConfig) *TmuxManager {
	tmuxCtx, cancel := context.WithCancel(ctx)

	// Create test providers
	paneProvider := NewTestPaneProvider(f.logger)
	for _, pane := range config.InitialPanes {
		paneProvider.AddPane(pane)
	}

	sessionProvider := config.MockSessionProvider
	if sessionProvider == nil {
		sessionProvider = NewMockSessionProvider()
	}
	if config.CurrentSession != "" {
		sessionProvider.SetCurrentSessionOverride(config.CurrentSession)
	}

	// Set up mock sessions
	if config.MockSessionProvider != nil {
		for name, session := range config.PresetSessions {
			if cwd, ok := config.SessionCwds[name]; ok {
				config.MockSessionProvider.SetSession(session, cwd)
			}
		}
	}

	// Create TmuxManager with test dependencies
	// Use real tmux path discovery for integration tests
	tmuxPath := FindTmuxExecutable(f.logger)
	if tmuxPath == "" {
		tmuxPath = "/usr/local/bin/tmux" // Fallback for unit tests
	}

	tm := &TmuxManager{
		sessions:        make(map[string]*TmuxSession),
		panes:           make(map[string]*TmuxPane),
		paneRegistry:    NewPaneRegistry(),
		ctx:             tmuxCtx,
		cancel:          cancel,
		logger:          f.logger,
		tmuxPath:        tmuxPath,
		executor:        config.MockExecutor,
		paneProvider:    paneProvider,
		sessionProvider: sessionProvider,
		navigator:       NewTmuxNavigator(tmuxPath, f.logger, config.MockExecutor),
	}

	// Initialize other managers with test configuration
	tm.sessionManager = NewTmuxSessionManager(tm.tmuxPath, f.logger, config.MockExecutor)
	tm.windowManager = NewTmuxWindowManager(tm.tmuxPath, f.logger, config.MockExecutor)
	tm.config = NewTmuxConfig(tm.tmuxPath, f.logger, config.MockExecutor)
	tm.projectMapper = NewTmuxProjectMapper(f.logger)
	tm.sessionDiscovery = NewSessionDiscovery(tm.tmuxPath, f.logger, config.MockExecutor)
	tm.paneDiscovery = NewPaneDiscovery(tm.tmuxPath, f.logger, config.MockExecutor)
	tm.operations = NewTmuxOperations(tm.tmuxPath, f.logger, tm.windowManager, config.MockExecutor)
	tm.discovery = NewTmuxDiscovery(tm.tmuxPath, f.logger, tm.projectMapper)
	tm.finder = NewTmuxFinder(f.logger)
	tm.advancedOps = NewTmuxAdvancedOperations(tm.tmuxPath, f.logger, config.MockExecutor)

	// Pre-populate panes from provider
	for target, pane := range paneProvider.GetAllPanes() {
		tm.panes[target] = pane
	}

	return tm
}

// NewTmuxManagerWithConfig creates a TmuxManager with explicit configuration.
func NewTmuxManagerWithConfig(config TmuxManagerConfig) *TmuxManager {
	tmuxCtx, cancel := context.WithCancel(config.Context)

	tm := &TmuxManager{
		sessions:        make(map[string]*TmuxSession),
		panes:           make(map[string]*TmuxPane),
		paneRegistry:    NewPaneRegistry(),
		ctx:             tmuxCtx,
		cancel:          cancel,
		logger:          config.Logger,
		tmuxPath:        config.TmuxPath,
		executor:        config.Executor,
		paneProvider:    config.PaneProvider,
		sessionProvider: config.SessionProvider,
		navigator:       config.Navigator,
	}

	// Initialize managers
	tm.sessionManager = NewTmuxSessionManager(config.TmuxPath, config.Logger, config.Executor)
	tm.windowManager = NewTmuxWindowManager(config.TmuxPath, config.Logger, config.Executor)
	tm.config = NewTmuxConfig(config.TmuxPath, config.Logger, config.Executor)
	tm.projectMapper = NewTmuxProjectMapper(config.Logger)
	tm.sessionDiscovery = config.SessionDiscovery
	tm.paneDiscovery = config.PaneDiscovery
	tm.operations = NewTmuxOperations(config.TmuxPath, config.Logger, tm.windowManager, config.Executor)
	tm.discovery = NewTmuxDiscovery(config.TmuxPath, config.Logger, tm.projectMapper)
	tm.finder = NewTmuxFinder(config.Logger)
	tm.advancedOps = NewTmuxAdvancedOperations(config.TmuxPath, config.Logger, config.Executor)

	return tm
}