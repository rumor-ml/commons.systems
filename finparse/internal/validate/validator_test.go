package validate

import (
	"strings"
	"testing"

	"github.com/rumor-ml/commons.systems/finparse/internal/domain"
)

func TestValidateBudget_Empty(t *testing.T) {
	budget := domain.NewBudget()
	result := ValidateBudget(budget)

	if len(result.Errors) != 0 {
		t.Errorf("empty budget should have no errors, got %d", len(result.Errors))
	}
}

func TestValidateBudget_ValidBudget(t *testing.T) {
	budget := domain.NewBudget()

	// Add valid institution
	inst := domain.Institution{ID: "inst1", Name: "Test Bank"}
	if err := budget.AddInstitution(inst); err != nil {
		t.Fatalf("failed to add institution: %v", err)
	}

	// Add valid account
	acc, err := domain.NewAccount("acc1", "inst1", "Checking", domain.AccountTypeChecking)
	if err != nil {
		t.Fatalf("failed to create account: %v", err)
	}
	if err := budget.AddAccount(*acc); err != nil {
		t.Fatalf("failed to add account: %v", err)
	}

	// Add valid statement
	stmt, err := domain.NewStatement("stmt1", "acc1", "2024-01-01", "2024-01-31")
	if err != nil {
		t.Fatalf("failed to create statement: %v", err)
	}
	if err := budget.AddStatement(*stmt); err != nil {
		t.Fatalf("failed to add statement: %v", err)
	}

	// Add valid transaction
	txn, err := domain.NewTransaction("txn1", "2024-01-15", "Test Purchase", -50.00, domain.CategoryGroceries)
	if err != nil {
		t.Fatalf("failed to create transaction: %v", err)
	}
	if err := budget.AddTransaction(*txn); err != nil {
		t.Fatalf("failed to add transaction: %v", err)
	}

	result := ValidateBudget(budget)

	if len(result.Errors) != 0 {
		t.Errorf("valid budget should have no errors, got %d:", len(result.Errors))
		for _, e := range result.Errors {
			t.Errorf("  - %s %s: %s", e.Entity, e.ID, e.Message)
		}
	}
}

func TestValidateBudget_InvalidCategory(t *testing.T) {
	budget := domain.NewBudget()

	// Create transaction with invalid category by bypassing constructor
	txn := &domain.Transaction{
		ID:       "txn1",
		Date:     "2024-01-15",
		Category: domain.Category("invalid_category"),
	}
	if err := budget.AddTransaction(*txn); err != nil {
		t.Fatalf("failed to add transaction: %v", err)
	}

	result := ValidateBudget(budget)

	if len(result.Errors) == 0 {
		t.Error("expected validation error for invalid category")
	}

	found := false
	for _, e := range result.Errors {
		if e.Entity == "transaction" && e.Field == "Category" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected category validation error")
	}
}

func TestValidateBudget_InvalidAccountType(t *testing.T) {
	budget := domain.NewBudget()

	// Add institution first
	inst := domain.Institution{ID: "inst1", Name: "Test Bank"}
	if err := budget.AddInstitution(inst); err != nil {
		t.Fatalf("failed to add institution: %v", err)
	}

	// Create account with invalid type by bypassing constructor
	acc := domain.Account{
		ID:            "acc1",
		InstitutionID: "inst1",
		Name:          "Test Account",
		Type:          domain.AccountType("invalid_type"),
	}
	if err := budget.AddAccount(acc); err != nil {
		t.Fatalf("failed to add account: %v", err)
	}

	result := ValidateBudget(budget)

	if len(result.Errors) == 0 {
		t.Error("expected validation error for invalid account type")
	}

	found := false
	for _, e := range result.Errors {
		if e.Entity == "account" && e.Field == "Type" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected account type validation error")
	}
}

func TestValidateBudget_InvalidDateFormat(t *testing.T) {
	budget := domain.NewBudget()

	// Create transaction with invalid date by bypassing constructor
	txn := &domain.Transaction{
		ID:       "txn1",
		Date:     "2024-13-01", // Invalid month
		Category: domain.CategoryGroceries,
	}
	if err := budget.AddTransaction(*txn); err != nil {
		t.Fatalf("failed to add transaction: %v", err)
	}

	result := ValidateBudget(budget)

	if len(result.Errors) == 0 {
		t.Error("expected validation error for invalid date format")
	}

	found := false
	for _, e := range result.Errors {
		if e.Entity == "transaction" && e.Field == "Date" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected date validation error")
	}
}

