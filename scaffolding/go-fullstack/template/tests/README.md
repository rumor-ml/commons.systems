# {{APP_NAME_TITLE}} E2E Tests

This directory contains end-to-end tests for {{APP_NAME_TITLE}} using Playwright.

## Overview

The test suite includes:
- **Basic UI tests** - Testing page navigation, HTMX interactions, and React islands
- **Emulator-based tests** - Testing backend workflows using Firebase emulators
- **Test helpers** - Utilities for seeding data and verifying async operations

## Quick Start

### Running Tests Locally

```bash
# From the tests directory
pnpm test

# Or from the site directory
make test-e2e
```

**Note:** Tests that interact with Firebase emulators (e.g., `example-workflow.spec.ts`) require emulators to be running first.

### Running with Emulators

```bash
# Option 1: Start emulators manually, then run tests
firebase emulators:start  # In one terminal
pnpm test                 # In another terminal

# Option 2: Use make target (starts emulators automatically)
cd ../site
make test-emulator
```

## Test Structure

### Files

```
tests/
├── e2e/
│   ├── homepage.spec.ts          # Basic UI tests (no emulators needed)
│   └── example-workflow.spec.ts  # Example emulator-based tests
├── fixtures/
│   ├── test-helpers.ts            # Generic emulator utilities
│   └── {{APP_NAME}}-fixtures.ts   # App-specific Playwright fixtures
├── playwright.config.ts           # Playwright configuration
└── package.json                   # Test dependencies
```

### Test Types

#### 1. Basic UI Tests (`homepage.spec.ts`)
- Test page loading and navigation
- Test HTMX partial updates
- Test React island hydration
- **No emulators required**

#### 2. Emulator-based Tests (`example-workflow.spec.ts`)
- Test complete workflows with backend operations
- Seed test data in Firestore
- Wait for async operations to complete
- Verify final state in Firestore and GCS
- **Requires emulators running**

## Writing Tests

### Using Test Helpers

The `TestHelpers` class provides utilities for working with Firebase emulators:

```typescript
import { test, expect } from '../fixtures/{{APP_NAME}}-fixtures';

test('my test', async ({ helpers }) => {
  // Create test data
  const itemID = await helpers.createItem('items', {
    name: 'Test Item',
    status: 'pending',
  });

  // Wait for async operation to complete
  await helpers.waitForCondition(
    'items',
    itemID,
    (data) => data.status === 'completed',
    30000 // 30 second timeout
  );

  // Verify final state
  await helpers.assertItemInFirestore('items', itemID, {
    status: 'completed',
  });
});
```

### Creating Custom Fixtures

Add app-specific fixtures to `fixtures/{{APP_NAME}}-fixtures.ts`:

```typescript
export const test = base.extend<{
  helpers: TestHelpers;
  testUser: { userID: string };  // Add your fixture type
}>({
  helpers: async ({}, use) => { /* ... */ },

  // Your custom fixture
  testUser: async ({ helpers }, use) => {
    const userID = await helpers.createItem('users', {
      email: 'test@example.com',
      name: 'Test User',
    });

    await use({ userID });
  },
});
```

### Testing Patterns

#### 1. Wait for Async Operations

Always use `waitForCondition()` instead of fixed timeouts:

```typescript
// Good ✓
await helpers.waitForCondition(
  'tasks',
  taskID,
  (data) => data.status === 'completed'
);

// Bad ✗
await page.waitForTimeout(5000);
```

#### 2. Verify State in Multiple Places

Check both UI and backend state:

```typescript
// Verify UI shows correct state
await expect(fileRow).toContainText('Uploaded');

// Verify Firestore has correct data
await helpers.assertItemInFirestore('files', fileID, {
  status: 'uploaded',
  gcsPath: expect.stringMatching(/^uploads\//),
});

// Verify file exists in GCS
const item = await helpers.getItem('files', fileID);
await helpers.assertFileInGCS('test-bucket', item.gcsPath);
```

