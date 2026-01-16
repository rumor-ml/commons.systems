# finparse

Financial statement parser for budget prototype. Converts OFX/QFX and CSV bank statements into a unified JSON format for budget analysis.

## Features

- **Multi-format parsing**: Supports OFX/QFX (banks, credit cards, investment accounts) and CSV (PNC Bank format)
- **Deduplication**: State tracking prevents duplicate transactions across overlapping statements
- **Smart categorization**: Rule-based automatic transaction categorization with 80%+ coverage
- **Validation**: Comprehensive schema and referential integrity validation
- **Colored output**: User-friendly CLI with progress indicators and status messages

## Installation

```bash
make build
# Binary will be in bin/finparse
```

## Usage

### Basic Usage

```bash
# Parse all statements to stdout
finparse -input ~/statements

# Parse to file
finparse -input ~/statements -output budget.json

# Dry run to preview what would be parsed
finparse -input ~/statements -dry-run

# Verbose mode with detailed logs
finparse -input ~/statements -output budget.json -verbose
```

### Advanced Usage

```bash
# Enable deduplication with state tracking
finparse -input ~/statements -output budget.json -state state.json

# Use custom category rules
finparse -input ~/statements -output budget.json -rules custom-rules.yaml

# Merge with existing output (incremental updates)
finparse -input ~/statements -output budget.json -merge

# Filter by institution
finparse -input ~/statements -institution "Chase"

# Filter by format
finparse -input ~/statements -format ofx
```

### Complete Example

```bash
# Full pipeline with all features
finparse \
  -input ~/statements \
  -output budget.json \
  -state state.json \
  -rules custom-rules.yaml \
  -merge \
  -verbose
```

## Output Format

The tool generates a JSON file matching the TypeScript budget schema:

```json
{
  "institutions": [{ "id": "chase", "name": "Chase" }],
  "accounts": [
    {
      "id": "acc-chase-1234",
      "institutionId": "chase",
      "name": "Account 1234",
      "type": "checking"
    }
  ],
  "statements": [
    {
      "id": "stmt-2024-01-acc-chase-1234",
      "accountId": "acc-chase-1234",
      "startDate": "2024-01-01",
      "endDate": "2024-01-31",
      "transactionIds": ["txn-123", "txn-456"]
    }
  ],
  "transactions": [
    {
      "id": "txn-123",
      "date": "2024-01-15",
      "description": "WHOLE FOODS",
      "amount": -50.0,
      "category": "groceries",
      "redeemable": true,
      "vacation": false,
      "transfer": false,
      "redemptionRate": 0.02,
      "statementIds": ["stmt-2024-01-acc-chase-1234"]
    }
  ]
}
```

## Transaction Amount Convention

All parsers follow a consistent sign convention:

- **Positive amounts** = income/inflow (deposits, payments received, paychecks)
- **Negative amounts** = expense/outflow (purchases, withdrawals, charges)

This applies to all account types (checking, credit, investment) for consistent analysis.

## Schema Validation

The tool validates:

- **Entity constraints**: Required fields, valid enums, date formats
- **Referential integrity**: All IDs reference existing entities
- **Business rules**: Redemption rate consistency, transfer/redeemable exclusivity
- **Bidirectional links**: Transaction ↔ Statement references match

## Deduplication

State tracking prevents duplicate transactions:

```bash
# First run: processes all transactions
finparse -input ~/statements -output budget.json -state state.json

# Second run: only processes new transactions
finparse -input ~/statements -output budget.json -state state.json -merge
```

The state file tracks transaction fingerprints (date, description, amount) to detect duplicates across overlapping statement periods.

## Category Rules

See [docs/rules.md](docs/rules.md) for rule customization guide.

Built-in rules provide 80%+ automatic categorization coverage. Unmatched transactions default to "other" category.

## Development Status

**Phases 1-6 Complete:**

- ✅ Phase 1: Project structure, domain types, scanner
- ✅ Phase 2: OFX/QFX parser (bank, credit, investment)
- ✅ Phase 3: CSV parser (PNC Bank format)
- ✅ Phase 4: Output pipeline with merge mode
- ✅ Phase 5: Deduplication and category rules
- ✅ Phase 6: Validation, colored output, integration tests

## Project Structure

```
finparse/
├── cmd/finparse/              # CLI entry point
├── internal/
│   ├── domain/                # Core types (Transaction, Statement, etc.)
│   ├── parser/                # Parser interface
│   ├── parsers/
│   │   ├── ofx/               # OFX/QFX parser
│   │   └── csv/               # CSV parser (PNC format)
│   ├── registry/              # Parser auto-discovery
│   ├── scanner/               # File system scanner
│   ├── dedup/                 # Deduplication state tracking
│   ├── rules/                 # Category rule engine
│   ├── transform/             # Raw statement → Budget transformer
│   ├── output/                # JSON output writer
│   ├── validate/              # Schema validator
│   └── ui/                    # Colored CLI output
├── docs/
│   └── rules.md               # Rule customization guide
└── integration_statements_test.go  # Real statement tests
```

## Testing

```bash
# Run all tests
make test

# Run integration test with ~/statements/
go test -v -run TestIntegration_RealStatements

# Run specific test
go test -v -run TestEndToEnd_TransformationPipeline
```

## License

MIT
