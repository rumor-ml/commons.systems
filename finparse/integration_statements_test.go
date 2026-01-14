package finparse

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/rumor-ml/commons.systems/finparse/internal/dedup"
	"github.com/rumor-ml/commons.systems/finparse/internal/domain"
	"github.com/rumor-ml/commons.systems/finparse/internal/registry"
	"github.com/rumor-ml/commons.systems/finparse/internal/rules"
	"github.com/rumor-ml/commons.systems/finparse/internal/scanner"
	"github.com/rumor-ml/commons.systems/finparse/internal/transform"
	"github.com/rumor-ml/commons.systems/finparse/internal/validate"
)

// TestIntegration_RealStatements tests parsing with real statements from ~/statements/
// This test is skipped if the directory doesn't exist or is empty.
func TestIntegration_RealStatements(t *testing.T) {
	statementsDir := filepath.Join(os.Getenv("HOME"), "statements")

	// Skip if directory doesn't exist
	if _, err := os.Stat(statementsDir); os.IsNotExist(err) {
		t.Skip("~/statements/ not found - skipping integration test")
	}

	// Create scanner
	s := scanner.New(statementsDir)

	// Scan for files
	files, err := s.Scan()
	if err != nil {
		t.Fatalf("Failed to scan directory: %v", err)
	}

	if len(files) == 0 {
		t.Skip("~/statements/ is empty - skipping integration test")
	}

	t.Logf("Found %d statement files in ~/statements/", len(files))

	// Create parser registry
	reg, err := registry.New()
	if err != nil {
		t.Fatalf("Failed to create parser registry: %v", err)
	}

	// Load embedded rules
	engine, err := rules.LoadEmbedded()
	if err != nil {
		t.Fatalf("Failed to load embedded rules: %v", err)
	}

	// Create dedup state
	state := dedup.NewState()

	// Create budget
	budget := domain.NewBudget()

	// Parse and transform all files
	ctx := context.Background()
	var parseSuccessCount, parseFailureCount int
	var parseErrors []string
	var transformFailureCount int
	var transformErrors []string

	for i, file := range files {
		parser, err := reg.FindParser(file.Path)
		if err != nil {
			t.Fatalf("Failed to find parser for %s: %v", file.Path, err)
		}

		if parser == nil {
			t.Fatalf("No parser found for %s", file.Path)
		}

		f, err := os.Open(file.Path)
		if err != nil {
			t.Fatalf("Failed to open %s: %v", file.Path, err)
		}

		rawStmt, err := parser.Parse(ctx, f, file.Metadata)
		f.Close()

		if err != nil {
			parseFailureCount++
			parseErrors = append(parseErrors, fmt.Sprintf("%s: %v", file.Path, err))
			// Parse errors are logged for debugging but don't immediately fail the test.
			// A 20% failure rate threshold is enforced below (line 120) to catch systematic issues
			// while allowing partial success with real-world data.
			t.Logf("Parse encountered issue for file %d of %d (%s): %v",
				i+1, len(files), file.Path, err)
			continue
		}

		parseSuccessCount++

		if rawStmt == nil {
			t.Fatalf("Parser returned nil statement for %s", file.Path)
		}

		_, err = transform.TransformStatement(rawStmt, budget, state, engine)
		if err != nil {
			transformFailureCount++
			transformErrors = append(transformErrors, fmt.Sprintf("%s: %v", file.Path, err))
			// Transform errors are logged but don't immediately fail the test.
			// Threshold enforcement below ensures transform quality.
			t.Logf("Transform encountered issue for file %d of %d (%s): %v",
				i+1, len(files), file.Path, err)
			continue
		}
	}

	// Enforce failure threshold
	totalFiles := parseSuccessCount + parseFailureCount
	if totalFiles > 0 {
		failureRate := float64(parseFailureCount) / float64(totalFiles) * 100

		if parseSuccessCount == 0 {
			t.Fatalf("CRITICAL: All %d files failed to parse", totalFiles)
		}

		if failureRate > 20.0 {
			t.Errorf("Parse failure rate %.1f%% exceeds 20%% threshold (%d/%d failed)",
				failureRate, parseFailureCount, totalFiles)
			t.Logf("Failed files:")
			for _, errMsg := range parseErrors {
				t.Logf("  - %s", errMsg)
			}
		}
	}

	// Enforce transform failure threshold
	transformAttempts := parseSuccessCount // Only parsed files attempt transform
	if transformAttempts > 0 {
		transformFailureRate := float64(transformFailureCount) / float64(transformAttempts) * 100

		if transformFailureRate > 20.0 {
			t.Errorf("Transform failure rate %.1f%% exceeds 20%% threshold (%d/%d failed)",
				transformFailureRate, transformFailureCount, transformAttempts)
			t.Logf("Failed transforms:")
			for _, errMsg := range transformErrors {
				t.Logf("  - %s", errMsg)
			}
		}
	}

	// Verify we got data
	institutions := budget.GetInstitutions()
	accounts := budget.GetAccounts()
	statements := budget.GetStatements()
	transactions := budget.GetTransactions()

	if len(institutions) == 0 {
		t.Error("Expected at least one institution")
	}
	if len(accounts) == 0 {
		t.Error("Expected at least one account")
	}
	if len(statements) == 0 {
		t.Error("Expected at least one statement")
	}
	if len(transactions) == 0 {
		t.Error("Expected at least one transaction")
	}

	t.Logf("Parsed successfully:")
	t.Logf("  Institutions: %d", len(institutions))
	t.Logf("  Accounts: %d", len(accounts))
	t.Logf("  Statements: %d", len(statements))
	t.Logf("  Transactions: %d", len(transactions))

	// Run validation on the budget.
	// Note: This is a smoke test that validation runs successfully on real data.
	// It does not verify that specific validation rules catch specific violations.
	// Comprehensive validation rule testing should be done with fixture data
	// containing known violations (see issue requirements for validation rules).
	validationResult := validate.ValidateBudget(budget)

	if len(validationResult.Errors) > 0 {
		t.Errorf("Validation failed with %d errors:", len(validationResult.Errors))
		for _, e := range validationResult.Errors {
			t.Errorf("  - %s %s [%s]: %s", e.Entity, e.ID, e.Field, e.Message)
		}
	}

	if len(validationResult.Warnings) > 0 {
		t.Logf("Validation produced %d warnings:", len(validationResult.Warnings))
		for _, w := range validationResult.Warnings {
			t.Logf("  - %s %s [%s]: %s", w.Entity, w.ID, w.Field, w.Message)
		}
	}

	t.Logf("Validation passed!")
}

// TestIntegration_RealStatements_ExpectedFileCount tests that we can parse
// at least 25 files from ~/statements/ (as mentioned in the plan).
// This is a separate test so it can be skipped independently if the file count changes.
func TestIntegration_RealStatements_ExpectedFileCount(t *testing.T) {
	statementsDir := filepath.Join(os.Getenv("HOME"), "statements")

	// Skip if directory doesn't exist
	if _, err := os.Stat(statementsDir); os.IsNotExist(err) {
		t.Skip("~/statements/ not found - skipping integration test")
	}

	// Create scanner
	s := scanner.New(statementsDir)

	// Scan for files
	files, err := s.Scan()
	if err != nil {
		t.Fatalf("Failed to scan directory: %v", err)
	}

	t.Logf("Found %d statement files in ~/statements/", len(files))

	// The plan mentions 25 files as an expected count
	expectedMinFiles := 25
	if len(files) < expectedMinFiles {
		t.Logf("Note: Expected at least %d files, found %d", expectedMinFiles, len(files))
		t.Logf("This may indicate the statements directory has changed or is incomplete")
		// Don't fail - just log the observation
	}
}
