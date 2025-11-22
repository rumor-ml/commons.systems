// interfaces.go - Terminal management interfaces

package terminal

import (
	"github.com/natb1/tui/pkg/model"
)

// SessionManager defines the interface for tmux session management
type SessionManager interface {
	CreateProjectSession(project *model.Project) (*TmuxSession, error)
	CreateWindow(sessionName, windowName, command string, worktreeID string, project *model.Project) (*TmuxWindow, error)
	ListSessions() (map[string]*TmuxSession, error)
	GetProjectSession(projectName string) (*TmuxSession, bool)
}

// PaneNavigator defines the interface for pane navigation and attachment
type PaneNavigator interface {
	AttachToWindow(sessionName, windowName string) error
	AttachToPane(paneTarget string) error
}

// PaneDiscoverer defines the interface for pane discovery and mapping
type PaneDiscoverer interface {
	DiscoverAllPanes() error
	MapSessionsToProjects(projects []*model.Project) ([]*model.Project, error)
	GetAllPanes() map[string]*TmuxPane
	FindProjectPane(project *model.Project, shellType model.ShellType) *TmuxPane
	FindWorktreePane(project *model.Project, worktree *model.Worktree, shellType model.ShellType) *TmuxPane
}

// RegistryManager defines the interface for pane registry management
type RegistryManager interface {
	GetPaneRegistry() *PaneRegistry
}