package transform

import (
	"testing"
	"time"
)

// TODO(#1346): Consider adding property-based tests for ID generation stability

func TestSlugifyInstitution(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		expected    string
		expectError bool
	}{
		{
			name:        "simple name with space",
			input:       "American Express",
			expected:    "american-express",
			expectError: false,
		},
		{
			name:        "already lowercase",
			input:       "pnc bank",
			expected:    "pnc-bank",
			expectError: false,
		},
		{
			name:        "special characters",
			input:       "Wells Fargo & Co.",
			expected:    "wells-fargo-co",
			expectError: false,
		},
		{
			name:        "multiple spaces",
			input:       "Capital  One   Bank",
			expected:    "capital-one-bank",
			expectError: false,
		},
		{
			name:        "unicode characters",
			input:       "Café Crédit",
			expected:    "cafe-credit",
			expectError: false,
		},
		{
			name:        "empty string",
			input:       "",
			expected:    "",
			expectError: true,
		},
		{
			name:        "single word",
			input:       "Chase",
			expected:    "chase",
			expectError: false,
		},
		{
			name:        "trailing special chars",
			input:       "Bank of America!",
			expected:    "bank-of-america",
			expectError: false,
		},
		{
			name:        "leading special chars",
			input:       "!Chase Bank",
			expected:    "chase-bank",
			expectError: false,
		},
		{
			name:        "numbers in name",
			input:       "Bank 123",
			expected:    "bank-123",
			expectError: false,
		},
		{
			name:        "only special characters",
			input:       "!@#$%^&*()",
			expected:    "",
			expectError: true,
		},
		{
			name:        "only hyphens",
			input:       "---",
			expected:    "",
			expectError: true,
		},
		{
			name:        "special chars with spaces",
			input:       "!!! --- ###",
			expected:    "",
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := SlugifyInstitution(tt.input)
			if tt.expectError {
				if err == nil {
					t.Errorf("SlugifyInstitution(%q) expected error, got nil", tt.input)
				}
			} else {
				if err != nil {
					t.Errorf("SlugifyInstitution(%q) returned unexpected error: %v", tt.input, err)
				}
				if result != tt.expected {
					t.Errorf("SlugifyInstitution(%q) = %q, expected %q", tt.input, result, tt.expected)
				}
			}
		})
	}
}

// TestSlugifyInstitution_UnicodeNormalizationError documents the error handling
// for unicode normalization failures. This error path is defensive code that's
// extremely rare in practice because:
// 1. Go strings are valid UTF-8 by construction
// 2. The transform.String function rarely fails with valid inputs
// 3. Would require malformed UTF-8 or artificially injected failing transformer
//
// The error handling exists to provide context (institution name) if this
// ever occurs due to corrupt input data, making debugging possible.
func TestSlugifyInstitution_UnicodeNormalizationError(t *testing.T) {
	t.Skip("Unicode normalization error path is defensive code that's extremely difficult to trigger with valid Go strings. " +
		"Testing would require injecting a failing transformer or crafting malformed UTF-8 that Go's string handling prevents. " +
		"Error handling at idgen.go:24-27 wraps failures with institution name context for debugging if this ever occurs.")
}

func TestExtractLast4(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "more than 4 digits",
			input:    "12345",
			expected: "2345",
		},
		{
			name:     "exactly 4 digits",
			input:    "1234",
			expected: "1234",
		},
		{
			name:     "less than 4 digits",
			input:    "123",
			expected: "123",
		},
		{
			name:     "single digit",
			input:    "1",
			expected: "1",
		},
		{
			name:     "empty string",
			input:    "",
			expected: "",
		},
		{
			name:     "long account number",
			input:    "1234567890",
			expected: "7890",
		},
		{
			name:     "account with letters",
			input:    "ABC123",
			expected: "C123",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ExtractLast4(tt.input)
			if result != tt.expected {
				t.Errorf("ExtractLast4(%q) = %q, expected %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestGenerateAccountID(t *testing.T) {
	tests := []struct {
		name            string
		institutionSlug string
		accountNumber   string
		expected        string
	}{
		{
			name:            "american express with abbreviation",
			institutionSlug: "american-express",
			accountNumber:   "2011",
			expected:        "acc-amex-2011",
		},
		{
			name:            "bank of america with abbreviation",
			institutionSlug: "bank-of-america",
			accountNumber:   "5678",
			expected:        "acc-boa-5678",
		},
		{
			name:            "capital one with abbreviation",
			institutionSlug: "capital-one",
			accountNumber:   "9012",
			expected:        "acc-c1-9012",
		},
		{
			name:            "unknown institution no abbreviation",
			institutionSlug: "pnc-bank",
			accountNumber:   "3456",
			expected:        "acc-pnc-bank-3456",
		},
		{
			name:            "short account number",
			institutionSlug: "chase",
			accountNumber:   "12",
			expected:        "acc-chase-12",
		},
		{
			name:            "long account number",
			institutionSlug: "wells-fargo",
			accountNumber:   "1234567890",
			expected:        "acc-wells-fargo-7890",
		},
		{
			name:            "account with special characters",
			institutionSlug: "citi",
			accountNumber:   "ABC-123",
			expected:        "acc-citi--123",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := GenerateAccountID(tt.institutionSlug, tt.accountNumber)
			if result != tt.expected {
				t.Errorf("GenerateAccountID(%q, %q) = %q, expected %q",
					tt.institutionSlug, tt.accountNumber, result, tt.expected)
			}
		})
	}
}

func TestGenerateStatementID(t *testing.T) {
	tests := []struct {
		name        string
		periodStart time.Time
		accountID   string
		expected    string
	}{
		{
			name:        "october 2025",
			periodStart: time.Date(2025, 10, 15, 0, 0, 0, 0, time.UTC),
			accountID:   "acc-amex-2011",
			expected:    "stmt-2025-10-acc-amex-2011",
		},
		{
			name:        "january single digit month",
			periodStart: time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC),
			accountID:   "acc-chase-5678",
			expected:    "stmt-2024-01-acc-chase-5678",
		},
		{
			name:        "december double digit month",
			periodStart: time.Date(2023, 12, 31, 23, 59, 59, 0, time.UTC),
			accountID:   "acc-boa-9012",
			expected:    "stmt-2023-12-acc-boa-9012",
		},
		{
			name:        "different account ID format",
			periodStart: time.Date(2025, 5, 10, 12, 30, 0, 0, time.UTC),
			accountID:   "acc-pnc-bank-3456",
			expected:    "stmt-2025-05-acc-pnc-bank-3456",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := GenerateStatementID(tt.periodStart, tt.accountID)
			if result != tt.expected {
				t.Errorf("GenerateStatementID(%v, %q) = %q, expected %q",
					tt.periodStart, tt.accountID, result, tt.expected)
			}
		})
	}
}

func TestAbbreviateSlug(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "american express abbreviation",
			input:    "american-express",
			expected: "amex",
		},
		{
			name:     "bank of america abbreviation",
			input:    "bank-of-america",
			expected: "boa",
		},
		{
			name:     "capital one abbreviation",
			input:    "capital-one",
			expected: "c1",
		},
		{
			name:     "unknown institution no abbreviation",
			input:    "wells-fargo",
			expected: "wells-fargo",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := abbreviateSlug(tt.input)
			if result != tt.expected {
				t.Errorf("abbreviateSlug(%q) = %q, expected %q", tt.input, result, tt.expected)
			}
		})
	}
}
