---
skill: validate
model: haiku
dangerouslyDisableSandbox: true
description: Run full validation pipeline (lint + typecheck + test)
---

# /validate - Full Validation Pipeline

Run the complete validation pipeline for the current project: linting, type checking, and testing.

## Usage

- `/validate` - Run full validation (lint + typecheck + test)
- `/validate quick` - Skip tests, run lint + typecheck only

## Instructions

1. Determine validation scope:
   - No args: Run `make validate` (full pipeline)
   - `quick` arg: Run `make lint && make typecheck` (skip tests)

2. Execute validation with `dangerouslyDisableSandbox: true`

3. Report results for each stage:
   - **Linting**: Show any style or quality issues
   - **Type checking**: Show any type errors
   - **Testing**: Show test results (if running full validation)

4. Provide summary:
   - ✓ All checks passed
   - Or list which checks failed and why

5. If validation fails:
   - Offer to fix issues automatically (for formatting/linting)
   - Suggest running `/debug` for investigation
   - Provide specific commands to fix issues

## Examples

### Full validation

```bash
make validate
```

### Quick validation (no tests)

```bash
make lint && make typecheck
```

### Fix formatting issues automatically

```bash
make format
```

## Validation Pipeline

The `make validate` target runs:

1. `make lint` - Go vet, ESLint
2. `make typecheck` - Go build, TypeScript tsc
3. `make test` - All tests

## Notes

- Uses `dangerouslyDisableSandbox: true` for git/gh/pnpm access
- The root Makefile auto-detects project type (Go/TypeScript/hybrid)
- Individual app Makefiles may have additional validation steps
