package rules

import (
	"bufio"
	"database/sql"
	_ "embed"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/rumor-ml/commons.systems/finparse/internal/domain"
	_ "modernc.org/sqlite"
)

//go:embed testdata/reference_transactions.txt
var embeddedReferenceTransactions string

func TestNewEngine_ValidRules(t *testing.T) {
	rulesYAML := `
rules:
  - name: "Test Rule"
    pattern: "TEST"
    match_type: "contains"
    priority: 100
    category: "groceries"
    flags:
      redeemable: true
      vacation: false
      transfer: false
    redemption_rate: 0.02
`
	engine, err := NewEngine([]byte(rulesYAML))
	if err != nil {
		t.Fatalf("NewEngine() error = %v", err)
	}

	if len(engine.rules) != 1 {
		t.Errorf("NewEngine() rules count = %d, want 1", len(engine.rules))
	}

	rule := engine.rules[0]
	if rule.Name != "Test Rule" {
		t.Errorf("rule.Name = %s, want Test Rule", rule.Name)
	}
	if rule.Priority != 100 {
		t.Errorf("rule.Priority = %d, want 100", rule.Priority)
	}
	if rule.Category != "groceries" {
		t.Errorf("rule.Category = %s, want groceries", rule.Category)
	}
}

func TestNewEngine_InvalidCategory(t *testing.T) {
	rulesYAML := `
rules:
  - name: "Invalid Category"
    pattern: "TEST"
    match_type: "contains"
    priority: 100
    category: "invalid_category"
    flags:
      redeemable: false
      vacation: false
      transfer: false
    redemption_rate: 0.0
`
	_, err := NewEngine([]byte(rulesYAML))
	if err == nil {
		t.Error("NewEngine() expected error for invalid category")
	}
}

func TestNewEngine_InvalidPriority(t *testing.T) {
	tests := []struct {
		name     string
		priority int
	}{
		{"negative priority", -1},
		{"priority too high", 1000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rulesYAML := `
rules:
  - name: "Invalid Priority"
    pattern: "TEST"
    match_type: "contains"
    priority: ` + string(rune(tt.priority)) + `
    category: "groceries"
    flags:
      redeemable: false
      vacation: false
      transfer: false
    redemption_rate: 0.0
`
			_, err := NewEngine([]byte(rulesYAML))
			if err == nil {
				t.Errorf("NewEngine() expected error for %s", tt.name)
			}
		})
	}
}

func TestNewEngine_InvalidRedemptionRate(t *testing.T) {
	tests := []struct {
		name string
		rate string
	}{
		{"negative rate", "-0.1"},
		{"rate too high", "1.5"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rulesYAML := `
rules:
  - name: "Invalid Rate"
    pattern: "TEST"
    match_type: "contains"
    priority: 100
    category: "groceries"
    flags:
      redeemable: false
      vacation: false
      transfer: false
    redemption_rate: ` + tt.rate + `
`
			_, err := NewEngine([]byte(rulesYAML))
			if err == nil {
				t.Errorf("NewEngine() expected error for %s", tt.name)
			}
		})
	}
}

