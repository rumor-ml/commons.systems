package tmux

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestPaneJSONMarshaling tests that Pane types can be marshaled and unmarshaled correctly
func TestPaneJSONMarshaling(t *testing.T) {
	// Create a test pane
	pane, err := NewPane("%1", "/path/to/repo", "@10", 0, true, false, "nvim", "Editor", true)
	if err != nil {
		t.Fatalf("Failed to create pane: %v", err)
	}

	// Marshal to JSON
	data, err := json.Marshal(pane)
	if err != nil {
		t.Fatalf("Failed to marshal pane: %v", err)
	}

	// Verify JSON is not empty
	if string(data) == "{}" {
		t.Error("Marshaled pane is empty object")
	}

	// Unmarshal back
	var unmarshaled Pane
	if err := json.Unmarshal(data, &unmarshaled); err != nil {
		t.Fatalf("Failed to unmarshal pane: %v", err)
	}

	// Verify all fields match
	if unmarshaled.ID() != pane.ID() {
		t.Errorf("ID mismatch: got %s, want %s", unmarshaled.ID(), pane.ID())
	}
	if unmarshaled.Path() != pane.Path() {
		t.Errorf("Path mismatch: got %s, want %s", unmarshaled.Path(), pane.Path())
	}
	if unmarshaled.WindowID() != pane.WindowID() {
		t.Errorf("WindowID mismatch: got %s, want %s", unmarshaled.WindowID(), pane.WindowID())
	}
	if unmarshaled.WindowIndex() != pane.WindowIndex() {
		t.Errorf("WindowIndex mismatch: got %d, want %d", unmarshaled.WindowIndex(), pane.WindowIndex())
	}
	if unmarshaled.WindowActive() != pane.WindowActive() {
		t.Errorf("WindowActive mismatch: got %v, want %v", unmarshaled.WindowActive(), pane.WindowActive())
	}
	if unmarshaled.WindowBell() != pane.WindowBell() {
		t.Errorf("WindowBell mismatch: got %v, want %v", unmarshaled.WindowBell(), pane.WindowBell())
	}
	if unmarshaled.Command() != pane.Command() {
		t.Errorf("Command mismatch: got %s, want %s", unmarshaled.Command(), pane.Command())
	}
	if unmarshaled.Title() != pane.Title() {
		t.Errorf("Title mismatch: got %s, want %s", unmarshaled.Title(), pane.Title())
	}
	if unmarshaled.IsClaudePane() != pane.IsClaudePane() {
		t.Errorf("IsClaudePane mismatch: got %v, want %v", unmarshaled.IsClaudePane(), pane.IsClaudePane())
	}
}

// TestRepoTreeJSONMarshaling tests that RepoTree can be marshaled and unmarshaled correctly
func TestRepoTreeJSONMarshaling(t *testing.T) {
	// Create test panes
	pane1, _ := NewPane("%1", "/path/to/repo", "@10", 0, true, false, "nvim", "Editor", true)
	pane2, _ := NewPane("%2", "/path/to/repo", "@10", 0, false, false, "bash", "Shell", false)

	// Create and populate tree
	tree := NewRepoTree()
	if err := tree.SetPanes("myrepo", "main", []Pane{pane1, pane2}); err != nil {
		t.Fatalf("Failed to set panes: %v", err)
	}

	// Marshal to JSON
	data, err := json.Marshal(tree)
	if err != nil {
		t.Fatalf("Failed to marshal tree: %v", err)
	}

	// Verify JSON is not empty
	if string(data) == "{}" {
		t.Error("Marshaled tree is empty object")
	}

	// Unmarshal back
	var unmarshaled RepoTree
	if err := json.Unmarshal(data, &unmarshaled); err != nil {
		t.Fatalf("Failed to unmarshal tree: %v", err)
	}

	// Verify structure is preserved
	if !unmarshaled.HasRepo("myrepo") {
		t.Error("Repo 'myrepo' not found in unmarshaled tree")
	}

	if !unmarshaled.HasBranch("myrepo", "main") {
		t.Error("Branch 'main' not found in unmarshaled tree")
	}

	panes, ok := unmarshaled.GetPanes("myrepo", "main")
	if !ok {
		t.Fatal("Failed to get panes from unmarshaled tree")
	}

	if len(panes) != 2 {
		t.Errorf("Expected 2 panes, got %d", len(panes))
	}

	// Verify first pane
	if panes[0].ID() != "%1" {
		t.Errorf("First pane ID mismatch: got %s, want %s", panes[0].ID(), "%1")
	}
	if panes[1].ID() != "%2" {
		t.Errorf("Second pane ID mismatch: got %s, want %s", panes[1].ID(), "%2")
	}
}

