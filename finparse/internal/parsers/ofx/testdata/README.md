# OFX Parser Test Data

This directory contains test data for the OFX parser. Real financial statement files are **not committed to git** for security and privacy reasons.

## Running Integration Tests

The test suite includes both:

1. **Synthetic tests** - Run automatically in CI using generated OFX content
2. **Integration tests** - Require real OFX/QFX files (skipped if files unavailable)

## Setting Up Test Data (Optional)

To run integration tests with real files locally:

1. **Copy sample OFX/QFX files** to this directory:
   - `amex.ofx` - American Express credit card statement
   - `capitalone.ofx` - Capital One credit card statement
   - `pnc.ofx` - PNC Bank checking/savings statement
   - `vanguard.ofx` - Vanguard investment statement
   - `tiaa.ofx` - TIAA investment statement

2. **Sanitize data** (recommended):
   - Remove or redact sensitive account numbers
   - Remove or redact personal information
   - Keep the OFX structure intact for testing

3. **Run tests**:
   ```bash
   cd finparse
   go test -v ./internal/parsers/ofx/...
   ```

Integration tests will automatically skip if test files are not present.

## Security Note

⚠️ **Never commit real financial data to git**

- All `.ofx` and `.qfx` files in this directory are gitignored
- The synthetic tests provide adequate coverage for CI/CD
- Real files are only needed for local validation during development
