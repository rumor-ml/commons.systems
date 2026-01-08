package registry

import (
	"fmt"
	"io"
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

// FindParser returns the best parser for this file.
// Reads first 512 bytes for format detection via header inspection.
// This is sufficient to detect magic numbers and headers in common financial formats (OFX, QFX, CSV).
func (r *Registry) FindParser(path string) (parser.Parser, error) {
	// Read file header for format detection
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}

	header := make([]byte, 512)
	n, err := f.Read(header)
	if err != nil && err != io.EOF {
		f.Close() // Best-effort close, ignore error since we're already failing
		return nil, fmt.Errorf("failed to read header from %s: %w", path, err)
	}
	// EOF is OK - some statement files (especially CSV or minimal test files) may be < 512 bytes.
	// Parsers receive whatever was read (0 to 512 bytes) and should handle variable header sizes.
	header = header[:n]

	// Try each parser's CanParse method
	for _, p := range r.parsers {
		if p.CanParse(path, header) {
			if err := f.Close(); err != nil {
				return nil, fmt.Errorf("failed to close file %s: %w", path, err)
			}
			return p, nil
		}
	}

	if err := f.Close(); err != nil {
		return nil, fmt.Errorf("failed to close file %s: %w", path, err)
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