// TestSetPanesDefensiveCopy tests that SetPanes makes a defensive copy to prevent external mutation
func TestSetPanesDefensiveCopy(t *testing.T) {
	// Create test panes
	pane1, _ := NewPane("%1", "/path/to/repo", "@10", 0, true, false, "nvim", "Editor", true)
	pane2, _ := NewPane("%2", "/path/to/repo", "@10", 0, false, false, "bash", "Shell", false)

	// Create external slice
	externalPanes := []Pane{pane1, pane2}

	// Create tree and set panes
	tree := NewRepoTree()
	if err := tree.SetPanes("myrepo", "main", externalPanes); err != nil {
		t.Fatalf("Failed to set panes: %v", err)
	}

	// Mutate the external slice
	pane3, _ := NewPane("%3", "/path/to/other", "@11", 1, false, true, "tmux", "Tmux", false)
	externalPanes[0] = pane3

	// Verify tree was not affected by external mutation
	panes, ok := tree.GetPanes("myrepo", "main")
	if !ok {
		t.Fatal("Failed to get panes from tree")
	}

	if len(panes) != 2 {
		t.Errorf("Expected 2 panes, got %d", len(panes))
	}

	// Original pane should still be in the tree
	if panes[0].ID() != "%1" {
		t.Errorf("First pane was mutated! Got ID %s, want %s", panes[0].ID(), "%1")
	}
}

// TestTreeBroadcastScenario simulates the daemon broadcast scenario
func TestTreeBroadcastScenario(t *testing.T) {
	// Create test panes
	pane1, _ := NewPane("%1", "/path/to/repo", "@10", 0, true, false, "nvim", "Editor", true)
	pane2, _ := NewPane("%2", "/path/to/repo", "@10", 0, false, false, "bash", "Shell", false)

	// Create and populate tree
	tree := NewRepoTree()
	if err := tree.SetPanes("myrepo", "main", []Pane{pane1, pane2}); err != nil {
		t.Fatalf("Failed to set panes: %v", err)
	}

	// Simulate broadcasting: marshal tree to JSON (as would happen in ToWireFormat())
	treeJSON, err := json.Marshal(tree)
	if err != nil {
		t.Fatalf("Failed to marshal tree for broadcast: %v", err)
	}

	// Verify the JSON is not empty
	if string(treeJSON) == "{}" || string(treeJSON) == "null" {
		t.Errorf("Tree serialized to empty/null: %s", string(treeJSON))
	}

	// Simulate receiving: unmarshal JSON back to tree
	var receivedTree RepoTree
	if err := json.Unmarshal(treeJSON, &receivedTree); err != nil {
		t.Fatalf("Failed to unmarshal tree after broadcast: %v", err)
	}

	// Verify received tree has the same structure
	if !receivedTree.HasRepo("myrepo") {
		t.Error("Received tree missing repo 'myrepo'")
	}

	if !receivedTree.HasBranch("myrepo", "main") {
		t.Error("Received tree missing branch 'main'")
	}

	receivedPanes, ok := receivedTree.GetPanes("myrepo", "main")
	if !ok {
		t.Fatal("Failed to get panes from received tree")
	}

	if len(receivedPanes) != 2 {
		t.Errorf("Expected 2 panes in received tree, got %d", len(receivedPanes))
	}

	// Verify pane details are preserved
	if receivedPanes[0].ID() != "%1" {
		t.Errorf("First pane ID not preserved: got %s, want %s", receivedPanes[0].ID(), "%1")
	}
	if receivedPanes[0].Path() != "/path/to/repo" {
		t.Errorf("First pane path not preserved: got %s, want %s", receivedPanes[0].Path(), "/path/to/repo")
	}
	if receivedPanes[0].IsClaudePane() != true {
		t.Error("First pane IsClaudePane not preserved")
	}
}

