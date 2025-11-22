// branch_service.go - Git branch discovery and management
//
// ## Metadata
//
// Service for discovering and managing git branches, including remote branch
// tracking and worktree association.
//
// ### Purpose
//
// Provide comprehensive branch discovery for git repositories, tracking both
// local and remote branches, identifying which branches have worktrees, and
// enabling worktree creation for remote branches.
//
// ### Instructions
//
// #### Branch Discovery
//
// ##### List All Branches
//
// Discover all branches in a repository including local branches, remote-tracking
// branches, and identify which branches have associated worktrees.
//
// ##### Filter Available Branches
//
// When creating new worktrees, filter the branch list to show only remote branches
// that don't already have local worktrees.
//
// ### Dependencies
//
// #### [Git](https://git-scm.com/)
//
// Uses git commands for branch discovery, worktree management, and repository queries.

package git

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// BranchService manages git branch discovery and operations
type BranchService struct {
	repoPath string
}

// BranchInfo contains git branch information
type BranchInfo struct {
	Name         string
	FullName     string
	Remote       string
	IsCurrent    bool
	IsRemoteOnly bool
	CommitHash   string
	WorktreePath string // empty if no worktree
}

// NewBranchService creates a new branch service
func NewBranchService(repoPath string) *BranchService {
	return &BranchService{
		repoPath: repoPath,
	}
}

// GetCurrentBranch returns the name of the currently checked out branch in the main repo
func (bs *BranchService) GetCurrentBranch() (string, error) {
	cmd := exec.Command("git", "-C", bs.repoPath, "rev-parse", "--abbrev-ref", "HEAD")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("failed to get current branch: %w, output: %s", err, string(output))
	}

	branch := strings.TrimSpace(string(output))
	return branch, nil
}

// FetchFromRemote syncs with remote repository to get latest branch information
func (bs *BranchService) FetchFromRemote() error {
	logger := log.Get()
	logger.Debug("Fetching from remote", "repo", bs.repoPath)

	// Run git fetch to sync with remote
	cmd := exec.Command("git", "-C", bs.repoPath, "fetch", "--prune")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to fetch from remote: %w, output: %s", err, string(output))
	}

	logger.Debug("Successfully fetched from remote", "repo", bs.repoPath)
	return nil
}

// ListAllBranches discovers all local and remote branches
func (bs *BranchService) ListAllBranches() ([]*BranchInfo, error) {
	logger := log.Get()
	logger.Debug("Discovering all branches", "repo", bs.repoPath)

	// Get all local and remote branches
	cmd := exec.Command("git", "-C", bs.repoPath, "branch", "-a", "-v", "--format=%(refname)\t%(objectname:short)\t%(HEAD)")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("failed to list branches: %w, output: %s", err, string(output))
	}

	branches := make([]*BranchInfo, 0)
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")

	for _, line := range lines {
		if line == "" {
			continue
		}

		parts := strings.Split(line, "\t")
		if len(parts) < 2 {
			continue
		}

		refname := parts[0]
		commitHash := parts[1]
		isCurrent := len(parts) > 2 && parts[2] == "*"

		// Parse ref name to extract branch info
		var name, fullName, remote string
		var isRemoteOnly bool

		if strings.HasPrefix(refname, "refs/heads/") {
			// Local branch
			name = strings.TrimPrefix(refname, "refs/heads/")
			fullName = refname
			remote = ""
			isRemoteOnly = false
		} else if strings.HasPrefix(refname, "refs/remotes/") {
			// Remote branch
			remoteBranch := strings.TrimPrefix(refname, "refs/remotes/")
			parts := strings.SplitN(remoteBranch, "/", 2)
			if len(parts) == 2 {
				remote = parts[0]
				name = parts[1]
				fullName = refname
				isRemoteOnly = true

				// Skip HEAD references
				if name == "HEAD" {
					continue
				}
			}
		} else {
			continue
		}

		branches = append(branches, &BranchInfo{
			Name:         name,
			FullName:     fullName,
			Remote:       remote,
			IsCurrent:    isCurrent,
			IsRemoteOnly: isRemoteOnly,
			CommitHash:   commitHash,
		})
	}

	logger.Debug("Discovered branches", "count", len(branches))
	return branches, nil
}

// GetWorktreesForBranches maps worktrees to their branches
func (bs *BranchService) GetWorktreesForBranches(branches []*BranchInfo) error {
	logger := log.Get()

	// List all worktrees
	cmd := exec.Command("git", "-C", bs.repoPath, "worktree", "list", "--porcelain")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to list worktrees: %w, output: %s", err, string(output))
	}

	// Parse worktree list output
	type worktreeInfo struct {
		path   string
		branch string
	}

	worktrees := make(map[string]string) // branch -> path
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")

	var currentPath string
	for _, line := range lines {
		if strings.HasPrefix(line, "worktree ") {
			currentPath = strings.TrimPrefix(line, "worktree ")
		} else if strings.HasPrefix(line, "branch ") {
			branchRef := strings.TrimPrefix(line, "branch ")
			branchName := strings.TrimPrefix(branchRef, "refs/heads/")
			if currentPath != "" {
				worktrees[branchName] = currentPath
			}
		} else if line == "" {
			currentPath = ""
		}
	}

	// Associate worktrees with branches
	for _, branch := range branches {
		if !branch.IsRemoteOnly {
			if path, exists := worktrees[branch.Name]; exists {
				branch.WorktreePath = path
			}
		}
	}

	logger.Debug("Mapped worktrees to branches", "worktree_count", len(worktrees))
	return nil
}

