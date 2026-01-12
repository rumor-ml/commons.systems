// Package rules provides a YAML-based rules engine for transaction categorization.
package rules

import (
	_ "embed"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/rumor-ml/commons.systems/finparse/internal/domain"
	"gopkg.in/yaml.v3"
)

//go:embed rules.yaml
var embeddedRules []byte

// MatchType defines how patterns are matched against transaction descriptions
type MatchType string

const (
	// MatchTypeExact requires the pattern to match the entire description exactly
	MatchTypeExact MatchType = "exact"
	// MatchTypeContains requires the pattern to be a substring of the description
	MatchTypeContains MatchType = "contains"
)

// Flags represent special boolean flags for transactions.
//
// Currently allows any combination of flags. Business logic may require certain
// combinations to be invalid (e.g., Transfer=true with Redeemable=true makes no
// sense because transfers between accounts shouldn't earn cashback rewards).
// Before adding validation, clarify business rules for:
//   - Can vacation transactions be transfers? (e.g., ATM withdrawal on vacation)
//   - Can redeemable transactions be transfers? (e.g., credit card payment with rewards)
//
// Tracked in TODO(#1405).
type Flags struct {
	Redeemable bool `yaml:"redeemable"`
	Vacation   bool `yaml:"vacation"`
	Transfer   bool `yaml:"transfer"`
}

// Rule represents a single categorization rule.
//
// Rules should be created via:
//   - YAML loading: NewEngine, LoadEmbedded, LoadFromFile
//   - Programmatic construction: NewRule constructor
//
// Both methods provide comprehensive validation of all invariants:
//   - Priority in range [0, 999]
//   - RedemptionRate in range [0.0, 1.0]
//   - Redeemable=true requires RedemptionRate > 0
//   - Redeemable=false requires RedemptionRate = 0
//   - Pattern must not be empty after trimming
//   - MatchType must be "exact" or "contains"
//   - Category must be a valid domain.Category
//
// WARNING: Direct struct construction bypasses validation and can create invalid
// rules. Fields are exported for YAML unmarshaling and testing. Always prefer
// NewRule for programmatic construction or NewEngine for YAML loading.
type Rule struct {
	Name           string    `yaml:"name"`
	Pattern        string    `yaml:"pattern"`
	MatchType      MatchType `yaml:"match_type"`
	Priority       int       `yaml:"priority"`
	Category       string    `yaml:"category"`
	Flags          Flags     `yaml:"flags"`
	RedemptionRate float64   `yaml:"redemption_rate"`
}

// NewRule creates a validated rule. All invariants are checked.
// This constructor should be used when constructing Rule instances programmatically.
// YAML loading via NewEngine performs equivalent validation automatically.
func NewRule(name, pattern string, matchType MatchType, priority int, category string, flags Flags, redemptionRate float64) (*Rule, error) {
	// Validate category
	if !domain.ValidateCategory(domain.Category(category)) {
		return nil, fmt.Errorf("invalid category %q", category)
	}

	// Validate priority (0-999)
	if priority < 0 || priority > 999 {
		return nil, fmt.Errorf("priority must be in [0,999], got %d", priority)
	}

	// Validate redemption rate (0.0-1.0)
	if redemptionRate < 0.0 || redemptionRate > 1.0 {
		return nil, fmt.Errorf("redemption rate must be in [0,1], got %f", redemptionRate)
	}

	// Validate consistency: redeemable=true requires rate > 0
	if flags.Redeemable && redemptionRate == 0 {
		return nil, fmt.Errorf("redeemable=true requires redemption_rate > 0")
	}

	// Validate consistency: redeemable=false requires rate = 0
	if !flags.Redeemable && redemptionRate != 0 {
		return nil, fmt.Errorf("redeemable=false requires redemption_rate = 0")
	}

	// Validate match type
	if matchType != MatchTypeExact && matchType != MatchTypeContains {
		return nil, fmt.Errorf("invalid match_type %q (must be 'exact' or 'contains')", matchType)
	}

	// Validate pattern is not empty
	if strings.TrimSpace(pattern) == "" {
		return nil, fmt.Errorf("pattern cannot be empty")
	}

	return &Rule{
		Name:           name,
		Pattern:        pattern,
		MatchType:      matchType,
		Priority:       priority,
		Category:       category,
		Flags:          flags,
		RedemptionRate: redemptionRate,
	}, nil
}

// RuleSet represents the top-level YAML structure
type RuleSet struct {
	Rules []Rule `yaml:"rules"`
}

// MatchResult is currently constructed inline in Engine.Match.
// Since Match only constructs MatchResult from validated Rule structs, the
// invariants (Redeemable/RedemptionRate consistency) are preserved transitively.
//
// Adding a NewMatchResult constructor would provide defense-in-depth but is not
// critical since MatchResult is only created from already-validated Rules.
// Tracked in TODO(#1401).

// Engine performs rule matching on transaction descriptions
type Engine struct {
	rules []Rule // Sorted by priority (highest first)
}

// MatchResult contains the result of applying a rule
type MatchResult struct {
	Category       domain.Category
	Redeemable     bool
	Vacation       bool
	Transfer       bool
	RedemptionRate float64
	RuleName       string // For debugging
}

