package scanner

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/rumor-ml/commons.systems/finparse/internal/parser"
)

// TODO(#1266): Consider adding unit tests for scanner and registry

// Scanner walks directory tree and finds statement files
type Scanner struct {
	rootDir string
}

// New creates a new scanner for the given root directory
func New(rootDir string) *Scanner {
	return &Scanner{rootDir: rootDir}
}

// ScanResult represents a found file with metadata
type ScanResult struct {
	Path     string
	Metadata parser.Metadata
}

// Scan walks the directory tree and finds all statement files
func (s *Scanner) Scan() ([]ScanResult, error) {
	var results []ScanResult
	fileCount := 0

	// Expand ~ to home directory
	rootDir, err := s.expandHome(s.rootDir)
	if err != nil {
		return nil, fmt.Errorf("failed to expand path: %w", err)
	}

	// Walk directory tree
	err = filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return fmt.Errorf("error accessing %s (processed %d files so far): %w", path, fileCount, err)
		}

		// Skip directories
		if info.IsDir() {
			return nil
		}

		// Only process files with known extensions
		if !s.isStatementFile(path) {
			return nil
		}

		// Extract metadata from path
		metadata, err := s.extractMetadata(path, rootDir)
		if err != nil {
			return fmt.Errorf("metadata extraction failed at %s (processed %d files so far): %w", path, fileCount, err)
		}

		// Validate metadata
		if err := metadata.Validate(); err != nil {
			return fmt.Errorf("invalid metadata for %s (processed %d files so far): %w", path, fileCount, err)
		}

		results = append(results, ScanResult{
			Path:     path,
			Metadata: metadata,
		})
		fileCount++

		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("scan failed: %w", err)
	}

	return results, nil
}

// isStatementFile checks if file is a known statement format
func (s *Scanner) isStatementFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".qfx" || ext == ".ofx" || ext == ".csv"
}

// extractMetadata parses directory structure to extract institution/account info
// Path structure: {root}/{institution}/{account}/{period?}/file.ext
// Example: ~/statements/american_express/2011/2025-10/statement.qfx
// TODO(#1269): Return zero-value metadata on error instead of partial metadata
func (s *Scanner) extractMetadata(filePath, rootDir string) (parser.Metadata, error) {
	// Get relative path from root
	relPath, err := filepath.Rel(rootDir, filePath)
	if err != nil {
		return parser.Metadata{
			FilePath:   filePath,
			DetectedAt: time.Now(),
		}, fmt.Errorf("failed to compute relative path for %s: %w", filePath, err)
	}

	// Split path into components
	parts := strings.Split(filepath.ToSlash(relPath), "/")

	meta := parser.Metadata{
		FilePath:   filePath,
		DetectedAt: time.Now(),
	}

	// Extract institution (first directory)
	if len(parts) >= 2 {
		meta.Institution = s.normalizeInstitutionName(parts[0])
	}

	// Extract account number (second directory)
	if len(parts) >= 3 {
		meta.AccountNumber = parts[1]
	}

	// Extract period (third directory, if it looks like a date)
	if len(parts) >= 4 && s.looksLikePeriod(parts[2]) {
		meta.Period = parts[2]
	}

	return meta, nil
}

// normalizeInstitutionName converts directory name to readable name
// "american_express" -> "American Express"
// "capital_one" -> "Capital One"
func (s *Scanner) normalizeInstitutionName(dirName string) string {
	// Replace underscores with spaces
	name := strings.ReplaceAll(dirName, "_", " ")

	// Title case each word
	words := strings.Split(name, " ")
	for i, word := range words {
		if len(word) > 0 {
			words[i] = strings.ToUpper(word[:1]) + word[1:]
		}
	}

	return strings.Join(words, " ")
}

// looksLikePeriod checks if string might be a date period.
// Lenient check: length >= 7 with dash at position 4 (typical YYYY-MM format).
// Does not validate that characters are digits - relies on directory naming conventions.
func (s *Scanner) looksLikePeriod(str string) bool {
	return len(str) >= 7 && str[4] == '-'
}

// expandHome expands ~ to home directory
// TODO(#1267): Add validation of expanded path to provide better error messages
func (s *Scanner) expandHome(path string) (string, error) {
	if strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("failed to get home directory: %w", err)
		}
		return filepath.Join(home, path[2:]), nil
	}
	return path, nil
}
