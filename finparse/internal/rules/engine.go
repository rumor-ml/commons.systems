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
// TODO(#1430): Consider stronger type-level enforcement for valid match types
type MatchType string

const (
	// MatchTypeExact requires the pattern to match the entire description exactly
	MatchTypeExact MatchType = "exact"
	// MatchTypeContains requires the pattern to be a substring of the description
	MatchTypeContains MatchType = "contains"
)

// Flags represent special boolean flags for transactions.
//
// Currently validates that Transfer=true with Redeemable=true is invalid
// (enforced in NewFlags and UnmarshalYAML). This prevents transfers between
// accounts from earning cashback rewards.
//
// Future validation considerations tracked in TODO(#1405):
//   - Can vacation transactions be transfers? (e.g., ATM withdrawal on vacation)
//   - Should there be other invalid flag combinations?
type Flags struct {
	Redeemable bool `yaml:"redeemable"`
	Vacation   bool `yaml:"vacation"`
	Transfer   bool `yaml:"transfer"`
}

// NewFlags creates a validated Flags instance.
// Returns error if flag combination violates business rules.
// Currently enforces: Transfer=true with Redeemable=true is invalid
// (transfers between accounts should not earn cashback rewards).
func NewFlags(redeemable, vacation, transfer bool) (*Flags, error) {
	if transfer && redeemable {
		return nil, fmt.Errorf("invalid flags: transfer=true with redeemable=true (transfers should not earn cashback)")
	}

	return &Flags{
		Redeemable: redeemable,
		Vacation:   vacation,
		Transfer:   transfer,
	}, nil
}

