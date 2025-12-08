# PrintSync E2E Test Suite

End-to-end tests for the PrintSync application using Playwright with Firebase emulators.

## Overview

This test suite validates the complete PrintSync workflow, from file discovery to upload and trash management. Tests run against local Firebase emulators (Firestore and Cloud Storage) to ensure isolated, reproducible test runs.

## Test Files

### Basic Workflows

- **`homepage.spec.ts`** - Homepage and navigation tests
- **`approval-flow.spec.ts`** - Single file approval and upload workflow
- **`bulk-approval.spec.ts`** - Bulk approval operations for multiple files
- **`rejection-flow.spec.ts`** - File rejection workflow
- **`mixed-workflow.spec.ts`** - Mixed approve/reject operations
- **`trash-workflow.spec.ts`** - Trash and restore operations

### Advanced Tests

- **`error-handling.spec.ts`** - Error states, error messages, and recovery mechanisms
- **`sse-realtime.spec.ts`** - Server-Sent Events (SSE) real-time updates using HTMX
- **`concurrent-operations.spec.ts`** - Session isolation, duplicate detection, and concurrent operations

## Prerequisites

### Required Software

- Node.js 18+ and pnpm
- Go 1.22+
- Firebase CLI (`npm install -g firebase-tools`)
- Playwright browsers

### Install Dependencies

```bash
# Install Node.js dependencies
pnpm install

# Install Playwright browsers
pnpm exec playwright install

# Install Go dependencies
cd printsync
go mod download
```

### Install templ (for Go template generation)

```bash
go install github.com/a-h/templ/cmd/templ@latest
```

## Running Tests Locally

### 1. Start Firebase Emulators

The test script automatically starts and stops emulators, but you can also run them manually:

```bash
# From project root
firebase emulators:start --only firestore,storage --project demo-test
```

The emulators will start on:

- Firestore: `localhost:8082`
- Cloud Storage: `localhost:9199`
- Emulator UI: `localhost:4000`

### 2. Build the Application

```bash
cd printsync
make build
```

This will:

- Generate Go code from templ templates
- Build CSS with Tailwind
- Compile the Go binary

### 3. Run E2E Tests

```bash
# From printsync directory
pnpm test:e2e

# Or from project root
cd printsync && pnpm test:e2e
```

### 4. Run Specific Tests

```bash
# Run a single test file
pnpm exec playwright test error-handling.spec.ts

# Run tests matching a pattern
pnpm exec playwright test --grep "approval"

# Run tests in UI mode (interactive)
pnpm exec playwright test --ui

# Run tests with debugging
pnpm exec playwright test --debug
```

## Environment Variables

The test suite uses the following environment variables:

### Required (automatically set by test script)

- `FIRESTORE_EMULATOR_HOST=localhost:8082` - Firestore emulator host
- `STORAGE_EMULATOR_HOST=localhost:9199` - Cloud Storage emulator host
- `GCLOUD_PROJECT=demo-test` - GCP project ID for emulators

### Optional

- `HEADLESS=true` - Run tests in headless mode (default in CI)
- `CI=true` - Enables CI-specific behavior

## Test Architecture

### Fixtures

Tests use custom Playwright fixtures defined in `tests/fixtures/`:

- **`printsync-fixtures.ts`** - Main fixture that extends Playwright with:
  - `helpers` - TestHelpers instance for Firestore/GCS operations
  - `testSession` - Pre-seeded test session with sample files

- **`test-helpers.ts`** - Helper functions for:
  - Creating test sessions in Firestore
  - Creating test files in Firestore
  - Waiting for file status changes
  - Asserting Firestore and GCS state
  - Automatic cleanup after tests

- **`test-data.ts`** - Test data generators for:
  - PDF and EPUB file metadata
  - Test user IDs and session IDs
  - File hashes and content

### Import Pattern

All test files should use the custom fixtures:

```typescript
import { test, expect } from '../fixtures/printsync-fixtures';

test('my test', async ({ page, testSession, helpers }) => {
  // Test implementation
});
```

## Troubleshooting

### Emulators Won't Start

**Problem**: Emulators fail to start or ports are already in use

**Solution**:

```bash
# Kill processes on emulator ports
lsof -ti:8082 | xargs kill -9  # Firestore
lsof -ti:9199 | xargs kill -9  # Storage
lsof -ti:4000 | xargs kill -9  # UI
```

### Tests Timeout

**Problem**: Tests timeout waiting for file status changes

**Possible causes**:

