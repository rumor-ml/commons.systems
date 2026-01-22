package registry

import (
	"fmt"
	"io"
	"os"
	"strings"
	"sync"

	"github.com/rumor-ml/commons.systems/finparse/internal/parser"
	"github.com/rumor-ml/commons.systems/finparse/internal/parsers/csv"
	"github.com/rumor-ml/commons.systems/finparse/internal/parsers/ofx"
)

// Registry holds all registered parsers with thread-safe access for concurrent file parsing.
// TODO(#1322): Add concurrent tests to verify thread safety of FindParser calls
type Registry struct {
	mu      sync.RWMutex
	parsers []parser.Parser
}

// New creates a registry with built-in parsers and optional custom parsers.
// Returns an error with context (successfully registered parsers, failure point) if registration fails
// due to duplicate names or nil parsers.
func New(customParsers ...parser.Parser) (*Registry, error) {
	r := &Registry{parsers: []parser.Parser{}}

	// getRegisteredNames returns comma-separated parser names, or "none" if empty.
	getRegisteredNames := func() string {
		if len(r.parsers) == 0 {
			return "none"
		}
		names := make([]string, 0, len(r.parsers))
		for _, p := range r.parsers {
			if p != nil {
				names = append(names, p.Name())
			} else {
				names = append(names, "<nil>")
			}
		}
		return strings.Join(names, ", ")
	}

	// Register built-in parsers
	if err := r.register(ofx.NewParser()); err != nil {
		return nil, fmt.Errorf("failed to register ofx parser - Successfully registered: %s: %w", getRegisteredNames(), err)
	}

	if err := r.register(csv.NewParser()); err != nil {
		return nil, fmt.Errorf("failed to register csv-pnc parser - Successfully registered: %s: %w", getRegisteredNames(), err)
	}

	// Register custom parsers
	for i, p := range customParsers {
		if err := r.register(p); err != nil {
			return nil, fmt.Errorf("failed to register custom parser %d of %d - Successfully registered: %s: %w",
				i+1, len(customParsers), getRegisteredNames(), err)
		}
	}

	return r, nil
}

// MustNew creates a registry with built-in parsers and optional custom parsers.
// Panics with detailed context (successfully registered parsers, failure point) if registration fails.
// This indicates a programmer error in parser initialization.
func MustNew(customParsers ...parser.Parser) *Registry {
	r, err := New(customParsers...)
	if err != nil {
		panic(fmt.Sprintf("failed to create parser registry: %+v\n\nThis is a programmer error - check your parser initialization.", err))
	}
	return r
}

// register adds a parser during registry construction (private).
func (r *Registry) register(p parser.Parser) error {
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
//
// Each parser's CanParse method receives the header and must validate it contains
// sufficient data for reliable format detection.
// TODO(#1320): Simplify comment to avoid duplicating implementation details from code
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

	// TODO(#1470): Enhance error message with file extension and available parsers list
	return nil, fmt.Errorf("no parser found for file: %s", path)
}

// readHeader reads up to 512 bytes for format detection.
// TODO(#1302): Consider making this a standalone function since it doesn't use receiver state
func (r *Registry) readHeader(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer func() {
		if err := f.Close(); err != nil {
			// Log close error for debugging (rare for read-only files, but can occur on network filesystems)
			// TODO(#1304): Add structured logging when project has logger infrastructure
			fmt.Fprintf(os.Stderr, "Warning: Failed to close file %s: %v\n", path, err)
		}
	}()

	// TODO(#1293): Consider more specific error messages for directory vs file vs permission issues
	header := make([]byte, 512)
	n, err := f.Read(header)
	if err != nil && err != io.EOF {
		return nil, fmt.Errorf("failed to read header from %s: %w", path, err)
	}
	// Return the header bytes read (may be less than 512 for small files).
	// Each parser's CanParse method must validate that the header contains
	// sufficient data for format detection, returning false if header is too small.
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