// UnmarshalYAML implements yaml.Unmarshaler to enforce validation during YAML loading.
// Ensures all Flags instances are validated at construction time.
func (f *Flags) UnmarshalYAML(unmarshal func(interface{}) error) error {
	type rawFlags Flags
	var raw rawFlags
	if err := unmarshal(&raw); err != nil {
		return err
	}

	validated, err := NewFlags(raw.Redeemable, raw.Vacation, raw.Transfer)
	if err != nil {
		return err
	}

	*f = *validated
	return nil
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
// rules. Fields are exported for YAML unmarshaling (which uses UnmarshalYAML for
// validation) and testing. Always prefer NewRule for programmatic construction.
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
	// Validate flags
	if _, err := NewFlags(flags.Redeemable, flags.Vacation, flags.Transfer); err != nil {
		return nil, err
	}

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

// Validate checks all invariants on a Rule instance.
// Useful for validating Rules created through direct struct construction
// (e.g., in tests) or to re-check rules after modification.
func (r *Rule) Validate() error {
	_, err := NewRule(
		r.Name,
		r.Pattern,
		r.MatchType,
		r.Priority,
		r.Category,
		r.Flags,
		r.RedemptionRate,
	)
	return err
}

// UnmarshalYAML implements yaml.Unmarshaler to enforce validation during YAML loading.
// Ensures all Rule instances are validated at construction time, eliminating the
// temporary invalid state window between unmarshal and post-validation in NewEngine.
func (r *Rule) UnmarshalYAML(unmarshal func(interface{}) error) error {
	type rawRule Rule
	var raw rawRule
	if err := unmarshal(&raw); err != nil {
		return err
	}

	validated, err := NewRule(
		raw.Name, raw.Pattern, raw.MatchType,
		raw.Priority, raw.Category, raw.Flags,
		raw.RedemptionRate,
	)
	if err != nil {
		return fmt.Errorf("invalid rule %q: %w", raw.Name, err)
	}

	*r = *validated
	return nil
}

// TODO(#1427): RuleSet is only used for YAML unmarshaling in NewEngine and could be unexported
// RuleSet represents the top-level YAML structure
type RuleSet struct {
	Rules []Rule `yaml:"rules"`
}

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

// NewMatchResult creates a validated match result.
// Enforces invariant: Redeemable=true requires RedemptionRate > 0.
func NewMatchResult(category domain.Category, redeemable, vacation, transfer bool, redemptionRate float64, ruleName string) (*MatchResult, error) {
	if !domain.ValidateCategory(category) {
		return nil, fmt.Errorf("invalid category %q", category)
	}

	if redeemable && redemptionRate == 0 {
		return nil, fmt.Errorf("redeemable=true requires redemption_rate > 0")
	}

	if !redeemable && redemptionRate != 0 {
		return nil, fmt.Errorf("redeemable=false requires redemption_rate = 0")
	}

	return &MatchResult{
		Category:       category,
		Redeemable:     redeemable,
		Vacation:       vacation,
		Transfer:       transfer,
		RedemptionRate: redemptionRate,
		RuleName:       ruleName,
	}, nil
}

// NewEngine creates a rules engine from YAML data
func NewEngine(rulesData []byte) (*Engine, error) {
	var ruleSet RuleSet
	if err := yaml.Unmarshal(rulesData, &ruleSet); err != nil {
		return nil, fmt.Errorf("failed to parse YAML rules (check syntax, indentation, and field names): %w", err)
	}

	// Validate rules by reconstructing them through NewRule constructor
	validatedRules := make([]Rule, len(ruleSet.Rules))
	for i, rule := range ruleSet.Rules {
		validatedRule, err := NewRule(
			rule.Name,
			rule.Pattern,
			rule.MatchType,
			rule.Priority,
			rule.Category,
			rule.Flags,
			rule.RedemptionRate,
		)
		if err != nil {
			return nil, fmt.Errorf("rule %d (%s): %w", i, rule.Name, err)
		}
		validatedRules[i] = *validatedRule
	}

	// Sort rules by priority (highest first). Use SliceStable to preserve YAML file
	// order for rules with equal priority. This guarantees deterministic first-match-wins
	// behavior where the first rule in the YAML file wins when multiple equal-priority
	// rules match the same transaction.
	sort.SliceStable(validatedRules, func(i, j int) bool {
		return validatedRules[i].Priority > validatedRules[j].Priority
	})

	return &Engine{
		rules: validatedRules,
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
// this ordering). Returns (nil, false, nil) if no rules match.
func (e *Engine) Match(description string) (*MatchResult, bool, error) {
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
			result, err := NewMatchResult(
				domain.Category(rule.Category),
				rule.Flags.Redeemable,
				rule.Flags.Vacation,
				rule.Flags.Transfer,
				rule.RedemptionRate,
				rule.Name,
			)
			if err != nil {
				// Defense in depth: validation should prevent this, but return error instead of panic.
				// Return true because the rule matched - this is an internal error, not a match failure.

				// Log full details to stderr for debugging
				fmt.Fprintf(os.Stderr, "INTERNAL ERROR: Rule %q produced invalid MatchResult\n", rule.Name)
				fmt.Fprintf(os.Stderr, "  Category: %s, Redeemable: %v, Vacation: %v, Transfer: %v, Rate: %.2f\n",
					rule.Category, rule.Flags.Redeemable, rule.Flags.Vacation, rule.Flags.Transfer, rule.RedemptionRate)
				fmt.Fprintf(os.Stderr, "  Validation error: %v\n", err)

				return nil, true, fmt.Errorf("INTERNAL ERROR constructing match result from rule %q: %w (this indicates rule validation was bypassed or rules were modified after loading - please report this bug with rule definition)", rule.Name, err)
			}
			return result, true, nil
		}
	}

	return nil, false, nil
}

// GetRules returns a copy of the rules for inspection/debugging.
//
// Returns a new slice containing value copies of each Rule struct. Since Rule
// contains only value-type fields (no pointers, slices, or maps),
// modifying returned rules will not affect the engine's internal state.
// Rules are returned in priority order (highest first). For equal priorities,
// rules appear in YAML file order (stable sort).
func (e *Engine) GetRules() []Rule {
	result := make([]Rule, len(e.rules))
	copy(result, e.rules)
	return result
}
