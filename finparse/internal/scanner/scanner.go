package scanner

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/rumor-ml/commons.systems/finparse/internal/parser"
)

// TODO(#1287): Consider removing vague comment about future unit tests

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
	Metadata *parser.Metadata
	Warnings []string // Metadata quality warnings
}

// NewScanResult creates a new ScanResult with validation
func NewScanResult(path string, metadata *parser.Metadata) (ScanResult, error) {
	if metadata == nil {
		return ScanResult{}, fmt.Errorf("metadata cannot be nil")
	}
	if path != metadata.FilePath() {
		return ScanResult{}, fmt.Errorf("path mismatch: %s != %s", path, metadata.FilePath())
	}

	result := ScanResult{
		Path:     path,
		Metadata: metadata,
		Warnings: []string{},
	}

	// Add warning if metadata incomplete
	if metadata.Institution() == "" || metadata.AccountNumber() == "" {
		result.Warnings = append(result.Warnings,
			fmt.Sprintf("incomplete metadata (institution: %q, account: %q) - verify directory structure",
				metadata.Institution(), metadata.AccountNumber()))
	}

	return result, nil
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

		// Create validated ScanResult
		result, err := NewScanResult(path, metadata)
		if err != nil {
			return fmt.Errorf("failed to create scan result for %s (processed %d files so far): %w", path, fileCount, err)
		}

		results = append(results, result)
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
func (s *Scanner) extractMetadata(filePath, rootDir string) (*parser.Metadata, error) {
	// Get relative path from root
	relPath, err := filepath.Rel(rootDir, filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to compute relative path for %s: %w", filePath, err)
	}

	// Split path into components
	parts := strings.Split(filepath.ToSlash(relPath), "/")

	// Create metadata with required fields
	meta, err := parser.NewMetadata(filePath, time.Now())
	if err != nil {
		return nil, fmt.Errorf("failed to create metadata for %s: %w", filePath, err)
	}

	// Extract institution (first directory)
	if len(parts) >= 2 {
		meta.SetInstitution(s.normalizeInstitutionName(parts[0]))
	}

	// Extract account number (second directory)
	if len(parts) >= 3 {
		meta.SetAccountNumber(parts[1])
	}

	// Extract period (third directory, if it looks like a date)
	if len(parts) >= 4 && s.looksLikePeriod(parts[2]) {
		meta.SetPeriod(parts[2])
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

// looksLikePeriod checks if string is a valid YYYY-MM period using time.Parse.
// Returns false for directory names like "backup-2024" or "test-data" to avoid
// misinterpreting them as statement periods.
func (s *Scanner) looksLikePeriod(str string) bool {
	// Must be exactly 7 characters for YYYY-MM format
	if len(str) != 7 {
		return false
	}
	// Try to parse as YYYY-MM
	_, err := time.Parse("2006-01", str)
	return err == nil
}

// expandHome expands ~ to home directory.
// Only supports ~/path format (current user's home).
// Does not support ~username/path (requires user lookup and potential security issues).
func (s *Scanner) expandHome(path string) (string, error) {
	// Handle ~/path
	if strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("failed to get home directory: %w", err)
		}
		return filepath.Join(home, path[2:]), nil
	}

	// Handle unsupported ~username/ format
	if strings.HasPrefix(path, "~") && len(path) > 1 && path[1] != '/' {
		return "", fmt.Errorf("unsupported path format: %s (use ~/path for current user's home directory)", path)
	}

	return path, nil
}
