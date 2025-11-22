// project.go - Project and shell model definitions
//
// ## Metadata
//
// ICF project model structures for managing projects, worktrees, and associated shell sessions.
//
// ### Purpose
//
// Define data structures for ICF projects with comprehensive shell tracking including
// dynamic tmux session discovery, unknown session handling, and real-time pane title updates.
//
// ### Instructions
//
// #### Shell Type Management
//
// ##### Three Shell Types
//
// Support zsh, claude, and unknown shell types with distinct handling for each type.
// Unknown shells represent discovered tmux sessions that cannot be classified as zsh or claude.
//
// ##### Dynamic Shell Discovery
//
// Enable automatic detection of running tmux sessions and windows, mapping them to projects
// based on current working directory when possible, and grouping unmatched sessions separately.
//
// #### Display Requirements
//
// ##### Unicode Shell Icons
//
// Use unicode symbols for visual shell identification: ⚡ for zsh, 🤖 for claude,
// no icon for unknown shells which display only the pane title.
//
// ##### Real-time Pane Titles
//
// Support dynamic extraction and display of tmux pane titles (#{pane_title}) that update
// in real-time as users work, showing current command or application state.
//
// #### Project Association
//
// ##### CWD-based Mapping
//
// Associate tmux sessions with projects by comparing session current working directory
// against discovered project paths using existing project discovery logic.
//
// ##### Unknown Session Grouping
//
// Group all tmux sessions that cannot be mapped to discovered projects under a special
// "Other Sessions" grouping to maintain visibility of all running tmux activity.
//
// ### Dependencies
//
// #### [ICF](https://github.com/rumor-ml/icf)
//
// Core framework providing project discovery logic that informs tmux session mapping
// and grouping decisions based on directory structure analysis.

package model

import "time"

// Project represents an ICF project with worktrees and shells
type Project struct {
	Name          string               `json:"name"`
	Path          string               `json:"path"`
	CurrentBranch string               `json:"current_branch,omitempty"` // Currently checked out branch in main repo
	KeyBinding    rune                 `json:"key_binding"`
	Dashboard     *Dashboard           `json:"dashboard,omitempty"`
	MainShells    map[ShellType]*Shell `json:"main_shells"`
	Worktrees     []*Worktree          `json:"worktrees"`
	Expanded      bool                 `json:"expanded"`
	Status        ProjectStatus        `json:"status"`
	StatusReason  string               `json:"status_reason,omitempty"`
	HttpServer    *HttpServer          `json:"http_server,omitempty"`
	IsWorktree    bool                 `json:"is_worktree"`
	ParentRepo    string               `json:"parent_repo,omitempty"`
}

// Worktree represents a git worktree with associated shells
type Worktree struct {
	ID           string               `json:"id"`
	Name         string               `json:"name"`
	Path         string               `json:"path"`
	Branch       string               `json:"branch"`
	KeyBinding   rune                 `json:"key_binding"`
	Shells       map[ShellType]*Shell `json:"shells"`
	CreatedAt    time.Time            `json:"created_at"`
	IsActive     bool                 `json:"is_active"`
	IsPrunable   bool                 `json:"is_prunable"`
	Status       ProjectStatus        `json:"status"`
	StatusReason string               `json:"status_reason,omitempty"`
	HttpServer   *HttpServer          `json:"http_server,omitempty"`
}

// Shell represents a running shell process (zsh, claude, or unknown)
type Shell struct {
	Type      ShellType   `json:"type"`
	ProcessID int         `json:"process_id"`
	Status    ShellStatus `json:"status"`
	Command   string      `json:"command"`    // Current command/process running
	PaneTitle string      `json:"pane_title"` // Tmux pane title from #{pane_title}
	CreatedAt time.Time   `json:"created_at"`
	LastUsed  time.Time   `json:"last_used"`
}

// Dashboard represents a running dashboard process for a project
type Dashboard struct {
	ProcessID int         `json:"process_id"`
	Status    ShellStatus `json:"status"`
	CreatedAt time.Time   `json:"created_at"`
	LastUsed  time.Time   `json:"last_used"`
}

// HttpServer represents a running HTTP server process for a project or worktree
type HttpServer struct {
	Port      int         `json:"port"`
	ProcessID int         `json:"process_id"`
	Status    ShellStatus `json:"status"`
	CreatedAt time.Time   `json:"created_at"`
	LastUsed  time.Time   `json:"last_used"`
}

// ShellType defines the type of shell
type ShellType string

const (
	ShellTypeZsh     ShellType = "zsh"
	ShellTypeClaude  ShellType = "claude"
	ShellTypeNvim    ShellType = "nvim"
	ShellTypeUnknown ShellType = "unknown"
)

// ShellStatus defines the status of a shell or dashboard
type ShellStatus string

const (
	ShellStatusStarting ShellStatus = "starting"
	ShellStatusRunning  ShellStatus = "running"
	ShellStatusStopped  ShellStatus = "stopped"
	ShellStatusError    ShellStatus = "error"
)

// ProjectStatus defines the status of a project or worktree
type ProjectStatus string

