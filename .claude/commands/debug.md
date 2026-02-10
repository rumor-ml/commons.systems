---
skill: debug
model: haiku
dangerouslyDisableSandbox: true
description: Run debugging and diagnostic tools
---

# /debug - Debugging and Diagnostics

Run debugging and diagnostic tools to investigate test failures, build issues, or code quality problems.

## Usage

- `/debug` - Interactive debugging menu
- `/debug lint` - Run linters and show detailed output
- `/debug typecheck` - Run type checkers with verbose output
- `/debug coverage` - Generate and display test coverage report
- `/debug logs <app>` - Show recent logs for an app

## Instructions

### Interactive Mode (no args)

1. Ask the user what they want to debug:
   - Test failures
   - Build/compilation errors
   - Type errors
   - Code quality issues
   - Runtime errors

2. Based on their response, run appropriate diagnostic commands

### Specific Debug Commands

#### Lint Debug

```bash
# Go projects
go vet -v ./...

# TypeScript/JavaScript projects
pnpm eslint . --format verbose
```

#### Type Check Debug

```bash
# Go projects
go build -v ./...

# TypeScript projects
pnpm tsc --noEmit --listFiles
```

#### Coverage Report

```bash
# Go projects
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out -o coverage.html
cat coverage.out | grep -v "100.0%"

# TypeScript/JavaScript projects (if Jest configured)
pnpm test --coverage
```

#### Log Analysis

```bash
# For Go apps with structured logging
cd <app-name> && go run ./cmd/... 2>&1 | jq .

# For Firebase/Cloud Run apps
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=<app>" --limit 50
```

## Debugging Workflows

### Test Failure Investigation

1. Run failed test with verbose output:

   ```bash
   go test -v -run TestSpecificTest ./...
   ```

2. Check for common issues:
   - Missing dependencies
   - Environment variables not set
   - Test data/fixtures missing
   - Timing/race conditions

3. Suggest fixes based on error patterns

### Build/Compilation Errors

1. Run build with verbose output:

   ```bash
   go build -v ./...
   ```

2. Check for:
   - Import errors
   - Missing packages
   - Syntax errors
   - Module issues

3. Suggest running `go mod tidy` if dependency-related

### Type Errors

1. Run TypeScript compiler with verbose output:

   ```bash
   pnpm tsc --noEmit --pretty
   ```

2. Identify error patterns:
   - Missing type definitions
   - Incorrect type usage
   - Strict mode violations

3. Offer to fix simple type errors

## Notes

- Always use `dangerouslyDisableSandbox: true` for tool access
- Generate coverage reports in `tmp/` directory (gitignored)
- For Firebase apps, may need `gcloud auth` configured
- E2E test debugging may require tmux session inspection
