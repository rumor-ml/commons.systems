package domain

import "testing"

func TestValidateCategory(t *testing.T) {
	t.Run("valid categories", func(t *testing.T) {
		validCategories := []Category{
			CategoryIncome,
			CategoryHousing,
			CategoryUtilities,
			CategoryGroceries,
			CategoryDining,
			CategoryTransportation,
			CategoryHealthcare,
			CategoryEntertainment,
			CategoryShopping,
			CategoryTravel,
			CategoryInvestment,
			CategoryOther,
		}

		for _, cat := range validCategories {
			if !ValidateCategory(cat) {
				t.Errorf("Expected %s to be valid", cat)
			}
		}
	})

	t.Run("invalid categories", func(t *testing.T) {
		invalidCases := []Category{
			"invalid",
			"INCOME",      // wrong case
			"",            // empty
			"dinning",     // typo
			"credit_card", // wrong type
			"Income",      // wrong case
			"shopping ",   // trailing space
			" shopping",   // leading space
		}

		for _, cat := range invalidCases {
			if ValidateCategory(cat) {
				t.Errorf("Expected %s to be invalid", cat)
			}
		}
	})
}

func TestValidateAccountType(t *testing.T) {
	t.Run("valid account types", func(t *testing.T) {
		validTypes := []AccountType{
			AccountTypeChecking,
			AccountTypeSavings,
			AccountTypeCredit,
			AccountTypeInvestment,
		}

		for _, typ := range validTypes {
			if !ValidateAccountType(typ) {
				t.Errorf("Expected %s to be valid", typ)
			}
		}
	})

	t.Run("invalid account types", func(t *testing.T) {
		invalidCases := []AccountType{
			"credit_card", // wrong format
			"",            // empty
			"CHECKING",    // wrong case
			"Checking",    // wrong case
			"saving",      // typo
			"investments", // plural
			"checking ",   // trailing space
			" checking",   // leading space
		}

		for _, typ := range invalidCases {
			if ValidateAccountType(typ) {
				t.Errorf("Expected %s to be invalid", typ)
			}
		}
	})
}

func TestNewTransaction_Validation(t *testing.T) {
	t.Run("empty ID", func(t *testing.T) {
		_, err := NewTransaction("", "2024-01-01", "test", 100.0, CategoryIncome)
		if err == nil {
			t.Error("Expected error for empty ID")
		}
		if err != nil && err.Error() != "transaction ID cannot be empty" {
			t.Errorf("Expected 'transaction ID cannot be empty', got '%s'", err.Error())
		}
	})

	t.Run("invalid date format", func(t *testing.T) {
		invalidDates := []string{
			"2024-13-01", // invalid month
			"2024-01-32", // invalid day
			"01-01-2024", // wrong format
			"2024/01/01", // wrong separator
			"invalid",    // not a date
			"",           // empty
		}

		for _, date := range invalidDates {
			_, err := NewTransaction("tx1", date, "test", 100.0, CategoryIncome)
			if err == nil {
				t.Errorf("Expected error for invalid date format: %s", date)
			}
		}
	})

	t.Run("empty description", func(t *testing.T) {
		_, err := NewTransaction("tx1", "2024-01-01", "", 100.0, CategoryIncome)
		if err == nil {
			t.Error("Expected error for empty description")
		}
		if err != nil && err.Error() != "description cannot be empty" {
			t.Errorf("Expected 'description cannot be empty', got '%s'", err.Error())
		}
	})

	t.Run("invalid category", func(t *testing.T) {
		invalidCategories := []Category{
			"invalid",
			"INCOME",
			"",
			"credit_card",
		}

		for _, cat := range invalidCategories {
			_, err := NewTransaction("tx1", "2024-01-01", "test", 100.0, cat)
			if err == nil {
				t.Errorf("Expected error for invalid category: %s", cat)
			}
		}
	})

	t.Run("valid transaction", func(t *testing.T) {
		tx, err := NewTransaction("tx1", "2024-01-15", "Test transaction", 100.0, CategoryIncome)
		if err != nil {
			t.Errorf("Expected no error, got %v", err)
		}
		if tx == nil {
			t.Error("Expected transaction, got nil")
		}
		if tx != nil {
			if tx.ID != "tx1" {
				t.Errorf("Expected ID 'tx1', got '%s'", tx.ID)
			}
			if tx.Date != "2024-01-15" {
				t.Errorf("Expected Date '2024-01-15', got '%s'", tx.Date)
			}
			if tx.Description != "Test transaction" {
				t.Errorf("Expected Description 'Test transaction', got '%s'", tx.Description)
			}
			if tx.Amount != 100.0 {
				t.Errorf("Expected Amount 100.0, got %f", tx.Amount)
			}
			if tx.Category != CategoryIncome {
				t.Errorf("Expected Category CategoryIncome, got %s", tx.Category)
			}
			if tx.GetStatementIDs() == nil {
				t.Error("Expected StatementIDs to be empty slice, not nil")
			}
			if len(tx.GetStatementIDs()) != 0 {
				t.Errorf("Expected StatementIDs length 0, got %d", len(tx.GetStatementIDs()))
			}
			if tx.RedemptionRate != 0.0 {
				t.Errorf("Expected RedemptionRate 0.0, got %f", tx.RedemptionRate)
			}
		}
	})
}

