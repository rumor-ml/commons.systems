package scanner

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/rumor-ml/commons.systems/finparse/internal/parser"
)

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

	// Expand ~ to home directory
	rootDir := s.expandHome(s.rootDir)

	// Walk directory tree
	err := filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
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
		metadata := s.extractMetadata(path, rootDir)

		results = append(results, ScanResult{
			Path:     path,
			Metadata: metadata,
		})

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
func (s *Scanner) extractMetadata(filePath, rootDir string) parser.Metadata {
	// Get relative path from root
	relPath, err := filepath.Rel(rootDir, filePath)
	if err != nil {
		relPath = filePath
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

	return meta
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

// looksLikePeriod checks if string looks like a date period (YYYY-MM)
func (s *Scanner) looksLikePeriod(str string) bool {
	// Simple check: starts with 4 digits
	return len(str) >= 7 && str[4] == '-'
}

// expandHome expands ~ to home directory
func (s *Scanner) expandHome(path string) string {
	if strings.HasPrefix(path, "~/") {
		home, _ := os.UserHomeDir()
		return filepath.Join(home, path[2:])
	}
	return path
}
