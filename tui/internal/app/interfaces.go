// interfaces.go - Interfaces for app dependencies

package app

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/natb1/tui/pkg/model"
)

// ProjectMapInterface defines the interface for project discovery
type ProjectMapInterface interface {
	Init() tea.Cmd
	GetProjects() map[string]*Project
	GetModelProjects() []*model.Project
	GetCategories() map[string][]*Project
	IsInitialized() bool
	GetWorkspaceRoot() string
	RefreshProjects() error
	GetProjectByName(name string) *model.Project
	GetProjectByPath(path string) *model.Project
}
