package domain

// Category represents the budget category enum
type Category string

const (
	CategoryIncome         Category = "income"
	CategoryHousing        Category = "housing"
	CategoryUtilities      Category = "utilities"
	CategoryGroceries      Category = "groceries"
	CategoryDining         Category = "dining"
	CategoryTransportation Category = "transportation"
	CategoryHealthcare     Category = "healthcare"
	CategoryEntertainment  Category = "entertainment"
	CategoryShopping       Category = "shopping"
	CategoryTravel         Category = "travel"
	CategoryInvestment     Category = "investment"
	CategoryOther          Category = "other"
)

// AccountType represents the account type enum
type AccountType string

const (
	AccountTypeChecking   AccountType = "checking"
	AccountTypeSavings    AccountType = "savings"
	AccountTypeCredit     AccountType = "credit"
	AccountTypeInvestment AccountType = "investment"
)

// Transaction matches TypeScript Transaction interface
type Transaction struct {
	ID                  string   `json:"id"`
	Date                string   `json:"date"` // ISO format YYYY-MM-DD
	Description         string   `json:"description"`
	Amount              float64  `json:"amount"` // Positive=income, Negative=expense
	Category            Category `json:"category"`
	Redeemable          bool     `json:"redeemable"`
	Vacation            bool     `json:"vacation"`
	Transfer            bool     `json:"transfer"`
	RedemptionRate      float64  `json:"redemptionRate"`
	LinkedTransactionID *string  `json:"linkedTransactionId,omitempty"`
	StatementIDs        []string `json:"statementIds"`
}

// Statement matches TypeScript Statement interface
type Statement struct {
	ID             string   `json:"id"`
	AccountID      string   `json:"accountId"`
	StartDate      string   `json:"startDate"` // YYYY-MM-DD
	EndDate        string   `json:"endDate"`   // YYYY-MM-DD
	TransactionIDs []string `json:"transactionIds"`
}

// Account matches TypeScript Account interface
type Account struct {
	ID            string      `json:"id"`
	InstitutionID string      `json:"institutionId"`
	Name          string      `json:"name"`
	Type          AccountType `json:"type"`
}

// Institution matches TypeScript Institution interface
type Institution struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Budget is the root output structure (full JSON file)
type Budget struct {
	Institutions []Institution `json:"institutions"`
	Accounts     []Account     `json:"accounts"`
	Statements   []Statement   `json:"statements"`
	Transactions []Transaction `json:"transactions"`
}

// ValidateCategory checks if category is valid
func ValidateCategory(c Category) bool {
	validCategories := []Category{
		CategoryIncome, CategoryHousing, CategoryUtilities,
		CategoryGroceries, CategoryDining, CategoryTransportation,
		CategoryHealthcare, CategoryEntertainment, CategoryShopping,
		CategoryTravel, CategoryInvestment, CategoryOther,
	}
	for _, valid := range validCategories {
		if c == valid {
			return true
		}
	}
	return false
}

// ValidateAccountType checks if account type is valid
func ValidateAccountType(t AccountType) bool {
	return t == AccountTypeChecking ||
		t == AccountTypeSavings ||
		t == AccountTypeCredit ||
		t == AccountTypeInvestment
}
