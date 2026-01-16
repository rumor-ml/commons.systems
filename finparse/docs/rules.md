# Category Rules Guide

finparse uses a rule-based engine to automatically categorize transactions. Rules match transaction descriptions and assign categories.

## Rule Structure

Rules are defined in YAML format:

```yaml
- description: 'Whole Foods'
  match_type: 'contains'
  category: 'groceries'
  priority: 100
  redeemable: true
  redemption_rate: 0.02
```

### Required Fields

- **description**: Text pattern to match against transaction descriptions
- **match_type**: How to match the pattern (see Match Types below)
- **category**: Budget category to assign (see Categories below)
- **priority**: Rule precedence (0-999, higher = more specific)

### Optional Fields

- **redeemable**: Whether transaction earns cashback (default: false)
- **redemption_rate**: Cashback rate (0.0-1.0, e.g., 0.02 = 2%)
- **vacation**: Mark as vacation expense (default: false)
- **transfer**: Mark as account transfer (default: false)

## Match Types

### exact

Matches the entire description exactly (case-insensitive):

```yaml
- description: 'PAYPAL *NETFLIX'
  match_type: 'exact'
  category: 'entertainment'
  priority: 200
```

### contains

Matches if description contains the pattern (case-insensitive):

```yaml
- description: 'WHOLEFDS'
  match_type: 'contains'
  category: 'groceries'
  priority: 100
```

**Note**: `contains` is the most common and flexible match type.

## Categories

Valid categories (from TypeScript budget schema):

- **income**: Paychecks, deposits, reimbursements
- **housing**: Rent, mortgage, property taxes, HOA
- **utilities**: Electric, gas, water, internet, phone
- **groceries**: Supermarkets, grocery stores
- **dining**: Restaurants, food delivery, coffee shops
- **transportation**: Gas, car payments, insurance, rideshare
- **healthcare**: Doctor visits, prescriptions, insurance
- **entertainment**: Movies, streaming, concerts, hobbies
- **shopping**: Retail, clothing, electronics
- **travel**: Flights, hotels, vacation expenses
- **investment**: Brokerage transfers, retirement contributions
- **other**: Default for unmatched transactions

## Priority

Priority determines which rule wins when multiple rules match:

- **0-99**: Generic catch-all rules (e.g., "WHOLEFDS" → groceries)
- **100-499**: Standard merchant rules (e.g., "Whole Foods" → groceries)
- **500-899**: Specific merchant rules (e.g., "WHOLEFDS #123 SUNNYVALE" → groceries)
- **900-999**: Override rules (e.g., "WHOLEFDS GIFT CARD" → shopping, not groceries)

**Example conflict resolution:**

```yaml
# Generic rule (lower priority)
- description: 'WHOLEFDS'
  match_type: 'contains'
  category: 'groceries'
  priority: 100

# Specific override (higher priority wins)
- description: 'WHOLEFDS GIFT CARD'
  match_type: 'contains'
  category: 'shopping'
  priority: 900
```

## Flags

### Redeemable

Mark transactions that earn cashback:

```yaml
- description: 'WHOLEFDS'
  match_type: 'contains'
  category: 'groceries'
  priority: 100
  redeemable: true
  redemption_rate: 0.02 # 2% cashback
```

**Rules**:

- `redeemable: true` requires `redemption_rate > 0`
- `redeemable: false` requires `redemption_rate = 0`
- Transfers cannot be redeemable

### Vacation

Mark vacation-related expenses:

```yaml
- description: 'DELTA AIR'
  match_type: 'contains'
  category: 'travel'
  priority: 100
  vacation: true
```

### Transfer

Mark account-to-account transfers:

```yaml
- description: 'XFER FROM CHECKING'
  match_type: 'contains'
  category: 'other'
  priority: 500
  transfer: true
```

**Note**: Transfers cannot be redeemable (no cashback on transfers).

## Example Rules

### Groceries

```yaml
- description: 'WHOLEFDS'
  match_type: 'contains'
  category: 'groceries'
  priority: 100
  redeemable: true
  redemption_rate: 0.02

- description: 'TRADER JOE'
  match_type: 'contains'
  category: 'groceries'
  priority: 100
  redeemable: true
  redemption_rate: 0.02

- description: 'SAFEWAY'
  match_type: 'contains'
  category: 'groceries'
  priority: 100
```

### Dining

```yaml
- description: 'DOORDASH'
  match_type: 'contains'
  category: 'dining'
  priority: 100
  redeemable: true
  redemption_rate: 0.03

- description: 'UBER EATS'
  match_type: 'contains'
  category: 'dining'
  priority: 100

- description: 'STARBUCKS'
  match_type: 'contains'
  category: 'dining'
  priority: 100
```

### Transportation

```yaml
- description: 'SHELL'
  match_type: 'contains'
  category: 'transportation'
  priority: 100

- description: 'CHEVRON'
  match_type: 'contains'
  category: 'transportation'
  priority: 100

- description: 'UBER'
  match_type: 'contains'
  category: 'transportation'
  priority: 100
```

### Utilities

```yaml
- description: 'PGE'
  match_type: 'contains'
  category: 'utilities'
  priority: 100

- description: 'COMCAST'
  match_type: 'contains'
  category: 'utilities'
  priority: 100

- description: 'AT&T'
  match_type: 'contains'
  category: 'utilities'
  priority: 100
```

### Entertainment

```yaml
- description: 'NETFLIX'
  match_type: 'contains'
  category: 'entertainment'
  priority: 100

- description: 'SPOTIFY'
  match_type: 'contains'
  category: 'entertainment'
  priority: 100

- description: 'AMC THEATRES'
  match_type: 'contains'
  category: 'entertainment'
  priority: 100
```

