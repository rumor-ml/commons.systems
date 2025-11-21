package ui

import (
	"context"
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/natb1/tui/internal/status"
	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// NavigationComponent provides project navigation functionality using delegation pattern
type NavigationComponent struct {
	listNav          *NavigationListComponent
	width            int
	height           int
	worktreeProgress WorktreeProgress
	tmuxPanes        map[string]*terminal.TmuxPane // cached tmux panes for display

	// Change detection for incremental updates
	lastProjectsHash uint64
	lastPanesHash    uint64
	
	// Delegated components
	projectHandler *NavigationProjectHandler
	paneHandler    *NavigationPaneHandler
	hashHandler    *NavigationHashHandler
	updateHandler  *NavigationUpdateHandler
}

// NewNavigationComponent creates a new navigation component with delegation pattern
func NewNavigationComponent() *NavigationComponent {
	// Create delegated handlers
	hashHandler := NewNavigationHashHandler()
	projectHandler := NewNavigationProjectHandler(hashHandler)
	paneHandler := NewNavigationPaneHandler(hashHandler)
	updateHandler := NewNavigationUpdateHandler()
	
	nc := &NavigationComponent{
		listNav:        NewNavigationListComponent(),
		width:          120, // Default size
		height:         40,  // Default size
		projectHandler: projectHandler,
		paneHandler:    paneHandler,
		hashHandler:    hashHandler,
		updateHandler:  updateHandler,
	}
	// Set initial size on list nav
	nc.listNav.SetSize(nc.width, nc.height)
	return nc
}

// StartClaudeMonitoring starts the Claude activity monitoring
func (n *NavigationComponent) StartClaudeMonitoring(ctx context.Context) error {
	if n.listNav != nil {
		return n.listNav.StartClaudeMonitoring(ctx)
	}
	return nil
}

// SetProjects updates the navigation with real discovered projects using delegation
func (n *NavigationComponent) SetProjects(projects []*model.Project) {
	logger := log.Get()
	logger.Debug("NavigationComponent.SetProjects called", "count", len(projects))

	// Delegate to project handler for processing
	shouldUpdate, newHash := n.projectHandler.ProcessProjectUpdate(projects, &n.lastProjectsHash, n.tmuxPanes)
	
	if !shouldUpdate {
		return
	}
	
	n.lastProjectsHash = newHash

	if n.listNav != nil {
		logger.Debug("navigation.go: Calling SetProjectsAndPanes from SetProjects", "projectCount", len(projects))
		n.listNav.SetProjectsAndPanes(projects, n.tmuxPanes)
	} else {
		logger.Error("listNav is nil in SetProjects")
	}
}

// SetPanes updates the navigation with discovered tmux panes using delegation
func (n *NavigationComponent) SetPanes(panes map[string]*terminal.TmuxPane) {
	logger := log.Get()
	logger.Debug("NavigationComponent.SetPanes called", "count", len(panes))

	// Delegate to pane handler for processing
	shouldUpdate, updateType, newHash := n.paneHandler.ProcessPaneUpdate(panes, &n.lastPanesHash, n.tmuxPanes)
	
	if !shouldUpdate {
		return
	}
	
	n.lastPanesHash = newHash
	n.tmuxPanes = panes
	
	// Handle different update types
	if n.listNav != nil && n.listNav.projects != nil {
		if updateType == "claude_status" {
			logger.Debug("navigation.go: Updating panes only (Claude status)")
		} else {
			logger.Debug("navigation.go: Updating panes only (normal)")
		}
		n.listNav.UpdatePanesOnly(n.tmuxPanes)
	}
}

// GetProjects returns the current projects
func (n *NavigationComponent) GetProjects() []*model.Project {
	if n.listNav != nil {
		return n.listNav.projects
	}
	return nil
}

// RefreshDisplay forces a refresh of the navigation display
func (n *NavigationComponent) RefreshDisplay() {
	if n.listNav != nil {
		// Trigger a refresh in the list navigation
		n.listNav.RefreshDisplay()
	}
}

// GetClaudeStatusManager returns the ClaudeStatusManager for external configuration
func (n *NavigationComponent) GetClaudeStatusManager() *status.ClaudeStatusManager {
	if n.listNav != nil {
		return n.listNav.GetClaudeStatusManager()
	}
	return nil
}

// Init initializes the navigation component
func (n *NavigationComponent) Init() tea.Cmd {
	return n.listNav.Init()
}

// Update handles messages for the navigation component using delegation
func (n *NavigationComponent) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	// Don't handle window size messages directly - the parent manager
	// will call SetSize() to respect the layout with logs and help sections
	if _, ok := msg.(tea.WindowSizeMsg); ok {
		return n, nil
	}
	
	// Delegate message handling to update handler
	handled, cmd, worktreeProgress := n.updateHandler.ProcessMessage(msg)
	if handled {
		if worktreeProgress != nil {
			n.worktreeProgress = *worktreeProgress
		}
		if cmd != nil {
			return n, cmd
		}
		return n, nil
	}

	// Since navigation is chord-based, we don't need focus to process chord keys
	// but we still let the list handle chord input directly
	updatedList, cmd := n.listNav.Update(msg)
	n.listNav = updatedList.(*NavigationListComponent)
	return n, cmd
}

// NavigationCancelMsg is sent when navigation is cancelled (e.g., ESC pressed)
type NavigationCancelMsg struct{}

// View renders the navigation component
func (n *NavigationComponent) View() string {
	logger := log.Get()
	// Don't log on every View() call - this happens on every render frame

	if n.width == 0 || n.height == 0 {
		return "Navigation Loading..."
	}

	// If we're creating a worktree, show progress
	if n.worktreeProgress.InProgress {
		return fmt.Sprintf("Creating worktree for %s...\n\nPlease wait...", n.worktreeProgress.ProjectName)
	}

	// Get list view
	logger.Debug("Getting list view from listNav")
	view := n.listNav.View()
	logger.Debug("Got list view", "length", len(view))

	// Additional cleanup in case list component missed any
	view = strings.ReplaceAll(view, "[K", "")
	view = strings.ReplaceAll(view, "\x1b[K", "")

	return view
}

// SetSize sets the component size
func (n *NavigationComponent) SetSize(width, height int) {
	n.width = width
	n.height = height
	n.listNav.SetSize(width, height)
}

// SetLogsComponent passes the logs component to the list navigation
func (n *NavigationComponent) SetLogsComponent(logs *LogsComponent) {
	if n.listNav != nil {
		n.listNav.SetLogsComponent(logs)
	}
}

// UpdatePanes updates the cached tmux panes after a layout change
func (n *NavigationComponent) UpdatePanes(panes map[string]*terminal.TmuxPane) {
	logger := log.Get()
	logger.Debug("NavigationComponent updating panes", "count", len(panes))

	// Update our cached panes
	n.tmuxPanes = panes

	// Also update the list navigation component's panes
	if n.listNav != nil {
		n.listNav.UpdateTmuxPanes(panes)
	}
}

// GetHelpText returns help text for navigation keys
func (n *NavigationComponent) GetHelpText() string {
	return "[key]c claude • [key]n nvim • [key]z zsh • Esc return to terminal"
}
