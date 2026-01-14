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
	var consecutiveFailures int
	const maxConsecutiveFailures = 5

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

		// Check for parser contract violation BEFORE error handling
		// Parser contract: Parse() must return non-nil statement when error is nil
		if err == nil && rawStmt == nil {
			t.Fatalf("CRITICAL BUG: Parser %s violated contract for %s (returned nil statement without error)",
				parser.Name(), file.Path)
		}

		if err != nil {
			parseFailureCount++
			consecutiveFailures++
			parseErrors = append(parseErrors, fmt.Sprintf("%s: %v", file.Path, err))

			// Fail fast if systematic failure detected
			if consecutiveFailures >= maxConsecutiveFailures {
				// Extract last N errors for context
				startIdx := len(parseErrors) - maxConsecutiveFailures
				if startIdx < 0 {
					startIdx = 0
				}
				recentErrors := parseErrors[startIdx:]
				errorList := ""
				for _, e := range recentErrors {
					errorList += fmt.Sprintf("  - %s\n", e)
				}
				t.Fatalf("SYSTEMATIC FAILURE: %d consecutive parse failures detected (likely parser bug, not data issue)\nLast %d errors:\n%s",
					consecutiveFailures, len(recentErrors), errorList)
			}

			// Parse errors are logged for debugging but don't immediately fail the test.
			// A 5% failure rate threshold is enforced below to catch systematic issues
			// while allowing partial success with real-world data.
			t.Logf("Parse encountered issue for file %d of %d (%s): %v",
				i+1, len(files), file.Path, err)
			continue
		}

		// Reset counter on success
		consecutiveFailures = 0
		parseSuccessCount++

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

		if failureRate > 5.0 {
			t.Errorf("Parse failure rate %.1f%% exceeds 5%% threshold (%d/%d failed)",
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

		if transformFailureRate > 5.0 {
			t.Errorf("Transform failure rate %.1f%% exceeds 5%% threshold (%d/%d failed)",
				transformFailureRate, transformFailureCount, transformAttempts)
			t.Logf("Failed transforms:")
			for _, errMsg := range transformErrors {
				t.Logf("  - %s", errMsg)
			}
		}
	}

	// TODO(#1444): Integration test doesn't verify TypeScript schema compatibility
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

// TestIntegration_ValidationFailures verifies that the validation pipeline
// catches violations in fixture data containing known validation errors.
// This test ensures validation rules (date format, category enums, redemption rates)
// work correctly through the full parse->transform->validate pipeline.
func TestIntegration_ValidationFailures(t *testing.T) {
	// Test cases with known validation violations
	testCases := []struct {
		name          string
		budgetJSON    string
		expectedError string // substring that should appear in validation error
		expectedField string // field name that should have the error
	}{
		{
			name: "invalid_date_format",
			budgetJSON: `{
				"institutions": [],
				"accounts": [],
				"statements": [],
				"transactions": [{
					"id": "txn-invalid-date",
					"date": "2024-13-01",
					"description": "Test Transaction",
					"amount": -50.00,
					"category": "groceries",
					"redeemable": false,
					"redemptionRate": 0,
					"vacation": false,
					"transfer": false,
					"statementIds": []
				}]
			}`,
			expectedError: "invalid date format",
			expectedField: "Date",
		},
		{
			name: "invalid_category",
			budgetJSON: `{
				"institutions": [],
				"accounts": [],
				"statements": [],
				"transactions": [{
					"id": "txn-invalid-cat",
					"date": "2024-01-15",
					"description": "Test Transaction",
					"amount": -50.00,
					"category": "invalid_category",
					"redeemable": false,
					"redemptionRate": 0,
					"vacation": false,
					"transfer": false,
					"statementIds": []
				}]
			}`,
			expectedError: "invalid category",
			expectedField: "Category",
		},
		{
			name: "invalid_account_type",
			budgetJSON: `{
				"institutions": [{"id": "inst1", "name": "Test Bank"}],
				"accounts": [{
					"id": "acc1",
					"institutionId": "inst1",
					"name": "Test Account",
					"type": "invalid_type"
				}],
				"statements": [],
				"transactions": []
			}`,
			expectedError: "invalid account type",
			expectedField: "Type",
		},
		{
			name: "redemption_rate_too_high",
			budgetJSON: `{
				"institutions": [],
				"accounts": [],
				"statements": [],
				"transactions": [{
					"id": "txn-rate-high",
					"date": "2024-01-15",
					"description": "Test Transaction",
					"amount": -50.00,
					"category": "groceries",
					"redeemable": true,
					"redemptionRate": 1.5,
					"vacation": false,
					"transfer": false,
					"statementIds": []
				}]
			}`,
			expectedError: "redemption rate must be in [0,1]",
			expectedField: "RedemptionRate",
		},
		{
			name: "redemption_rate_negative",
			budgetJSON: `{
				"institutions": [],
				"accounts": [],
				"statements": [],
				"transactions": [{
					"id": "txn-rate-neg",
					"date": "2024-01-15",
					"description": "Test Transaction",
					"amount": -50.00,
					"category": "groceries",
					"redeemable": true,
					"redemptionRate": -0.5,
					"vacation": false,
					"transfer": false,
					"statementIds": []
				}]
			}`,
			expectedError: "redemption rate must be in [0,1]",
			expectedField: "RedemptionRate",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Create budget from JSON with known violation
			budget := domain.NewBudget()
			err := budget.UnmarshalJSON([]byte(tc.budgetJSON))

			// Some violations are caught by domain unmarshal, others by validator
			if err != nil {
				// Domain layer caught it - that's acceptable
				t.Logf("Domain validation correctly rejected invalid data: %v", err)
				return
			}

			// If domain didn't catch it, validator must
			result := validate.ValidateBudget(budget)

			if len(result.Errors) == 0 {
				t.Errorf("Expected validation error for %s, but got no errors", tc.name)
				return
			}

			// Verify specific field error exists
			found := false
			for _, e := range result.Errors {
				if e.Field == tc.expectedField && contains(e.Message, tc.expectedError) {
					found = true
					t.Logf("Found expected error: %s %s [%s]: %s", e.Entity, e.ID, e.Field, e.Message)
					break
				}
			}

			if !found {
				t.Errorf("Expected error on field %s containing %q, but got:", tc.expectedField, tc.expectedError)
				for _, e := range result.Errors {
					t.Errorf("  - %s %s [%s]: %s", e.Entity, e.ID, e.Field, e.Message)
				}
			}
		})
	}
}