// ListRemoteBranchesAndWorktrees returns only remote branches and local branches with worktrees
// This filters out:
// - Stale local branches that haven't been cleaned up
// - The current branch of the main repository (user should work on it via main repo shell)
func (bs *BranchService) ListRemoteBranchesAndWorktrees() ([]*BranchInfo, error) {
	logger := log.Get()

	// Get current branch of the main repo
	currentBranch, err := bs.GetCurrentBranch()
	if err != nil {
		logger.Warn("Failed to get current branch", "error", err)
		currentBranch = "" // Continue without filtering current branch
	}

	// Get all branches
	allBranches, err := bs.ListAllBranches()
	if err != nil {
		return nil, err
	}

	// Map worktrees to branches
	err = bs.GetWorktreesForBranches(allBranches)
	if err != nil {
		return nil, err
	}

	// Filter to only include:
	// 1. Remote branches (IsRemoteOnly = true), excluding current branch
	// 2. Local branches that have worktrees (WorktreePath != "")
	filtered := make([]*BranchInfo, 0)
	for _, branch := range allBranches {
		if branch.IsRemoteOnly {
			// Skip remote branches that match the current branch
			if currentBranch != "" && branch.Name == currentBranch {
				continue
			}
			// Include all other remote branches
			filtered = append(filtered, branch)
		} else if branch.WorktreePath != "" && branch.WorktreePath != bs.repoPath {
			// Include local branches with worktrees (but not the main repo)
			filtered = append(filtered, branch)
		}
		// Skip local branches without worktrees (these are stale)
	}

	logger.Debug("Filtered to remote branches and worktrees",
		"current_branch", currentBranch,
		"total_branches", len(allBranches),
		"filtered_count", len(filtered))

	return filtered, nil
}

// GetRemoteBranchesWithoutWorktrees returns remote branches that don't have local worktrees
func (bs *BranchService) GetRemoteBranchesWithoutWorktrees() ([]*BranchInfo, error) {
	branches, err := bs.ListAllBranches()
	if err != nil {
		return nil, err
	}

	err = bs.GetWorktreesForBranches(branches)
	if err != nil {
		return nil, err
	}

	// Create a map of local branch names
	localBranches := make(map[string]bool)
	for _, branch := range branches {
		if !branch.IsRemoteOnly {
			localBranches[branch.Name] = true
		}
	}

	// Filter for remote branches without local equivalents
	available := make([]*BranchInfo, 0)
	for _, branch := range branches {
		if branch.IsRemoteOnly && !localBranches[branch.Name] {
			available = append(available, branch)
		}
	}

	return available, nil
}

// CreateWorktreeForBranch creates a new worktree for a remote branch
func (bs *BranchService) CreateWorktreeForBranch(branchInfo *BranchInfo, worktreeName string) (string, error) {
	logger := log.Get()

	// Determine worktree path
	worktreePath := filepath.Join(bs.repoPath, ".worktrees", worktreeName)

	// Create worktree command
	// For remote branches: git worktree add -b <local-name> <path> <remote>/<branch>
	var cmd *exec.Cmd
	if branchInfo.IsRemoteOnly {
		// Create local branch from remote
		remoteBranch := fmt.Sprintf("%s/%s", branchInfo.Remote, branchInfo.Name)
		cmd = exec.Command("git", "-C", bs.repoPath, "worktree", "add", "-b", branchInfo.Name, worktreePath, remoteBranch)
		logger.Info("Creating worktree from remote branch",
			"remote_branch", remoteBranch,
			"local_branch", branchInfo.Name,
			"path", worktreePath)
	} else {
		// Create worktree from existing local branch
		cmd = exec.Command("git", "-C", bs.repoPath, "worktree", "add", worktreePath, branchInfo.Name)
		logger.Info("Creating worktree from local branch",
			"branch", branchInfo.Name,
			"path", worktreePath)
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("failed to create worktree: %w, output: %s", err, string(output))
	}

	logger.Info("Created worktree successfully", "path", worktreePath)
	return worktreePath, nil
}

// ConvertToModelBranch converts BranchInfo to model.Branch
func (bs *BranchService) ConvertToModelBranch(branchInfo *BranchInfo, worktreeService interface{}) *model.Branch {
	branch := model.NewBranch(branchInfo.Name, branchInfo.FullName, branchInfo.Remote)
	branch.IsCurrent = branchInfo.IsCurrent
	branch.IsRemoteOnly = branchInfo.IsRemoteOnly
	branch.CommitHash = branchInfo.CommitHash
	branch.LastModified = time.Now() // TODO: Get actual last modified time from git

	// If this branch has a worktree, create the worktree model
	if branchInfo.WorktreePath != "" && branchInfo.WorktreePath != bs.repoPath {
		branch.Worktree = model.NewWorktree(
			branchInfo.Name,       // ID
			branchInfo.Name,       // Name
			branchInfo.WorktreePath, // Path
			branchInfo.Name,       // Branch
		)
	}

	return branch
}
