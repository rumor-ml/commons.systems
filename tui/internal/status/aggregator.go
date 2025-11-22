// aggregator.go - Core status aggregation engine
//
// ## Metadata
//
// TUI core status aggregation engine managing unified status collection.
//
// ### Purpose
//
// Orchestrate status collection from multiple sources and coordinate unified status
// updates across the ICF workspace ecosystem while maintaining efficient resource
// utilization and real-time status accuracy.
//
// ### Instructions
//
// #### Multi-Source Aggregation
//
// ##### ICF Project Status
//
// Monitor PLAN.md files, project metadata, and git status to track project progress,
// milestone completion, and overall health indicators for all discovered ICF projects
// within the workspace hierarchy.
//
// ##### TUI Application Integration
//
// Collect real-time status from ICF TUI applications using the status aggregation specification,
// enabling unified monitoring of active terminal sessions and their operational state
// within the multiplexer interface.
//
// #### Event-Driven Updates
//
// ##### Efficient Collection
//
// Use filesystem monitoring and application event streams to trigger status updates only
// when changes occur, reducing system load while ensuring status information remains current.
//
// ### Dependencies
//
// #### [ICF](https://github.com/rumor-ml/icf)
//
// Core framework providing project structure patterns and status reporting conventions
// that enable consistent interpretation and aggregation across diverse project types.

package status

import (
	"context"
	"sync"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/natb1/tui/pkg/discovery"
)

// Aggregator collects and unifies status from multiple sources
type Aggregator struct {
	sources      map[string]Source
	cache        *StatusCache
	subscribers  []chan StatusUpdate
	dashboard    *DashboardData
	mutex        sync.RWMutex
	updateChan   chan StatusUpdate
	ctx          context.Context
	cancel       context.CancelFunc
}

// StatusData represents status information from a source
type StatusData struct {
	Source    string                 `json:"source"`
	Timestamp time.Time              `json:"timestamp"`
	Data      map[string]interface{} `json:"data"`
	Health    HealthIndicator        `json:"health"`
}

// HealthIndicator represents overall health status
type HealthIndicator string

const (
	HealthHealthy  HealthIndicator = "healthy"
	HealthWarning  HealthIndicator = "warning"
	HealthCritical HealthIndicator = "critical"
	HealthUnknown  HealthIndicator = "unknown"
)

// StatusUpdate represents a status change event
type StatusUpdate struct {
	Source    string      `json:"source"`
	Timestamp time.Time   `json:"timestamp"`
	Data      interface{} `json:"data"`
	Type      UpdateType  `json:"type"`
}

// UpdateType categorizes status updates
type UpdateType string

const (
	UpdateTypeProjectStatus     UpdateType = "project_status"
	UpdateTypeApplicationStatus UpdateType = "application_status"
	UpdateTypeResourceStatus    UpdateType = "resource_status"
	UpdateTypeHealthStatus      UpdateType = "health_status"
)

// StatusUpdateMsg is sent when status data changes
type StatusUpdateMsg struct {
	Dashboard *DashboardData
	Updates   []StatusUpdate
}

// NewAggregator creates a new status aggregator
func NewAggregator() *Aggregator {
	ctx, cancel := context.WithCancel(context.Background())
	return &Aggregator{
		sources:      make(map[string]Source),
		cache:        NewStatusCache(5 * time.Minute), // 5-minute default TTL
		subscribers:  make([]chan StatusUpdate, 0),
		dashboard:    &DashboardData{},
		updateChan:   make(chan StatusUpdate, 100),
		ctx:          ctx,
		cancel:       cancel,
	}
}

// Init initializes the status aggregator
func (a *Aggregator) Init() tea.Cmd {
	return tea.Batch(
		a.startUpdateLoop(),
		a.discoverSources(),
	)
}

// Shutdown gracefully shuts down the aggregator
func (a *Aggregator) Shutdown() {
	if a.cancel != nil {
		a.cancel()
	}
}

// HandleMsg processes messages for the status aggregator
func (a *Aggregator) HandleMsg(msg tea.Msg) tea.Cmd {
	switch msg := msg.(type) {
	case discovery.ProjectDiscoveredMsg:
		return a.handleProjectDiscovered(msg)
	case discovery.ProjectUpdatedMsg:
		return a.handleProjectUpdated(msg)
	case StatusUpdateMsg:
		return a.handleStatusUpdate(msg)
	}
	return nil
}

// startUpdateLoop begins the status update processing loop
func (a *Aggregator) startUpdateLoop() tea.Cmd {
	return func() tea.Msg {
		go a.processUpdates()
		return nil
	}
}

// discoverSources discovers available status sources
func (a *Aggregator) discoverSources() tea.Cmd {
	return func() tea.Msg {
		return nil
	}
}

// processUpdates processes status updates in background with context cancellation
func (a *Aggregator) processUpdates() {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-a.ctx.Done():
			return // Exit when context is cancelled
		case update := <-a.updateChan:
			a.processStatusUpdate(update)
		case <-ticker.C:
			a.collectStatusUpdates()
		}
	}
}

// processStatusUpdate processes a single status update
func (a *Aggregator) processStatusUpdate(update StatusUpdate) {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	// Update cache
	a.cache.Set(update.Source, &StatusData{
		Source:    update.Source,
		Timestamp: update.Timestamp,
		Data:      map[string]interface{}{"update": update.Data},
		Health:    HealthHealthy,
	})

	// Regenerate dashboard data
	a.generateDashboardData()

	// Notify subscribers
	for _, subscriber := range a.subscribers {
		select {
		case subscriber <- update:
		default:
			// Skip if subscriber is busy
		}
	}
}

// collectStatusUpdates collects status from all sources
func (a *Aggregator) collectStatusUpdates() {
	a.mutex.RLock()
	sources := make([]Source, 0, len(a.sources))
	for _, source := range a.sources {
		sources = append(sources, source)
	}
	a.mutex.RUnlock()

	for _, source := range sources {
		go func(s Source) {
			status, err := s.GetStatus()
			if err != nil {
				return
			}

			update := StatusUpdate{
				Source:    s.Name(),
				Timestamp: status.Timestamp,
				Data:      status.Data,
				Type:      UpdateTypeProjectStatus,
			}

			select {
			case a.updateChan <- update:
			default:
				// Drop update if channel is full
			}
		}(source)
	}
}

// handleProjectDiscovered processes newly discovered projects
func (a *Aggregator) handleProjectDiscovered(msg discovery.ProjectDiscoveredMsg) tea.Cmd {
	// Add project as status source
	source := NewProjectSource(msg.Project)
	a.AddSource(source)
	return nil
}

// handleProjectUpdated processes project status updates
func (a *Aggregator) handleProjectUpdated(msg discovery.ProjectUpdatedMsg) tea.Cmd {
	update := StatusUpdate{
		Source:    msg.Project.Name,
		Timestamp: time.Now(),
		Data:      msg.Project.Status,
		Type:      UpdateTypeProjectStatus,
	}

	select {
	case a.updateChan <- update:
	default:
	}

	return nil
}

// handleStatusUpdate processes general status updates
func (a *Aggregator) handleStatusUpdate(msg StatusUpdateMsg) tea.Cmd {
	// Update dashboard with new data
	a.mutex.Lock()
	a.dashboard = msg.Dashboard
	a.mutex.Unlock()

	return nil
}

// Subscribe adds a subscriber to status updates
func (a *Aggregator) Subscribe() chan StatusUpdate {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	subscriber := make(chan StatusUpdate, 10)
	a.subscribers = append(a.subscribers, subscriber)
	return subscriber
}

