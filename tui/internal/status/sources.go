// sources.go - Status source interfaces and implementations
//
// ## Metadata
//
// TUI status source abstractions and concrete implementations.
//
// ### Purpose
//
// Define and implement status source interfaces and concrete implementations for
// collecting status information from ICF projects, TUI applications, and system
// resources within the status aggregation framework.
//
// ### Instructions
//
// #### Source Interface Design
//
// ##### Pluggable Architecture
//
// Design source interfaces to support pluggable status collection from diverse
// sources including ICF projects, external applications, and system monitoring
// tools with consistent data formats and subscription patterns.
//
// ##### Event-Driven Updates
//
// Implement subscription-based status updates to enable real-time status
// propagation from sources to the aggregator without polling overhead.
//
// ### Dependencies
//
// #### [ICF](https://github.com/rumor-ml/icf)
//
// Core framework providing project discovery and status reporting patterns that
// inform source implementation and data collection strategies.

package status

import (
	"time"

	"github.com/natb1/tui/pkg/discovery"
)

// Source represents a status information source
type Source interface {
	GetStatus() (*StatusData, error)
	Subscribe(chan StatusUpdate) error
	Name() string
}

// ProjectSource implements Source for ICF projects
type ProjectSource struct {
	project     *discovery.Project
	subscribers []chan StatusUpdate
}

// NewProjectSource creates a new project status source
func NewProjectSource(project *discovery.Project) *ProjectSource {
	return &ProjectSource{
		project:     project,
		subscribers: make([]chan StatusUpdate, 0),
	}
}

// GetStatus returns current project status
func (ps *ProjectSource) GetStatus() (*StatusData, error) {
	return &StatusData{
		Source:    ps.project.Name,
		Timestamp: time.Now(),
		Data: map[string]interface{}{
			"status":   ps.project.Status,
			"metadata": ps.project.Metadata,
		},
		Health: HealthHealthy,
	}, nil
}

// Subscribe adds a subscriber to project updates
func (ps *ProjectSource) Subscribe(ch chan StatusUpdate) error {
	ps.subscribers = append(ps.subscribers, ch)
	return nil
}

// Name returns the source name
func (ps *ProjectSource) Name() string {
	return ps.project.Name
}

// AddSource adds a status source to the aggregator
func (a *Aggregator) AddSource(source Source) {
	a.mutex.Lock()
	defer a.mutex.Unlock()

	a.sources[source.Name()] = source

	// Subscribe to source updates
	source.Subscribe(a.updateChan)
}