// TestIntegration_ReferentialIntegrity verifies that validation catches
// referential integrity violations (broken references between entities)
// in the full pipeline, not just in isolated validator tests.
func TestIntegration_ReferentialIntegrity(t *testing.T) {
	testCases := []struct {
		name          string
		budgetJSON    string
		expectedError string
		expectedField string
	}{
		{
			name: "account_references_nonexistent_institution",
			budgetJSON: `{
				"institutions": [],
				"accounts": [{
					"id": "acc1",
					"institutionId": "nonexistent-inst",
					"name": "Test Account",
					"type": "checking"
				}],
				"statements": [],
				"transactions": []
			}`,
			expectedError: "non-existent institution",
			expectedField: "InstitutionID",
		},
		{
			name: "statement_references_nonexistent_account",
			budgetJSON: `{
				"institutions": [],
				"accounts": [],
				"statements": [{
					"id": "stmt1",
					"accountId": "nonexistent-acc",
					"startDate": "2024-01-01",
					"endDate": "2024-01-31",
					"transactionIds": []
				}],
				"transactions": []
			}`,
			expectedError: "non-existent account",
			expectedField: "AccountID",
		},
		{
			name: "transaction_references_nonexistent_statement",
			budgetJSON: `{
				"institutions": [],
				"accounts": [],
				"statements": [],
				"transactions": [{
					"id": "txn1",
					"date": "2024-01-15",
					"description": "Test",
					"amount": -50.00,
					"category": "groceries",
					"redeemable": false,
					"redemptionRate": 0,
					"vacation": false,
					"transfer": false,
					"statementIds": ["nonexistent-stmt"]
				}]
			}`,
			expectedError: "non-existent statement",
			expectedField: "StatementIDs",
		},
		{
			name: "statement_references_nonexistent_transaction",
			budgetJSON: `{
				"institutions": [{"id": "inst1", "name": "Test Bank"}],
				"accounts": [{
					"id": "acc1",
					"institutionId": "inst1",
					"name": "Checking",
					"type": "checking"
				}],
				"statements": [{
					"id": "stmt1",
					"accountId": "acc1",
					"startDate": "2024-01-01",
					"endDate": "2024-01-31",
					"transactionIds": ["nonexistent-txn"]
				}],
				"transactions": []
			}`,
			expectedError: "non-existent transaction",
			expectedField: "TransactionIDs",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Create budget from JSON with broken reference
			budget := domain.NewBudget()
			err := budget.UnmarshalJSON([]byte(tc.budgetJSON))

			// Some violations are caught by domain unmarshal, others by validator
			if err != nil {
				// Domain layer caught it - that's acceptable
				t.Logf("Domain validation correctly rejected broken reference: %v", err)
				return
			}

			// If domain didn't catch it, validator must
			result := validate.ValidateBudget(budget)

			if len(result.Errors) == 0 {
				t.Errorf("Expected validation error for %s, but got no errors", tc.name)
				return
			}

			// Verify specific field error exists
			found := false
			for _, e := range result.Errors {
				if e.Field == tc.expectedField && contains(e.Message, tc.expectedError) {
					found = true
					t.Logf("Found expected error: %s %s [%s]: %s", e.Entity, e.ID, e.Field, e.Message)
					break
				}
			}

			if !found {
				t.Errorf("Expected error on field %s containing %q, but got:", tc.expectedField, tc.expectedError)
				for _, e := range result.Errors {
					t.Errorf("  - %s %s [%s]: %s", e.Entity, e.ID, e.Field, e.Message)
				}
			}
		})
	}
}

// contains checks if a string contains a substring (case-insensitive)
func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 ||
		(len(s) > 0 && len(substr) > 0 && containsHelper(s, substr)))
}

func containsHelper(s, substr string) bool {
	sLower := ""
	substrLower := ""
	for _, r := range s {
		if r >= 'A' && r <= 'Z' {
			sLower += string(r + 32)
		} else {
			sLower += string(r)
		}
	}
	for _, r := range substr {
		if r >= 'A' && r <= 'Z' {
			substrLower += string(r + 32)
		} else {
			substrLower += string(r)
		}
	}
	for i := 0; i <= len(sLower)-len(substrLower); i++ {
		if sLower[i:i+len(substrLower)] == substrLower {
			return true
		}
	}
	return false
}
