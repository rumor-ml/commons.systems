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

**IMPORTANT: Execute each step below sequentially. Do not skip steps or proceed to other work until all steps are complete.**

1. Parse command line arguments to determine test scope:
   - No args: test type = `all`
   - `unit`, `integration`, or `e2e`: test type = argument value
   - Otherwise: test type = app name
   - Store for use in later steps

2. Auto-detect and start emulators if needed (for E2E tests):
   - Determine if emulators are needed:
     - If test type is `e2e`: emulators needed = true
     - If test type is `all`: emulators needed = true (include E2E)
     - Otherwise: emulators needed = false
   - If emulators needed:
     - Check if emulators are running: `nc -z 127.0.0.1 9099 2>/dev/null`
     - If not running:
       - Source port utilities: `source infrastructure/scripts/port-utils.sh`
       - Run: `infrastructure/scripts/start-emulators.sh`
       - Use `dangerouslyDisableSandbox: true`
       - If startup succeeds, continue to next step
       - If startup fails, display error and exit

3. Execute the appropriate make command:
   - If test type is `all`: Run `make test`
   - If test type is `unit`, `integration`, or `e2e`: Run `make test-<type>`
   - If test type is app name: Run `cd <app-name> && make test`
   - Use `dangerouslyDisableSandbox: true` for execution
   - Capture all output

4. Display the test results clearly:
   - Show pass/fail status
   - Display any error messages or assertion failures
   - Report test coverage if available

5. If tests fail:
   - Summarize the failures (test names, error messages)
   - Suggest next steps (e.g., "Run `/debug` to investigate", "Check logs for details")

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
- Emulator pool mode is auto-detected via `POOL_INSTANCE_ID` environment variable
- The root Makefile delegates to `infrastructure/scripts/run-tests.sh` for discovery
- Individual app Makefiles provide project-specific test commands
- Emulators persist after tests complete (use `/stop-emulators` to shut down)