// TestPaneJSONFieldNames verifies that JSON field names follow snake_case convention
func TestPaneJSONFieldNames(t *testing.T) {
	pane, _ := NewPane("%1", "/path", "@10", 0, true, false, "cmd", "title", true)

	data, err := json.Marshal(pane)
	if err != nil {
		t.Fatalf("Failed to marshal pane: %v", err)
	}

	// Parse as generic map to check field names
	var fields map[string]interface{}
	if err := json.Unmarshal(data, &fields); err != nil {
		t.Fatalf("Failed to unmarshal to map: %v", err)
	}

	// Verify snake_case field names
	expectedFields := []string{
		"id", "path", "window_id", "window_index",
		"window_active", "window_bell", "command", "title", "is_claude_pane",
	}

	for _, field := range expectedFields {
		if _, ok := fields[field]; !ok {
			t.Errorf("Missing expected field: %s", field)
		}
	}
}

// TestRepoTreeWithMultipleBranches tests marshaling tree with multiple repos and branches
func TestRepoTreeWithMultipleBranches(t *testing.T) {
	pane1, _ := NewPane("%1", "/repo1", "@10", 0, true, false, "nvim", "Editor", true)
	pane2, _ := NewPane("%2", "/repo1", "@11", 1, false, false, "bash", "Shell", false)
	pane3, _ := NewPane("%3", "/repo2", "@20", 0, true, false, "git", "Git", false)

	tree := NewRepoTree()
	tree.SetPanes("repo1", "main", []Pane{pane1})
	tree.SetPanes("repo1", "feature", []Pane{pane2})
	tree.SetPanes("repo2", "main", []Pane{pane3})

	// Marshal and unmarshal
	data, err := json.Marshal(tree)
	if err != nil {
		t.Fatalf("Failed to marshal tree: %v", err)
	}

	var unmarshaled RepoTree
	if err := json.Unmarshal(data, &unmarshaled); err != nil {
		t.Fatalf("Failed to unmarshal tree: %v", err)
	}

	// Verify all repos and branches are preserved
	repos := unmarshaled.Repos()
	if len(repos) != 2 {
		t.Errorf("Expected 2 repos, got %d", len(repos))
	}

	repo1Branches := unmarshaled.Branches("repo1")
	if len(repo1Branches) != 2 {
		t.Errorf("Expected 2 branches for repo1, got %d", len(repo1Branches))
	}

	repo2Branches := unmarshaled.Branches("repo2")
	if len(repo2Branches) != 1 {
		t.Errorf("Expected 1 branch for repo2, got %d", len(repo2Branches))
	}
}

// TestPaneUnmarshalJSON_InvalidInput tests that unmarshaling rejects invalid pane data
func TestPaneUnmarshalJSON_InvalidInput(t *testing.T) {
	tests := []struct {
		name    string
		json    string
		wantErr string
	}{
		{
			name:    "empty_pane_id",
			json:    `{"id":"","path":"/foo","window_id":"@0","window_index":0,"window_active":true,"window_bell":false,"command":"bash","title":"test","is_claude_pane":false}`,
			wantErr: "pane ID required",
		},
		{
			name:    "whitespace_only_pane_id",
			json:    `{"id":"   ","path":"/foo","window_id":"@0","window_index":0,"window_active":true,"window_bell":false,"command":"bash","title":"test","is_claude_pane":false}`,
			wantErr: "pane ID required",
		},
		{
			name:    "invalid_pane_id_format",
			json:    `{"id":"abc","path":"/foo","window_id":"@0","window_index":0,"window_active":true,"window_bell":false,"command":"bash","title":"test","is_claude_pane":false}`,
			wantErr: "must start with %",
		},
		{
			name:    "negative_window_index",
			json:    `{"id":"%1","path":"/foo","window_id":"@0","window_index":-1,"window_active":true,"window_bell":false,"command":"bash","title":"test","is_claude_pane":false}`,
			wantErr: "must be non-negative",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var pane Pane
			err := json.Unmarshal([]byte(tt.json), &pane)
			if err == nil {
				t.Errorf("Expected error containing %q, got nil", tt.wantErr)
			} else if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("Error %q does not contain %q", err.Error(), tt.wantErr)
			}
		})
	}
}

// TestRepoTreeUnmarshalJSON_InvalidInput tests that unmarshaling rejects invalid tree data
func TestRepoTreeUnmarshalJSON_InvalidInput(t *testing.T) {
	tests := []struct {
		name    string
		json    string
		wantErr string
	}{
		{
			name:    "empty_repo_name",
			json:    `{"":{"main":[]}}`,
			wantErr: "empty repo name",
		},
		{
			name:    "empty_branch_name",
			json:    `{"myrepo":{"":[]}}`,
			wantErr: "empty branch name",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var tree RepoTree
			err := json.Unmarshal([]byte(tt.json), &tree)
			if err == nil {
				t.Errorf("Expected error containing %q, got nil", tt.wantErr)
			} else if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("Error %q does not contain %q", err.Error(), tt.wantErr)
			}
		})
	}
}

