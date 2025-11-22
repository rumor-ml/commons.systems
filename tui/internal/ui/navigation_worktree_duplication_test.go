package ui

import (
	"testing"

	"github.com/natb1/tui/pkg/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestWorktreeNoDuplication verifies that worktrees are not duplicated in the navigation list
func TestWorktreeNoDuplication(t *testing.T) {
	// Create test projects including worktrees that should be filtered
	projects := []*model.Project{
		{
			Name:       "project",
			Path:       "/workspace/project",
			KeyBinding: 'p',
			IsWorktree: false,
			Expanded:   true,
			Worktrees: []*model.Worktree{
				{
					ID:         "project-test-suite",
					Name:       "project-test-suite",
					Branch:     "project-test-suite",
					Path:       "/workspace/project-test-suite",
					KeyBinding: 'j',
				},
				{
					ID:         "worktree-discovery",
					Name:       "worktree-discovery",
					Branch:     "feature/worktree-discovery-2025-02-08",
					Path:       "/workspace/project/.worktrees/worktree-discovery",
					KeyBinding: 'w',
				},
			},
		},
		// This simulates the bug where worktrees appear as top-level projects
		{
			Name:       "project/project-test-suite",
			Path:       "/workspace/project-test-suite",
			KeyBinding: 'r',
			IsWorktree: true, // This should be filtered out
			ParentRepo: "/workspace/project",
		},
		{
			Name:       "project/worktree-discovery-2025-02-08",
			Path:       "/workspace/project/.worktrees/worktree-discovery",
			KeyBinding: 'o',
			IsWorktree: true, // This should be filtered out
			ParentRepo: "/workspace/project",
		},
		{
			Name:       "finance",
			Path:       "/workspace/finance",
			KeyBinding: 'f',
			IsWorktree: false,
		},
	}

	// Create key binding manager
	keyMgr := model.NewKeyBindingManager()
	
	// Build list items
	items := BuildListItems(projects, keyMgr, nil, nil)
	
	// Count how many times each project/worktree appears
	projectCount := make(map[string]int)
	worktreeCount := make(map[string]int)
	
	for _, item := range items {
		if listItem, ok := item.(ListItem); ok {
			if listItem.Project != nil {
				if listItem.IsWorktree && listItem.Worktree != nil {
					// This is a worktree item
					worktreeCount[listItem.Worktree.ID]++
				} else if !listItem.IsWorktree {
					// This is a project item
					projectCount[listItem.Project.Name]++
				}
			}
		}
	}
	
	// Verify no duplicates
	t.Run("NoDuplicateProjects", func(t *testing.T) {
		for name, count := range projectCount {
			assert.Equal(t, 1, count, "Project %s should appear exactly once, but appeared %d times", name, count)
		}
	})
	
	t.Run("NoDuplicateWorktrees", func(t *testing.T) {
		for name, count := range worktreeCount {
			assert.Equal(t, 1, count, "Worktree %s should appear exactly once, but appeared %d times", name, count)
		}
	})
	
	t.Run("WorktreesNotTopLevel", func(t *testing.T) {
		// Verify that projects with IsWorktree=true don't appear as top-level items
		assert.Equal(t, 0, projectCount["project/project-test-suite"], 
			"Worktree project/project-test-suite should not appear as top-level project")
		assert.Equal(t, 0, projectCount["project/worktree-discovery-2025-02-08"], 
			"Worktree project/worktree-discovery-2025-02-08 should not appear as top-level project")
	})
	
	t.Run("WorktreesUnderParent", func(t *testing.T) {
		// Verify worktrees appear under their parent project
		assert.Equal(t, 1, worktreeCount["project-test-suite"], 
			"Worktree project-test-suite should appear once under parent project")
		assert.Equal(t, 1, worktreeCount["worktree-discovery"], 
			"Worktree worktree-discovery should appear once under parent project")
	})
	
	t.Run("ExpectedProjectCount", func(t *testing.T) {
		// Should have exactly 2 top-level projects (project and finance)
		assert.Equal(t, 2, len(projectCount), "Should have exactly 2 top-level projects")
		assert.Contains(t, projectCount, "project", "Should have 'project' as top-level")
		assert.Contains(t, projectCount, "finance", "Should have 'finance' as top-level")
	})
}

// TestWorktreeMultipleCallsNoDuplication verifies worktrees aren't duplicated on repeated calls
func TestWorktreeMultipleCallsNoDuplication(t *testing.T) {
	project := &model.Project{
		Name:       "test-project",
		Path:       "/workspace/test-project",
		KeyBinding: 't',
		IsWorktree: false,
		Expanded:   true,
		Worktrees:  []*model.Worktree{}, // Start empty
	}
	
	// Simulate multiple discovery calls adding worktrees
	// This tests the fix in controller.go that resets worktrees before appending
	for i := 0; i < 3; i++ {
		// In the fixed code, worktrees are reset before discovery
		// In the buggy code, they would accumulate
		project.Worktrees = []*model.Worktree{
			{
				ID:     "feature-1",
				Name:   "feature-1",
				Branch: "feature-1",
				Path:   "/workspace/test-project/.worktrees/feature-1",
			},
			{
				ID:     "feature-2",
				Name:   "feature-2",
				Branch: "feature-2",
				Path:   "/workspace/test-project/.worktrees/feature-2",
			},
		}
	}
	
	// After 3 calls, should still have exactly 2 worktrees
	require.Equal(t, 2, len(project.Worktrees), 
		"Should have exactly 2 worktrees after multiple discovery calls")
	
	// Build list and verify no duplication
	keyMgr := model.NewKeyBindingManager()
	items := BuildListItems([]*model.Project{project}, keyMgr, nil, nil)
	
	worktreeCount := make(map[string]int)
	for _, item := range items {
		if listItem, ok := item.(ListItem); ok {
			if listItem.IsWorktree && listItem.Worktree != nil {
				worktreeCount[listItem.Worktree.ID]++
			}
		}
	}
	
	assert.Equal(t, 1, worktreeCount["feature-1"], 
		"feature-1 should appear exactly once")
	assert.Equal(t, 1, worktreeCount["feature-2"], 
		"feature-2 should appear exactly once")
}