1. PrintSync server not running or crashed
2. Emulators not accessible
3. Firestore writes not completing

**Solution**:

```bash
# Check emulator logs
cat /tmp/claude/emulators.log

# Check server is running
curl http://localhost:8080/health

# Increase timeout in test
await helpers.waitForFileStatus(fileID, 'uploaded', 60000); // 60s
```

### Playwright Browser Issues

**Problem**: Browser fails to launch or tests fail to run

**Solution**:

```bash
# Reinstall browsers
pnpm exec playwright install --force

# Clear Playwright cache
rm -rf ~/.cache/ms-playwright
pnpm exec playwright install
```

### Firestore Data Persists Between Tests

**Problem**: Test data from previous runs affects new tests

**Solution**:

- Fixtures automatically clean up after each test
- If cleanup fails, manually clear emulator data:

```bash
# Restart emulators (clears all data)
firebase emulators:start --only firestore,storage --project demo-test
```

### Tests Pass Locally but Fail in CI

**Possible causes**:

1. Different environment variables
2. Timing issues (slower CI environment)
3. Missing dependencies

**Solution**:

- Check CI logs for specific error messages
- Download test artifacts from failed CI runs
- Run tests with `CI=true` locally to simulate CI environment:

```bash
CI=true pnpm test:e2e
```

## CI/CD Integration

Tests run automatically in GitHub Actions for every push and pull request.

### Workflow: `push-main.yml`

The `test-go-fullstack-printsync` job:

1. Checks out code
2. Sets up Go and Node.js
3. Installs dependencies
4. Runs `infrastructure/scripts/test-go-fullstack-app.sh printsync`
5. Uploads artifacts on failure:
   - Emulator logs (`/tmp/claude/emulators.log`)
   - Test results (`printsync/test-results/`)
   - Playwright report (`printsync/playwright-report/`)

### Viewing CI Artifacts

When tests fail in CI:

1. Go to the failed workflow run
2. Scroll to "Artifacts" section at the bottom
3. Download:
   - `emulator-logs-printsync` - Emulator output and errors
   - `test-results-printsync` - Test results and screenshots

### CI Test Script

The test script (`infrastructure/scripts/test-go-fullstack-app.sh`) does:

1. Start Firebase emulators in background
2. Build the PrintSync application
3. Start the PrintSync server
4. Run E2E tests with Playwright
5. Clean up (kill emulators and server)

## Writing New Tests

### Template for New Test File

```typescript
import { test, expect } from '../fixtures/printsync-fixtures';
import { generateTestPDFFile } from '../fixtures/test-data';

test.describe('My Feature Tests', () => {
  test('should do something', async ({ page, helpers }) => {
    // Create test data
    const userID = 'test-user-123';
    const file = generateTestPDFFile({
      localPath: '/test/my-test.pdf',
      status: 'pending',
    });

    const sessionID = await helpers.createTestSession(userID, '/test', [
      {
        localPath: file.localPath,
        hash: file.hash,
        status: file.status,
        metadata: file.metadata,
      },
    ]);

    const fileID = await helpers.createTestFile(sessionID, file);

    // Navigate to page
    await page.goto(`http://localhost:8080/sync/${sessionID}`);
    await page.waitForLoadState('networkidle');

    // Test assertions
    const fileRow = page.locator(`#file-${fileID}`);
    await expect(fileRow).toBeVisible();

    // Cleanup is automatic via fixtures
  });
});
```

### Best Practices

1. **Use fixtures** - Always use `testSession` or `helpers` fixtures for test data
2. **Clean locators** - Use data attributes or IDs for stable selectors
3. **Wait for network** - Use `waitForLoadState('networkidle')` after navigation
4. **Graceful degradation** - Use `.catch(() => false)` for features not yet implemented
5. **Meaningful assertions** - Assert on both Firestore state AND UI state
6. **Timeouts** - Set appropriate timeouts for async operations

## Performance

- Average test execution time: 2-5 seconds per test
- Full suite execution: ~1-2 minutes
- CI execution time: ~5-10 minutes (including build)

## Coverage

Current test coverage includes:

- File approval and upload workflows
- File rejection workflows
- Bulk operations
- Trash and restore operations
- Error handling and recovery
- Real-time SSE updates (HTMX)
- Session isolation
- Concurrent operations
- Duplicate detection

## Future Enhancements

Potential areas for additional testing:

- File metadata editing
- Search and filtering
- Pagination for large file lists
- Network error simulation
- Performance testing with large datasets
- Accessibility testing
- Mobile responsive testing