// TestRepoTreeClone tests that Clone creates a deep copy
func TestRepoTreeClone(t *testing.T) {
	// Create original tree with data
	original := NewRepoTree()
	pane1, _ := NewPane("%1", "/path/one", "@0", 0, true, false, "zsh", "title1", false)
	pane2, _ := NewPane("%2", "/path/two", "@1", 1, false, false, "vim", "title2", false)
	original.SetPanes("repo1", "branch1", []Pane{pane1})
	original.SetPanes("repo2", "branch2", []Pane{pane2})

	// Clone the tree
	clone := original.Clone()

	// Verify clone has same data
	repos := clone.Repos()
	if len(repos) != 2 {
		t.Errorf("Clone should have 2 repos, got %d", len(repos))
	}

	panes1, ok := clone.GetPanes("repo1", "branch1")
	if !ok || len(panes1) != 1 {
		t.Errorf("Clone should have panes for repo1/branch1")
	}

	panes2, ok := clone.GetPanes("repo2", "branch2")
	if !ok || len(panes2) != 1 {
		t.Errorf("Clone should have panes for repo2/branch2")
	}

	// Mutate original tree
	pane3, _ := NewPane("%3", "/path/three", "@2", 2, false, false, "bash", "title3", false)
	original.SetPanes("repo3", "branch3", []Pane{pane3})

	// Verify clone is NOT affected by mutation
	cloneRepos := clone.Repos()
	if len(cloneRepos) != 2 {
		t.Errorf("Clone should still have 2 repos after original mutation, got %d", len(cloneRepos))
	}

	if _, ok := clone.GetPanes("repo3", "branch3"); ok {
		t.Errorf("Clone should NOT have repo3/branch3 added after cloning")
	}

	// Verify original was mutated
	originalRepos := original.Repos()
	if len(originalRepos) != 3 {
		t.Errorf("Original should have 3 repos, got %d", len(originalRepos))
	}
}

// TestRepoTreeClone_EmptyTree tests cloning an empty tree
func TestRepoTreeClone_EmptyTree(t *testing.T) {
	original := NewRepoTree()
	clone := original.Clone()

	repos := clone.Repos()
	if len(repos) != 0 {
		t.Errorf("Cloned empty tree should have 0 repos, got %d", len(repos))
	}

	// Mutate original
	pane, _ := NewPane("%1", "/path", "@0", 0, true, false, "zsh", "title", false)
	original.SetPanes("repo1", "branch1", []Pane{pane})

	// Verify clone still empty
	cloneRepos := clone.Repos()
	if len(cloneRepos) != 0 {
		t.Errorf("Cloned tree should remain empty after original mutation, got %d repos", len(cloneRepos))
	}
}

// TestRepoTreeUnmarshalJSON_MapIsolation verifies that UnmarshalJSON creates
// independent map structures to prevent data races via shared map pointers.
func TestRepoTreeUnmarshalJSON_MapIsolation(t *testing.T) {
	// Create original tree with test data
	original := NewRepoTree()
	pane1, _ := NewPane("%1", "/path/one", "@0", 0, true, false, "zsh", "title1", false)
	pane2, _ := NewPane("%2", "/path/two", "@1", 1, false, false, "vim", "title2", false)
	original.SetPanes("repo1", "main", []Pane{pane1})
	original.SetPanes("repo2", "feature", []Pane{pane2})

	// Marshal to JSON
	jsonData, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("Failed to marshal tree: %v", err)
	}

	// Unmarshal to new tree
	var unmarshaled RepoTree
	if err := json.Unmarshal(jsonData, &unmarshaled); err != nil {
		t.Fatalf("Failed to unmarshal tree: %v", err)
	}

	// Verify unmarshaled tree has correct data
	if !unmarshaled.HasRepo("repo1") {
		t.Error("Unmarshaled tree should have repo1")
	}
	if !unmarshaled.HasBranch("repo1", "main") {
		t.Error("Unmarshaled tree should have repo1/main")
	}

	// Mutate original tree (simulating concurrent daemon updates)
	pane3, _ := NewPane("%3", "/path/three", "@2", 2, false, false, "bash", "title3", false)
	if err := original.SetPanes("repo1", "main", []Pane{pane3}); err != nil {
		t.Fatalf("Failed to update original tree: %v", err)
	}

	// Verify unmarshaled tree is NOT affected by mutation
	// This would fail if UnmarshalJSON shared map pointers
	panes, ok := unmarshaled.GetPanes("repo1", "main")
	if !ok {
		t.Fatal("Unmarshaled tree should still have repo1/main")
	}
	if len(panes) != 1 {
		t.Errorf("Unmarshaled tree should have 1 pane, got %d", len(panes))
	}
	if panes[0].ID() != "%1" {
		t.Errorf("Unmarshaled tree should have original pane %%1, got %s", panes[0].ID())
	}

	// Verify original tree was mutated
	originalPanes, _ := original.GetPanes("repo1", "main")
	if len(originalPanes) != 1 {
		t.Errorf("Original tree should have 1 pane, got %d", len(originalPanes))
	}
	if originalPanes[0].ID() != "%3" {
		t.Errorf("Original tree should have new pane %%3, got %s", originalPanes[0].ID())
	}
}