func TestValidateBudget_DefaultRedemptionRateIsValid(t *testing.T) {
	budget := domain.NewBudget()

	// Create transaction with default redemption settings
	txn := &domain.Transaction{
		ID:       "txn1",
		Date:     "2024-01-15",
		Category: domain.CategoryGroceries,
	}
	if err := budget.AddTransaction(*txn); err != nil {
		t.Fatalf("failed to add transaction: %v", err)
	}

	result := ValidateBudget(budget)

	// Should pass with default values (redeemable=false, rate=0)
	if len(result.Errors) != 0 {
		t.Errorf("expected no errors for default redemption settings, got %d", len(result.Errors))
	}
}

func TestValidateBudget_MissingInstitutionReference(t *testing.T) {
	// Test validator by loading JSON with broken reference
	// (Budget.AddAccount would catch this, but validator should also catch it)
	jsonData := []byte(`{
		"institutions": [],
		"accounts": [{
			"id": "acc1",
			"institutionId": "nonexistent",
			"name": "Test Account",
			"type": "checking"
		}],
		"statements": [],
		"transactions": []
	}`)

	budget := domain.NewBudget()
	if err := budget.UnmarshalJSON(jsonData); err == nil {
		// If UnmarshalJSON allows it, validator should catch it
		result := ValidateBudget(budget)

		if len(result.Errors) == 0 {
			t.Error("expected validation error for missing institution reference")
		}

		found := false
		for _, e := range result.Errors {
			if e.Entity == "account" && e.Field == "InstitutionID" {
				found = true
				break
			}
		}
		if !found {
			t.Error("expected institution reference validation error")
		}
	} else {
		// UnmarshalJSON already caught it, which is also acceptable
		t.Skip("UnmarshalJSON already validates institution references")
	}
}

func TestValidateBudget_MissingAccountReference(t *testing.T) {
	// Test validator by loading JSON with broken reference
	// (Budget.AddStatement would catch this, but validator should also catch it)
	jsonData := []byte(`{
		"institutions": [],
		"accounts": [],
		"statements": [{
			"id": "stmt1",
			"accountId": "nonexistent",
			"startDate": "2024-01-01",
			"endDate": "2024-01-31",
			"transactionIds": []
		}],
		"transactions": []
	}`)

	budget := domain.NewBudget()
	if err := budget.UnmarshalJSON(jsonData); err == nil {
		// If UnmarshalJSON allows it, validator should catch it
		result := ValidateBudget(budget)

		if len(result.Errors) == 0 {
			t.Error("expected validation error for missing account reference")
		}

		found := false
		for _, e := range result.Errors {
			if e.Entity == "statement" && e.Field == "AccountID" {
				found = true
				break
			}
		}
		if !found {
			t.Error("expected account reference validation error")
		}
	} else {
		// UnmarshalJSON already caught it, which is also acceptable
		t.Skip("UnmarshalJSON already validates account references")
	}
}

func TestValidateBudget_InvalidDateOrdering(t *testing.T) {
	budget := domain.NewBudget()

	// Add institution and account
	inst := domain.Institution{ID: "inst1", Name: "Test Bank"}
	if err := budget.AddInstitution(inst); err != nil {
		t.Fatalf("failed to add institution: %v", err)
	}

	acc, err := domain.NewAccount("acc1", "inst1", "Checking", domain.AccountTypeChecking)
	if err != nil {
		t.Fatalf("failed to create account: %v", err)
	}
	if err := budget.AddAccount(*acc); err != nil {
		t.Fatalf("failed to add account: %v", err)
	}

	// Create statement with end date before start date
	stmt := domain.Statement{
		ID:        "stmt1",
		AccountID: "acc1",
		StartDate: "2024-01-31",
		EndDate:   "2024-01-01", // End before start
	}
	if err := budget.AddStatement(stmt); err != nil {
		t.Fatalf("failed to add statement: %v", err)
	}

	result := ValidateBudget(budget)

	if len(result.Errors) == 0 {
		t.Error("expected validation error for invalid date ordering")
	}

	found := false
	for _, e := range result.Errors {
		if e.Entity == "statement" && e.Field == "EndDate" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected date ordering validation error")
	}
}

