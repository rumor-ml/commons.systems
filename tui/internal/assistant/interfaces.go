// interfaces.go - Interfaces for assistant dependencies

package assistant

import "github.com/natb1/tui/pkg/discovery"

// ProjectSource defines the interface for project discovery
type ProjectSource interface {
	IsInitialized() bool
	GetProjects() map[string]*discovery.Project
}
