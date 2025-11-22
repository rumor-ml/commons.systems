// repository.go - Repository and branch model definitions
//
// ## Metadata
//
// Repository and branch data structures for managing git repositories
// with branch-worktree relationships and shell sessions.
//
// ### Purpose
//
// Define data structures for git repositories with branch discovery,
// worktree management, and real-time branch tracking.
//
// ### Instructions
//
// #### Branch Management
//
// ##### Branch Discovery
//
// Support discovery of both local and remote branches, tracking which branches
// have associated worktrees and which are available for worktree creation.
//
// ##### Worktree Association
//
// Maintain 1:1 mapping between branches and worktrees, where each branch can
// have at most one worktree associated with it.
//
// #### Display Requirements
//
// ##### Branch Display
//
// Show branches with visual indicators for:
// - Whether the branch has a worktree
// - Whether the branch is remote-only
// - Whether the branch is the current branch
//
// ### Dependencies
//
// #### [Git](https://git-scm.com/)
//
// Uses git commands to discover branches, manage worktrees, and track
// repository state.

package model

import "time"

// Repository represents a git repository with branches and worktrees
type Repository struct {
	Name         string               `json:"name"`
	Path         string               `json:"path"`
	KeyBinding   rune                 `json:"key_binding"`
	Branches     []*Branch            `json:"branches"`
	MainShells   map[ShellType]*Shell `json:"main_shells"`
	Expanded     bool                 `json:"expanded"`
	Status       ProjectStatus        `json:"status"`
	StatusReason string               `json:"status_reason,omitempty"`
}

// Branch represents a git branch with optional worktree
type Branch struct {
	Name         string               `json:"name"`
	FullName     string               `json:"full_name"` // e.g., "refs/heads/main" or "refs/remotes/origin/main"
	Remote       string               `json:"remote"`    // e.g., "origin" or empty for local branches
	KeyBinding   rune                 `json:"key_binding"`
	Worktree     *Worktree            `json:"worktree,omitempty"` // nil if no worktree exists
	IsRemoteOnly bool                 `json:"is_remote_only"`     // true if branch exists only on remote
	IsCurrent    bool                 `json:"is_current"`         // true if this is the currently checked out branch
	CommitHash   string               `json:"commit_hash"`
	LastModified time.Time            `json:"last_modified"`
	Status       ProjectStatus        `json:"status"`
	StatusReason string               `json:"status_reason,omitempty"`
}

// NewRepository creates a new repository
func NewRepository(name, path string) *Repository {
	return &Repository{
		Name:       name,
		Path:       path,
		MainShells: make(map[ShellType]*Shell),
		Branches:   make([]*Branch, 0),
		Expanded:   true, // Always expanded to show branches
		Status:     ProjectStatusNormal,
	}
}

// NewBranch creates a new branch
func NewBranch(name, fullName, remote string) *Branch {
	return &Branch{
		Name:         name,
		FullName:     fullName,
		Remote:       remote,
		IsRemoteOnly: remote != "",
		Status:       ProjectStatusNormal,
	}
}

// HasWorktree returns true if the branch has an associated worktree
func (b *Branch) HasWorktree() bool {
	return b.Worktree != nil
}

// GetDisplayName returns the display name for the branch
func (b *Branch) GetDisplayName() string {
	if b.IsRemoteOnly && b.Remote != "" {
		return b.Remote + "/" + b.Name
	}
	return b.Name
}

// IsBlocked returns true if the branch is in blocked status
func (b *Branch) IsBlocked() bool {
	return b.Status == ProjectStatusBlocked
}

// IsTesting returns true if the branch is in testing status
func (b *Branch) IsTesting() bool {
	return b.Status == ProjectStatusTesting
}