#### 3. Test Real-time Updates (SSE)

For Server-Sent Events, update Firestore and wait for UI to reflect changes:

```typescript
// Navigate to page with SSE connection
await page.goto(`/items/${itemID}`);

// Update Firestore directly
const firestore = helpers.getFirestore();
await firestore.collection('items').doc(itemID).update({
  status: 'processing',
});

// Wait for SSE to update UI
await expect(statusElement).toContainText('processing', { timeout: 5000 });
```

#### 4. Automatic Cleanup

Test data is cleaned up automatically - no need to manually delete:

```typescript
test('my test', async ({ helpers }) => {
  const item1 = await helpers.createItem('items', { name: 'Item 1' });
  const item2 = await helpers.createItem('items', { name: 'Item 2' });

  // ... test logic ...

  // Cleanup happens automatically after test completes
  // Even if the test fails!
});
```

## Configuration

### Emulator Ports

Default emulator ports (configured in `playwright.config.ts`):
- Firestore: `localhost:8082`
- Storage: `localhost:9199`

These match the default Firebase emulator configuration. If you use different ports, update the `env` section in `playwright.config.ts`.

### Timeouts

- Per-test timeout: 60 seconds
- Assertion timeout: 10 seconds
- Custom waits: Configurable per operation

## Troubleshooting

### "FIRESTORE_EMULATOR_HOST environment variable not set"

**Solution:** Start Firebase emulators before running tests:
```bash
firebase emulators:start
```

### Tests timeout waiting for conditions

**Possible causes:**
1. Emulators not running
2. Backend not processing events
3. Incorrect collection/document names
4. Backend error (check server logs)

**Debug steps:**
```bash
# Check emulators are running
curl http://localhost:8082/

# Check server logs
cd ../site && make dev

# Run test in headed mode to see what's happening
pnpm test:headed
```

### Tests pass locally but fail in CI

**Possible causes:**
1. CI not starting emulators
2. Different timeout requirements in CI
3. Port conflicts in CI environment

**Solution:** Check CI configuration includes emulator startup and allows sufficient time for operations.

## Advanced Usage

### Direct Firestore/GCS Access

For operations not covered by helpers:

```typescript
const firestore = helpers.getFirestore();
const storage = helpers.getStorage();

// Complex query
const snapshot = await firestore
  .collection('items')
  .where('status', '==', 'pending')
  .where('createdAt', '>', yesterday)
  .orderBy('createdAt', 'desc')
  .limit(10)
  .get();

// Upload file to GCS
const bucket = storage.bucket('test-bucket');
await bucket.file('test.txt').save(Buffer.from('test content'));
```

### Seeding Complex Data Structures

```typescript
// Create related documents
const projectID = await helpers.createItem('projects', {
  name: 'Test Project',
});

// Create multiple related items
const taskIDs = await Promise.all(
  [1, 2, 3].map(i =>
    helpers.createItem('tasks', {
      title: `Task ${i}`,
      projectID,
      status: 'pending',
    })
  )
);
```

## Best Practices

1. **Use fixtures for common scenarios** - Create reusable fixtures for frequently used test data
2. **Test one thing per test** - Keep tests focused and independent
3. **Use meaningful test names** - Describe what the test verifies
4. **Wait for conditions, not timeouts** - Use `waitForCondition()` instead of fixed waits
5. **Verify complete state** - Check UI, Firestore, and GCS as appropriate
6. **Trust automatic cleanup** - Don't manually delete test data in tests
7. **Add comments for complex waits** - Explain what you're waiting for and why

## Resources

- [Playwright Documentation](https://playwright.dev/)
- [Firebase Emulator Suite](https://firebase.google.com/docs/emulator-suite)
- [Firestore Node.js SDK](https://googleapis.dev/nodejs/firestore/latest/)
- [GCS Node.js SDK](https://googleapis.dev/nodejs/storage/latest/)
