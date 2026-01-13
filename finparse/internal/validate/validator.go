package validate

import (
	"fmt"
	"time"

	"github.com/rumor-ml/commons.systems/finparse/internal/domain"
)

// ValidationResult contains all validation errors and warnings for a budget
type ValidationResult struct {
	Errors   []ValidationError
	Warnings []ValidationWarning
}

// ValidationError represents a validation error
type ValidationError struct {
	Entity  string // "transaction", "statement", "account", "institution"
	ID      string
	Field   string
	Value   string
	Message string
}

// ValidationWarning represents a non-critical validation issue
type ValidationWarning struct {
	Entity  string
	ID      string
	Field   string
	Value   string
	Message string
}

// ValidateBudget performs comprehensive validation of a Budget,
// checking both individual entity constraints and referential integrity.
// Returns ValidationResult with all errors and warnings found.
func ValidateBudget(b *domain.Budget) *ValidationResult {
	result := &ValidationResult{
		Errors:   []ValidationError{},
		Warnings: []ValidationWarning{},
	}

	// Build lookup maps for referential integrity checks
	institutionIDs := make(map[string]bool)
	accountIDs := make(map[string]bool)
	statementIDs := make(map[string]bool)
	transactionIDs := make(map[string]bool)

	// Validate institutions
	for _, inst := range b.GetInstitutions() {
		if inst.ID == "" {
			result.Errors = append(result.Errors, ValidationError{
				Entity:  "institution",
				ID:      inst.ID,
				Field:   "ID",
				Value:   "",
				Message: "institution ID cannot be empty",
			})
		}
		if inst.Name == "" {
			result.Errors = append(result.Errors, ValidationError{
				Entity:  "institution",
				ID:      inst.ID,
				Field:   "Name",
				Value:   "",
				Message: "institution name cannot be empty",
			})
		}

		// Check for duplicate IDs
		if inst.ID != "" {
			if institutionIDs[inst.ID] {
				result.Errors = append(result.Errors, ValidationError{
					Entity:  "institution",
					ID:      inst.ID,
					Field:   "ID",
					Value:   inst.ID,
					Message: "duplicate institution ID",
				})
			}
			institutionIDs[inst.ID] = true
		}
	}

	// Validate accounts
	for _, acc := range b.GetAccounts() {
		if acc.ID == "" {
			result.Errors = append(result.Errors, ValidationError{
				Entity:  "account",
				ID:      acc.ID,
				Field:   "ID",
				Value:   "",
				Message: "account ID cannot be empty",
			})
		}
		if acc.Name == "" {
			result.Errors = append(result.Errors, ValidationError{
				Entity:  "account",
				ID:      acc.ID,
				Field:   "Name",
				Value:   "",
				Message: "account name cannot be empty",
			})
		}
		if acc.InstitutionID == "" {
			result.Errors = append(result.Errors, ValidationError{
				Entity:  "account",
				ID:      acc.ID,
				Field:   "InstitutionID",
				Value:   "",
				Message: "account institutionId cannot be empty",
			})
		}

		// Validate account type enum
		if !domain.ValidateAccountType(acc.Type) {
			result.Errors = append(result.Errors, ValidationError{
				Entity:  "account",
				ID:      acc.ID,
				Field:   "Type",
				Value:   string(acc.Type),
				Message: fmt.Sprintf("invalid account type: %s (must be checking, savings, credit, or investment)", acc.Type),
			})
		}

		// Check institution reference
		if acc.InstitutionID != "" && !institutionIDs[acc.InstitutionID] {
			result.Errors = append(result.Errors, ValidationError{
				Entity:  "account",
				ID:      acc.ID,
				Field:   "InstitutionID",
				Value:   acc.InstitutionID,
				Message: fmt.Sprintf("references non-existent institution: %s", acc.InstitutionID),
			})
		}

		// Check for duplicate IDs
		if acc.ID != "" {
			if accountIDs[acc.ID] {
				result.Errors = append(result.Errors, ValidationError{
					Entity:  "account",
					ID:      acc.ID,
					Field:   "ID",
					Value:   acc.ID,
					Message: "duplicate account ID",
				})
			}
			accountIDs[acc.ID] = true
		}
	}

	// Validate statements
	for _, stmt := range b.GetStatements() {
		if stmt.ID == "" {
			result.Errors = append(result.Errors, ValidationError{
				Entity:  "statement",
				ID:      stmt.ID,
				Field:   "ID",
				Value:   "",
				Message: "statement ID cannot be empty",
			})
		}
		if stmt.AccountID == "" {
			result.Errors = append(result.Errors, ValidationError{
				Entity:  "statement",
				ID:      stmt.ID,
				Field:   "AccountID",
				Value:   "",
				Message: "statement accountId cannot be empty",
			})
		}

		// Validate date formats
		if stmt.StartDate != "" {
			if _, err := time.Parse("2006-01-02", stmt.StartDate); err != nil {
				result.Errors = append(result.Errors, ValidationError{
					Entity:  "statement",
					ID:      stmt.ID,
					Field:   "StartDate",
					Value:   stmt.StartDate,
					Message: fmt.Sprintf("invalid date format (expected YYYY-MM-DD): %v", err),
				})
			}
		}

		if stmt.EndDate != "" {
			if _, err := time.Parse("2006-01-02", stmt.EndDate); err != nil {
				result.Errors = append(result.Errors, ValidationError{
					Entity:  "statement",
					ID:      stmt.ID,
					Field:   "EndDate",
					Value:   stmt.EndDate,
					Message: fmt.Sprintf("invalid date format (expected YYYY-MM-DD): %v", err),
				})
			}
		}

		// Validate date ordering (only if both dates are valid)
		if stmt.StartDate != "" && stmt.EndDate != "" {
			start, startErr := time.Parse("2006-01-02", stmt.StartDate)
			end, endErr := time.Parse("2006-01-02", stmt.EndDate)
			if startErr == nil && endErr == nil && end.Before(start) {
				result.Errors = append(result.Errors, ValidationError{
					Entity:  "statement",
					ID:      stmt.ID,
					Field:   "EndDate",
					Value:   stmt.EndDate,
					Message: fmt.Sprintf("end date %s is before start date %s", stmt.EndDate, stmt.StartDate),
				})
			}
		}

		// Check account reference
		if stmt.AccountID != "" && !accountIDs[stmt.AccountID] {
			result.Errors = append(result.Errors, ValidationError{
				Entity:  "statement",
				ID:      stmt.ID,
				Field:   "AccountID",
				Value:   stmt.AccountID,
				Message: fmt.Sprintf("references non-existent account: %s", stmt.AccountID),
			})
		}

		// Check for duplicate IDs
		if stmt.ID != "" {
			if statementIDs[stmt.ID] {
				result.Errors = append(result.Errors, ValidationError{
					Entity:  "statement",
					ID:      stmt.ID,
					Field:   "ID",
					Value:   stmt.ID,
					Message: "duplicate statement ID",
				})
			}
			statementIDs[stmt.ID] = true
		}

		// Validate transaction references (bidirectional check)
		for _, txnID := range stmt.GetTransactionIDs() {
			if txnID == "" {
				result.Errors = append(result.Errors, ValidationError{
					Entity:  "statement",
					ID:      stmt.ID,
					Field:   "TransactionIDs",
					Value:   "",
					Message: "statement contains empty transaction ID",
				})
			}
		}
	}

	// Validate transactions
	for _, txn := range b.GetTransactions() {
		if txn.ID == "" {
			result.Errors = append(result.Errors, ValidationError{
				Entity:  "transaction",
				ID:      txn.ID,
				Field:   "ID",
				Value:   "",
				Message: "transaction ID cannot be empty",
			})
		}

		// Validate date format
		if txn.Date != "" {
			if _, err := time.Parse("2006-01-02", txn.Date); err != nil {
				result.Errors = append(result.Errors, ValidationError{
					Entity:  "transaction",
					ID:      txn.ID,
					Field:   "Date",
					Value:   txn.Date,
					Message: fmt.Sprintf("invalid date format (expected YYYY-MM-DD): %v", err),
				})
			}
		}

		// Validate category enum
		if !domain.ValidateCategory(txn.Category) {
			result.Errors = append(result.Errors, ValidationError{
				Entity:  "transaction",
				ID:      txn.ID,
				Field:   "Category",
				Value:   string(txn.Category),
				Message: fmt.Sprintf("invalid category: %s", txn.Category),
			})
		}

		// Validate redemption rate
		if txn.RedemptionRate() < 0 || txn.RedemptionRate() > 1 {
			result.Errors = append(result.Errors, ValidationError{
				Entity:  "transaction",
				ID:      txn.ID,
				Field:   "RedemptionRate",
				Value:   fmt.Sprintf("%f", txn.RedemptionRate()),
				Message: fmt.Sprintf("redemption rate must be in [0,1], got %f", txn.RedemptionRate()),
			})
		}

		// Validate redeemable consistency
		if txn.Redeemable() && txn.RedemptionRate() == 0 {
			result.Errors = append(result.Errors, ValidationError{
				Entity:  "transaction",
				ID:      txn.ID,
				Field:   "RedemptionRate",
				Value:   "0",
				Message: "redeemable transaction must have non-zero redemption rate",
			})
		}
		if !txn.Redeemable() && txn.RedemptionRate() != 0 {
			result.Errors = append(result.Errors, ValidationError{
				Entity:  "transaction",
				ID:      txn.ID,
				Field:   "RedemptionRate",
				Value:   fmt.Sprintf("%f", txn.RedemptionRate()),
				Message: "non-redeemable transaction must have zero redemption rate",
			})
		}

		// Validate transfer and redeemable flags
		if txn.Transfer() && txn.Redeemable() {
			result.Errors = append(result.Errors, ValidationError{
				Entity:  "transaction",
				ID:      txn.ID,
				Field:   "Transfer",
				Value:   "true",
				Message: "transaction cannot be both transfer and redeemable (transfers should not earn cashback)",
			})
		}

		// Check for duplicate IDs
		if txn.ID != "" {
			if transactionIDs[txn.ID] {
				result.Errors = append(result.Errors, ValidationError{
					Entity:  "transaction",
					ID:      txn.ID,
					Field:   "ID",
					Value:   txn.ID,
					Message: "duplicate transaction ID",
				})
			}
			transactionIDs[txn.ID] = true
		}

		// Validate statement references (bidirectional check)
		for _, stmtID := range txn.GetStatementIDs() {
			if stmtID == "" {
				result.Errors = append(result.Errors, ValidationError{
					Entity:  "transaction",
					ID:      txn.ID,
					Field:   "StatementIDs",
					Value:   "",
					Message: "transaction contains empty statement ID",
				})
			}
			// Note: We defer checking if statementIDs exist until after we've built the complete map
		}
	}

	// Second pass: validate bidirectional references
	// Check that transaction.statementIds reference existing statements
	for _, txn := range b.GetTransactions() {
		for _, stmtID := range txn.GetStatementIDs() {
			if stmtID != "" && !statementIDs[stmtID] {
				result.Errors = append(result.Errors, ValidationError{
					Entity:  "transaction",
					ID:      txn.ID,
					Field:   "StatementIDs",
					Value:   stmtID,
					Message: fmt.Sprintf("references non-existent statement: %s", stmtID),
				})
			}
		}
	}

	// Check that statement.transactionIds reference existing transactions
	for _, stmt := range b.GetStatements() {
		for _, txnID := range stmt.GetTransactionIDs() {
			if txnID != "" && !transactionIDs[txnID] {
				result.Errors = append(result.Errors, ValidationError{
					Entity:  "statement",
					ID:      stmt.ID,
					Field:   "TransactionIDs",
					Value:   txnID,
					Message: fmt.Sprintf("references non-existent transaction: %s", txnID),
				})
			}
		}
	}

	return result
}
