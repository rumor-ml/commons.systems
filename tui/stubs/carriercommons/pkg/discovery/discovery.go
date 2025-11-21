package discovery

import (
	"os"
	"path/filepath"
	tea "github.com/charmbracelet/bubbletea"
)

// Project represents a project in the system
type Project struct {
	Name     string
	Path     string
	Status   ProjectStatus
	Metadata *ProjectMetadata
}

// ProjectStatus contains the current status of a project
type ProjectStatus struct {
	State   string
	Message string
}

// Dependency represents a project dependency
type Dependency struct {
	Name        string
	URL         string
	Description string
}

// ProjectMetadata contains additional project information
type ProjectMetadata struct {
	Name         string
	Path         string
	Description  string
	Tags         []string
	Purpose      string
	Principles   []string
	Dependencies []Dependency
	IsWorktree   bool
	ParentRepo   string
}

// ProjectDiscoveredMsg is sent when a new project is discovered
type ProjectDiscoveredMsg struct {
	Project *Project
}

// ProjectUpdatedMsg is sent when a project is updated
type ProjectUpdatedMsg struct {
	Project *Project
}

// FindCarrierCommonsRoot attempts to find the carriercommons root directory
// by walking up the directory tree looking for markers
func FindCarrierCommonsRoot() string {
	// Start from current working directory
	cwd, err := os.Getwd()
	if err != nil {
		return ""
	}

	// Walk up the directory tree
	current := cwd
	for {
		// Check for common markers of a carriercommons root
		// (e.g., presence of specific directories or files)
		markers := []string{".git", "go.mod", "README.md"}

		for _, marker := range markers {
			if _, err := os.Stat(filepath.Join(current, marker)); err == nil {
				// Found a potential root
				return current
			}
		}

		// Move up one directory
		parent := filepath.Dir(current)
		if parent == current {
			// Reached root of filesystem
			break
		}
		current = parent
	}

	return ""
}

// GetPath returns the project path
func (p *Project) GetPath() string {
	return p.Path
}

// GetName returns the project name
func (p *Project) GetName() string {
	return p.Name
}

// DiscoverProjects searches for projects in the given root directory
func DiscoverProjects(rootPath string) ([]*Project, error) {
	// Stub implementation - returns an empty list
	// In a real implementation, this would:
	// 1. Walk the directory tree
	// 2. Look for project markers (e.g., .git, go.mod, package.json)
	// 3. Create Project structs for each discovered project
	return []*Project{}, nil
}

// EnhancedDiscoverProjects performs enhanced project discovery with metadata
func EnhancedDiscoverProjects(rootPath string) ([]*ProjectMetadata, error) {
	// Stub implementation - returns an empty list
	// In a real implementation, this would:
	// 1. Discover all projects
	// 2. Load metadata from project files
	// 3. Analyze dependencies
	// 4. Detect worktrees
	return []*ProjectMetadata{}, nil
}

// Ensure these message types implement tea.Msg
var _ tea.Msg = ProjectDiscoveredMsg{}
var _ tea.Msg = ProjectUpdatedMsg{}