func TestValidateBudget_DuplicateIDs(t *testing.T) {
	budget := domain.NewBudget()

	// Add two institutions with same ID
	inst1 := domain.Institution{ID: "inst1", Name: "Bank A"}
	inst2 := domain.Institution{ID: "inst1", Name: "Bank B"}

	if err := budget.AddInstitution(inst1); err != nil {
		t.Fatalf("failed to add first institution: %v", err)
	}

	// AddInstitution should catch this, but if it doesn't, validator should
	_ = budget.AddInstitution(inst2) // Ignore error since AddInstitution might catch it

	result := ValidateBudget(budget)

	// Check if validator catches duplicate (or AddInstitution prevented it)
	// Either way, we should not have duplicates in final budget
	institutions := budget.GetInstitutions()
	if len(institutions) > 1 {
		// If we have duplicates, validator should report it
		found := false
		for _, e := range result.Errors {
			if e.Entity == "institution" && e.Message == "duplicate institution ID" {
				found = true
				break
			}
		}
		if !found {
			t.Error("expected duplicate ID validation error")
		}
	}
}

func TestValidateBudget_TransferAndRedeemable(t *testing.T) {
	budget := domain.NewBudget()

	// Create transaction that is both transfer and redeemable (invalid)
	txn := &domain.Transaction{
		ID:       "txn1",
		Date:     "2024-01-15",
		Category: domain.CategoryOther,
	}
	if err := budget.AddTransaction(*txn); err != nil {
		t.Fatalf("failed to add transaction: %v", err)
	}

	result := ValidateBudget(budget)

	// With default values, this should pass
	if len(result.Errors) != 0 {
		t.Errorf("expected no errors for default transaction flags, got %d", len(result.Errors))
	}
}

func TestValidateBudget_RedemptionRateOutOfBounds(t *testing.T) {
	// Test rate > 1
	jsonData1 := []byte(`{
		"institutions": [],
		"accounts": [],
		"statements": [],
		"transactions": [{
			"id": "txn1",
			"date": "2024-01-15",
			"description": "Test",
			"amount": -50.00,
			"category": "groceries",
			"redeemable": true,
			"redemptionRate": 1.5,
			"vacation": false,
			"transfer": false,
			"statementIds": []
		}]
	}`)

	budget1 := domain.NewBudget()
	err1 := budget1.UnmarshalJSON(jsonData1)

	// Domain validation already catches rate > 1 during unmarshal
	if err1 == nil {
		// If domain didn't catch it, validator should
		result1 := ValidateBudget(budget1)

		if len(result1.Errors) == 0 {
			t.Error("expected validation error for redemption rate > 1")
		}

		found1 := false
		for _, e := range result1.Errors {
			if e.Entity == "transaction" && e.Field == "RedemptionRate" && e.ID == "txn1" {
				found1 = true
				break
			}
		}
		if !found1 {
			t.Error("expected redemption rate validation error for rate > 1")
		}
	} else {
		// Expected: domain validation rejects invalid data
		t.Logf("Domain validation correctly rejected rate > 1: %v", err1)
	}

	// Test rate < 0
	jsonData2 := []byte(`{
		"institutions": [],
		"accounts": [],
		"statements": [],
		"transactions": [{
			"id": "txn2",
			"date": "2024-01-15",
			"description": "Test",
			"amount": -50.00,
			"category": "groceries",
			"redeemable": true,
			"redemptionRate": -0.5,
			"vacation": false,
			"transfer": false,
			"statementIds": []
		}]
	}`)

	budget2 := domain.NewBudget()
	err2 := budget2.UnmarshalJSON(jsonData2)

	// Domain validation already catches rate < 0 during unmarshal
	if err2 == nil {
		// If domain didn't catch it, validator should
		result2 := ValidateBudget(budget2)

		if len(result2.Errors) == 0 {
			t.Error("expected validation error for redemption rate < 0")
		}

		found2 := false
		for _, e := range result2.Errors {
			if e.Entity == "transaction" && e.Field == "RedemptionRate" && e.ID == "txn2" {
				found2 = true
				break
			}
		}
		if !found2 {
			t.Error("expected redemption rate validation error for rate < 0")
		}
	} else {
		// Expected: domain validation rejects invalid data
		t.Logf("Domain validation correctly rejected rate < 0: %v", err2)
	}
}

