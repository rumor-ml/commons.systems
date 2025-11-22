// project_adapter.go - Adapter between external project discovery and internal models

package app

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/natb1/tui/pkg/model"
	projectdiscovery "github.com/rumor-ml/carriercommons/pkg/discovery"
)

// convertExternalToInternalProject converts from external project discovery format to internal format
func convertExternalToInternalProject(extProject *projectdiscovery.ProjectMetadata) *Project {
	// Extract emotional category from path
	emotionalCategory := extractEmotionalCategory(extProject.Path)

	// Convert dependencies
	deps := make([]string, 0, len(extProject.Dependencies))
	for _, dep := range extProject.Dependencies {
		deps = append(deps, dep.Name)
	}

	// Convert metadata
	var metadata *ProjectMetadata
	if extProject.Purpose != "" || len(extProject.Principles) > 0 || len(extProject.Dependencies) > 0 {
		depMap := make(map[string]string)
		for _, dep := range extProject.Dependencies {
			// External dependencies only have Name, URL, Description
			depMap[dep.Name] = dep.URL
		}

		metadata = &ProjectMetadata{
			Purpose:        extProject.Purpose,
			CorePrinciples: extProject.Principles,
			Dependencies:   depMap,
			// GitHubURL would need to be extracted from project or config
		}
	}

	return &Project{
		Name:              extProject.Name,
		Path:              extProject.Path,
		EmotionalCategory: emotionalCategory,
		Metadata:          metadata,
		Status: ProjectStatus{
			Overall:      "active", // Default status
			Health:       "healthy",
			LastActivity: time.Now().Format(time.RFC3339),
			Progress:     0.0,
		},
		Dependencies: deps,
		IsWorktree:   extProject.IsWorktree,
		ParentRepo:   extProject.ParentRepo,
	}
}

// convertInternalToModelProject converts from internal discovery format to UI model format
func convertInternalToModelProject(discProject *Project) *model.Project {
	// Ensure project name is valid (not empty)
	projectName := discProject.Name
	if projectName == "" {
		projectName = filepath.Base(discProject.Path)
	}

	// Create model project
	modelProject := &model.Project{
		Name:       projectName,
		Path:       discProject.Path,
		KeyBinding: 0, // Will be assigned by KeyBindingManager
		MainShells: make(map[model.ShellType]*model.Shell),
		Worktrees:  []*model.Worktree{},
		Expanded:   false,
		IsWorktree: discProject.IsWorktree,
		ParentRepo: discProject.ParentRepo,
	}

	// Set status based on overall status
	if discProject.Status.Overall == "blocked" {
		modelProject.Status = model.ProjectStatusBlocked
		modelProject.StatusReason = "Project status: blocked"
	} else {
		modelProject.Status = model.ProjectStatusNormal
	}

	return modelProject
}

// convertExternalToModelProject converts directly from external to model format
func convertExternalToModelProject(extProject *projectdiscovery.ProjectMetadata) *model.Project {
	// First convert to internal format, then to model format
	internalProject := convertExternalToInternalProject(extProject)
	return convertInternalToModelProject(internalProject)
}

// convertSimpleExternalToModelProject converts from simple external Project to model format
func convertSimpleExternalToModelProject(extProject projectdiscovery.Project) *model.Project {
	// Create a minimal project
	return &model.Project{
		Name:       extProject.Name,
		Path:       extProject.Path,
		KeyBinding: 0, // Will be assigned by KeyBindingManager
		MainShells: make(map[model.ShellType]*model.Shell),
		Worktrees:  []*model.Worktree{},
		Expanded:   false,
	}
}

// extractEmotionalCategory extracts emotional category from project path
func extractEmotionalCategory(projectPath string) string {
	// Look for category patterns in path
	parts := strings.Split(projectPath, string(filepath.Separator))

	// Check for known emotional categories
	emotionalCategories := []string{
		"security", "finance", "health", "personal", "work",
		"social", "learning", "creative", "maintenance",
	}

	for _, part := range parts {
		for _, category := range emotionalCategories {
			if strings.EqualFold(part, category) {
				return category
			}
		}
	}

	// Check if path contains workspace subdirectory that might be a category
	if len(parts) >= 2 {
		// If project is in a subdirectory of workspace, use that as category
		workspaceIdx := -1
		for i, part := range parts {
			if strings.Contains(part, "intent") || strings.Contains(part, "workspace") {
				workspaceIdx = i
				break
			}
		}

		if workspaceIdx >= 0 && workspaceIdx+2 < len(parts) {
			// Project is in workspace/category/project structure
			return parts[workspaceIdx+1]
		}
	}

	return "" // No category found
}

// discoverProjectsUsingExternal uses the external project discovery
func discoverProjectsUsingExternal(workspaceRoot string) ([]*model.Project, error) {
	// Use the enhanced discovery to get metadata
	extProjects, err := projectdiscovery.EnhancedDiscoverProjects(workspaceRoot)
	if err != nil {
		return nil, fmt.Errorf("enhanced project discovery failed: %w", err)
	}

	// Convert to model projects
	modelProjects := make([]*model.Project, 0, len(extProjects))
	for _, extProject := range extProjects {
		modelProject := convertExternalToModelProject(extProject)
		modelProjects = append(modelProjects, modelProject)
	}

	return modelProjects, nil
}
