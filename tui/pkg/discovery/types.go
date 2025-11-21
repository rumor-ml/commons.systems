// types.go - Shared types for project discovery
// These types bridge between external discovery and internal usage

package discovery

import "time"

// Project represents a discovered project
type Project struct {
	Name              string           `json:"name"`
	Path              string           `json:"path"`
	EmotionalCategory string           `json:"emotional_category"`
	Metadata          *ProjectMetadata `json:"metadata"`
	Status            ProjectStatus    `json:"status"`
	Dependencies      []string         `json:"dependencies"`
	IsWorktree        bool             `json:"is_worktree"`
	ParentRepo        string           `json:"parent_repo"`
}

// ProjectMetadata contains parsed ICF metadata
type ProjectMetadata struct {
	Purpose        string            `json:"purpose"`
	CorePrinciples []string          `json:"core_principles"`
	Dependencies   map[string]string `json:"dependencies"`
	GitHubURL      string            `json:"github_url"`
}

// ProjectStatus represents the current status of a project
type ProjectStatus struct {
	Overall      string    `json:"overall"`
	Health       string    `json:"health"`
	LastActivity string    `json:"last_activity"`
	Progress     float64   `json:"progress"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// ProjectDiscoveryCompleteMsg indicates discovery has completed
type ProjectDiscoveryCompleteMsg struct {
	Projects map[string]*Project
	Error    error
}

// ProjectUpdatedMsg is sent when project status changes
type ProjectUpdatedMsg struct {
	Project *Project
}

// ProjectDiscoveredMsg is sent when a new project is discovered
type ProjectDiscoveredMsg struct {
	Project *Project
}

// GetPath returns the project path (implements worktree.ProjectInfo interface)
func (p *Project) GetPath() string {
	return p.Path
}

// GetName returns the project name (implements worktree.ProjectInfo interface)  
func (p *Project) GetName() string {
	return p.Name
}