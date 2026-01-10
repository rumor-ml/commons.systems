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
// combinations to be invalid (e.g., Transfer=true with Redeemable=true), but this
// requires clarification of business rules before adding validation.
// Tracked in TODO(#1405).
type Flags struct {
	Redeemable bool `yaml:"redeemable"`
	Vacation   bool `yaml:"vacation"`
	Transfer   bool `yaml:"transfer"`
}

// Rule represents a single categorization rule.
//
// Rules should be created via YAML loading (NewEngine, LoadEmbedded, LoadFromFile)
// which provides comprehensive validation of all invariants:
//   - Priority in range [0, 999]
//   - RedemptionRate in range [0.0, 1.0]
//   - Redeemable=true requires RedemptionRate > 0
//   - Redeemable=false requires RedemptionRate = 0
//   - Pattern must not be empty after trimming
//   - MatchType must be "exact" or "contains"
//   - Category must be a valid domain.Category
//
// WARNING: Direct struct construction bypasses validation and can create invalid
// rules. Fields are exported for YAML unmarshaling and testing, but validation
// is only enforced through NewEngine. Tracked in TODO(#1400).
type Rule struct {
	Name           string    `yaml:"name"`
	Pattern        string    `yaml:"pattern"`
	MatchType      MatchType `yaml:"match_type"`
	Priority       int       `yaml:"priority"`
	Category       string    `yaml:"category"`
	Flags          Flags     `yaml:"flags"`
	RedemptionRate float64   `yaml:"redemption_rate"`
}

// RuleSet represents the top-level YAML structure
type RuleSet struct {
	Rules []Rule `yaml:"rules"`
}

// MatchResult is currently constructed inline in Engine.Match (line 174-181).
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

	// Sort rules by priority (highest first)
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
// are evaluated in their original YAML file order (sorting happens in NewEngine).
// Returns (nil, false) if no rules match.
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
// contains only value types (no pointers or slices), modifications to returned
// rules will not affect the engine's internal state. Rules are returned in
// priority order (highest first). For equal priorities, rules appear in YAML
// file order (stable sort).
func (e *Engine) GetRules() []Rule {
	result := make([]Rule, len(e.rules))
	copy(result, e.rules)
	return result
}
