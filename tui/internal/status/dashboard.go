// dashboard.go - Dashboard data structures and generation
//
// ## Metadata
//
// TUI dashboard data generation and management.
//
// ### Purpose
//
// Provide unified dashboard data structures and generation logic for presenting
// aggregated status information from multiple ICF projects, operations, and
// system resources in a cohesive interface representation.
//
// ### Instructions
//
// #### Data Structure Design
//
// ##### Hierarchical Organization
//
// Structure dashboard data to reflect project hierarchies, operational dependencies,
// and resource relationships for intuitive navigation and status interpretation.
//
// ##### Performance Optimization
//
// Generate dashboard data efficiently from cached status information while
// maintaining responsive UI update cycles and minimal computational overhead.
//
// ### Dependencies
//
// #### [ICF](https://github.com/rumor-ml/icf)
//
// Core framework providing project status patterns and organizational structures
// that inform dashboard layout and status interpretation logic.

package status

import "time"

// DashboardData represents unified dashboard status
type DashboardData struct {
	Projects   []ProjectStatus   `json:"projects"`
	Operations []OperationStatus `json:"operations"`
	Resources  ResourceStatus    `json:"resources"`
	Health     HealthStatus      `json:"health"`
	Timestamp  time.Time         `json:"timestamp"`
}

// ProjectStatus represents aggregated project status
type ProjectStatus struct {
	Name              string            `json:"name"`
	Path              string            `json:"path"`
	EmotionalCategory string            `json:"emotional_category"`
	Overall           string            `json:"overall"`
	Health            HealthIndicator   `json:"health"`
	Progress          float64           `json:"progress"`
	LastActivity      time.Time         `json:"last_activity"`
	ActiveOperations  []OperationStatus `json:"active_operations"`
}

// OperationStatus represents status of ongoing operations
type OperationStatus struct {
	ID       string        `json:"id"`
	Name     string        `json:"name"`
	Project  string        `json:"project"`
	Status   string        `json:"status"`
	Progress float64       `json:"progress"`
	ETA      time.Duration `json:"eta"`
	Details  string        `json:"details"`
}

// ResourceStatus represents system resource usage
type ResourceStatus struct {
	CPU           float64 `json:"cpu"`
	Memory        float64 `json:"memory"`
	Disk          float64 `json:"disk"`
	Network       float64 `json:"network"`
	TerminalCount int     `json:"terminal_count"`
}

// HealthStatus represents overall system health
type HealthStatus struct {
	Overall    HealthIndicator `json:"overall"`
	Projects   HealthIndicator `json:"projects"`
	Operations HealthIndicator `json:"operations"`
	Resources  HealthIndicator `json:"resources"`
	LastCheck  time.Time       `json:"last_check"`
}

// generateDashboardData creates unified dashboard representation
func (a *Aggregator) generateDashboardData() {
	dashboard := &DashboardData{
		Projects:   make([]ProjectStatus, 0),
		Operations: make([]OperationStatus, 0),
		Resources:  ResourceStatus{},
		Health: HealthStatus{
			Overall:   HealthHealthy,
			LastCheck: time.Now(),
		},
		Timestamp: time.Now(),
	}

	// Aggregate project status
	for sourceName, cached := range a.cache.data {
		if cached.IsExpired() {
			continue
		}

		// This is a simplified example
		projectStatus := ProjectStatus{
			Name:         sourceName,
			Overall:      "active",
			Health:       cached.data.Health,
			Progress:     0.5,
			LastActivity: cached.data.Timestamp,
		}
		dashboard.Projects = append(dashboard.Projects, projectStatus)
	}

	a.dashboard = dashboard
}

// GetDashboardData returns current dashboard data
func (a *Aggregator) GetDashboardData() *DashboardData {
	a.mutex.RLock()
	defer a.mutex.RUnlock()

	return a.dashboard
}
