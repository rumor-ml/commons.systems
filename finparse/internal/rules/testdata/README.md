# Reference Transaction Data

This directory contains reference data for testing rule coverage.

## reference_transactions.txt

Contains 1,268 transaction descriptions from the carriercommons reference database.
These are used to validate that embedded rules meet the ≥95% coverage requirement
from issue #1261.

### Updating the Data

If the reference database is updated, regenerate this file:

```bash
sqlite3 ~/carriercommons/finance/finance.db \
  "SELECT name FROM transactions ORDER BY id" \
  > finparse/internal/rules/testdata/reference_transactions.txt
```

Verify the count:

```bash
wc -l finparse/internal/rules/testdata/reference_transactions.txt
# Should output: 1268
```

### Why Embedded?

The testdata is embedded in the test binary (via `//go:embed`) to ensure:

- Tests run in CI without database access
- All developers can run tests locally
- Coverage regressions are caught immediately
- No runtime dependency on external database

Before this change, the test would skip if the database wasn't available,
making it easy to miss coverage regressions.
