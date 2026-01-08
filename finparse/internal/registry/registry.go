package registry

import (
	"fmt"
	"os"

	"github.com/rumor-ml/commons.systems/finparse/internal/parser"
)

// Registry holds all registered parsers
type Registry struct {
	parsers []parser.Parser
}

// New creates a registry with all built-in parsers
func New() *Registry {
	return &Registry{
		parsers: []parser.Parser{
			// Parsers will be added in Phase 2-3
			// ofx.NewParser(),
			// csv.NewPNCParser(),
		},
	}
}

// Register adds a custom parser (for extensibility)
func (r *Registry) Register(p parser.Parser) {
	r.parsers = append(r.parsers, p)
}

// FindParser returns the best parser for this file
// Reads first 512 bytes to detect format
func (r *Registry) FindParser(path string) (parser.Parser, error) {
	// Read file header for format detection
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer f.Close()

	header := make([]byte, 512)
	n, err := f.Read(header)
	if err != nil && n == 0 {
		return nil, fmt.Errorf("failed to read header: %w", err)
	}

	// Try each parser's CanParse method
	for _, p := range r.parsers {
		if p.CanParse(path, header[:n]) {
			return p, nil
		}
	}

	return nil, fmt.Errorf("no parser found for file: %s", path)
}

// ListParsers returns all registered parsers
func (r *Registry) ListParsers() []string {
	names := make([]string, len(r.parsers))
	for i, p := range r.parsers {
		names[i] = p.Name()
	}
	return names
}
