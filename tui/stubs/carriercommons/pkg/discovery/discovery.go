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
// by walking up the directory tree looking for .git directory (monorepo root)
func FindCarrierCommonsRoot() string {
	// Start from current working directory
	cwd, err := os.Getwd()
	if err != nil {
		return ""
	}

	// Walk up the directory tree
	current := cwd
	for {
		// Look specifically for .git directory (monorepo root)
		gitPath := filepath.Join(current, ".git")
		if info, err := os.Stat(gitPath); err == nil && info.IsDir() {
			// Found the git repository root
			return current
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
	var projects []*ProjectMetadata

	// If rootPath is empty, use current working directory
	if rootPath == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return nil, err
		}
		rootPath = cwd
	}

	// Find actual monorepo root by looking for .git directory
	root := FindCarrierCommonsRoot()
	if root != "" {
		rootPath = root
	}

	// Get the monorepo name from the root path
	monorepoName := filepath.Base(rootPath)

	// Create the monorepo root project
	rootProject := &ProjectMetadata{
		Name:        monorepoName,
		Path:        rootPath,
		Description: "Monorepo containing multiple projects",
		Tags:        []string{"monorepo", "root"},
		IsWorktree:  false,
		ParentRepo:  "",
	}
	projects = append(projects, rootProject)

	// Walk the root directory looking for sub-projects
	entries, err := os.ReadDir(rootPath)
	if err != nil {
		return projects, err
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		name := entry.Name()

		// Skip hidden directories, node_modules, and other non-project dirs
		if name[0] == '.' || name == "node_modules" || name == ".git" {
			continue
		}

		projectPath := filepath.Join(rootPath, name)

		// Check if this looks like a project
		hasPackageJson := fileExists(filepath.Join(projectPath, "package.json"))
		hasGoMod := fileExists(filepath.Join(projectPath, "go.mod"))
		hasSiteDir := dirExists(filepath.Join(projectPath, "site"))
		hasTestsDir := dirExists(filepath.Join(projectPath, "tests"))
		hasScriptsDir := dirExists(filepath.Join(projectPath, "scripts"))
		hasTerraformDir := dirExists(filepath.Join(projectPath, "terraform"))

		// Also include known project names
		isKnownProject := isKnownProjectName(name)

		if hasPackageJson || hasGoMod || hasSiteDir || hasTestsDir || hasScriptsDir || hasTerraformDir || isKnownProject {
			// Create sub-project as a child of the monorepo
			project := &ProjectMetadata{
				Name:        name,
				Path:        projectPath,
				Description: inferDescription(name),
				Tags:        inferTags(name, hasGoMod, hasSiteDir),
				IsWorktree:  false,
				ParentRepo:  monorepoName,
			}
			projects = append(projects, project)
		}
	}

	return projects, nil
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func isKnownProjectName(name string) bool {
	knownProjects := map[string]bool{
		"fellspiral":        true,
		"videobrowser":      true,
		"tui":               true,
		"infrastructure":    true,
		"playwright-server": true,
		"claudetool":        true,
	}
	return knownProjects[name]
}

func inferDescription(name string) string {
	descriptions := map[string]string{
		"fellspiral":        "Fellspiral card game site",
		"videobrowser":      "Video browser application",
		"tui":               "Terminal UI for project management",
		"infrastructure":    "Infrastructure and deployment scripts",
		"playwright-server": "Playwright testing server",
		"claudetool":        "Claude debugging and deployment tools",
	}
	if desc, ok := descriptions[name]; ok {
		return desc
	}
	return name + " module"
}

func inferTags(name string, hasGoMod, hasSiteDir bool) []string {
	var tags []string

	if hasSiteDir {
		tags = append(tags, "site")
	}
	if hasGoMod {
		tags = append(tags, "go")
	}

	// Add specific tags based on project name
	switch name {
	case "fellspiral", "videobrowser":
		tags = append(tags, "web", "frontend")
	case "tui":
		tags = append(tags, "cli", "terminal")
	case "infrastructure":
		tags = append(tags, "deployment", "ops")
	case "playwright-server":
		tags = append(tags, "testing", "e2e")
	case "claudetool":
		tags = append(tags, "tools", "debugging")
	}

	return tags
}

// Ensure these message types implement tea.Msg
var _ tea.Msg = ProjectDiscoveredMsg{}
var _ tea.Msg = ProjectUpdatedMsg{}