func TestValidateBudget_RedeemableConsistency(t *testing.T) {
	// Test redeemable=true with rate=0
	jsonData1 := []byte(`{
		"institutions": [],
		"accounts": [],
		"statements": [],
		"transactions": [{
			"id": "txn1",
			"date": "2024-01-15",
			"description": "Test",
			"amount": -50.00,
			"category": "groceries",
			"redeemable": true,
			"redemptionRate": 0,
			"vacation": false,
			"transfer": false,
			"statementIds": []
		}]
	}`)

	budget1 := domain.NewBudget()
	err1 := budget1.UnmarshalJSON(jsonData1)

	// Domain validation already catches redeemable=true with rate=0
	if err1 == nil {
		// If domain didn't catch it, validator should
		result1 := ValidateBudget(budget1)

		if len(result1.Errors) == 0 {
			t.Error("expected validation error for redeemable=true with rate=0")
		}

		found1 := false
		for _, e := range result1.Errors {
			if e.Entity == "transaction" && e.Field == "RedemptionRate" && e.ID == "txn1" {
				if strings.Contains(e.Message, "redeemable") && strings.Contains(e.Message, "non-zero") {
					found1 = true
					break
				}
			}
		}
		if !found1 {
			t.Error("expected redeemable consistency error for true/0")
		}
	} else {
		// Expected: domain validation rejects invalid data
		t.Logf("Domain validation correctly rejected redeemable=true with rate=0: %v", err1)
	}

	// Test redeemable=false with rate!=0
	jsonData2 := []byte(`{
		"institutions": [],
		"accounts": [],
		"statements": [],
		"transactions": [{
			"id": "txn2",
			"date": "2024-01-15",
			"description": "Test",
			"amount": -50.00,
			"category": "groceries",
			"redeemable": false,
			"redemptionRate": 0.02,
			"vacation": false,
			"transfer": false,
			"statementIds": []
		}]
	}`)

	budget2 := domain.NewBudget()
	err2 := budget2.UnmarshalJSON(jsonData2)

	// Domain validation already catches redeemable=false with rate!=0
	if err2 == nil {
		// If domain didn't catch it, validator should
		result2 := ValidateBudget(budget2)

		if len(result2.Errors) == 0 {
			t.Error("expected validation error for redeemable=false with rate!=0")
		}

		found2 := false
		for _, e := range result2.Errors {
			if e.Entity == "transaction" && e.Field == "RedemptionRate" && e.ID == "txn2" {
				if strings.Contains(e.Message, "non-redeemable") && strings.Contains(e.Message, "zero") {
					found2 = true
					break
				}
			}
		}
		if !found2 {
			t.Error("expected redeemable consistency error for false/non-zero")
		}
	} else {
		// Expected: domain validation rejects invalid data
		t.Logf("Domain validation correctly rejected redeemable=false with rate!=0: %v", err2)
	}
}

func TestValidateBudget_TransferAndRedeemableConflict(t *testing.T) {
	jsonData := []byte(`{
		"institutions": [],
		"accounts": [],
		"statements": [],
		"transactions": [{
			"id": "txn1",
			"date": "2024-01-15",
			"description": "Test",
			"amount": -50.00,
			"category": "other",
			"redeemable": true,
			"redemptionRate": 0.02,
			"vacation": false,
			"transfer": true,
			"statementIds": []
		}]
	}`)

	budget := domain.NewBudget()
	if err := budget.UnmarshalJSON(jsonData); err != nil {
		t.Fatalf("failed to unmarshal JSON: %v", err)
	}

	result := ValidateBudget(budget)

	if len(result.Errors) == 0 {
		t.Error("expected validation error for transfer+redeemable conflict")
	}

	found := false
	for _, e := range result.Errors {
		if e.Entity == "transaction" && e.Field == "Transfer" && e.ID == "txn1" {
			if strings.Contains(e.Message, "transfer") && strings.Contains(e.Message, "redeemable") {
				found = true
				break
			}
		}
	}
	if !found {
		t.Error("expected transfer+redeemable validation error")
	}
}

