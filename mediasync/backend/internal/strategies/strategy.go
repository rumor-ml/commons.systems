package strategies

import (
	"context"
)

// MediaStrategy defines the interface for different media type processors
type MediaStrategy interface {
	// Name returns the strategy name (e.g., "audio", "video", "print", "finance")
	Name() string

	// FileExtensions returns the list of supported file extensions
	FileExtensions() []string

	// ExtractMetadata extracts metadata from a file
	ExtractMetadata(ctx context.Context, filePath string) (metadata map[string]interface{}, logs []string, err error)

	// NormalizePath generates a normalized GCS path from metadata
	NormalizePath(metadata map[string]interface{}, fileName string) (string, error)

	// IsEnabled returns whether this strategy is enabled
	IsEnabled() bool
}

// Registry holds all registered media strategies
type Registry struct {
	strategies map[string]MediaStrategy
}

// NewRegistry creates a new strategy registry
func NewRegistry() *Registry {
	return &Registry{
		strategies: make(map[string]MediaStrategy),
	}
}

// Register adds a strategy to the registry
func (r *Registry) Register(strategy MediaStrategy) {
	r.strategies[strategy.Name()] = strategy
}

// Get retrieves a strategy by name
func (r *Registry) Get(name string) (MediaStrategy, bool) {
	strategy, ok := r.strategies[name]
	return strategy, ok
}

// GetEnabled returns all enabled strategies
func (r *Registry) GetEnabled() []MediaStrategy {
	enabled := []MediaStrategy{}
	for _, strategy := range r.strategies {
		if strategy.IsEnabled() {
			enabled = append(enabled, strategy)
		}
	}
	return enabled
}

// GetForFile returns the appropriate strategy for a file extension
func (r *Registry) GetForFile(fileName string) (MediaStrategy, bool) {
	for _, strategy := range r.strategies {
		if !strategy.IsEnabled() {
			continue
		}
		for _, ext := range strategy.FileExtensions() {
			if len(fileName) >= len(ext) && fileName[len(fileName)-len(ext):] == ext {
				return strategy, true
			}
		}
	}
	return nil, false
}
