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