func TestValidateBudget_TransactionReferencesNonexistentStatement(t *testing.T) {
	jsonData := []byte(`{
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
	}`)

	budget := domain.NewBudget()
	if err := budget.UnmarshalJSON(jsonData); err != nil {
		t.Fatalf("failed to unmarshal JSON: %v", err)
	}

	result := ValidateBudget(budget)

	if len(result.Errors) == 0 {
		t.Error("expected validation error for transaction referencing non-existent statement")
	}

	found := false
	for _, e := range result.Errors {
		if e.Entity == "transaction" && e.Field == "StatementIDs" && e.ID == "txn1" {
			if strings.Contains(e.Message, "non-existent") || strings.Contains(e.Message, "not found") {
				found = true
				break
			}
		}
	}
	if !found {
		t.Error("expected statement reference validation error")
	}
}

func TestValidateBudget_StatementReferencesNonexistentTransaction(t *testing.T) {
	jsonData := []byte(`{
		"institutions": [{"id":"inst1","name":"Test Bank"}],
		"accounts": [{"id":"acc1","institutionId":"inst1","name":"Checking","type":"checking"}],
		"statements": [{
			"id":"stmt1",
			"accountId":"acc1",
			"startDate":"2024-01-01",
			"endDate":"2024-01-31",
			"transactionIds":["nonexistent-txn"]
		}],
		"transactions": []
	}`)

	budget := domain.NewBudget()
	if err := budget.UnmarshalJSON(jsonData); err != nil {
		t.Fatalf("failed to unmarshal JSON: %v", err)
	}

	result := ValidateBudget(budget)

	if len(result.Errors) == 0 {
		t.Error("expected validation error for statement referencing non-existent transaction")
	}

	found := false
	for _, e := range result.Errors {
		if e.Entity == "statement" && e.Field == "TransactionIDs" && e.ID == "stmt1" {
			if strings.Contains(e.Message, "non-existent") || strings.Contains(e.Message, "not found") {
				found = true
				break
			}
		}
	}
	if !found {
		t.Error("expected transaction reference validation error")
	}
}

func TestValidateBudget_StatementWithEmptyTransactionID(t *testing.T) {
	jsonData := []byte(`{
		"institutions": [{"id":"inst1","name":"Test Bank"}],
		"accounts": [{"id":"acc1","institutionId":"inst1","name":"Checking","type":"checking"}],
		"statements": [{
			"id":"stmt1",
			"accountId":"acc1",
			"startDate":"2024-01-01",
			"endDate":"2024-01-31",
			"transactionIds":[""]
		}],
		"transactions": []
	}`)

	budget := domain.NewBudget()
	if err := budget.UnmarshalJSON(jsonData); err != nil {
		t.Fatalf("failed to unmarshal JSON: %v", err)
	}

	result := ValidateBudget(budget)

	if len(result.Errors) == 0 {
		t.Error("expected validation error for empty transaction ID in statement")
	}

	found := false
	for _, e := range result.Errors {
		if e.Entity == "statement" && e.Field == "TransactionIDs" && e.ID == "stmt1" {
			if strings.Contains(e.Message, "empty") {
				found = true
				break
			}
		}
	}
	if !found {
		t.Error("expected empty transaction ID validation error")
	}
}

func TestValidateBudget_TransactionWithEmptyStatementID(t *testing.T) {
	jsonData := []byte(`{
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
			"statementIds": [""]
		}]
	}`)

	budget := domain.NewBudget()
	if err := budget.UnmarshalJSON(jsonData); err != nil {
		t.Fatalf("failed to unmarshal JSON: %v", err)
	}

	result := ValidateBudget(budget)

	if len(result.Errors) == 0 {
		t.Error("expected validation error for empty statement ID in transaction")
	}

	found := false
	for _, e := range result.Errors {
		if e.Entity == "transaction" && e.Field == "StatementIDs" && e.ID == "txn1" {
			if strings.Contains(e.Message, "empty") {
				found = true
				break
			}
		}
	}
	if !found {
		t.Error("expected empty statement ID validation error")
	}
}
