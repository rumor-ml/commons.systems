// project_map_adapter.go - Adapter for ProjectMap using external discovery

package app

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
	projectdiscovery "github.com/rumor-ml/carriercommons/pkg/discovery"
)

// ExternalProjectMap wraps external project discovery to match ProjectMap interface
type ExternalProjectMap struct {
	workspaceRoot string
	projects      map[string]*Project
	modelProjects []*model.Project // Cached model projects
	categories    map[string][]*Project
	initialized   bool
	mutex         sync.RWMutex

	// Caching
	lastScanTime time.Time
}

// NewExternalProjectMap creates a new project map using external discovery
func NewExternalProjectMap(workspaceRoot string) (*ExternalProjectMap, error) {
	// If no workspace root provided, detect from project structure
	if workspaceRoot == "" {
		// Use the project discovery's FindCarrierCommonsRoot function
		// which properly handles submodule contexts and finds the parent repo
		workspaceRoot = projectdiscovery.FindCarrierCommonsRoot()

		// If still not found, fall back to looking for .gitmodules
		if workspaceRoot == "" {
			cwd, err := os.Getwd()
			if err != nil {
				return nil, fmt.Errorf("failed to get current directory: %w", err)
			}

			// Look for parent directory with .gitmodules
			dir := cwd
			for dir != "/" && dir != "" {
				if _, err := os.Stat(filepath.Join(dir, ".gitmodules")); err == nil {
					workspaceRoot = dir
					break
				}
				dir = filepath.Dir(dir)
			}

			// If still not found, use current directory
			if workspaceRoot == "" {
				workspaceRoot = cwd
			}
		}
	}

	return &ExternalProjectMap{
		workspaceRoot: workspaceRoot,
		projects:      make(map[string]*Project),
		categories:    make(map[string][]*Project),
		initialized:   false,
	}, nil
}

// Init initializes project discovery
func (pm *ExternalProjectMap) Init() tea.Cmd {
	return pm.scanWorkspace()
}

// scanWorkspace scans the workspace for projects
func (pm *ExternalProjectMap) scanWorkspace() tea.Cmd {
	return func() tea.Msg {
		err := pm.discoverProjects()
		if err != nil {
			log.Get().Error("Project discovery failed", "error", err)
			return fmt.Errorf("project discovery failed: %w", err)
		}

		pm.mutex.Lock()
		projects := pm.projects
		pm.mutex.Unlock()

		return ProjectDiscoveryCompleteMsg{
			Projects: projects,
		}
	}
}

// discoverProjects performs the actual project discovery using external package
func (pm *ExternalProjectMap) discoverProjects() error {
	logger := log.Get()
	logger.Info("External project discovery starting", "workspaceRoot", pm.workspaceRoot)

	// Use enhanced discovery to get metadata
	// Pass the workspace root explicitly to ensure it includes the parent repo
	extProjects, err := projectdiscovery.EnhancedDiscoverProjects(pm.workspaceRoot)
	if err != nil {
		return fmt.Errorf("project discovery failed: %w", err)
	}

	logger.Info("EnhancedDiscoverProjects returned", "projectCount", len(extProjects))

	// Convert enhanced projects
	pm.mutex.Lock()
	defer pm.mutex.Unlock()

	pm.projects = make(map[string]*Project)
	pm.modelProjects = make([]*model.Project, 0)
	pm.categories = make(map[string][]*Project)

	for _, extProject := range extProjects {
		internalProject := convertExternalToInternalProject(extProject)
		pm.projects[internalProject.Name] = internalProject
		pm.addToCategories(internalProject)

		// Also create model project
		modelProject := convertExternalToModelProject(extProject)
		pm.modelProjects = append(pm.modelProjects, modelProject)
	}

	pm.initialized = true
	pm.lastScanTime = time.Now()

	logger.Info("External project discovery complete",
		"projectCount", len(pm.projects),
		"categoryCount", len(pm.categories))

	return nil
}

// addToCategories adds a project to categories map
func (pm *ExternalProjectMap) addToCategories(project *Project) {
	category := project.EmotionalCategory
	if category == "" {
		category = "uncategorized"
	}

	if pm.categories[category] == nil {
		pm.categories[category] = make([]*Project, 0)
	}
	pm.categories[category] = append(pm.categories[category], project)
}

// GetProject returns a project by name
func (pm *ExternalProjectMap) GetProject(name string) *Project {
	pm.mutex.RLock()
	defer pm.mutex.RUnlock()
	return pm.projects[name]
}

// GetProjects returns all projects
func (pm *ExternalProjectMap) GetProjects() map[string]*Project {
	pm.mutex.RLock()
	defer pm.mutex.RUnlock()

	// Return a copy to prevent race conditions
	projects := make(map[string]*Project)
	for k, v := range pm.projects {
		projects[k] = v
	}
	return projects
}

// GetModelProjects returns all projects as model projects
func (pm *ExternalProjectMap) GetModelProjects() []*model.Project {
	pm.mutex.RLock()
	defer pm.mutex.RUnlock()

	// Return cached model projects
	return pm.modelProjects
}

// GetCategories returns projects organized by emotional category
func (pm *ExternalProjectMap) GetCategories() map[string][]*Project {
	pm.mutex.RLock()
	defer pm.mutex.RUnlock()

	// Return a copy
	categories := make(map[string][]*Project)
	for k, v := range pm.categories {
		categories[k] = v
	}
	return categories
}

// IsInitialized returns true if project discovery is complete
func (pm *ExternalProjectMap) IsInitialized() bool {
	pm.mutex.RLock()
	defer pm.mutex.RUnlock()
	return pm.initialized
}

// GetWorkspaceRoot returns the workspace root directory
func (pm *ExternalProjectMap) GetWorkspaceRoot() string {
	return pm.workspaceRoot
}

// RefreshProjects forces a refresh of project discovery
func (pm *ExternalProjectMap) RefreshProjects() error {
	return pm.discoverProjects()
}

// GetProjectByName finds a model.Project by exact name match
func (pm *ExternalProjectMap) GetProjectByName(name string) *model.Project {
	pm.mutex.RLock()
	defer pm.mutex.RUnlock()

	for _, project := range pm.modelProjects {
		if project.Name == name {
			return project
		}
	}
	return nil
}

// GetProjectByPath finds a model.Project by path or parent path match
// Returns the most specific (deepest) matching project when multiple projects match
func (pm *ExternalProjectMap) GetProjectByPath(path string) *model.Project {
	pm.mutex.RLock()
	defer pm.mutex.RUnlock()

	var bestMatch *model.Project
	var bestMatchLen int

	// Try exact match first, then prefix match for nested directories
	for _, project := range pm.modelProjects {
		// Exact match
		if project.Path == path {
			return project
		}

		// Prefix match (path is within project directory)
		// Use filepath.HasPrefix equivalent by checking if path starts with project path
		// and ensuring it's a proper directory boundary
		if len(project.Path) > 0 && len(path) >= len(project.Path) {
			// Check if path starts with project.Path
			if path[:len(project.Path)] == project.Path {
				// Ensure it's a directory boundary (path separator after project path)
				if len(path) == len(project.Path) || (len(path) > len(project.Path) && path[len(project.Path)] == '/') {
					// Keep the longest match (most specific project)
					if len(project.Path) > bestMatchLen {
						bestMatch = project
						bestMatchLen = len(project.Path)
					}
				}
			}
		}
	}

	return bestMatch
}
