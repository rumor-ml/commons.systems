# Test Stability Guide

This guide documents best practices and patterns for writing stable E2E tests across all apps in the monorepo.

## Retry Strategy

### Default Configuration

The base Playwright config (`playwright.base.config.ts`) sets:

- **CI**: 2 retries per test
- **Local**: 0 retries

This default works well for most UI/timing-dependent tests.

### When to Override Retries

Use `test.describe().configure({ retries: N })` to override retries for specific test suites:

#### Database/API Tests: 1 retry (fail fast)

```javascript
test.describe('Database Operations', () => {
  test.describe().configure({ retries: 1 });

  // Tests that interact with Firestore/APIs
  // These should fail fast - no need for multiple retries
});
```

**Rationale**: Database and API tests are deterministic. If they fail, it's likely a real issue, not timing.

#### UI Interaction Tests: 2-3 retries (default or higher)

```javascript
test.describe('Interactive UI', () => {
  // Use default 2 retries, or increase to 3 for complex interactions
  test.describe().configure({ retries: 3 });

  // Tests with complex UI interactions, animations, or timing-sensitive waits
});
```

**Rationale**: UI tests can be affected by rendering timing, browser quirks, and animation delays.

#### Emulator Integration Tests: 2 retries (default)

```javascript
test.describe('Firestore Emulator Integration', () => {
  // Use default 2 retries
  // Tests that interact with Firebase emulators
  // Emulators can have occasional timing quirks
});
```

**Rationale**: Emulator interactions are mostly deterministic but can have occasional timing issues.

#### Bulk Operations: 2 retries with longer timeouts

```javascript
test.describe('Bulk Operations', () => {
  test.describe().configure({ retries: 2, timeout: 90000 });

  // Tests that process many items (50+ cards, large file uploads, etc.)
});
```

**Rationale**: Bulk operations need more time, but retries help with occasional network/processing delays.

## PrintSync Serial Execution

**File**: `printsync/tests/playwright.config.ts`

```javascript
const config = createPlaywrightConfig({...});
config.fullyParallel = false; // Serial execution
config.workers = 1;
```

### Why Serial?

PrintSync tests run serially (not in parallel) because:

1. **Shared Firestore Emulators**: Multiple tests writing to the same Firestore emulator cause race conditions
2. **Data Isolation**: Tests expect clean emulator state between runs
3. **Stability > Speed**: 2-3 minute serial execution with 100% stability beats 30-45s parallel with flakiness

### Trade-offs

- **Pro**: Tests are completely stable and predictable
- **Pro**: Easier to debug when failures occur
- **Con**: Takes 2-3 minutes vs 30-45 seconds for parallel execution

### Future Optimization

To parallelize PrintSync tests in the future:

1. Implement data namespace isolation per test (e.g., user-specific prefixes)
2. Use separate emulator instances per worker (resource intensive)
3. Mock Firestore instead of using real emulators (loses integration testing value)

## Best Practices

### 1. Wait for Load States

Always wait for elements to be fully loaded before interacting:

```javascript
// ✅ Good: Wait for specific element
await page.waitForSelector('.card-item', { timeout: 5000 });
await page.locator('.card-item').click();

// ❌ Bad: Click immediately without waiting
await page.locator('.card-item').click(); // May fail if element not ready
```

### 2. Firestore Listeners

When testing real-time Firestore listeners:

```javascript
// ✅ Good: Wait for data to propagate through listener
await page.waitForSelector('.card-item', { timeout: 10000 });

// ❌ Bad: Assume immediate update
await page.waitForTimeout(100); // Too short for Firestore propagation
```

### 3. Cleanup Between Tests

Always clean up state to avoid test pollution:

```javascript
test.afterEach(async ({ page }) => {
  // Clear localStorage
  await page.evaluate(() => localStorage.clear());

  // Reset to known state
  await page.goto('/');
});
```

### 4. Avoid Hard-Coded Timeouts