// TestPaneWithWindowActive tests the WithWindowActive mutation method
func TestPaneWithWindowActive(t *testing.T) {
	original, _ := NewPane("%1", "/path", "@10", 0, false, false, "cmd", "title", true)

	modified := original.WithWindowActive(true)

	// Verify windowActive was changed
	if !modified.WindowActive() {
		t.Error("WithWindowActive should set windowActive to true")
	}

	// Verify other fields unchanged
	if modified.ID() != original.ID() {
		t.Errorf("WithWindowActive should not modify ID: got %s, want %s", modified.ID(), original.ID())
	}
	if modified.Path() != original.Path() {
		t.Errorf("WithWindowActive should not modify Path: got %s, want %s", modified.Path(), original.Path())
	}
	if modified.WindowID() != original.WindowID() {
		t.Errorf("WithWindowActive should not modify WindowID: got %s, want %s", modified.WindowID(), original.WindowID())
	}
	if modified.WindowIndex() != original.WindowIndex() {
		t.Errorf("WithWindowActive should not modify WindowIndex: got %d, want %d", modified.WindowIndex(), original.WindowIndex())
	}
	if modified.WindowBell() != original.WindowBell() {
		t.Errorf("WithWindowActive should not modify WindowBell: got %v, want %v", modified.WindowBell(), original.WindowBell())
	}
	if modified.Command() != original.Command() {
		t.Errorf("WithWindowActive should not modify Command: got %s, want %s", modified.Command(), original.Command())
	}
	if modified.Title() != original.Title() {
		t.Errorf("WithWindowActive should not modify Title: got %s, want %s", modified.Title(), original.Title())
	}
	if modified.IsClaudePane() != original.IsClaudePane() {
		t.Errorf("WithWindowActive should not modify IsClaudePane: got %v, want %v", modified.IsClaudePane(), original.IsClaudePane())
	}

	// Verify original unchanged (immutability)
	if original.WindowActive() {
		t.Error("WithWindowActive should not mutate original")
	}
}

// TestPaneWithWindowActive_SetFalse tests setting windowActive to false
func TestPaneWithWindowActive_SetFalse(t *testing.T) {
	original, _ := NewPane("%1", "/path", "@10", 0, true, false, "cmd", "title", true)

	modified := original.WithWindowActive(false)

	if modified.WindowActive() {
		t.Error("WithWindowActive should set windowActive to false")
	}

	if !original.WindowActive() {
		t.Error("WithWindowActive should not mutate original")
	}
}