func TestSetRedemptionRate_Validation(t *testing.T) {
	t.Run("negative rate", func(t *testing.T) {
		tx, _ := NewTransaction("tx1", "2024-01-01", "test", 100.0, CategoryIncome)
		err := tx.SetRedemptionRate(-0.1)
		if err == nil {
			t.Error("Expected error for negative rate")
		}
	})

	t.Run("rate greater than 1", func(t *testing.T) {
		tx, _ := NewTransaction("tx1", "2024-01-01", "test", 100.0, CategoryIncome)
		err := tx.SetRedemptionRate(1.1)
		if err == nil {
			t.Error("Expected error for rate > 1")
		}
	})

	t.Run("valid rates", func(t *testing.T) {
		validRates := []float64{0.0, 0.5, 1.0, 0.25, 0.75}

		for _, rate := range validRates {
			tx, _ := NewTransaction("tx1", "2024-01-01", "test", 100.0, CategoryIncome)
			err := tx.SetRedemptionRate(rate)
			if err != nil {
				t.Errorf("Expected no error for rate %f, got %v", rate, err)
			}
			if tx.RedemptionRate != rate {
				t.Errorf("Expected RedemptionRate %f, got %f", rate, tx.RedemptionRate)
			}
		}
	})
}

func TestNewStatement_Validation(t *testing.T) {
	t.Run("empty ID", func(t *testing.T) {
		_, err := NewStatement("", "acc1", "2024-01-01", "2024-01-31")
		if err == nil {
			t.Error("Expected error for empty ID")
		}
		if err != nil && err.Error() != "statement ID cannot be empty" {
			t.Errorf("Expected 'statement ID cannot be empty', got '%s'", err.Error())
		}
	})

	t.Run("empty accountID", func(t *testing.T) {
		_, err := NewStatement("stmt1", "", "2024-01-01", "2024-01-31")
		if err == nil {
			t.Error("Expected error for empty accountID")
		}
		if err != nil && err.Error() != "account ID cannot be empty" {
			t.Errorf("Expected 'account ID cannot be empty', got '%s'", err.Error())
		}
	})

	t.Run("invalid start date", func(t *testing.T) {
		invalidDates := []string{
			"2024-13-01",
			"invalid",
			"",
		}

		for _, date := range invalidDates {
			_, err := NewStatement("stmt1", "acc1", date, "2024-01-31")
			if err == nil {
				t.Errorf("Expected error for invalid start date: %s", date)
			}
		}
	})

	t.Run("invalid end date", func(t *testing.T) {
		invalidDates := []string{
			"2024-13-01",
			"invalid",
			"",
		}

		for _, date := range invalidDates {
			_, err := NewStatement("stmt1", "acc1", "2024-01-01", date)
			if err == nil {
				t.Errorf("Expected error for invalid end date: %s", date)
			}
		}
	})

	t.Run("start date equals end date", func(t *testing.T) {
		_, err := NewStatement("stmt1", "acc1", "2024-01-15", "2024-01-15")
		if err == nil {
			t.Error("Expected error when start date equals end date")
		}
	})

	t.Run("start date after end date", func(t *testing.T) {
		_, err := NewStatement("stmt1", "acc1", "2024-01-31", "2024-01-01")
		if err == nil {
			t.Error("Expected error when start date after end date")
		}
	})

	t.Run("valid statement", func(t *testing.T) {
		stmt, err := NewStatement("stmt1", "acc1", "2024-01-01", "2024-01-31")
		if err != nil {
			t.Errorf("Expected no error, got %v", err)
		}
		if stmt == nil {
			t.Error("Expected statement, got nil")
		}
		if stmt != nil {
			if stmt.ID != "stmt1" {
				t.Errorf("Expected ID 'stmt1', got '%s'", stmt.ID)
			}
			if stmt.AccountID != "acc1" {
				t.Errorf("Expected AccountID 'acc1', got '%s'", stmt.AccountID)
			}
			if stmt.StartDate != "2024-01-01" {
				t.Errorf("Expected StartDate '2024-01-01', got '%s'", stmt.StartDate)
			}
			if stmt.EndDate != "2024-01-31" {
				t.Errorf("Expected EndDate '2024-01-31', got '%s'", stmt.EndDate)
			}
			if stmt.GetTransactionIDs() == nil {
				t.Error("Expected TransactionIDs to be empty slice, not nil")
			}
			if len(stmt.GetTransactionIDs()) != 0 {
				t.Errorf("Expected TransactionIDs length 0, got %d", len(stmt.GetTransactionIDs()))
			}
		}
	})
}