### Travel

```yaml
- description: 'DELTA AIR'
  match_type: 'contains'
  category: 'travel'
  priority: 100
  vacation: true

- description: 'MARRIOTT'
  match_type: 'contains'
  category: 'travel'
  priority: 100
  vacation: true

- description: 'AIRBNB'
  match_type: 'contains'
  category: 'travel'
  priority: 100
  vacation: true
```

### Transfers

```yaml
- description: 'XFER FROM'
  match_type: 'contains'
  category: 'other'
  priority: 500
  transfer: true

- description: 'ONLINE TRANSFER'
  match_type: 'contains'
  category: 'other'
  priority: 500
  transfer: true
```

## Using Custom Rules

### Create a Rules File

1. Create a YAML file (e.g., `my-rules.yaml`)
2. Add your rules following the structure above
3. Use the `-rules` flag:

```bash
finparse -input ~/statements -output budget.json -rules my-rules.yaml
```

### Start from Built-in Rules

The built-in rules are embedded in the binary. To export them:

```go
// In Go code
engine, _ := rules.LoadEmbedded()
rules := engine.GetRules()
// Marshal to YAML and save
```

Or reference the embedded rules file: `internal/rules/embedded/rules.yaml`

### Testing Rules

Test your rules without writing output:

```bash
# Dry run with verbose output
finparse -input ~/statements -rules my-rules.yaml -dry-run -verbose

# Check rule coverage
finparse -input ~/statements -rules my-rules.yaml -verbose | grep "Rule coverage"
```

**Target**: 80%+ rule coverage (80% of transactions matched)

### Debugging Unmatched Transactions

Run with `-verbose` to see unmatched transactions:

```bash
finparse -input ~/statements -output budget.json -verbose
```

Look for:

```
Rule matching statistics:
  Matched: 950 (95.0%)
  Unmatched: 50
  Example unmatched transactions:
    - MYSTERY MERCHANT 123
    - UNKNOWN STORE XYZ
```

Add rules for these merchants to improve coverage.

## Best Practices

1. **Start with embedded rules**: They provide 80%+ coverage for common merchants
2. **Use generic patterns**: `"WHOLEFDS"` matches all Whole Foods locations
3. **Set appropriate priorities**: Generic rules low, specific overrides high
4. **Test incrementally**: Add rules one at a time and verify coverage
5. **Document exceptions**: Use comments in YAML for unusual rules
6. **Version control**: Keep your rules file in git for history

## Rule Development Workflow

1. **Run with verbose output**:

   ```bash
   finparse -input ~/statements -verbose -output budget.json
   ```

2. **Identify unmatched transactions** in the output

3. **Add rules** to your custom rules file:

   ```yaml
   - description: 'NEW MERCHANT'
     match_type: 'contains'
     category: 'shopping'
     priority: 100
   ```

4. **Test and iterate**:

   ```bash
   finparse -input ~/statements -rules my-rules.yaml -verbose -output budget.json
   ```

5. **Verify coverage improved**:
   ```
   Rule coverage: 85.0% (850/1000 matched)  # Better than before!
   ```

## Common Patterns

### Bank-specific Formatting

Different banks format merchant names differently:

```yaml
# Chase: "WHOLEFDS #123"
# Amex: "WHOLE FOODS MKT"
# PNC: "WHOLE FOODS MARKET"

# Generic pattern matches all
- description: 'WHOLE'
  match_type: 'contains'
  category: 'groceries'
  priority: 100
```

### Payment Processors

Watch for payment processor prefixes:

```yaml
# Matches: "PAYPAL *NETFLIX", "PAYPAL *SPOTIFY"
- description: 'PAYPAL *NETFLIX'
  match_type: 'exact'
  category: 'entertainment'
  priority: 200

- description: 'SQ *COFFEE SHOP'
  match_type: 'contains'
  category: 'dining'
  priority: 200
```

### Recurring Subscriptions

Group subscriptions for easy analysis:

```yaml
- description: 'NETFLIX'
  match_type: 'contains'
  category: 'entertainment'
  priority: 100

- description: 'SPOTIFY'
  match_type: 'contains'
  category: 'entertainment'
  priority: 100

- description: 'AMAZON PRIME'
  match_type: 'contains'
  category: 'shopping'
  priority: 100
```

## Troubleshooting

### Rule Not Matching

1. Check for **typos** in description
2. Verify **match_type** (exact vs contains)
3. Try **shorter pattern**: "WHOLE" instead of "WHOLE FOODS MARKET"
4. Check **priority**: Higher priority rules override lower

### Multiple Rules Matching

The **highest priority** rule wins:

```yaml
# Both match "WHOLEFDS GIFT CARD", but priority 900 wins
- description: 'WHOLEFDS'
  priority: 100
  category: 'groceries'

- description: 'GIFT CARD'
  priority: 900
  category: 'shopping' # This wins!
```

### Validation Errors

Check for:

- Invalid **category** (must be one of 12 valid categories)
- Invalid **redemption_rate** (must be 0.0-1.0)
- **transfer + redeemable** conflict (not allowed)
- **redeemable without rate** (must have rate > 0)

## Advanced Topics

### Regex Support (Future)

Currently only `exact` and `contains` are supported. Regex matching may be added in a future version.

### Dynamic Rules (Future)

Rule learning from user corrections may be added in a future version.

### Rule Analytics (Future)

Metrics on rule effectiveness (match count, coverage by category) may be added in a future version.

## Getting Help

- **Issue tracker**: Report bugs or request features
- **Built-in rules**: Reference `internal/rules/embedded/rules.yaml` for examples
- **Test your rules**: Use `-verbose` flag to debug matching
