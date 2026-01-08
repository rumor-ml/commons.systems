package registry

import (
	"fmt"
	"io"
	"os"
	"sync"

	"github.com/rumor-ml/commons.systems/finparse/internal/parser"
	"github.com/rumor-ml/commons.systems/finparse/internal/parsers/ofx"
)

// Registry holds all registered parsers with thread-safe access for concurrent file parsing.
type Registry struct {
	mu      sync.RWMutex
	parsers []parser.Parser
}

// New creates a registry with all built-in parsers.
// Returns an error if built-in parser registration fails (programmer error).
func New() (*Registry, error) {
	r := &Registry{parsers: []parser.Parser{}}

	// Register built-in parsers
	if err := r.Register(ofx.NewParser()); err != nil {
		return nil, fmt.Errorf("failed to register ofx parser: %w", err)
	}

	return r, nil
}

// MustNew creates a registry with all built-in parsers.
// Panics if built-in parser registration fails (programmer error).
func MustNew() *Registry {
	r, err := New()
	if err != nil {
		panic(fmt.Sprintf("failed to create registry: %v", err))
	}
	return r
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

// FindParser returns the best parser for this file by reading up to 512 bytes
// for format detection. This size is sufficient for OFX headers (~100 bytes),
// CSV headers, and other text-based financial formats. Future parsers requiring
// larger headers should document this constraint.
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
func (r *Registry) readHeader(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer f.Close()

	// TODO(#1293): Consider more specific error messages for directory vs file vs permission issues
	header := make([]byte, 512)
	n, err := f.Read(header)
	if err != nil && err != io.EOF {
		return nil, fmt.Errorf("failed to read header from %s: %w", path, err)
	}
	// EOF is acceptable - files smaller than 512 bytes will return their full content.
	// Parsers must validate that headers contain sufficient data for their format
	// detection needs, as minimum header size varies by file format.
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
