// tmux_discovery.go - Discovery and mapping functionality

package terminal

import (
	"fmt"
	"strings"

	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// TmuxDiscovery handles discovery and mapping of tmux sessions to projects
type TmuxDiscovery struct {
	tmuxPath      string
	logger        log.Logger
	projectMapper *TmuxProjectMapper
}

// NewTmuxDiscovery creates a new TmuxDiscovery instance
func NewTmuxDiscovery(tmuxPath string, logger log.Logger, projectMapper *TmuxProjectMapper) *TmuxDiscovery {
	return &TmuxDiscovery{
		tmuxPath:      tmuxPath,
		logger:        logger,
		projectMapper: projectMapper,
	}
}

// MapSessionsToProjects maps tmux sessions to projects based on working directory
func (disc *TmuxDiscovery) MapSessionsToProjects(tm *TmuxManager, projects []*model.Project) ([]*model.Project, error) {
	disc.logger.Debug("MapSessionsToProjects called", "inputProjectCount", len(projects))
	tm.mutex.Lock()
	defer tm.mutex.Unlock()

	// Create a copy of projects list to avoid modifying the original
	mappedProjects := make([]*model.Project, len(projects))
	copy(mappedProjects, projects)

	// Find existing "Other Sessions" project or create one
	var otherSessionsProject *model.Project
	for _, project := range mappedProjects {
		if project.IsOtherSessionsProject() {
			otherSessionsProject = project
			break
		}
	}
	if otherSessionsProject == nil {
		otherSessionsProject = model.NewOtherSessionsProject()
	}

	// Get current working directory for each session
	sessionCwdMap := disc.getSessionCwdMap(tm)

	// Map sessions to projects based on working directory
	mappedSessions := disc.mapSessionsToProjectsByPath(tm, mappedProjects, sessionCwdMap)

	// Add unmapped sessions to Other Sessions project
	hasUnmappedSessions := disc.addUnmappedSessions(tm, mappedSessions, otherSessionsProject)

	// Add Other Sessions project if there are unmapped sessions and it's not already in the list
	if hasUnmappedSessions {
		mappedProjects = disc.ensureOtherSessionsProject(mappedProjects, otherSessionsProject)
	}

	// Map individual panes to projects based on their current working directory
	tm.projectMapper.mapPanesToProjects(mappedProjects, tm.panes, tm.paneRegistry)

	return mappedProjects, nil
}

// getSessionCwdMap gets the current working directory for all sessions
func (disc *TmuxDiscovery) getSessionCwdMap(tm *TmuxManager) map[string]string {
	sessionCwdMap := make(map[string]string)
	for sessionName := range tm.sessions {
		cwd, err := disc.getSessionCwd(tm, sessionName)
		if err != nil {
			disc.logger.Warn("Failed to get CWD for session", "session", sessionName, "error", err)
			sessionCwdMap[sessionName] = ""
		} else {
			sessionCwdMap[sessionName] = cwd
		}
	}
	return sessionCwdMap
}

// mapSessionsToProjectsByPath maps sessions to projects based on working directory paths
func (disc *TmuxDiscovery) mapSessionsToProjectsByPath(tm *TmuxManager, mappedProjects []*model.Project, sessionCwdMap map[string]string) map[string]bool {
	mappedSessions := make(map[string]bool)

	for _, project := range mappedProjects {
		for sessionName, session := range tm.sessions {
			if mappedSessions[sessionName] {
				continue // Already mapped
			}

			sessionCwd := sessionCwdMap[sessionName]
			if sessionCwd == "" {
				continue
			}

			// Check if session CWD is within project path
			if strings.HasPrefix(sessionCwd, project.Path) {
				disc.logger.Debug("Mapping session to project",
					"session", sessionName,
					"project", project.Name,
					"sessionCwd", sessionCwd,
					"projectPath", project.Path)

				// Map session to this project
				session.Project = project
				mappedSessions[sessionName] = true

				// Add shells from this session to the project
				tm.addSessionShellsToProject(session, project)
			}
		}
	}

	return mappedSessions
}

// addUnmappedSessions adds any unmapped sessions to the Other Sessions project
func (disc *TmuxDiscovery) addUnmappedSessions(tm *TmuxManager, mappedSessions map[string]bool, otherSessionsProject *model.Project) bool {
	hasUnmappedSessions := false
	for sessionName, session := range tm.sessions {
		if !mappedSessions[sessionName] {
			disc.logger.Debug("Adding unmapped session to Other Sessions", "session", sessionName)
			session.Project = otherSessionsProject
			tm.addSessionShellsToProject(session, otherSessionsProject)
			hasUnmappedSessions = true
		}
	}
	return hasUnmappedSessions
}

// ensureOtherSessionsProject ensures the Other Sessions project is in the projects list if needed
func (disc *TmuxDiscovery) ensureOtherSessionsProject(mappedProjects []*model.Project, otherSessionsProject *model.Project) []*model.Project {
	// Check if "Other Sessions" is already in the mappedProjects list
	alreadyExists := false
	for _, project := range mappedProjects {
		if project.IsOtherSessionsProject() {
			alreadyExists = true
			break
		}
	}
	if !alreadyExists {
		mappedProjects = append(mappedProjects, otherSessionsProject)
	}
	return mappedProjects
}

// getSessionCwd gets the current working directory of a tmux session
func (disc *TmuxDiscovery) getSessionCwd(tm *TmuxManager, sessionName string) (string, error) {
	return tm.sessionDiscovery.GetSessionCwd(sessionName)
}

// RefreshPaneProjectMappings refreshes the project mappings for all panes
func (disc *TmuxDiscovery) RefreshPaneProjectMappings(tm *TmuxManager, projects []*model.Project) {
	disc.logger.Debug("Refreshing pane project mappings", "projects", len(projects), "panes", len(tm.panes))
	
	tm.mutex.RLock()
	defer tm.mutex.RUnlock()
	
	tm.projectMapper.mapPanesToProjects(projects, tm.panes, tm.paneRegistry)
}

// DiscoverPanesSynchronously discovers all tmux panes and maps them to projects
func (disc *TmuxDiscovery) DiscoverPanesSynchronously(tm *TmuxManager, projects []*model.Project) error {
	disc.logger.Info("Starting synchronous pane discovery", "projects", len(projects))

	// First, discover all existing sessions
	if err := tm.DiscoverExistingSessions(); err != nil {
		disc.logger.Error("Failed to discover sessions", "error", err)
		return fmt.Errorf("failed to discover sessions: %w", err)
	}

	// Then discover all panes
	if err := tm.DiscoverAllPanes(); err != nil {
		disc.logger.Error("Failed to discover panes", "error", err)
		return fmt.Errorf("failed to discover panes: %w", err)
	}

	// Map sessions to projects
	mappedProjects, err := tm.MapSessionsToProjects(projects)
	if err != nil {
		disc.logger.Error("Failed to map sessions to projects", "error", err)
		return fmt.Errorf("failed to map sessions to projects: %w", err)
	}

	// Refresh pane mappings with the updated project list
	disc.RefreshPaneProjectMappings(tm, mappedProjects)

	disc.logger.Info("Synchronous pane discovery complete",
		"discoveredPanes", len(tm.panes))
	return nil
}

// addSessionShellsToProject adds shells from a session to a project (delegated method)
func (disc *TmuxDiscovery) addSessionShellsToProject(tm *TmuxManager, session *TmuxSession, project *model.Project) {
	tm.addSessionShellsToProject(session, project)
}