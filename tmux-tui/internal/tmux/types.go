package tmux

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Pane represents a tmux pane with validated fields.
// All fields are private to enforce validation and prevent invalid state mutations.
// Use NewPane() to create and getters to access fields.
type Pane struct {
	id           string
	path         string
	windowID     string
	windowIndex  int
	windowActive bool
	windowBell   bool
	command      string
	title        string
	isClaudePane bool
}

// Getters for Pane
func (p Pane) ID() string         { return p.id }
func (p Pane) Path() string       { return p.path }
func (p Pane) WindowID() string   { return p.windowID }
func (p Pane) WindowIndex() int   { return p.windowIndex }
func (p Pane) WindowActive() bool { return p.windowActive }
func (p Pane) WindowBell() bool   { return p.windowBell }
func (p Pane) Command() string    { return p.command }
func (p Pane) Title() string      { return p.title }
func (p Pane) IsClaudePane() bool { return p.isClaudePane }

// NewPane creates a new Pane with validation.
func NewPane(id, path, windowID string, windowIndex int, windowActive, windowBell bool, command, title string, isClaudePane bool) (Pane, error) {
	id = strings.TrimSpace(id)
	windowID = strings.TrimSpace(windowID)

	if id == "" {
		return Pane{}, fmt.Errorf("pane ID required")
	}
	if !strings.HasPrefix(id, "%") {
		return Pane{}, fmt.Errorf("invalid pane ID format: %s (must start with %%)", id)
	}
	if windowIndex < 0 {
		return Pane{}, fmt.Errorf("window index must be non-negative: %d", windowIndex)
	}

	return Pane{
		id:           id,
		path:         path,
		windowID:     windowID,
		windowIndex:  windowIndex,
		windowActive: windowActive,
		windowBell:   windowBell,
		command:      command,
		title:        title,
		isClaudePane: isClaudePane,
	}, nil
}

// MarshalJSON implements json.Marshaler for wire format.
func (p Pane) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		ID           string `json:"id"`
		Path         string `json:"path"`
		WindowID     string `json:"window_id"`
		WindowIndex  int    `json:"window_index"`
		WindowActive bool   `json:"window_active"`
		WindowBell   bool   `json:"window_bell"`
		Command      string `json:"command"`
		Title        string `json:"title"`
		IsClaudePane bool   `json:"is_claude_pane"`
	}{
		ID:           p.id,
		Path:         p.path,
		WindowID:     p.windowID,
		WindowIndex:  p.windowIndex,
		WindowActive: p.windowActive,
		WindowBell:   p.windowBell,
		Command:      p.command,
		Title:        p.title,
		IsClaudePane: p.isClaudePane,
	})
}

// UnmarshalJSON implements json.Unmarshaler for wire format.
func (p *Pane) UnmarshalJSON(data []byte) error {
	var aux struct {
		ID           string `json:"id"`
		Path         string `json:"path"`
		WindowID     string `json:"window_id"`
		WindowIndex  int    `json:"window_index"`
		WindowActive bool   `json:"window_active"`
		WindowBell   bool   `json:"window_bell"`
		Command      string `json:"command"`
		Title        string `json:"title"`
		IsClaudePane bool   `json:"is_claude_pane"`
	}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}

	// Reuse constructor for validation - single source of truth
	validated, err := NewPane(
		aux.ID,
		aux.Path,
		aux.WindowID,
		aux.WindowIndex,
		aux.WindowActive,
		aux.WindowBell,
		aux.Command,
		aux.Title,
		aux.IsClaudePane,
	)
	if err != nil {
		return err
	}

	*p = validated
	return nil
}

// Window represents a tmux window with validated panes.
// All fields are private to enforce validation and prevent invalid state mutations.
// Use NewWindow() to create and getters to access fields.
type Window struct {
	id     string
	name   string
	index  int
	active bool
	panes  []Pane
}

// Getters for Window
func (w Window) ID() string   { return w.id }
func (w Window) Name() string { return w.name }
func (w Window) Index() int   { return w.index }
func (w Window) Active() bool { return w.active }

// Panes returns a copy of the panes slice to prevent external mutation.
func (w Window) Panes() []Pane {
	result := make([]Pane, len(w.panes))
	copy(result, w.panes)
	return result
}