// TestPaneWithActiveAndTitle tests the WithActiveAndTitle mutation method
func TestPaneWithActiveAndTitle(t *testing.T) {
	original, _ := NewPane("%1", "/path", "@10", 0, false, false, "cmd", "old", true)

	modified := original.WithActiveAndTitle(true, "new")

	// Verify both fields were changed
	if !modified.WindowActive() {
		t.Error("WithActiveAndTitle should set windowActive to true")
	}
	if modified.Title() != "new" {
		t.Errorf("WithActiveAndTitle should set title: got %s, want new", modified.Title())
	}

	// Verify other fields unchanged
	if modified.ID() != original.ID() {
		t.Errorf("WithActiveAndTitle should not modify ID: got %s, want %s", modified.ID(), original.ID())
	}
	if modified.Path() != original.Path() {
		t.Errorf("WithActiveAndTitle should not modify Path: got %s, want %s", modified.Path(), original.Path())
	}
	if modified.WindowID() != original.WindowID() {
		t.Errorf("WithActiveAndTitle should not modify WindowID: got %s, want %s", modified.WindowID(), original.WindowID())
	}
	if modified.WindowIndex() != original.WindowIndex() {
		t.Errorf("WithActiveAndTitle should not modify WindowIndex: got %d, want %d", modified.WindowIndex(), original.WindowIndex())
	}
	if modified.WindowBell() != original.WindowBell() {
		t.Errorf("WithActiveAndTitle should not modify WindowBell: got %v, want %v", modified.WindowBell(), original.WindowBell())
	}
	if modified.Command() != original.Command() {
		t.Errorf("WithActiveAndTitle should not modify Command: got %s, want %s", modified.Command(), original.Command())
	}
	if modified.IsClaudePane() != original.IsClaudePane() {
		t.Errorf("WithActiveAndTitle should not modify IsClaudePane: got %v, want %v", modified.IsClaudePane(), original.IsClaudePane())
	}

	// Verify original unchanged (immutability)
	if original.WindowActive() {
		t.Error("WithActiveAndTitle should not mutate original windowActive")
	}
	if original.Title() != "old" {
		t.Errorf("WithActiveAndTitle should not mutate original title: got %s, want old", original.Title())
	}
}

// TestPaneWithActiveAndTitle_SetFalse tests setting windowActive to false with title update
func TestPaneWithActiveAndTitle_SetFalse(t *testing.T) {
	original, _ := NewPane("%1", "/path", "@10", 0, true, false, "cmd", "old", true)

	modified := original.WithActiveAndTitle(false, "new")

	if modified.WindowActive() {
		t.Error("WithActiveAndTitle should set windowActive to false")
	}
	if modified.Title() != "new" {
		t.Errorf("WithActiveAndTitle should set title: got %s, want new", modified.Title())
	}
	if !original.WindowActive() {
		t.Error("WithActiveAndTitle should not mutate original")
	}
	if original.Title() != "old" {
		t.Error("WithActiveAndTitle should not mutate original title")
	}
}

// TestRepoTreeUpdatePaneActiveState tests updating pane active state
func TestRepoTreeUpdatePaneActiveState(t *testing.T) {
	tree := NewRepoTree()
	pane1, _ := NewPane("%1", "/path", "@10", 0, false, false, "cmd", "title1", true)
	pane2, _ := NewPane("%2", "/path", "@10", 0, true, false, "cmd", "title2", false)
	tree.SetPanes("repo", "main", []Pane{pane1, pane2})

	// Update pane1 to active (using UpdatePaneActiveAndTitle with same title)
	if err := tree.UpdatePaneActiveAndTitle("%1", true, "title1"); err != nil {
		t.Errorf("Should find pane %%1: %v", err)
	}

	panes, _ := tree.GetPanes("repo", "main")
	if !panes[0].WindowActive() {
		t.Error("Pane %1 should be active")
	}
	if panes[1].WindowActive() != true {
		t.Error("Pane %2 should remain unchanged")
	}

	// Update pane2 to inactive (using UpdatePaneActiveAndTitle with same title)
	if err := tree.UpdatePaneActiveAndTitle("%2", false, "title2"); err != nil {
		t.Errorf("Should find pane %%2: %v", err)
	}

	panes, _ = tree.GetPanes("repo", "main")
	if panes[1].WindowActive() {
		t.Error("Pane %2 should be inactive")
	}

	// Try non-existent pane
	if err := tree.UpdatePaneActiveAndTitle("%999", true, "title"); err == nil {
		t.Error("Should return error for non-existent pane")
	}
}

