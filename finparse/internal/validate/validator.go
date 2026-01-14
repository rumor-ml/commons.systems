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

// addError appends a validation error to the result
func (r *ValidationResult) addError(entity, id, field, value, message string) {
	r.Errors = append(r.Errors, ValidationError{
		Entity:  entity,
		ID:      id,
		Field:   field,
		Value:   value,
		Message: message,
	})
}

// addWarning appends a validation warning to the result
func (r *ValidationResult) addWarning(entity, id, field, value, message string) {
	r.Warnings = append(r.Warnings, ValidationWarning{
		Entity:  entity,
		ID:      id,
		Field:   field,
		Value:   value,
		Message: message,
	})
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
	// Note: Empty budgets are valid (incremental parsing may start with no entities)
	// TODO: Type design improvements needed in separate PR:
	//   - Add EntityType enum to prevent "trasaction" typos
	//   - Make ValidationError/Warning fields private with constructors
	//   - Add convenience methods: HasErrors(), IsValid(), ErrorCount()
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
			result.addError("institution", inst.ID, "ID", "", "institution ID cannot be empty")
		}
		if inst.Name == "" {
			result.addError("institution", inst.ID, "Name", "", "institution name cannot be empty")
		}

		// Check for duplicate IDs
		if inst.ID != "" {
			if institutionIDs[inst.ID] {
				result.addError("institution", inst.ID, "ID", inst.ID, "duplicate institution ID")
			}
			institutionIDs[inst.ID] = true
		}
	}

	// Validate accounts
	for _, acc := range b.GetAccounts() {
		if acc.ID == "" {
			result.addError("account", acc.ID, "ID", "", "account ID cannot be empty")
		}
		if acc.Name == "" {
			result.addError("account", acc.ID, "Name", "", "account name cannot be empty")
		}
		if acc.InstitutionID == "" {
			result.addError("account", acc.ID, "InstitutionID", "", "account institutionId cannot be empty")
		}

		// Validate account type enum
		if !domain.ValidateAccountType(acc.Type) {
			result.addError("account", acc.ID, "Type", string(acc.Type),
				fmt.Sprintf("invalid account type: %s (must be checking, savings, credit, or investment)", acc.Type))
		}

		// Check institution reference
		if acc.InstitutionID != "" && !institutionIDs[acc.InstitutionID] {
			result.addError("account", acc.ID, "InstitutionID", acc.InstitutionID,
				fmt.Sprintf("references non-existent institution: %s", acc.InstitutionID))
		}

		// Check for duplicate IDs
		if acc.ID != "" {
			if accountIDs[acc.ID] {
				result.addError("account", acc.ID, "ID", acc.ID, "duplicate account ID")
			}
			accountIDs[acc.ID] = true
		}
	}

	// Validate statements
	for _, stmt := range b.GetStatements() {
		if stmt.ID == "" {
			result.addError("statement", stmt.ID, "ID", "", "statement ID cannot be empty")
		}
		if stmt.AccountID == "" {
			result.addError("statement", stmt.ID, "AccountID", "", "statement accountId cannot be empty")
		}

		// Validate date formats
		if stmt.StartDate != "" {
			if _, err := time.Parse("2006-01-02", stmt.StartDate); err != nil {
				result.addError("statement", stmt.ID, "StartDate", stmt.StartDate,
					fmt.Sprintf("invalid date format (expected YYYY-MM-DD): %v", err))
			}
		}

		if stmt.EndDate != "" {
			if _, err := time.Parse("2006-01-02", stmt.EndDate); err != nil {
				result.addError("statement", stmt.ID, "EndDate", stmt.EndDate,
					fmt.Sprintf("invalid date format (expected YYYY-MM-DD): %v", err))
			}
		}

		// Validate date ordering (only if both dates are valid)
		if stmt.StartDate != "" && stmt.EndDate != "" {
			start, startErr := time.Parse("2006-01-02", stmt.StartDate)
			end, endErr := time.Parse("2006-01-02", stmt.EndDate)
			if startErr == nil && endErr == nil && end.Before(start) {
				result.addError("statement", stmt.ID, "EndDate", stmt.EndDate,
					fmt.Sprintf("end date %s is before start date %s", stmt.EndDate, stmt.StartDate))
			}
		}

		// Check account reference
		if stmt.AccountID != "" && !accountIDs[stmt.AccountID] {
			result.addError("statement", stmt.ID, "AccountID", stmt.AccountID,
				fmt.Sprintf("references non-existent account: %s", stmt.AccountID))
		}

		// Check for duplicate IDs
		if stmt.ID != "" {
			if statementIDs[stmt.ID] {
				result.addError("statement", stmt.ID, "ID", stmt.ID, "duplicate statement ID")
			}
			statementIDs[stmt.ID] = true
		}

		// Validate transaction references (bidirectional check)
		for _, txnID := range stmt.GetTransactionIDs() {
			if txnID == "" {
				result.addError("statement", stmt.ID, "TransactionIDs", "", "statement contains empty transaction ID")
			}
		}
	}

	// Validate transactions
	for _, txn := range b.GetTransactions() {
		if txn.ID == "" {
			result.addError("transaction", txn.ID, "ID", "", "transaction ID cannot be empty")
		}

		// Validate date format
		if txn.Date != "" {
			if _, err := time.Parse("2006-01-02", txn.Date); err != nil {
				result.addError("transaction", txn.ID, "Date", txn.Date,
					fmt.Sprintf("invalid date format (expected YYYY-MM-DD): %v", err))
			}
		}

		// Validate category enum
		if !domain.ValidateCategory(txn.Category) {
			result.addError("transaction", txn.ID, "Category", string(txn.Category),
				fmt.Sprintf("invalid category: %s", txn.Category))
		}

		// Validate redemption rate
		if txn.RedemptionRate() < 0 || txn.RedemptionRate() > 1 {
			result.addError("transaction", txn.ID, "RedemptionRate", fmt.Sprintf("%f", txn.RedemptionRate()),
				fmt.Sprintf("redemption rate must be in [0,1], got %f", txn.RedemptionRate()))
		}

		// Validate redeemable consistency
		if txn.Redeemable() && txn.RedemptionRate() == 0 {
			result.addError("transaction", txn.ID, "RedemptionRate", "0",
				"redeemable transaction must have non-zero redemption rate")
		}
		if !txn.Redeemable() && txn.RedemptionRate() != 0 {
			result.addError("transaction", txn.ID, "RedemptionRate", fmt.Sprintf("%f", txn.RedemptionRate()),
				"non-redeemable transaction must have zero redemption rate")
		}

		// Validate transfer and redeemable flags
		if txn.Transfer() && txn.Redeemable() {
			result.addError("transaction", txn.ID, "Transfer", "true",
				"transaction cannot be both transfer and redeemable (transfers should not earn cashback)")
		}

		// Check for duplicate IDs
		if txn.ID != "" {
			if transactionIDs[txn.ID] {
				result.addError("transaction", txn.ID, "ID", txn.ID, "duplicate transaction ID")
			}
			transactionIDs[txn.ID] = true
		}

		// Validate statement references (bidirectional check)
		for _, stmtID := range txn.GetStatementIDs() {
			if stmtID == "" {
				result.addError("transaction", txn.ID, "StatementIDs", "", "transaction contains empty statement ID")
			}
			// Note: Statement ID validation deferred to second pass (line 388) because
			// bidirectional transaction↔statement references may appear in any order.
		}
	}

	// Second pass: validate bidirectional references
	// Check that transaction.statementIds reference existing statements
	for _, txn := range b.GetTransactions() {
		for _, stmtID := range txn.GetStatementIDs() {
			if stmtID != "" && !statementIDs[stmtID] {
				result.addError("transaction", txn.ID, "StatementIDs", stmtID,
					fmt.Sprintf("references non-existent statement: %s", stmtID))
			}
		}
	}

	// Check that statement.transactionIds reference existing transactions
	for _, stmt := range b.GetStatements() {
		for _, txnID := range stmt.GetTransactionIDs() {
			if txnID != "" && !transactionIDs[txnID] {
				result.addError("statement", stmt.ID, "TransactionIDs", txnID,
					fmt.Sprintf("references non-existent transaction: %s", txnID))
			}
		}
	}

	return result
}
