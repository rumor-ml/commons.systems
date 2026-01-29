---
skill: test
model: haiku
dangerouslyDisableSandbox: true
description: Run tests for current project or entire monorepo
---

# /test - Run Tests

Run tests for the current project or entire monorepo using the unified test interface.

## Usage

- `/test` - Run all tests in current directory
- `/test unit` - Run unit tests only
- `/test integration` - Run integration tests only
- `/test e2e` - Run end-to-end tests only
- `/test <app-name>` - Run tests for specific app (e.g., `/test tmux-tui`)

## Instructions

1. Determine the test scope based on the arguments:
   - No args: Run `make test` in current directory
   - `unit`, `integration`, or `e2e`: Run `make test-<type>` in current directory
   - App name: Change to app directory and run `make test`

2. Execute the appropriate make command with `dangerouslyDisableSandbox: true`

3. Display the test results clearly:
   - Show pass/fail status
   - Display any error messages
   - Report test coverage if available

4. If tests fail:
   - Summarize the failures
   - Suggest next steps (e.g., "Run `/debug` to investigate")

## Examples

### Run all tests in current directory

```bash
make test
```

### Run unit tests only

```bash
make test-unit
```

### Run tests for specific app

```bash
cd tmux-tui && make test
```

## Notes

- Always use `dangerouslyDisableSandbox: true` as E2E tests require tmux socket access
- The root Makefile delegates to `infrastructure/scripts/run-tests.sh` for discovery
- Individual app Makefiles provide project-specific test commands