func TestNewAccount_Validation(t *testing.T) {
	t.Run("empty ID", func(t *testing.T) {
		_, err := NewAccount("", "inst1", "Checking Account", AccountTypeChecking)
		if err == nil {
			t.Error("Expected error for empty ID")
		}
		if err != nil && err.Error() != "account ID cannot be empty" {
			t.Errorf("Expected 'account ID cannot be empty', got '%s'", err.Error())
		}
	})

	t.Run("empty institutionID", func(t *testing.T) {
		_, err := NewAccount("acc1", "", "Checking Account", AccountTypeChecking)
		if err == nil {
			t.Error("Expected error for empty institutionID")
		}
		if err != nil && err.Error() != "institution ID cannot be empty" {
			t.Errorf("Expected 'institution ID cannot be empty', got '%s'", err.Error())
		}
	})

	t.Run("empty name", func(t *testing.T) {
		_, err := NewAccount("acc1", "inst1", "", AccountTypeChecking)
		if err == nil {
			t.Error("Expected error for empty name")
		}
		if err != nil && err.Error() != "account name cannot be empty" {
			t.Errorf("Expected 'account name cannot be empty', got '%s'", err.Error())
		}
	})

	t.Run("invalid account type", func(t *testing.T) {
		invalidTypes := []AccountType{
			"invalid",
			"CHECKING",
			"",
			"credit_card",
		}

		for _, typ := range invalidTypes {
			_, err := NewAccount("acc1", "inst1", "Test Account", typ)
			if err == nil {
				t.Errorf("Expected error for invalid account type: %s", typ)
			}
		}
	})

	t.Run("valid account", func(t *testing.T) {
		acc, err := NewAccount("acc1", "inst1", "Checking Account", AccountTypeChecking)
		if err != nil {
			t.Errorf("Expected no error, got %v", err)
		}
		if acc == nil {
			t.Error("Expected account, got nil")
		}
		if acc != nil {
			if acc.ID != "acc1" {
				t.Errorf("Expected ID 'acc1', got '%s'", acc.ID)
			}
			if acc.InstitutionID != "inst1" {
				t.Errorf("Expected InstitutionID 'inst1', got '%s'", acc.InstitutionID)
			}
			if acc.Name != "Checking Account" {
				t.Errorf("Expected Name 'Checking Account', got '%s'", acc.Name)
			}
			if acc.Type != AccountTypeChecking {
				t.Errorf("Expected Type AccountTypeChecking, got %s", acc.Type)
			}
		}
	})
}

func TestNewInstitution_Validation(t *testing.T) {
	t.Run("empty ID", func(t *testing.T) {
		_, err := NewInstitution("", "Test Bank")
		if err == nil {
			t.Error("Expected error for empty ID")
		}
		if err != nil && err.Error() != "institution ID cannot be empty" {
			t.Errorf("Expected 'institution ID cannot be empty', got '%s'", err.Error())
		}
	})

	t.Run("empty name", func(t *testing.T) {
		_, err := NewInstitution("inst1", "")
		if err == nil {
			t.Error("Expected error for empty name")
		}
		if err != nil && err.Error() != "institution name cannot be empty" {
			t.Errorf("Expected 'institution name cannot be empty', got '%s'", err.Error())
		}
	})

	t.Run("valid institution", func(t *testing.T) {
		inst, err := NewInstitution("inst1", "Test Bank")
		if err != nil {
			t.Errorf("Expected no error, got %v", err)
		}
		if inst == nil {
			t.Error("Expected institution, got nil")
		}
		if inst != nil {
			if inst.ID != "inst1" {
				t.Errorf("Expected ID 'inst1', got '%s'", inst.ID)
			}
			if inst.Name != "Test Bank" {
				t.Errorf("Expected Name 'Test Bank', got '%s'", inst.Name)
			}
		}
	})
}