const (
	ProjectStatusNormal  ProjectStatus = "normal"
	ProjectStatusBlocked ProjectStatus = "blocked"
	ProjectStatusTesting ProjectStatus = "testing"
)

// OtherSessionsProjectName is the special project name for unmapped tmux sessions
const OtherSessionsProjectName = "Other Sessions"

// NewProject creates a new project with the given name and path
func NewProject(name, path string) *Project {
	return &Project{
		Name:       name,
		Path:       path,
		MainShells: make(map[ShellType]*Shell),
		Worktrees:  make([]*Worktree, 0),
		Expanded:   false,
		Status:     ProjectStatusNormal,
	}
}

// NewOtherSessionsProject creates the virtual project for unmapped tmux sessions
func NewOtherSessionsProject() *Project {
	return &Project{
		Name:       OtherSessionsProjectName,
		Path:       "", // No filesystem path for virtual project
		MainShells: make(map[ShellType]*Shell),
		Worktrees:  make([]*Worktree, 0),
		Expanded:   true, // Always expanded to show unknown sessions
		Status:     ProjectStatusNormal,
	}
}

// IsOtherSessionsProject returns true if this is the virtual Other Sessions project
func (p *Project) IsOtherSessionsProject() bool {
	return p.Name == OtherSessionsProjectName
}

// NewWorktree creates a new worktree
func NewWorktree(id, name, path, branch string) *Worktree {
	return &Worktree{
		ID:        id,
		Name:      name,
		Path:      path,
		Branch:    branch,
		Shells:    make(map[ShellType]*Shell),
		CreatedAt: time.Now(),
		IsActive:  true,
		Status:    ProjectStatusNormal,
	}
}

// NewShell creates a new shell
func NewShell(shellType ShellType, processID int) *Shell {
	return &Shell{
		Type:      shellType,
		ProcessID: processID,
		Status:    ShellStatusStarting,
		CreatedAt: time.Now(),
		LastUsed:  time.Now(),
	}
}

// NewDashboard creates a new dashboard
func NewDashboard(processID int) *Dashboard {
	return &Dashboard{
		ProcessID: processID,
		Status:    ShellStatusStarting,
		CreatedAt: time.Now(),
		LastUsed:  time.Now(),
	}
}

// NewHttpServer creates a new HTTP server
func NewHttpServer(port, processID int) *HttpServer {
	return &HttpServer{
		Port:      port,
		ProcessID: processID,
		Status:    ShellStatusStarting,
		CreatedAt: time.Now(),
		LastUsed:  time.Now(),
	}
}

// HasMainShell returns true if the project has a main shell of the given type
func (p *Project) HasMainShell(shellType ShellType) bool {
	shell, exists := p.MainShells[shellType]
	return exists && shell.Status == ShellStatusRunning
}

// HasWorktreeShell returns true if the worktree has a shell of the given type
func (w *Worktree) HasShell(shellType ShellType) bool {
	shell, exists := w.Shells[shellType]
	return exists && shell.Status == ShellStatusRunning
}

// GetDisplayName returns the display name for the worktree
func (w *Worktree) GetDisplayName() string {
	if w.Name != "" {
		return w.Name
	}
	return w.Branch
}

// IsRunning returns true if the shell is currently running
func (s *Shell) IsRunning() bool {
	return s.Status == ShellStatusRunning
}

// IsRunning returns true if the dashboard is currently running
func (d *Dashboard) IsRunning() bool {
	return d.Status == ShellStatusRunning
}

// UpdateLastUsed updates the last used timestamp
func (s *Shell) UpdateLastUsed() {
	s.LastUsed = time.Now()
}

// UpdateLastUsed updates the last used timestamp for dashboard
func (d *Dashboard) UpdateLastUsed() {
	d.LastUsed = time.Now()
}

// IsRunning returns true if the HTTP server is currently running
func (h *HttpServer) IsRunning() bool {
	return h.Status == ShellStatusRunning
}

// UpdateLastUsed updates the last used timestamp for HTTP server
func (h *HttpServer) UpdateLastUsed() {
	h.LastUsed = time.Now()
}

// HasHttpServer returns true if the project has a running HTTP server
func (p *Project) HasHttpServer() bool {
	return p.HttpServer != nil && p.HttpServer.IsRunning()
}

// HasHttpServer returns true if the worktree has a running HTTP server
func (w *Worktree) HasHttpServer() bool {
	return w.HttpServer != nil && w.HttpServer.IsRunning()
}

// IsBlocked returns true if the project is in blocked status
func (p *Project) IsBlocked() bool {
	return p.Status == ProjectStatusBlocked
}

// IsTesting returns true if the project is in testing status
func (p *Project) IsTesting() bool {
	return p.Status == ProjectStatusTesting
}

// IsBlocked returns true if the worktree is in blocked status
func (w *Worktree) IsBlocked() bool {
	return w.Status == ProjectStatusBlocked
}

// IsTesting returns true if the worktree is in testing status
func (w *Worktree) IsTesting() bool {
	return w.Status == ProjectStatusTesting
}
