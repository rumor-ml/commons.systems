// service.go - Worktree service for managing worktree lifecycle
//
// ## Metadata
//
// TUI worktree service managing worktree lifecycle, session persistence,
// and coordination with terminal sessions.
//
// ### Purpose
//
// Coordinate worktree management across projects, maintain session persistence for worktree
// shells, discover existing worktrees on startup, and integrate with terminal manager to
// provide seamless worktree-based development workflows.
//
// ### Instructions
//
// #### Worktree Management
//
// ##### Lifecycle Operations
//
// Create, discover, and manage git worktrees across multiple projects using the existing
// worktree manager while maintaining session state and coordinating with terminal sessions.
//
// ##### Session Persistence
//
// Track which terminal sessions belong to which worktrees, persist session state across
// multiplexer restarts, and restore shell sessions with their terminal output buffers.
//
// ### Dependencies
//
// #### [ICF](https://github.com/rumor-ml/icf)
//
// Core framework providing project structure and metadata that inform worktree organization
// and branch naming strategies.

package worktree

import (
	"context"
	"fmt"
	"sync"

	"github.com/rumor-ml/carriercommons/pkg/worktree"
	"github.com/rumor-ml/log/pkg/log"
)

// ProjectInfo contains minimal project information needed by worktree service
type ProjectInfo interface {
	GetPath() string
	GetName() string
}

// Service manages worktree lifecycle and session persistence
type Service struct {
	workspaceRoot string
	projects      map[string]*worktree.Manager // Project path -> Manager
	sessions      map[string][]string          // WorktreeID -> []SessionID
	mutex         sync.RWMutex
	ctx           context.Context
	cancel        context.CancelFunc
}



// NewService creates a new worktree service
func NewService(workspaceRoot string) *Service {
	ctx, cancel := context.WithCancel(context.Background())

	return &Service{
		workspaceRoot: workspaceRoot,
		projects:      make(map[string]*worktree.Manager),
		sessions:      make(map[string][]string),
		ctx:    ctx,
		cancel: cancel,
	}
}

// DiscoverWorktrees scans all projects for existing worktrees on startup
func (s *Service) DiscoverWorktrees(projects []ProjectInfo) error {
	logger := log.Get()
	logger.Info("Discovering worktrees across projects", "count", len(projects))

	s.mutex.Lock()
	defer s.mutex.Unlock()

	for _, project := range projects {
		// Create worktree manager for this project
		manager := worktree.NewManager(project.GetPath())
		s.projects[project.GetPath()] = manager

		// List existing worktrees
		worktrees, err := manager.ListWorktrees()
		if err != nil {
			logger.Error("Failed to list worktrees", "project", project.GetName(), "error", err)
			continue
		}

		logger.Info("Found worktrees", "project", project.GetName(), "count", len(worktrees))

		// Initialize empty session tracking for discovered worktrees
		for _, wt := range worktrees {
			// Use branch as ID for worktrees
			if wt.Branch != "" {
				s.sessions[wt.Branch] = []string{}
			}
		}
	}

	return nil
}

// CreateWorktree removed - this functionality is deprecated and not needed

// RegisterSession associates a terminal session with a worktree
func (s *Service) RegisterSession(worktreeID, sessionID, projectPath, shellType string) error {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	// Add to in-memory tracking
	s.sessions[worktreeID] = append(s.sessions[worktreeID], sessionID)

	// Find worktree path
	manager, exists := s.projects[projectPath]
	if !exists {
		return fmt.Errorf("project manager not found: %s", projectPath)
	}

	worktrees, err := manager.ListWorktrees()
	if err != nil {
		return err
	}

	var worktreePath string
	for _, wt := range worktrees {
		// Match by branch or path
		if wt.Branch == worktreeID || wt.Path == worktreeID {
			worktreePath = wt.Path
			break
		}
	}

	if worktreePath == "" {
		return fmt.Errorf("worktree not found: %s", worktreeID)
	}

	// Session tracking is now only in-memory
	return nil
}

// GetWorktreeSessions returns all session IDs for a worktree
func (s *Service) GetWorktreeSessions(worktreeID string) []string {
	s.mutex.RLock()
	defer s.mutex.RUnlock()

	return s.sessions[worktreeID]
}

// GetManager returns the worktree manager for a project
func (s *Service) GetManager(projectPath string) *worktree.Manager {
	s.mutex.RLock()
	defer s.mutex.RUnlock()

	return s.projects[projectPath]
}

// CleanupMergedWorktrees removes worktrees for branches that have been merged
func (s *Service) CleanupMergedWorktrees() error {
	s.mutex.RLock()
	managers := make([]*worktree.Manager, 0, len(s.projects))
	for _, manager := range s.projects {
		managers = append(managers, manager)
	}
	s.mutex.RUnlock()

	for _, manager := range managers {
		if err := manager.CleanupMergedWorktrees(); err != nil {
			log.Get().Error("Failed to cleanup merged worktrees",
				"project", manager.ProjectPath(), "error", err)
		}
	}

	return nil
}

// Shutdown gracefully shuts down the service
func (s *Service) Shutdown() error {
	s.cancel()
	return nil
}

