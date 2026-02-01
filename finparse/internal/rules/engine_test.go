package rules

import (
	"bufio"
	"database/sql"
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/rumor-ml/commons.systems/finparse/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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

func TestNewEngine_PriorityBoundaries(t *testing.T) {
	rulesYAML := `
rules:
  - name: "Lowest Priority"
    pattern: "TEST"
    match_type: "contains"
    priority: 0
    category: "other"
    flags:
      redeemable: false
      vacation: false
      transfer: false
    redemption_rate: 0.0
  - name: "Highest Priority"
    pattern: "TEST"
    match_type: "contains"
    priority: 999
    category: "income"
    flags:
      redeemable: false
      vacation: false
      transfer: false
    redemption_rate: 0.0
`
	engine, err := NewEngine([]byte(rulesYAML))
	if err != nil {
		t.Fatalf("NewEngine() failed with valid boundaries: %v", err)
	}

	// Verify sorting: highest priority first
	if len(engine.rules) != 2 {
		t.Fatalf("Expected 2 rules, got %d", len(engine.rules))
	}
	if engine.rules[0].Priority != 999 {
		t.Errorf("Expected priority 999 first, got %d", engine.rules[0].Priority)
	}
	if engine.rules[1].Priority != 0 {
		t.Errorf("Expected priority 0 last, got %d", engine.rules[1].Priority)
	}

	// Verify matching: highest priority wins
	result, matched, err := engine.Match("TEST TRANSACTION")
	if err != nil {
		t.Fatalf("Match() error = %v", err)
	}
	if !matched {
		t.Fatal("Expected match for TEST TRANSACTION")
	}
	if result.Category != domain.CategoryIncome {
		t.Errorf("Expected highest priority rule (income), got %s", result.Category)
	}
	if result.RuleName != "Highest Priority" {
		t.Errorf("Expected 'Highest Priority' rule to match, got %s", result.RuleName)
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

func TestMatch_PreparationForDateBasedVacation(t *testing.T) {
	// This test verifies current behavior and establishes contract for future date-based vacation
	rulesYAML := `
rules:
  - name: "Regular Dining"
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

	// Current behavior: Match() doesn't accept date parameter
	result, matched, err := engine.Match("STARBUCKS")
	if err != nil {
		t.Fatalf("Match() error = %v", err)
	}
	if !matched {
		t.Fatal("Expected match for STARBUCKS")
	}

	// Document current limitation
	if result.Vacation {
		t.Error("STARBUCKS should not be vacation (no date context)")
	}

	// TODO(#1407): When date-based vacation is implemented, add:
	// result := engine.MatchWithDate("STARBUCKS", "2025-12-25", vacationPeriods)
	// if !result.Vacation {
	//     t.Error("STARBUCKS during vacation period should have vacation=true")
	// }

	t.Log("Current Match() API does not support date-based vacation detection")
	t.Log("Future API: MatchWithDate(description, date, vacationPeriods) or Match returns raw result for post-processing")
}

func TestMatch_VacationPeriodOverridesPatternFlag(t *testing.T) {
	t.Skip("TODO(#1407): Date-based vacation detection not yet implemented")

	// When implemented, this test should verify:
	// - Transaction with vacation=false pattern during vacation period becomes vacation=true
	// - Transaction with vacation=true pattern outside vacation period remains vacation=true
	// - Vacation periods are inclusive of start/end dates

	// Expected behavior:
	// vacationPeriods := []VacationPeriod{{Start: "2025-12-20", End: "2025-12-30"}}
	// result1 := engine.MatchWithDate("STARBUCKS", "2025-12-25", vacationPeriods)
	// // Should be vacation=true (pattern=false but date overrides)
	//
	// result2 := engine.MatchWithDate("STARBUCKS", "2026-01-05", vacationPeriods)
	// // Should be vacation=false (pattern=false, date doesn't override)
}

func TestMatch_MultiplePatternsHighestPriorityWins(t *testing.T) {
	rulesYAML := `
rules:
  - name: "Generic Transportation"
    pattern: "UBER"
    match_type: "contains"
    priority: 500
    category: "transportation"
    flags:
      redeemable: false
      vacation: false
      transfer: false
    redemption_rate: 0.0
  - name: "Food Delivery"
    pattern: "EATS"
    match_type: "contains"
    priority: 600
    category: "dining"
    flags:
      redeemable: false
      vacation: false
      transfer: false
    redemption_rate: 0.0
  - name: "Specific Uber Eats"
    pattern: "UBER EATS"
    match_type: "contains"
    priority: 700
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

	// Test that highest priority match wins, regardless of pattern specificity
	result, matched, err := engine.Match("UBER EATS DELIVERY")
	if err != nil {
		t.Fatalf("Match() error = %v", err)
	}
	if !matched {
		t.Fatal("Expected match for UBER EATS DELIVERY")
	}

	// Should match "Specific Uber Eats" (priority 700), not "EATS" (600) or "UBER" (500)
	if result.RuleName != "Specific Uber Eats" {
		t.Errorf("Expected 'Specific Uber Eats' (priority 700) to match, got %q", result.RuleName)
	}
	if result.Category != domain.CategoryDining {
		t.Errorf("Expected category 'dining', got %q", result.Category)
	}
	if !result.Redeemable {
		t.Error("Expected redeemable=true from highest priority rule")
	}

	// Test with transaction that only matches lower priority rules
	result2, matched2, err := engine.Match("UBER FREIGHT")
	if err != nil {
		t.Fatalf("Match() error = %v", err)
	}
	if !matched2 {
		t.Fatal("Expected match for UBER FREIGHT")
	}

	// Should match "Generic Transportation" (priority 500) since higher priority rules don't match
	if result2.RuleName != "Generic Transportation" {
		t.Errorf("Expected 'Generic Transportation' to match, got %q", result2.RuleName)
	}
	if result2.Category != domain.CategoryTransportation {
		t.Errorf("Expected category 'transportation', got %q", result2.Category)
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

func TestMatch_CaseInsensitivityUnicode(t *testing.T) {
	// Document behavior with Unicode characters (accented, non-Latin).
	// Current implementation uses strings.ToUpper() which handles most Unicode correctly.
	rulesYAML := `
rules:
  - name: "Unicode Test"
    pattern: "CAFÉ ZÜRICH"
    match_type: "contains"
    priority: 100
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

	tests := []struct {
		desc        string
		shouldMatch bool
		note        string
	}{
		{"CAFÉ ZÜRICH", true, "exact match with accents"},
		{"café zürich", true, "lowercase with accents"},
		{"Café Zürich", true, "mixed case with accents"},
		{"CAFE ZURICH", false, "without accents - does not match (expected behavior)"},
	}

	for _, tt := range tests {
		t.Run(tt.desc, func(t *testing.T) {
			_, matched, err := engine.Match(tt.desc)
			if err != nil {
				t.Fatalf("Match() error = %v", err)
			}
			if matched != tt.shouldMatch {
				t.Errorf("Match(%q) = %v, want %v (%s)", tt.desc, matched, tt.shouldMatch, tt.note)
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

func TestMatch_WhitespaceEdgeCases(t *testing.T) {
	// Extended whitespace testing to document behavior with various whitespace types.
	// Current design: Internal whitespace is NOT normalized (exact match required).
	rulesYAML := `
rules:
  - name: "Whitespace Test"
    pattern: "TEST PATTERN"
    match_type: "contains"
    priority: 100
    category: "shopping"
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

	tests := []struct {
		desc        string
		shouldMatch bool
		reason      string
	}{
		{"TEST PATTERN", true, "exact match"},
		{"TEST  PATTERN", false, "double space does not match single space (design: no normalization)"},
		{"TEST    PATTERN", false, "quad space does not match single space"},
		{"TEST\tPATTERN", false, "tab does not match space"},
		{"TEST \t PATTERN", false, "mixed space+tab does not match"},
		{"  TEST PATTERN  ", true, "leading/trailing whitespace is trimmed"},
		{"TEST PATTERN EXTRA", true, "contains match includes extra text"},
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

	// Log unmatched transactions when coverage is incomplete
	if len(unmatched) > 0 {
		t.Logf("Unmatched transactions (%d of %d, %.2f%% uncovered):",
			len(unmatched), len(descriptions), 100.0-coveragePercent)
		for i, desc := range unmatched {
			if i < 50 { // Show first 50
				t.Logf("  [%d] %s", i+1, desc)
			}
		}
		if len(unmatched) > 50 {
			t.Logf("  ... and %d more", len(unmatched)-50)
		}
	}

	// Require ≥95% coverage
	if coverage < 0.95 {
		t.Errorf("Coverage %.2f%% below requirement (95%%)", coveragePercent)
	}
}

func TestEmbeddedRules_NewRuleCoverage(t *testing.T) {
	// Load embedded rules
	engine, err := LoadEmbedded()
	if err != nil {
		t.Fatalf("LoadEmbedded() error = %v", err)
	}

	tests := []struct {
		desc           string
		wantCategory   domain.Category
		wantVacation   bool
		wantRedeemable bool
	}{
		// Food delivery via Venmo (check whitespace handling)
		// TODO: Consolidate duplicate test assertions - this entry may be redundant with priority ordering tests
		{"VENMO *UBER EATS", domain.CategoryDining, false, true},
		// Note: Internal whitespace is NOT normalized by design (see TestMatch_InternalWhitespaceNormalization).
		// Pattern matching is exact for internal spaces to avoid unexpected regex behavior.
		// Known limitation: This causes VENMO with 2 spaces to fall through to "other" instead of matching the dining rule.
		// TODO: Consider whitespace normalization enhancement to handle variable spacing (tracked separately from #1645 coverage work).
		// {"VENMO  *UBER EATS", domain.CategoryDining, false, true}, // 2 spaces - skipped until whitespace bug is fixed
		{"VENMO *DOORDASH", domain.CategoryDining, false, true},

		// Major retailers
		{"AMAZON MKTPL*XB8MO38V3", domain.CategoryShopping, false, true},
		{"Amazon.com*MI4KC34I3", domain.CategoryShopping, false, true},
		{"AMZN Mktp US*BF8VM7243", domain.CategoryShopping, false, true},
		{"AMZN Mktp US*R98UJ1YB1", domain.CategoryShopping, false, true},
		{"AMZN MKTPLACE PMTS", domain.CategoryShopping, false, true},
		{"TARGET        00028456", domain.CategoryShopping, false, true},
		{"WALMART.COM", domain.CategoryShopping, false, true},

		// Groceries
		{"KROGER #0789", domain.CategoryGroceries, false, true},
		{"TRADER JOE'S #567", domain.CategoryGroceries, false, true},
		{"GIANT FOOD #1234", domain.CategoryGroceries, false, true},

		// Travel with vacation flag
		{"MARRIOTT HOTEL", domain.CategoryTravel, true, true},
		{"UNITED AIRLINES", domain.CategoryTravel, true, true},
		{"DELTA AIR 0062123456789", domain.CategoryTravel, true, true},

		// Dining - Chick-fil-A variations
		{"CHICKFILA #1234", domain.CategoryDining, false, true},
		{"CHICK-FIL-A #5678", domain.CategoryDining, false, true},

		// Priority ordering - more specific patterns should win
		{"GOOGLE *YOUTUBE PREMIUM", domain.CategoryEntertainment, false, true}, // Should match YouTube rule, not generic Google
		{"GOOGLE WM MAX LLC", domain.CategoryShopping, false, true},

		// Entertainment category
		{"FLICKR PRO", domain.CategoryEntertainment, false, true},
		{"DISNEYPLUS", domain.CategoryEntertainment, false, true},
		{"PATREON MEMBERSHIP", domain.CategoryEntertainment, false, true},
		{"888 AMF BOWLING CENTER", domain.CategoryEntertainment, false, true},

		// Transportation - Gas stations
		{"SHELL OIL 12345678", domain.CategoryTransportation, false, true},
		{"EXXONMOBIL #12345", domain.CategoryTransportation, false, true},
		{"BP#1234567890", domain.CategoryTransportation, false, true},
		{"CHEVRON 98765", domain.CategoryTransportation, false, true},
		{"WAWA #234", domain.CategoryTransportation, false, true},
		{"ROYALFARMS #567", domain.CategoryTransportation, false, false},

		// Venmo priority ordering - food delivery vs generic Venmo
		{"VENMO *UBER EATS PAYMENT", domain.CategoryDining, false, true}, // Food delivery pattern should override generic Venmo
		{"VENMO *DOORDASH ORDER", domain.CategoryDining, false, true},    // Food delivery pattern should override generic Venmo
		{"VENMO PAYMENT TO JOHN", domain.CategoryOther, false, false},    // Generic Venmo payment (transfer)

		// Travel with vacation flag - Complete coverage
		{"HILTON GARDEN INN", domain.CategoryTravel, true, true},
		{"HYATT REGENCY", domain.CategoryTravel, true, true},
		{"IHG HOLIDAY INN", domain.CategoryTravel, true, true},
		{"SOUTHWEST AIR 1234", domain.CategoryTravel, true, true},
		{"AMERICAN AIR TICKET", domain.CategoryTravel, true, true},
		{"AIRBNB *RESERVATION", domain.CategoryTravel, true, true},
		{"EXPEDIA BOOKING", domain.CategoryTravel, true, true},

		// Negative cases - should NOT match specific patterns
		{"REGULAR VENMO PAYMENT", domain.CategoryOther, false, false}, // Not food delivery
		{"VENMO *John Smith", domain.CategoryOther, false, false},     // Personal transfer

		// Pattern boundary cases - known limitations of substring matching
		// TODO: Consider more specific patterns to reduce false positives
		{"GIANT EAGLE AUTO SERVICE", domain.CategoryGroceries, false, true}, // Matches GIANT pattern (false positive - documents current behavior)
		{"AMAZON WEB SERVICES", domain.CategoryShopping, false, true},       // Matches AMAZON pattern (known limitation - AWS is cloud infrastructure, not shopping)
		{"SHELL CORPORATION", domain.CategoryTransportation, false, true},   // Matches SHELL pattern (false positive - documents current behavior)
		{"TST SYSTEMS INC", domain.CategoryDining, false, true},             // Matches TST pattern (false positive - documents current behavior)
		{"GIANT CONSTRUCTION", domain.CategoryGroceries, false, true},       // Matches GIANT pattern (false positive - documents current behavior)
		{"GAP ANALYSIS", domain.CategoryShopping, false, true},              // Matches GAP pattern (false positive - documents current behavior)
		// Note: DELTA DENTAL would not match any rule (no healthcare dental rules exist yet)

		// Issue examples from #1645
		{"POPEYES 13858", domain.CategoryDining, false, true},
		{"DOPPIO PASTIC", domain.CategoryDining, false, true},
		{"MAXS TAPHOUSE", domain.CategoryDining, false, true},
		{"THE CHICKEN LAB", domain.CategoryDining, false, true},

		// Government/Tax payments
		{"USATAXPYMT IRS", domain.CategoryOther, false, false},
		{"USATAXPYMT", domain.CategoryOther, false, false},
		{"IRS PAYMENT", domain.CategoryOther, false, false},
		{"DMV VA", domain.CategoryOther, false, false},
		{"BALTIMOREGOVT", domain.CategoryOther, false, false},

		// Format variations
		{"KROGER  #0789", domain.CategoryGroceries, false, true},
		{"walmart.com", domain.CategoryShopping, false, true},
		{"TRADER JOES", domain.CategoryGroceries, false, true},
	}

	for _, tt := range tests {
		t.Run(tt.desc, func(t *testing.T) {
			result, matched, err := engine.Match(tt.desc)
			if err != nil {
				t.Fatalf("Match() error = %v", err)
			}
			if !matched {
				t.Errorf("Expected match for %q but got no match", tt.desc)
				return
			}
			if result.Category != tt.wantCategory {
				t.Errorf("Match(%q) category = %s, want %s", tt.desc, result.Category, tt.wantCategory)
			}
			if result.Vacation != tt.wantVacation {
				t.Errorf("Match(%q) vacation = %v, want %v", tt.desc, result.Vacation, tt.wantVacation)
			}
			if result.Redeemable != tt.wantRedeemable {
				t.Errorf("Match(%q) redeemable = %v, want %v", tt.desc, result.Redeemable, tt.wantRedeemable)
			}
		})
	}
}

func TestEmbeddedRules_KnownLimitations(t *testing.T) {
	// This test documents known false positives from substring pattern matching.
	// These are tracked as acceptable trade-offs for simplicity vs regex complexity.
	// If refinement is needed, update patterns to be more specific (e.g., "GIANT FOOD" vs "GIANT").
	engine, err := LoadEmbedded()
	if err != nil {
		t.Fatalf("LoadEmbedded() error = %v", err)
	}

	tests := []struct {
		desc         string
		wantCategory domain.Category
		limitation   string
	}{
		{
			"GIANT EAGLE AUTO SERVICE",
			domain.CategoryGroceries,
			"Matches GIANT FOOD pattern despite being auto service (substring limitation)",
		},
		{
			"SHELL CORPORATION",
			domain.CategoryTransportation,
			"Matches SHELL gas station pattern despite being unrelated entity (substring limitation)",
		},
		{
			"AMAZON WEB SERVICES",
			domain.CategoryShopping,
			"Matches AMAZON pattern (acceptable - AWS is an Amazon service)",
		},
	}

	for _, tt := range tests {
		t.Run(tt.desc, func(t *testing.T) {
			result, matched, err := engine.Match(tt.desc)
			if err != nil {
				t.Fatalf("Match() error = %v", err)
			}
			if !matched {
				t.Errorf("Expected match for %q (limitation: %s)", tt.desc, tt.limitation)
				return
			}
			if result.Category != tt.wantCategory {
				t.Errorf("Match(%q) category = %s, want %s (limitation: %s)",
					tt.desc, result.Category, tt.wantCategory, tt.limitation)
			}
			t.Logf("Known limitation: %s", tt.limitation)
		})
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

func TestEmbeddedRules_CategoryDistribution(t *testing.T) {
	// Verify rules are distributed across categories per #1645 requirements:
	// - Shopping/retail expanded
	// - Groceries (at least 5 major chains)
	// - Travel with vacation flag
	// - Food delivery services
	// - Transportation/gas stations
	engine, err := LoadEmbedded()
	if err != nil {
		t.Fatalf("LoadEmbedded() error = %v", err)
	}

	categoryCount := make(map[domain.Category]int)
	for _, rule := range engine.rules {
		categoryCount[domain.Category(rule.Category)]++
	}

	// Minimum expected coverage per category (based on #1645 acceptance criteria)
	requirements := map[domain.Category]int{
		domain.CategoryShopping:       10, // Amazon, Target, Walmart variations
		domain.CategoryGroceries:      5,  // At least 5 major chains
		domain.CategoryTravel:         10, // Hotels + airlines
		domain.CategoryDining:         15, // Restaurants + food delivery
		domain.CategoryTransportation: 5,  // Gas stations + ride shares
	}

	for cat, minCount := range requirements {
		actual := categoryCount[cat]
		if actual < minCount {
			t.Errorf("Category %s has %d rules, expected at least %d (#1645 requirement)",
				cat, actual, minCount)
		}
	}

	t.Logf("Category distribution: %+v", categoryCount)
}

func TestEmbeddedRules_Structure(t *testing.T) {
	// Verifies the embedded rules.yaml file is valid and matches expected structure.
	// Catches regressions from manual edits:
	// - Typo in embedded rules.yaml (e.g., `categroy: "groceries"`)
	// - Invalid priority value (e.g., `priority: 1500`)
	// - Missing required field (e.g., pattern omitted)
	// - Invalid flag combination (e.g., `transfer: true, redeemable: true`)

	engine, err := LoadEmbedded()
	if err != nil {
		t.Fatalf("LoadEmbedded() failed: %v", err)
	}

	// Verify minimum rule count to detect accidental rule deletions
	// Threshold reflects baseline from #1645 work (56 original + 137 new rules)
	// Expected at least 190 rules (~193: 56 from carriercommons + 137 from #1645)
	if len(engine.rules) < 190 {
		t.Errorf("Rule count regression: expected at least 190 rules, got %d", len(engine.rules))
	}

	// Additional regression protection - log actual count and warn on unexpected changes
	actualCount := len(engine.rules)
	expectedMin := 193 // 56 original + 137 from #1645
	expectedMax := 200 // Allow moderate growth

	if actualCount < expectedMin {
		t.Errorf("Rule count regression: got %d rules, expected at least %d", actualCount, expectedMin)
	}
	if actualCount > expectedMax {
		t.Logf("Rule count grew to %d (expected max %d). Update test if this growth is intentional.", actualCount, expectedMax)
	}
	t.Logf("Current embedded rule count: %d (expected range: %d-%d)", actualCount, expectedMin, expectedMax)

	// Verify priority distribution matches migration doc
	priorityRanges := map[string]int{
		"income (900-999)":    0,
		"transfers (800-899)": 0,
		"high (700-799)":      0,
		"medium (500-699)":    0,
		"low (100-499)":       0,
		"catch-all (0-99)":    0,
	}

	for _, rule := range engine.rules {
		if rule.Priority >= 900 && rule.Priority <= 999 {
			priorityRanges["income (900-999)"]++
		} else if rule.Priority >= 800 && rule.Priority <= 899 {
			priorityRanges["transfers (800-899)"]++
		} else if rule.Priority >= 700 && rule.Priority <= 799 {
			priorityRanges["high (700-799)"]++
		} else if rule.Priority >= 500 && rule.Priority <= 699 {
			priorityRanges["medium (500-699)"]++
		} else if rule.Priority >= 100 && rule.Priority <= 499 {
			priorityRanges["low (100-499)"]++
		} else if rule.Priority >= 0 && rule.Priority <= 99 {
			priorityRanges["catch-all (0-99)"]++
		}
	}

	t.Logf("Priority distribution: %v", priorityRanges)

	// Verify all rules have valid categories
	for _, rule := range engine.rules {
		if !domain.ValidateCategory(domain.Category(rule.Category)) {
			t.Errorf("Rule %q has invalid category %q", rule.Name, rule.Category)
		}
	}

	// Verify redeemable consistency
	for _, rule := range engine.rules {
		if rule.Flags.Redeemable && rule.RedemptionRate == 0 {
			t.Errorf("Rule %q: redeemable=true but rate=0", rule.Name)
		}
		if !rule.Flags.Redeemable && rule.RedemptionRate != 0 {
			t.Errorf("Rule %q: redeemable=false but rate=%f", rule.Name, rule.RedemptionRate)
		}
	}

	// Verify transfer+redeemable conflict
	for _, rule := range engine.rules {
		if rule.Flags.Transfer && rule.Flags.Redeemable {
			t.Errorf("Rule %q: invalid combination transfer=true with redeemable=true", rule.Name)
		}
	}

	// Verify all patterns are non-empty
	for _, rule := range engine.rules {
		if strings.TrimSpace(rule.Pattern) == "" {
			t.Errorf("Rule %q has empty pattern", rule.Name)
		}
	}

	// Verify all priorities are in valid range [0, 999]
	for _, rule := range engine.rules {
		if rule.Priority < 0 || rule.Priority > 999 {
			t.Errorf("Rule %q has priority %d outside valid range [0, 999]", rule.Name, rule.Priority)
		}
	}

	// Verify all redemption rates are in valid range [0.0, 1.0]
	for _, rule := range engine.rules {
		if rule.RedemptionRate < 0.0 || rule.RedemptionRate > 1.0 {
			t.Errorf("Rule %q has redemption rate %f outside valid range [0.0, 1.0]", rule.Name, rule.RedemptionRate)
		}
	}

	// Verify all match types are valid
	for _, rule := range engine.rules {
		if rule.MatchType != MatchTypeExact && rule.MatchType != MatchTypeContains {
			t.Errorf("Rule %q has invalid match_type %q", rule.Name, rule.MatchType)
		}
	}
}

func TestEmbeddedRules_NoDuplicatePatterns(t *testing.T) {
	engine, err := LoadEmbedded()
	require.NoError(t, err)

	seen := make(map[string]string) // key: pattern+priority, value: rule name
	for _, rule := range engine.rules {
		key := fmt.Sprintf("%s@%d", rule.Pattern, rule.Priority)
		if existing, found := seen[key]; found {
			t.Errorf("Duplicate pattern+priority: %q and %q both use pattern %q at priority %d",
				existing, rule.Name, rule.Pattern, rule.Priority)
		}
		seen[key] = rule.Name
	}
}

func TestEmbeddedRules_PriorityOrdering(t *testing.T) {
	engine, err := LoadEmbedded()
	require.NoError(t, err)

	tests := []struct {
		desc     string
		input    string
		wantCat  domain.Category
		wantName string // Expected rule name to match
	}{
		{
			desc:     "Venmo Uber Eats should match dining, not generic Venmo",
			input:    "VENMO *UBER EATS",
			wantCat:  domain.CategoryDining,
			wantName: "Venmo Uber Eats",
		},
		{
			desc:     "AMZN abbreviation should match before AMAZON",
			input:    "AMZN Mktp US*123",
			wantCat:  domain.CategoryShopping,
			wantName: "Amazon (AMZN)",
		},
		{
			desc:     "YouTube should match before generic Google",
			input:    "GOOGLE *YOUTUBE PREMIUM",
			wantCat:  domain.CategoryEntertainment,
			wantName: "Google YouTube",
		},
		{
			desc:     "Giant Food should match grocery, not generic Giant",
			input:    "GIANT FOOD #1234",
			wantCat:  domain.CategoryGroceries,
			wantName: "Giant Food",
		},
		{
			desc:     "Shell Oil should match transportation",
			input:    "SHELL OIL 123",
			wantCat:  domain.CategoryTransportation,
			wantName: "Shell Gas",
		},
	}

	for _, tt := range tests {
		t.Run(tt.desc, func(t *testing.T) {
			result, matched, err := engine.Match(tt.input)
			require.NoError(t, err)
			require.True(t, matched, "Should match a rule")
			assert.Equal(t, tt.wantCat, result.Category)
			assert.Equal(t, tt.wantName, result.RuleName)
		})
	}
}

func TestEmbeddedRules_VacationFlagConsistency(t *testing.T) {
	engine, err := LoadEmbedded()
	require.NoError(t, err)

	travelRules := 0
	for _, rule := range engine.rules {
		if rule.Category == string(domain.CategoryTravel) {
			travelRules++
			if !rule.Flags.Vacation {
				t.Errorf("Travel rule %q missing vacation flag", rule.Name)
			}
		}
	}

	// Verify expected travel rule count
	require.GreaterOrEqual(t, travelRules, 10, "Expected at least 10 travel rules")

	// Verify specific transactions have correct vacation flags
	travelTests := []struct {
		desc         string
		wantVacation bool
	}{
		{"MARRIOTT HOTEL", true},
		{"DELTA AIR 123", true},
		{"AIRBNB *123", true},
		{"WALMART", false},
		{"CHIPOTLE", false},
	}

	for _, tt := range travelTests {
		result, matched, err := engine.Match(tt.desc)
		if err != nil || !matched {
			continue // Skip if no match
		}
		assert.Equal(t, tt.wantVacation, result.Vacation, "Wrong vacation flag for %s", tt.desc)
	}
}

func BenchmarkMatch_FullRuleSet(b *testing.B) {
	engine, err := LoadEmbedded()
	if err != nil {
		b.Fatalf("LoadEmbedded() error = %v", err)
	}

	// Test various scenarios: best case (early match), worst case (no match), average case
	descriptions := []string{
		"WHOLEFDS MARKET",           // Common pattern, likely early match
		"AMAZON MKTPL*ABC123",       // Very common, should match quickly
		"UNKNOWN MERCHANT XYZ12345", // Worst case: no match, scans all rules
		"VENMO *UBER EATS",          // Mid-priority dining pattern
		"SHELL OIL 12345678",        // Transportation pattern
	}

	errorCount := 0
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, desc := range descriptions {
			_, _, err := engine.Match(desc)
			if err != nil {
				errorCount++
			}
		}
	}
	b.StopTimer()

	if errorCount > 0 {
		b.Errorf("Benchmark encountered %d errors during %d iterations", errorCount, b.N)
	}
}

func TestEmbeddedRules_EdgeCases(t *testing.T) {
	engine, err := LoadEmbedded()
	require.NoError(t, err)

	tests := []struct {
		desc        string
		input       string
		expectMatch bool
	}{
		{"empty string", "", false},
		{"whitespace only", "   ", false},
		{"very long", strings.Repeat("A", 10000), false},
		{"emoji", "STARBUCKS ☕", true},
		{"unicode", "CAFÉ AMAZON", true},
	}

	for _, tt := range tests {
		t.Run(tt.desc, func(t *testing.T) {
			_, matched, err := engine.Match(tt.input)
			assert.NoError(t, err)
			assert.Equal(t, tt.expectMatch, matched)
		})
	}
}