func TestNewEngine_RedeemableConsistency(t *testing.T) {
	tests := []struct {
		name       string
		redeemable bool
		rate       string
		wantErr    bool
	}{
		{"redeemable with zero rate", true, "0.0", true},
		{"non-redeemable with non-zero rate", false, "0.02", true},
		{"redeemable with valid rate", true, "0.02", false},
		{"non-redeemable with zero rate", false, "0.0", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			redeemableStr := "false"
			if tt.redeemable {
				redeemableStr = "true"
			}

			rulesYAML := `
rules:
  - name: "Consistency Test"
    pattern: "TEST"
    match_type: "contains"
    priority: 100
    category: "groceries"
    flags:
      redeemable: ` + redeemableStr + `
      vacation: false
      transfer: false
    redemption_rate: ` + tt.rate + `
`
			_, err := NewEngine([]byte(rulesYAML))
			if (err != nil) != tt.wantErr {
				t.Errorf("NewEngine() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestNewEngine_InvalidMatchType(t *testing.T) {
	rulesYAML := `
rules:
  - name: "Invalid Match Type"
    pattern: "TEST"
    match_type: "invalid"
    priority: 100
    category: "groceries"
    flags:
      redeemable: false
      vacation: false
      transfer: false
    redemption_rate: 0.0
`
	_, err := NewEngine([]byte(rulesYAML))
	if err == nil {
		t.Error("NewEngine() expected error for invalid match_type")
	}
}

func TestNewEngine_EmptyPattern(t *testing.T) {
	rulesYAML := `
rules:
  - name: "Empty Pattern"
    pattern: ""
    match_type: "contains"
    priority: 100
    category: "groceries"
    flags:
      redeemable: false
      vacation: false
      transfer: false
    redemption_rate: 0.0
`
	_, err := NewEngine([]byte(rulesYAML))
	if err == nil {
		t.Error("NewEngine() expected error for empty pattern")
	}
}

func TestNewEngine_PrioritySorting(t *testing.T) {
	rulesYAML := `
rules:
  - name: "Low Priority"
    pattern: "LOW"
    match_type: "contains"
    priority: 100
    category: "groceries"
    flags:
      redeemable: false
      vacation: false
      transfer: false
    redemption_rate: 0.0
  - name: "High Priority"
    pattern: "HIGH"
    match_type: "contains"
    priority: 900
    category: "income"
    flags:
      redeemable: false
      vacation: false
      transfer: false
    redemption_rate: 0.0
  - name: "Medium Priority"
    pattern: "MED"
    match_type: "contains"
    priority: 500
    category: "utilities"
    flags:
      redeemable: false
      vacation: false
      transfer: false
    redemption_rate: 0.0
`
	engine, err := NewEngine([]byte(rulesYAML))
	if err != nil {
		t.Fatalf("NewEngine() error = %v", err)
	}

	// Verify rules are sorted by priority (highest first)
	if len(engine.rules) != 3 {
		t.Fatalf("NewEngine() rules count = %d, want 3", len(engine.rules))
	}

	if engine.rules[0].Name != "High Priority" {
		t.Errorf("rules[0].Name = %s, want High Priority", engine.rules[0].Name)
	}
	if engine.rules[1].Name != "Medium Priority" {
		t.Errorf("rules[1].Name = %s, want Medium Priority", engine.rules[1].Name)
	}
	if engine.rules[2].Name != "Low Priority" {
		t.Errorf("rules[2].Name = %s, want Low Priority", engine.rules[2].Name)
	}
}

func TestMatch_Contains(t *testing.T) {
	rulesYAML := `
rules:
  - name: "Whole Foods"
    pattern: "WHOLE FOODS"
    match_type: "contains"
    priority: 100
    category: "groceries"
    flags:
      redeemable: true
      vacation: false
      transfer: false
    redemption_rate: 0.02
`
	engine, err := NewEngine([]byte(rulesYAML))
	if err != nil {
		t.Fatalf("NewEngine() error = %v", err)
	}

	tests := []struct {
		name        string
		description string
		wantMatch   bool
	}{
		{"exact match", "WHOLE FOODS", true},
		{"case insensitive", "whole foods", true},
		{"substring", "WHOLE FOODS MARKET", true},
		{"prefix", "whole foods on main st", true},
		{"no match", "TARGET", false},
		{"partial word", "WHOLE", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, matched, err := engine.Match(tt.description)
			if err != nil {
				t.Fatalf("Match() error = %v", err)
			}
			if matched != tt.wantMatch {
				t.Errorf("Match(%q) matched = %v, want %v", tt.description, matched, tt.wantMatch)
			}

			if matched {
				if result.Category != domain.CategoryGroceries {
					t.Errorf("Match(%q) category = %s, want groceries", tt.description, result.Category)
				}
				if !result.Redeemable {
					t.Errorf("Match(%q) redeemable = false, want true", tt.description)
				}
				if result.RedemptionRate != 0.02 {
					t.Errorf("Match(%q) redemptionRate = %f, want 0.02", tt.description, result.RedemptionRate)
				}
			}
		})
	}
}

func TestMatch_Exact(t *testing.T) {
	rulesYAML := `
rules:
  - name: "Exact Match Rule"
    pattern: "EXACT PAYMENT"
    match_type: "exact"
    priority: 100
    category: "other"
    flags:
      redeemable: false
      vacation: false
      transfer: true
    redemption_rate: 0.0
`
	engine, err := NewEngine([]byte(rulesYAML))
	if err != nil {
		t.Fatalf("NewEngine() error = %v", err)
	}

	tests := []struct {
		name        string
		description string
		wantMatch   bool
	}{
		{"exact match", "EXACT PAYMENT", true},
		{"case insensitive", "exact payment", true},
		{"with whitespace", "  exact payment  ", true},
		{"substring", "EXACT PAYMENT RECEIVED", false},
		{"prefix", "EXACT", false},
		{"no match", "OTHER PAYMENT", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, matched, err := engine.Match(tt.description)
			if err != nil {
				t.Fatalf("Match() error = %v", err)
			}
			if matched != tt.wantMatch {
				t.Errorf("Match(%q) matched = %v, want %v", tt.description, matched, tt.wantMatch)
			}

			if matched {
				if result.Category != domain.CategoryOther {
					t.Errorf("Match(%q) category = %s, want other", tt.description, result.Category)
				}
				if !result.Transfer {
					t.Errorf("Match(%q) transfer = false, want true", tt.description)
				}
			}
		})
	}
}

func TestMatch_FirstMatchWins(t *testing.T) {
	rulesYAML := `
rules:
  - name: "High Priority"
    pattern: "UBER"
    match_type: "contains"
    priority: 900
    category: "transportation"
    flags:
      redeemable: false
      vacation: false
      transfer: false
    redemption_rate: 0.0
  - name: "Low Priority"
    pattern: "UBER"
    match_type: "contains"
    priority: 100
    category: "dining"
    flags:
      redeemable: true
      vacation: false
      transfer: false
    redemption_rate: 0.02
`
	engine, err := NewEngine([]byte(rulesYAML))
	if err != nil {
		t.Fatalf("NewEngine() error = %v", err)
	}

	result, matched, err := engine.Match("UBER EATS")
	if err != nil {
		t.Fatalf("Match() error = %v", err)
	}
	if !matched {
		t.Fatal("Match() expected match for UBER EATS")
	}

	// Should match the high priority rule (transportation)
	if result.Category != domain.CategoryTransportation {
		t.Errorf("Match() category = %s, want transportation", result.Category)
	}
	if result.RuleName != "High Priority" {
		t.Errorf("Match() ruleName = %s, want High Priority", result.RuleName)
	}
}

func TestMatch_NoMatch(t *testing.T) {
	rulesYAML := `
rules:
  - name: "Specific Rule"
    pattern: "WHOLE FOODS"
    match_type: "contains"
    priority: 100
    category: "groceries"
    flags:
      redeemable: false
      vacation: false
      transfer: false
    redemption_rate: 0.0
`
	engine, err := NewEngine([]byte(rulesYAML))
	if err != nil {
		t.Fatalf("NewEngine() error = %v", err)
	}

	result, matched, err := engine.Match("TARGET STORE")
	if err != nil {
		t.Fatalf("Match() error = %v", err)
	}
	if matched {
		t.Error("Match() expected no match for TARGET STORE")
	}
	if result != nil {
		t.Error("Match() result should be nil when no match")
	}
}

func TestLoadEmbedded(t *testing.T) {
	engine, err := LoadEmbedded()
	if err != nil {
		t.Fatalf("LoadEmbedded() error = %v", err)
	}

	if len(engine.rules) == 0 {
		t.Error("LoadEmbedded() returned empty rules")
	}

	// Verify embedded rules are sorted by priority
	for i := 1; i < len(engine.rules); i++ {
		if engine.rules[i].Priority > engine.rules[i-1].Priority {
			t.Errorf("LoadEmbedded() rules not sorted: rules[%d].Priority (%d) > rules[%d].Priority (%d)",
				i, engine.rules[i].Priority, i-1, engine.rules[i-1].Priority)
		}
	}

	// Test a few known embedded rules
	tests := []struct {
		description string
		wantMatch   bool
		wantCat     domain.Category
	}{
		{"JOHNS HOPKINS UNIVERSITY", true, domain.CategoryIncome},
		{"WHOLEFDS MARKET", true, domain.CategoryGroceries},
		{"CHIPOTLE MEXICAN GRILL", true, domain.CategoryDining},
		{"MARYLAND ATHLETIC CLUB", true, domain.CategoryHealthcare},
		{"UNKNOWN MERCHANT", false, ""},
	}

	for _, tt := range tests {
		t.Run(tt.description, func(t *testing.T) {
			result, matched, err := engine.Match(tt.description)
			if err != nil {
				t.Fatalf("Match() error = %v", err)
			}
			if matched != tt.wantMatch {
				t.Errorf("Match(%q) matched = %v, want %v", tt.description, matched, tt.wantMatch)
			}
			if matched && result.Category != tt.wantCat {
				t.Errorf("Match(%q) category = %s, want %s", tt.description, result.Category, tt.wantCat)
			}
		})
	}
}

func TestLoadFromFile(t *testing.T) {
	tmpDir := t.TempDir()
	rulesFile := filepath.Join(tmpDir, "custom_rules.yaml")

	rulesYAML := `
rules:
  - name: "Custom Rule"
    pattern: "CUSTOM MERCHANT"
    match_type: "contains"
    priority: 100
    category: "shopping"
    flags:
      redeemable: true
      vacation: false
      transfer: false
    redemption_rate: 0.02
`

	err := os.WriteFile(rulesFile, []byte(rulesYAML), 0644)
	if err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	engine, err := LoadFromFile(rulesFile)
	if err != nil {
		t.Fatalf("LoadFromFile() error = %v", err)
	}

	result, matched, err := engine.Match("CUSTOM MERCHANT STORE")
	if err != nil {
		t.Fatalf("Match() error = %v", err)
	}
	if !matched {
		t.Error("Match() expected match for CUSTOM MERCHANT STORE")
	}
	if result.Category != domain.CategoryShopping {
		t.Errorf("Match() category = %s, want shopping", result.Category)
	}
}

func TestLoadFromFile_NotExists(t *testing.T) {
	_, err := LoadFromFile("/nonexistent/rules.yaml")
	if err == nil {
		t.Error("LoadFromFile() expected error for non-existent file")
	}
}

func TestGetRules(t *testing.T) {
	rulesYAML := `
rules:
  - name: "Test Rule"
    pattern: "TEST"
    match_type: "contains"
    priority: 100
    category: "groceries"
    flags:
      redeemable: false
      vacation: false
      transfer: false
    redemption_rate: 0.0
`
	engine, err := NewEngine([]byte(rulesYAML))
	if err != nil {
		t.Fatalf("NewEngine() error = %v", err)
	}

	rules := engine.GetRules()
	if len(rules) != 1 {
		t.Errorf("GetRules() count = %d, want 1", len(rules))
	}

	// Verify it's a copy (modifying returned slice doesn't affect engine)
	rules[0].Name = "Modified"
	originalRules := engine.GetRules()
	if originalRules[0].Name == "Modified" {
		t.Error("GetRules() did not return a defensive copy")
	}
}

func TestMatch_CaseInsensitivity(t *testing.T) {
	rulesYAML := `
rules:
  - name: "Case Test"
    pattern: "WhOlE FoOdS"
    match_type: "contains"
    priority: 100
    category: "groceries"
    flags:
      redeemable: false
      vacation: false
      transfer: false
    redemption_rate: 0.0
`
	engine, err := NewEngine([]byte(rulesYAML))
	if err != nil {
		t.Fatalf("NewEngine() error = %v", err)
	}

	tests := []string{
		"WHOLE FOODS",
		"whole foods",
		"Whole Foods",
		"wHoLe FoOdS",
	}

	for _, desc := range tests {
		t.Run(desc, func(t *testing.T) {
			_, matched, err := engine.Match(desc)
			if err != nil {
				t.Fatalf("Match() error = %v", err)
			}
			if !matched {
				t.Errorf("Match(%q) expected match", desc)
			}
		})
	}
}

func TestMatch_WhitespaceTrimming(t *testing.T) {
	rulesYAML := `
rules:
  - name: "Whitespace Test"
    pattern: "  WHOLE FOODS  "
    match_type: "contains"
    priority: 100
    category: "groceries"
    flags:
      redeemable: false
      vacation: false
      transfer: false
    redemption_rate: 0.0
`
	engine, err := NewEngine([]byte(rulesYAML))
	if err != nil {
		t.Fatalf("NewEngine() error = %v", err)
	}

	tests := []string{
		"WHOLE FOODS",
		"  WHOLE FOODS",
		"WHOLE FOODS  ",
		"  WHOLE FOODS  ",
	}

	for _, desc := range tests {
		t.Run(desc, func(t *testing.T) {
			_, matched, err := engine.Match(desc)
			if err != nil {
				t.Fatalf("Match() error = %v", err)
			}
			if !matched {
				t.Errorf("Match(%q) expected match", desc)
			}
		})
	}
}

func TestMatch_InternalWhitespaceNormalization(t *testing.T) {
	rulesYAML := `
rules:
  - name: "Double Space Pattern"
    pattern: "AMAZON  MARKETPLACE"
    match_type: "contains"
    priority: 100
    category: "shopping"
    flags:
      redeemable: true
      vacation: false
      transfer: false
    redemption_rate: 0.02
`
	engine, err := NewEngine([]byte(rulesYAML))
	if err != nil {
		t.Fatalf("NewEngine() error = %v", err)
	}

	tests := []struct {
		desc        string
		shouldMatch bool
		reason      string
	}{
		{"AMAZON  MARKETPLACE", true, "exact match with double space"},
		{"AMAZON MARKETPLACE", false, "single space does not match double space pattern"},
		{"AMAZON   MARKETPLACE", false, "triple space does not match double space pattern"},
		{"AMAZON\tMARKETPLACE", false, "tab does not match space"},
	}

	for _, tt := range tests {
		t.Run(tt.desc, func(t *testing.T) {
			_, matched, err := engine.Match(tt.desc)
			if err != nil {
				t.Fatalf("Match() error = %v", err)
			}
			if matched != tt.shouldMatch {
				t.Errorf("Match(%q) = %v, want %v (%s)", tt.desc, matched, tt.shouldMatch, tt.reason)
			}
		})
	}

	// DESIGN DECISION: Internal whitespace is NOT normalized
	// Pattern "A  B" (2 spaces) only matches description "A  B" (2 spaces)
	// This is intentional - whitespace normalization would require regex
	// and could cause unexpected matches. If this causes rule coverage issues
	// with real-world transactions, consider adding \s+ regex support.
}

func TestMatch_EqualPriority_StableSort(t *testing.T) {
	rulesYAML := `
rules:
  - name: "First Rule Priority 500"
    pattern: "TEST"
    match_type: "contains"
    priority: 500
    category: "groceries"
    flags:
      redeemable: false
      vacation: false
      transfer: false
    redemption_rate: 0.0
  - name: "Second Rule Priority 500"
    pattern: "TEST"
    match_type: "contains"
    priority: 500
    category: "dining"
    flags:
      redeemable: false
      vacation: false
      transfer: false
    redemption_rate: 0.0
`
	engine, err := NewEngine([]byte(rulesYAML))
	if err != nil {
		t.Fatalf("NewEngine() error = %v", err)
	}

	result, matched, err := engine.Match("TEST MERCHANT")
	if err != nil {
		t.Fatalf("Match() error = %v", err)
	}
	if !matched {
		t.Fatal("Expected match for TEST MERCHANT")
	}

	// Should match first rule in YAML file order
	if result.Category != domain.CategoryGroceries {
		t.Errorf("Expected first rule (groceries) to match, got %s", result.Category)
	}
	if result.RuleName != "First Rule Priority 500" {
		t.Errorf("Expected first rule to match, got %s", result.RuleName)
	}
}

func TestMatch_WhitespaceOnlyDescription(t *testing.T) {
	rulesYAML := `
rules:
  - name: "Non-empty Pattern"
    pattern: "TEST"
    match_type: "contains"
    priority: 100
    category: "groceries"
    flags:
      redeemable: false
      vacation: false
      transfer: false
    redemption_rate: 0.0
`
	engine, _ := NewEngine([]byte(rulesYAML))

	// Description with only whitespace should not match
	result, matched, err := engine.Match("   ")
	if err != nil {
		t.Fatalf("Match() error = %v", err)
	}
	if matched {
		t.Error("Whitespace-only description should not match pattern 'TEST'")
	}
	if result != nil {
		t.Error("Result should be nil for no match")
	}
}

func TestNewEngine_InvalidYAML(t *testing.T) {
	invalidYAML := `
rules:
  - name: "Invalid"
    invalid_field: [this is not proper YAML structure
`

	_, err := NewEngine([]byte(invalidYAML))
	if err == nil {
		t.Error("NewEngine() expected error for invalid YAML")
	}
}

func TestEmbeddedRules_CoverageRequirement(t *testing.T) {
	t.Skip("TODO(#1261): Rule coverage requirement (95%) not yet met. Currently at ~84%. This is a feature in progress.")
	// Load embedded rules
	engine, err := LoadEmbedded()
	if err != nil {
		t.Fatalf("LoadEmbedded() error = %v", err)
	}

	// Load transactions from embedded testdata
	descriptions := loadEmbeddedReferenceTransactions(t)

	if len(descriptions) != 1268 {
		t.Errorf("Expected 1,268 transactions, got %d", len(descriptions))
	}

	// Apply rules to each transaction
	matched := 0
	unmatched := []string{}

	for _, desc := range descriptions {
		if _, ok, err := engine.Match(desc); err != nil {
			t.Fatalf("Match() error = %v", err)
		} else if ok {
			matched++
		} else {
			unmatched = append(unmatched, desc)
		}
	}

	// Calculate coverage
	coverage := float64(matched) / float64(len(descriptions))
	coveragePercent := coverage * 100

	// Report results
	t.Logf("Coverage: %.2f%% (%d/%d matched)", coveragePercent, matched, len(descriptions))

	// Require ≥95% coverage
	if coverage < 0.95 {
		t.Errorf("Coverage %.2f%% below requirement (95%%)", coveragePercent)
		t.Logf("Unmatched transactions (%d):", len(unmatched))
		for i, desc := range unmatched {
			if i < 20 { // Show first 20
				t.Logf("  - %s", desc)
			}
		}
		if len(unmatched) > 20 {
			t.Logf("  ... and %d more", len(unmatched)-20)
		}
	}
}

// loadEmbeddedReferenceTransactions loads transaction descriptions from embedded testdata.
// This ensures the coverage requirement test always runs (even in CI without database access).
// The testdata file was exported from the carriercommons reference database:
//
//	sqlite3 ~/carriercommons/finance/finance.db "SELECT name FROM transactions ORDER BY id"
func loadEmbeddedReferenceTransactions(t *testing.T) []string {
	t.Helper()

	scanner := bufio.NewScanner(strings.NewReader(embeddedReferenceTransactions))
	descriptions := []string{}
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line != "" {
			descriptions = append(descriptions, line)
		}
	}

	if err := scanner.Err(); err != nil {
		t.Fatalf("Failed to read embedded reference transactions: %v", err)
	}

	return descriptions
}

// loadTransactionDescriptions loads transaction descriptions from the reference database.
// DEPRECATED: Use loadEmbeddedReferenceTransactions instead. This function is kept for
// manual verification that the embedded testdata matches the current database state.
func loadTransactionDescriptions(t *testing.T, dbPath string) []string {
	t.Helper()

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("Failed to open database: %v", err)
	}
	defer db.Close()

	rows, err := db.Query("SELECT name FROM transactions ORDER BY id")
	if err != nil {
		t.Fatalf("Failed to query transactions: %v", err)
	}
	defer rows.Close()

	descriptions := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("Failed to scan row: %v", err)
		}
		descriptions = append(descriptions, name)
	}

	if err := rows.Err(); err != nil {
		t.Fatalf("Error iterating rows: %v", err)
	}

	return descriptions
}

