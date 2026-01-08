package registry

import (
	"fmt"
	"io"
	"os"
	"sync"

	"github.com/rumor-ml/commons.systems/finparse/internal/parser"
)

// Registry holds all registered parsers with thread-safe access via RWMutex.
type Registry struct {
	mu      sync.RWMutex
	parsers []parser.Parser
}

// New creates a registry with all built-in parsers.
// Built-in parser registration errors are programmer errors and should panic.
// Example: if err := r.Register(ofx.NewParser()); err != nil { panic(err) }
func New() *Registry {
	return &Registry{
		parsers: []parser.Parser{
			// TODO(Phase 2-3): Add built-in parsers here
			// ofx.NewParser(),
			// csv.NewPNCParser(),
		},
	}
}

// Register adds a custom parser (for extensibility)
func (r *Registry) Register(p parser.Parser) error {
	r.mu.Lock()
	defer r.mu.Unlock()

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
// Reads up to 512 bytes for format detection via header inspection.
// 512 bytes is sufficient for all known financial format headers:
// - OFX/QFX: XML declaration + <OFX> tag typically within first 200 bytes
// - CSV: Column headers typically < 200 bytes
// This size also matches common filesystem block sizes for efficient reading.
// Files smaller than 512 bytes are handled correctly (parsers receive actual file size).
func (r *Registry) FindParser(path string) (parser.Parser, error) {
	// Read file header for format detection
	header, err := r.readHeader(path)
	if err != nil {
		return nil, err
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	// Try each parser's CanParse method
	for _, p := range r.parsers {
		if p.CanParse(path, header) {
			return p, nil
		}
	}

	return nil, fmt.Errorf("no parser found for file: %s", path)
}

// readHeader reads the first 512 bytes of a file for format detection.
// The file is opened and closed within this method to avoid holding file handles
// during parser iteration, preventing resource exhaustion when processing many files.
func (r *Registry) readHeader(path string) ([]byte, error) {
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
	return header[:n], nil
}

// ListParsers returns all registered parsers
func (r *Registry) ListParsers() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	names := make([]string, len(r.parsers))
	for i, p := range r.parsers {
		names[i] = p.Name()
	}
	return names
}