```javascript
// ✅ Good: Wait for condition
await page.waitForFunction(() => document.querySelectorAll('.card-item').length > 0);

// ❌ Bad: Arbitrary timeout
await page.waitForTimeout(2000); // Magic number - may be too short or too long
```

### 5. Global Setup for Test Data

Use Playwright's `globalSetup` for one-time test data seeding:

```javascript
// playwright.config.ts
export default {
  globalSetup: './global-setup.ts',
};

// global-setup.ts
export default async function globalSetup() {
  // Seed Firestore emulator once before all tests
  await seedFirestoreWithTestData();
}
```

**Benefits**:

- Runs once, not per test
- Reduces test execution time
- Ensures consistent baseline data

## Common Patterns

### Testing HTMX Navigation

```javascript
test('should navigate with HTMX', async ({ page }) => {
  await page.goto('/');

  // Click navigation element
  await page.locator('[hx-get="/cards"]').click();

  // Wait for URL change (HTMX may update URL with hash)
  await page.waitForURL(/cards(\.html)?#filter/, { timeout: 10000 });

  // Wait for content to load (not just URL change)
  await page.waitForSelector('.card-item', { timeout: 15000 });
});
```

### Testing Firestore Real-Time Updates

```javascript
test('should update UI when Firestore data changes', async ({ page }) => {
  await page.goto('/cards');

  // Initial state
  await page.waitForSelector('.card-item', { timeout: 5000 });
  const initialCount = await page.locator('.card-item').count();

  // Trigger Firestore update (via API or direct emulator write)
  await addCardToFirestore({ id: 'test-card', name: 'Test' });

  // Wait for listener to propagate update (longer timeout for Firestore)
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.card-item').length === expected,
    initialCount + 1,
    { timeout: 10000 }
  );
});
```

### Testing Forms with Validation

```javascript
test('should validate form before submission', async ({ page }) => {
  await page.goto('/form');

  // Submit without filling (should show validation)
  await page.locator('button[type="submit"]').click();

  // Wait for validation message (not form submission)
  await expect(page.locator('.error-message')).toBeVisible();

  // Fill form
  await page.locator('input[name="title"]').fill('Test Title');

  // Submit should succeed
  await page.locator('button[type="submit"]').click();

  // Wait for success state
  await page.waitForURL(/success/, { timeout: 5000 });
});
```

## Debugging Flaky Tests

When a test fails intermittently:

1. **Check timeout values**: Are waits long enough for CI environment?
2. **Check dependencies**: Does the test depend on previous test state?
3. **Check race conditions**: Are you waiting for async operations to complete?
4. **Check emulator state**: Is test data properly seeded?
5. **Add logging**: Use `console.log()` in tests to trace execution flow

### Example: Adding Debug Logging

```javascript
test('flaky test', async ({ page }) => {
  console.log('Starting test - navigating to page');
  await page.goto('/cards');

  console.log('Waiting for cards to load');
  await page.waitForSelector('.card-item', { timeout: 5000 });

  const count = await page.locator('.card-item').count();
  console.log(`Found ${count} cards`);

  expect(count).toBeGreaterThan(0);
});
```

## Architecture Decisions

### Why Not Mock Everything?

We use real Firebase emulators instead of mocks because:

- Tests integration between frontend and Firebase
- Catches real-world bugs that mocks would miss
- Emulators are fast enough for E2E tests (startup ~5-10s)
- Emulators provide realistic Firebase behavior (timestamps, queries, etc.)

### Why Not Separate Emulator Instances Per Test?

We use shared emulators because:

- Starting emulators takes 30-60s per instance (too slow)
- Global setup seeds data once, shared across all tests
- Resource efficient (no need for 10+ emulator instances in parallel)
- Current approach works with proper test isolation

## Contributing

When adding new tests:

1. Follow the patterns in this guide
2. Use appropriate retry strategy for your test type
3. Add meaningful waits (not arbitrary timeouts)
4. Clean up test state in `afterEach()`
5. Document any new patterns or edge cases

## References

- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Firebase Emulator Suite](https://firebase.google.com/docs/emulator-suite)
- [HTMX Testing](https://htmx.org/docs/#testing)