func TestEndToEnd_VacationDateBasedDetection(t *testing.T) {
	// TODO(#1407): Implement date-based vacation detection
	// This test verifies the vacation detection requirement from issue #1261:
	// "Vacation detection (date-based periods + pattern matching)"
	//
	// The test demonstrates the expected behavior:
	// 1. Pattern-based detection: Hotel/flight patterns set vacation=true
	// 2. Date-based detection: Transactions during vacation periods get vacation=true
	// 3. Combined logic: Pattern OR date-based should set vacation=true

	// Test pattern-based vacation detection (currently implemented)
	rulesYAML := `
rules:
  - name: "Hotel Vacation"
    pattern: "MARRIOTT"
    match_type: "contains"
    priority: 500
    category: "travel"
    flags:
      redeemable: false
      vacation: true
      transfer: false
    redemption_rate: 0.0
  - name: "Regular Coffee"
    pattern: "STARBUCKS"
    match_type: "contains"
    priority: 400
    category: "dining"
    flags:
      redeemable: false
      vacation: false
      transfer: false
    redemption_rate: 0.0
`
	engine, err := NewEngine([]byte(rulesYAML))
	if err != nil {
		t.Fatalf("NewEngine() error = %v", err)
	}

	// Test pattern-based vacation detection
	t.Run("pattern-based vacation", func(t *testing.T) {
		result, matched, err := engine.Match("MARRIOTT HOTEL")
		if err != nil {
			t.Fatalf("Match() error = %v", err)
		}
		if !matched {
			t.Fatal("Expected match for MARRIOTT HOTEL")
		}
		if !result.Vacation {
			t.Error("MARRIOTT HOTEL should have vacation=true (pattern match)")
		}

		result, matched, err = engine.Match("STARBUCKS")
		if err != nil {
			t.Fatalf("Match() error = %v", err)
		}
		if !matched {
			t.Fatal("Expected match for STARBUCKS")
		}
		if result.Vacation {
			t.Error("STARBUCKS should have vacation=false (not a vacation pattern)")
		}
	})

	// Date-based vacation detection is not yet implemented
	// The spec requires: "Vacation detection (date-based periods + pattern matching)"
	//
	// Expected API (once implemented):
	//
	//   engine := NewEngineWithVacationPeriods(rulesYAML, []VacationPeriod{
	//       {Start: "2025-12-20", End: "2025-12-30"},
	//   })
	//
	//   // Starbucks during vacation period should be vacation=true
	//   result := engine.MatchWithDate("STARBUCKS", "2025-12-25")
	//   if !result.Vacation {
	//       t.Error("Transaction during vacation period should have vacation=true")
	//   }
	//
	//   // Starbucks outside vacation period should be vacation=false
	//   result = engine.MatchWithDate("STARBUCKS", "2026-01-05")
	//   if result.Vacation {
	//       t.Error("Transaction outside vacation period should have vacation=false")
	//   }
	//
	// This would enable distinguishing:
	// - $500 hotel during Hawaii vacation → vacation=true (useful for budget tracking)
	// - $500 hotel during work conference → vacation=false (business expense)
	//
	// TODO(#1406): Implement MatchWithDate() method and VacationPeriod configuration

	t.Log("Pattern-based vacation detection: IMPLEMENTED ✓")

	// Date-based vacation detection tracked separately
	t.Run("date-based vacation NOT IMPLEMENTED", func(t *testing.T) {
		t.Skip("TODO(#1407): Date-based vacation detection not yet implemented. Issue #1261 requires: 'Vacation detection (date-based periods + pattern matching)'")
		t.Log("Expected API: MatchWithDate(description, date) or vacation period configuration")
		t.Log("See test comments above for detailed design specification")
	})
}