// TestRepoTreeUpdatePaneActiveState_MultipleBranches tests updating across multiple repos/branches
func TestRepoTreeUpdatePaneActiveState_MultipleBranches(t *testing.T) {
	tree := NewRepoTree()
	pane1, _ := NewPane("%1", "/path1", "@10", 0, false, false, "cmd", "title1", false)
	pane2, _ := NewPane("%2", "/path2", "@11", 1, false, false, "cmd", "title2", false)
	pane3, _ := NewPane("%3", "/path3", "@12", 2, false, false, "cmd", "title3", false)
	tree.SetPanes("repo1", "main", []Pane{pane1})
	tree.SetPanes("repo1", "feature", []Pane{pane2})
	tree.SetPanes("repo2", "main", []Pane{pane3})

	// Update pane in repo1/feature (using UpdatePaneActiveAndTitle with same title)
	if err := tree.UpdatePaneActiveAndTitle("%2", true, "title2"); err != nil {
		t.Errorf("Should find pane %%2 in repo1/feature: %v", err)
	}

	panes, _ := tree.GetPanes("repo1", "feature")
	if !panes[0].WindowActive() {
		t.Error("Pane %2 should be active")
	}

	// Verify other panes unchanged
	panes1, _ := tree.GetPanes("repo1", "main")
	if panes1[0].WindowActive() {
		t.Error("Pane %1 should remain inactive")
	}

	panes3, _ := tree.GetPanes("repo2", "main")
	if panes3[0].WindowActive() {
		t.Error("Pane %3 should remain inactive")
	}
}

// TestRepoTreeFindPaneByID tests finding panes by ID across the tree
func TestRepoTreeFindPaneByID(t *testing.T) {
	tree := NewRepoTree()
	pane1, _ := NewPane("%1", "/path1", "@10", 0, true, false, "cmd", "title1", true)
	pane2, _ := NewPane("%2", "/path2", "@11", 1, false, false, "cmd", "title2", false)
	tree.SetPanes("repo1", "main", []Pane{pane1})
	tree.SetPanes("repo2", "feature", []Pane{pane2})

	// Find pane in first repo
	pane, repo, branch, found := tree.FindPaneByID("%1")
	if !found {
		t.Fatal("Should find pane %1")
	}
	if repo != "repo1" {
		t.Errorf("Expected repo 'repo1', got %s", repo)
	}
	if branch != "main" {
		t.Errorf("Expected branch 'main', got %s", branch)
	}
	if pane.ID() != "%1" {
		t.Errorf("Expected pane ID %%1, got %s", pane.ID())
	}
	if pane.Path() != "/path1" {
		t.Errorf("Expected path /path1, got %s", pane.Path())
	}

	// Find pane in second repo
	pane, repo, branch, found = tree.FindPaneByID("%2")
	if !found {
		t.Fatal("Should find pane %2")
	}
	if repo != "repo2" || branch != "feature" {
		t.Errorf("Expected repo2/feature, got %s/%s", repo, branch)
	}

	// Not found case
	_, _, _, found = tree.FindPaneByID("%999")
	if found {
		t.Error("Should not find non-existent pane")
	}
}

// TestRepoTreeFindPaneByID_EmptyTree tests finding in an empty tree
func TestRepoTreeFindPaneByID_EmptyTree(t *testing.T) {
	tree := NewRepoTree()

	_, _, _, found := tree.FindPaneByID("%1")
	if found {
		t.Error("Should not find pane in empty tree")
	}
}

// TestRepoTreeFindPaneByID_MultiplePanes tests finding among multiple panes in same branch
func TestRepoTreeFindPaneByID_MultiplePanes(t *testing.T) {
	tree := NewRepoTree()
	pane1, _ := NewPane("%1", "/path", "@10", 0, true, false, "cmd", "title1", true)
	pane2, _ := NewPane("%2", "/path", "@10", 0, false, false, "cmd", "title2", false)
	pane3, _ := NewPane("%3", "/path", "@10", 0, false, false, "cmd", "title3", false)
	tree.SetPanes("repo", "main", []Pane{pane1, pane2, pane3})

	// Find middle pane
	pane, repo, branch, found := tree.FindPaneByID("%2")
	if !found {
		t.Fatal("Should find pane %2")
	}
	if pane.ID() != "%2" || pane.Title() != "title2" {
		t.Error("Should find correct pane %2 with title 'title2'")
	}
	if repo != "repo" || branch != "main" {
		t.Error("Should return correct repo/branch")
	}
}

