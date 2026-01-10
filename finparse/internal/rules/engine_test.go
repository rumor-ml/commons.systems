package rules

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/rumor-ml/commons.systems/finparse/internal/domain"
)

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
			result, matched := engine.Match(tt.description)
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
			result, matched := engine.Match(tt.description)
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

	result, matched := engine.Match("UBER EATS")
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

	result, matched := engine.Match("TARGET STORE")
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
			result, matched := engine.Match(tt.description)
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

	result, matched := engine.Match("CUSTOM MERCHANT STORE")
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
			_, matched := engine.Match(desc)
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
			_, matched := engine.Match(desc)
			if !matched {
				t.Errorf("Match(%q) expected match", desc)
			}
		})
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
