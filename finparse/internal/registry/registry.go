package registry

import (
	"fmt"
	"io"
	"os"

	"github.com/rumor-ml/commons.systems/finparse/internal/parser"
)

// Registry holds all registered parsers
// TODO(#1277): Add concurrency tests when mutex is added for thread-safe concurrent access
type Registry struct {
	parsers []parser.Parser
}

// New creates a registry with all built-in parsers
func New() *Registry {
	return &Registry{
		parsers: []parser.Parser{
			// Parsers will be added in Phase 2-3
			// TODO: When uncommenting, handle Register errors (should never fail for built-in parsers)
			// ofx.NewParser(),
			// csv.NewPNCParser(),
		},
	}
}

// Register adds a custom parser (for extensibility)
func (r *Registry) Register(p parser.Parser) error {
	if p == nil {
		return fmt.Errorf("cannot register nil parser")
	}

	// Check for duplicate names
	for _, existing := range r.parsers {
		if existing.Name() == p.Name() {
			return fmt.Errorf("parser with name %q already registered", p.Name())
		}
	}

	r.parsers = append(r.parsers, p)
	return nil
}

// FindParser returns the best parser for this file.
// Reads first 512 bytes for format detection via header inspection.
// 512 bytes is sufficient for all known financial format headers (OFX, QFX, CSV magic numbers)
// and matches common filesystem block sizes for efficient reading.
func (r *Registry) FindParser(path string) (parser.Parser, error) {
	// Read file header for format detection
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer f.Close()

	header := make([]byte, 512)
	n, err := f.Read(header)
	if err != nil && err != io.EOF {
		return nil, fmt.Errorf("failed to read header from %s: %w", path, err)
	}
	// EOF is OK - some statement files (especially CSV or minimal test files) may be < 512 bytes.
	// Parsers MUST handle headers from 0 to 512 bytes in length. Parser implementations that
	// assume a minimum header size will fail on small files.
	header = header[:n]

	// Try each parser's CanParse method
	for _, p := range r.parsers {
		if p.CanParse(path, header) {
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