// TestRepoTreeUpdatePaneActiveAndTitle tests updating both active state and title
func TestRepoTreeUpdatePaneActiveAndTitle(t *testing.T) {
	tree := NewRepoTree()
	pane, _ := NewPane("%1", "/path", "@10", 0, false, false, "cmd", "old", true)
	tree.SetPanes("repo", "main", []Pane{pane})

	if err := tree.UpdatePaneActiveAndTitle("%1", true, "new"); err != nil {
		t.Errorf("Should find and update pane: %v", err)
	}

	panes, _ := tree.GetPanes("repo", "main")
	if !panes[0].WindowActive() {
		t.Error("Should update active state to true")
	}
	if panes[0].Title() != "new" {
		t.Errorf("Should update title: got %s, want new", panes[0].Title())
	}
}

// TestRepoTreeUpdatePaneActiveAndTitle_NotFound tests updating non-existent pane
func TestRepoTreeUpdatePaneActiveAndTitle_NotFound(t *testing.T) {
	tree := NewRepoTree()
	pane, _ := NewPane("%1", "/path", "@10", 0, false, false, "cmd", "title", true)
	tree.SetPanes("repo", "main", []Pane{pane})

	if err := tree.UpdatePaneActiveAndTitle("%999", true, "new"); err == nil {
		t.Error("Should return error for non-existent pane")
	}

	// Verify existing pane unchanged
	panes, _ := tree.GetPanes("repo", "main")
	if panes[0].Title() != "title" {
		t.Error("Existing pane should remain unchanged")
	}
}

// TestNewPane_TitleSanitization tests that NewPane sanitizes titles
func TestNewPane_TitleSanitization(t *testing.T) {
	testCases := []struct {
		name     string
		input    string
		expected string
	}{
		{"null bytes removed", "vim\x00editor", "vimeditor"},
		{"newlines removed", "bash\nshell", "bashshell"},
		{"carriage returns removed", "test\rdata", "testdata"},
		{"multiple control chars", "a\x00b\nc\rd", "abcd"},
		{"clean title unchanged", "normal-title", "normal-title"},
		{"empty after sanitization", "\x00\n\r", ""},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			pane, err := NewPane("%1", "/path", "@1", 0, false, false, "cmd", tc.input, false)
			if err != nil {
				t.Fatalf("NewPane failed: %v", err)
			}
			if pane.Title() != tc.expected {
				t.Errorf("Expected %q, got %q", tc.expected, pane.Title())
			}
		})
	}
}

// TestPaneWithActiveAndTitle_TitleSanitization tests that WithActiveAndTitle sanitizes titles
func TestPaneWithActiveAndTitle_TitleSanitization(t *testing.T) {
	testCases := []struct {
		name     string
		input    string
		expected string
	}{
		{"null bytes removed", "vim\x00editor", "vimeditor"},
		{"newlines removed", "bash\nshell", "bashshell"},
		{"carriage returns removed", "test\rdata", "testdata"},
		{"multiple control chars", "a\x00b\nc\rd", "abcd"},
		{"clean title unchanged", "normal-title", "normal-title"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			pane, _ := NewPane("%1", "/path", "@1", 0, false, false, "cmd", "old", false)
			modified := pane.WithActiveAndTitle(true, tc.input)
			if modified.Title() != tc.expected {
				t.Errorf("Expected %q, got %q", tc.expected, modified.Title())
			}
		})
	}
}

// TestRepoTreeUpdatePaneActiveAndTitle_PreservesOtherFields tests that other fields are not modified
func TestRepoTreeUpdatePaneActiveAndTitle_PreservesOtherFields(t *testing.T) {
	tree := NewRepoTree()
	pane, _ := NewPane("%1", "/path", "@10", 0, false, true, "cmd", "old", true)
	tree.SetPanes("repo", "main", []Pane{pane})

	tree.UpdatePaneActiveAndTitle("%1", true, "new")

	panes, _ := tree.GetPanes("repo", "main")
	updated := panes[0]

	// Verify updated fields
	if !updated.WindowActive() || updated.Title() != "new" {
		t.Error("Should update active and title")
	}

	// Verify preserved fields
	if updated.ID() != "%1" {
		t.Error("Should preserve ID")
	}
	if updated.Path() != "/path" {
		t.Error("Should preserve Path")
	}
	if updated.WindowID() != "@10" {
		t.Error("Should preserve WindowID")
	}
	if updated.WindowIndex() != 0 {
		t.Error("Should preserve WindowIndex")
	}
	if !updated.WindowBell() {
		t.Error("Should preserve WindowBell")
	}
	if updated.Command() != "cmd" {
		t.Error("Should preserve Command")
	}
	if !updated.IsClaudePane() {
		t.Error("Should preserve IsClaudePane")
	}
}