// NewWindow creates a new Window with validation.
func NewWindow(id, name string, index int, active bool, panes []Pane) (Window, error) {
	id = strings.TrimSpace(id)

	if id == "" {
		return Window{}, fmt.Errorf("window ID required")
	}
	if index < 0 {
		return Window{}, fmt.Errorf("window index must be non-negative: %d", index)
	}

	// Validate panes belong to this window
	for i, pane := range panes {
		if pane.WindowID() != id {
			return Window{}, fmt.Errorf("pane %d has wrong window ID: %s (expected %s)",
				i, pane.WindowID(), id)
		}
	}

	return Window{
		id:     id,
		name:   name,
		index:  index,
		active: active,
		panes:  panes,
	}, nil
}

// RepoTree is a nested map structure: repo -> branch -> panes.
// Use NewRepoTree() to create and methods to access/modify safely.
type RepoTree struct {
	tree map[string]map[string][]Pane
}

// NewRepoTree creates a new empty RepoTree.
func NewRepoTree() RepoTree {
	return RepoTree{
		tree: make(map[string]map[string][]Pane),
	}
}

// GetPanes retrieves panes for a given repo and branch.
// Returns a copy to prevent external mutation. Returns nil and false if not found.
func (rt RepoTree) GetPanes(repo, branch string) ([]Pane, bool) {
	branches, ok := rt.tree[repo]
	if !ok {
		return nil, false
	}
	panes, ok := branches[branch]
	if !ok {
		return nil, false
	}
	// Return a copy to prevent external mutation
	result := make([]Pane, len(panes))
	copy(result, panes)
	return result, true
}

// SetPanes sets panes for a given repo and branch with validation.
func (rt *RepoTree) SetPanes(repo, branch string, panes []Pane) error {
	if repo == "" {
		return fmt.Errorf("repo name required")
	}
	if branch == "" {
		return fmt.Errorf("branch name required")
	}

	if rt.tree[repo] == nil {
		rt.tree[repo] = make(map[string][]Pane)
	}

	// Defensive copy to prevent external mutation
	panesCopy := make([]Pane, len(panes))
	copy(panesCopy, panes)
	rt.tree[repo][branch] = panesCopy
	return nil
}

// Repos returns a list of all repository names.
func (rt RepoTree) Repos() []string {
	result := make([]string, 0, len(rt.tree))
	for repo := range rt.tree {
		result = append(result, repo)
	}
	return result
}

// Branches returns a list of all branches for a given repository.
// Returns nil if the repository doesn't exist.
func (rt RepoTree) Branches(repo string) []string {
	branches, ok := rt.tree[repo]
	if !ok {
		return nil
	}
	result := make([]string, 0, len(branches))
	for branch := range branches {
		result = append(result, branch)
	}
	return result
}

// HasRepo returns true if the repository exists in the tree.
func (rt RepoTree) HasRepo(repo string) bool {
	_, ok := rt.tree[repo]
	return ok
}

// HasBranch returns true if the branch exists in the given repository.
func (rt RepoTree) HasBranch(repo, branch string) bool {
	branches, ok := rt.tree[repo]
	if !ok {
		return false
	}
	_, ok = branches[branch]
	return ok
}

// Clone creates a deep copy of the RepoTree.
// The returned tree has independent map structures but shares the same Pane values.
// Since Pane is a value type with no pointer fields, this is safe.
func (rt RepoTree) Clone() RepoTree {
	clone := NewRepoTree()
	for repo, branches := range rt.tree {
		clone.tree[repo] = make(map[string][]Pane)
		for branch, panes := range branches {
			// Copy the slice
			panesCopy := make([]Pane, len(panes))
			copy(panesCopy, panes)
			clone.tree[repo][branch] = panesCopy
		}
	}
	return clone
}

// MarshalJSON implements json.Marshaler for wire format.
func (rt RepoTree) MarshalJSON() ([]byte, error) {
	return json.Marshal(rt.tree)
}

// UnmarshalJSON implements json.Unmarshaler for wire format.
func (rt *RepoTree) UnmarshalJSON(data []byte) error {
	if rt.tree == nil {
		rt.tree = make(map[string]map[string][]Pane)
	}

	var tempTree map[string]map[string][]Pane
	if err := json.Unmarshal(data, &tempTree); err != nil {
		return err
	}

	// Validate all repo and branch names, and pane invariants
	for repo, branches := range tempTree {
		if repo == "" {
			return fmt.Errorf("unmarshaled tree contains empty repo name")
		}
		for branch, panes := range branches {
			if branch == "" {
				return fmt.Errorf("unmarshaled tree contains empty branch name in repo %q", repo)
			}
			// Validate each pane satisfies basic invariants
			for i, pane := range panes {
				if pane.ID() == "" {
					return fmt.Errorf("unmarshaled tree contains invalid pane at repo %q, branch %q, index %d: empty ID", repo, branch, i)
				}
			}
		}
	}

	rt.tree = tempTree
	return nil
}
