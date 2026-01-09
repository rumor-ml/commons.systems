package transform

import (
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

// SlugifyInstitution converts institution name to a URL-safe slug.
// Examples: "American Express" → "american-express", "PNC Bank" → "pnc-bank"
func SlugifyInstitution(name string) (string, error) {
	if name == "" {
		return "", nil
	}

	// Normalize unicode (e.g., accented characters)
	t := transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
	normalized, _, err := transform.String(t, name)
	if err != nil {
		return "", fmt.Errorf("failed to normalize institution name %q: %w", name, err)
	}

	// Convert to lowercase
	slug := strings.ToLower(normalized)

	// Replace spaces and special characters with hyphens
	reg := regexp.MustCompile(`[^a-z0-9]+`)
	slug = reg.ReplaceAllString(slug, "-")

	// Trim leading/trailing hyphens
	slug = strings.Trim(slug, "-")

	return slug, nil
}

// ExtractLast4 returns the last 4 characters of the account number.
// If the account number has fewer than 4 characters, returns the full number.
// Examples: "12345" → "2345", "123" → "123", "" → ""
func ExtractLast4(accountNumber string) string {
	if len(accountNumber) <= 4 {
		return accountNumber
	}
	return accountNumber[len(accountNumber)-4:]
}

// GenerateAccountID creates a deterministic account ID.
// Format: "acc-{institutionSlug}-{last4}"
// Example: GenerateAccountID("amex", "2011") → "acc-amex-2011"
//
//	GenerateAccountID("bank-of-america", "5678") → "acc-boa-5678"
func GenerateAccountID(institutionSlug, accountNumber string) string {
	last4 := ExtractLast4(accountNumber)

	// Create abbreviated slug for common institutions
	abbrev := abbreviateSlug(institutionSlug)

	return fmt.Sprintf("acc-%s-%s", abbrev, last4)
}

// abbreviateSlug creates shorter versions of common institution names
func abbreviateSlug(slug string) string {
	abbreviations := map[string]string{
		"american-express": "amex",
		"bank-of-america":  "boa",
		"capital-one":      "c1",
	}

	if abbrev, ok := abbreviations[slug]; ok {
		return abbrev
	}

	return slug
}

// GenerateStatementID creates a deterministic statement ID.
// Format: "stmt-YYYY-MM-{accountID}"
// Example: GenerateStatementID(time.Date(2025, 10, 15, ...), "acc-amex-2011") → "stmt-2025-10-acc-amex-2011"
func GenerateStatementID(periodStart time.Time, accountID string) string {
	return fmt.Sprintf("stmt-%04d-%02d-%s", periodStart.Year(), periodStart.Month(), accountID)
}
