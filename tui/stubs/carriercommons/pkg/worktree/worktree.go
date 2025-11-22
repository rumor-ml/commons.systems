package worktree

import (
	"fmt"
	"os/exec"
	"strings"
)

// Worktree represents a git worktree
type Worktree struct {
	ID         string
	Path       string
	Branch     string
	Commit     string
	IsPrunable bool
}

// Manager manages worktrees for a project
type Manager struct {
	projectPath string
}

// NewManager creates a new worktree manager for a project
func NewManager(projectPath string) *Manager {
	return &Manager{
		projectPath: projectPath,
	}
}

// ProjectPath returns the project path
func (m *Manager) ProjectPath() string {
	return m.projectPath
}

// ListWorktrees returns all worktrees for the project
func (m *Manager) ListWorktrees() ([]*Worktree, error) {
	cmd := exec.Command("git", "worktree", "list", "--porcelain")
	cmd.Dir = m.projectPath

	output, err := cmd.Output()
	if err != nil {
		// If git worktree command fails, return empty list
		return []*Worktree{}, nil
	}

	return parseWorktreeList(string(output)), nil
}

// CreateWorktree creates a new worktree
func (m *Manager) CreateWorktree(path, branch string) (*Worktree, error) {
	cmd := exec.Command("git", "worktree", "add", path, branch)
	cmd.Dir = m.projectPath

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("failed to create worktree: %w", err)
	}

	return &Worktree{
		ID:     path,
		Path:   path,
		Branch: branch,
	}, nil
}

// RemoveWorktree removes a worktree
func (m *Manager) RemoveWorktree(path string) error {
	cmd := exec.Command("git", "worktree", "remove", path)
	cmd.Dir = m.projectPath

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to remove worktree: %w", err)
	}

	return nil
}

// CleanupMergedWorktrees removes worktrees for branches that have been merged
func (m *Manager) CleanupMergedWorktrees() error {
	// This is a stub implementation
	// In a real implementation, this would:
	// 1. List all worktrees
	// 2. Check which branches have been merged
	// 3. Remove worktrees for merged branches
	return nil
}

// parseWorktreeList parses the output of "git worktree list --porcelain"
func parseWorktreeList(output string) []*Worktree {
	var worktrees []*Worktree
	var current *Worktree

	lines := strings.Split(output, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			if current != nil {
				worktrees = append(worktrees, current)
				current = nil
			}
			continue
		}

		parts := strings.SplitN(line, " ", 2)
		if len(parts) < 2 {
			continue
		}

		key := parts[0]
		value := parts[1]

		switch key {
		case "worktree":
			current = &Worktree{
				Path: value,
				ID:   value,
			}
		case "branch":
			if current != nil {
				// Remove "refs/heads/" prefix if present
				current.Branch = strings.TrimPrefix(value, "refs/heads/")
			}
		case "HEAD":
			if current != nil {
				current.Commit = value
			}
		}
	}

	// Add last worktree if exists
	if current != nil {
		worktrees = append(worktrees, current)
	}

	return worktrees
}
