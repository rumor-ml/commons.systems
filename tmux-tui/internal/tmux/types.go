package tmux

// Pane represents a tmux pane
type Pane struct {
	ID           string
	Path         string
	WindowID     string
	WindowIndex  int
	WindowActive bool
	Command      string
}

// Window represents a tmux window
type Window struct {
	ID     string
	Name   string
	Index  int
	Active bool
	Panes  []Pane
}

// RepoTree represents the hierarchy: repo -> branch -> panes
// Structure: map[repoName]map[branchName][]Pane
type RepoTree map[string]map[string][]Pane