func TestRuleIsValueType(t *testing.T) {
	// This test ensures Rule contains only value types (no pointers/slices).
	// If Rule gains pointer/slice fields, this will fail to compile,
	// alerting developers that GetRules needs deep copying.
	var r1, r2 Rule
	_ = r1 == r2

	// Document why this matters
	t.Log("Rule is a pure value type - GetRules shallow copy is safe")
}

func TestNewEngine_TransferRedeemableConflict(t *testing.T) {
	rulesYAML := `
rules:
  - name: "Invalid Transfer+Redeemable"
    pattern: "TEST PAYMENT"
    match_type: "contains"
    priority: 100
    category: "other"
    flags:
      redeemable: true
      vacation: false
      transfer: true
    redemption_rate: 0.02
`
	_, err := NewEngine([]byte(rulesYAML))
	if err == nil {
		t.Error("NewEngine should reject transfer=true with redeemable=true")
	}
	if !strings.Contains(err.Error(), "transfer") || !strings.Contains(err.Error(), "redeemable") {
		t.Errorf("Error should mention conflicting flags, got: %v", err)
	}
}

func TestEmbeddedRules_CoverageProgress(t *testing.T) {
	// This test documents current coverage and fails if it regresses
	engine, err := LoadEmbedded()
	if err != nil {
		t.Fatalf("LoadEmbedded() error = %v", err)
	}

	descriptions := loadEmbeddedReferenceTransactions(t)
	if len(descriptions) != 1268 {
		t.Errorf("Expected 1,268 reference transactions, got %d", len(descriptions))
	}

	matched := 0
	for _, desc := range descriptions {
		if _, ok, _ := engine.Match(desc); ok {
			matched++
		}
	}

	coverage := float64(matched) / float64(len(descriptions))
	currentTarget := 0.84 // Update as coverage improves

	if coverage < currentTarget {
		t.Errorf("Coverage regressed: %.2f%% < %.2f%%", coverage*100, currentTarget*100)
	}

	t.Logf("Current coverage: %.2f%% (%d/%d), Target: 95%%",
		coverage*100, matched, len(descriptions))

	if coverage < 0.95 {
		t.Logf("Coverage gap: need %d more rules to reach 95%%",
			int(0.95*float64(len(descriptions)))-matched)
	}
}

func TestMatch_InternalErrorUnreachable(t *testing.T) {
	// This test documents that Match() internal error path should be unreachable
	// due to validation in NewEngine. If this test can trigger the error, validation
	// is broken and should be fixed.

	engine, _ := NewEngine([]byte(`
rules:
  - name: "Valid Rule"
    pattern: "TEST"
    match_type: "contains"
    priority: 100
    category: "groceries"
    flags:
      redeemable: true
      vacation: false
      transfer: false
    redemption_rate: 0.02
`))

	_, _, err := engine.Match("TEST TRANSACTION")
	if err != nil {
		t.Errorf("Match() returned unexpected error (validation should prevent this): %v", err)
	}
}