// NewEngine creates a rules engine from YAML data
func NewEngine(rulesData []byte) (*Engine, error) {
	var ruleSet RuleSet
	if err := yaml.Unmarshal(rulesData, &ruleSet); err != nil {
		return nil, fmt.Errorf("failed to parse YAML rules (check syntax, indentation, and field names): %w", err)
	}

	// TODO(#1411): Consider adding a validationError helper function to ensure
	// consistent error formatting with rule context (index + name) across all validation checks
	// Validate and process rules
	for i, rule := range ruleSet.Rules {
		// Validate category
		if !domain.ValidateCategory(domain.Category(rule.Category)) {
			return nil, fmt.Errorf("rule %d (%s): invalid category %q", i, rule.Name, rule.Category)
		}

		// Validate priority (0-999)
		if rule.Priority < 0 || rule.Priority > 999 {
			return nil, fmt.Errorf("rule %d (%s): priority must be in [0,999], got %d", i, rule.Name, rule.Priority)
		}

		// Validate redemption rate (0.0-1.0)
		if rule.RedemptionRate < 0.0 || rule.RedemptionRate > 1.0 {
			return nil, fmt.Errorf("rule %d (%s): redemption rate must be in [0,1], got %f", i, rule.Name, rule.RedemptionRate)
		}

		// Validate consistency: redeemable=true requires rate > 0
		if rule.Flags.Redeemable && rule.RedemptionRate == 0 {
			return nil, fmt.Errorf("rule %d (%s): redeemable=true requires redemption_rate > 0", i, rule.Name)
		}

		// Validate consistency: redeemable=false requires rate = 0
		if !rule.Flags.Redeemable && rule.RedemptionRate != 0 {
			return nil, fmt.Errorf("rule %d (%s): redeemable=false requires redemption_rate = 0", i, rule.Name)
		}

		// Validate match type
		if rule.MatchType != MatchTypeExact && rule.MatchType != MatchTypeContains {
			return nil, fmt.Errorf("rule %d (%s): invalid match_type %q (must be 'exact' or 'contains')", i, rule.Name, rule.MatchType)
		}

		// Validate pattern is not empty
		if strings.TrimSpace(rule.Pattern) == "" {
			return nil, fmt.Errorf("rule %d (%s): pattern cannot be empty", i, rule.Name)
		}
	}

	// Sort rules by priority (highest first). Use SliceStable to preserve YAML file
	// order for rules with equal priority (guarantees deterministic matching).
	sortedRules := make([]Rule, len(ruleSet.Rules))
	copy(sortedRules, ruleSet.Rules)
	sort.SliceStable(sortedRules, func(i, j int) bool {
		return sortedRules[i].Priority > sortedRules[j].Priority
	})

	return &Engine{
		rules: sortedRules,
	}, nil
}

// LoadEmbedded loads the embedded rules.yaml file
func LoadEmbedded() (*Engine, error) {
	engine, err := NewEngine(embeddedRules)
	if err != nil {
		return nil, fmt.Errorf("failed to load embedded rules (possible binary corruption): %w", err)
	}
	return engine, nil
}

// LoadFromFile loads rules from a filesystem path
func LoadFromFile(path string) (*Engine, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read rules file: %w", err)
	}
	engine, err := NewEngine(data)
	if err != nil {
		return nil, fmt.Errorf("failed to load rules from %q: %w", path, err)
	}
	return engine, nil
}

// Match applies rules to a transaction description and returns the first match.
// Rules are evaluated in priority order (highest first). Rules with equal priority
// are evaluated in their original YAML file order (stable sort in NewEngine preserves
// this ordering). Returns (nil, false) if no rules match.
func (e *Engine) Match(description string) (*MatchResult, bool) {
	// Normalize description: lowercase and trim
	normalizedDesc := strings.ToLower(strings.TrimSpace(description))

	// Iterate rules in priority order
	for _, rule := range e.rules {
		// Normalize pattern
		normalizedPattern := strings.ToLower(strings.TrimSpace(rule.Pattern))

		matched := false
		switch rule.MatchType {
		case MatchTypeExact:
			matched = normalizedDesc == normalizedPattern
		case MatchTypeContains:
			matched = strings.Contains(normalizedDesc, normalizedPattern)
		}

		if matched {
			return &MatchResult{
				Category:       domain.Category(rule.Category),
				Redeemable:     rule.Flags.Redeemable,
				Vacation:       rule.Flags.Vacation,
				Transfer:       rule.Flags.Transfer,
				RedemptionRate: rule.RedemptionRate,
				RuleName:       rule.Name,
			}, true
		}
	}

	return nil, false
}

// GetRules returns a copy of the rules for inspection/debugging.
//
// Returns a new slice containing value copies of each Rule struct. Since Rule
// struct fields are all value types (string, int, float64, bool, MatchType enum),
// modifying returned rules will not affect the engine's internal state.
// WARNING: If Rule struct is extended with pointer/slice fields, this method must
// be updated to perform deep copying to maintain this guarantee.
// Rules are returned in priority order (highest first). For equal priorities,
// rules appear in YAML file order (stable sort).
func (e *Engine) GetRules() []Rule {
	result := make([]Rule, len(e.rules))
	copy(result, e.rules)
	return result
}
