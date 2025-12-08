# PrintSync E2E Test Fixtures

This directory contains the E2E testing infrastructure for PrintSync, enabling isolated and deterministic tests using Firebase emulators.

## Overview

The test infrastructure provides:

- **Emulator management scripts** for Firestore and GCS
- **Test helpers** for creating and verifying test data
- **Playwright fixtures** for automatic test setup and cleanup
- **Test data generators** for creating realistic test scenarios

## Files

### Core Utilities

- **test-helpers.ts** - TestHelpers class for Firestore/GCS operations
- **test-data.ts** - Test data generators (PDFs, EPUBs, sessions, etc.)
- **printsync-fixtures.ts** - Playwright fixtures that extend base test

### Examples

- **example.test.ts** - Example test file demonstrating usage patterns

## Quick Start

### 1. Install Dependencies

```bash
cd printsync/tests
npm install
```

### 2. Start Emulators

```bash
# From repository root
./infrastructure/scripts/start-emulators.sh
```

This will start:

- Firestore emulator on port 8081
- Storage emulator on port 9199

### 3. Set Environment Variables

In your test terminal:

```bash
export FIRESTORE_EMULATOR_HOST=localhost:8081
export STORAGE_EMULATOR_HOST=localhost:9199
```

### 4. Run Tests

```bash
npm test
```

### 5. Stop Emulators

```bash
./infrastructure/scripts/stop-emulators.sh
```

## Usage Patterns

### Pattern 1: Using TestHelpers

```typescript
import { test, expect } from './fixtures/printsync-fixtures';
import { generateTestPDFFile, generateTestUserID } from './fixtures/test-data';

test('my test', async ({ helpers }) => {
  const userID = generateTestUserID();
  const file = generateTestPDFFile();

  const sessionID = await helpers.createTestSession(userID, '/test', [
    {
      localPath: file.localPath,
      hash: file.hash,
      status: 'pending',
      metadata: file.metadata,
    },
  ]);

  // Helpers automatically clean up after the test
});
```

### Pattern 2: Using Pre-Seeded Sessions

```typescript
import { test, expect } from './fixtures/printsync-fixtures';

test('my test', async ({ testSession, helpers }) => {
  // testSession already has 2 PDFs and 1 EPUB
  await helpers.assertFileInFirestore(testSession.fileIDs[0], {
    status: 'pending',
  });

  // Navigate to the session page
  // await page.goto(`/sessions/${testSession.sessionID}`);
});
```

### Pattern 3: Waiting for Status Changes

```typescript
import { test } from './fixtures/printsync-fixtures';

test('upload flow', async ({ helpers }) => {
  const fileID = await helpers.createTestFile(sessionID, fileData);

  // Wait for backend to process
  await helpers.waitForFileStatus(fileID, 'uploaded', 10000);

  // Verify in GCS
  await helpers.assertFileInGCS('my-bucket', 'path/to/file.pdf');
});
```

## API Reference

### TestHelpers

#### Constructor

```typescript
new TestHelpers();
```

Initializes Firestore and GCS clients using emulator environment variables.

#### Methods

**createTestSession(userID, rootDir, files): Promise\<string\>**

- Creates a session document in Firestore
- Returns the session ID
- Tracks for automatic cleanup

**createTestFile(sessionID, fileData): Promise\<string\>**

- Creates a file document in Firestore
- Returns the file ID
- Tracks for automatic cleanup

**waitForFileStatus(fileID, status, timeout?): Promise\<void\>**

- Polls Firestore until file reaches expected status
- Default timeout: 30000ms
- Throws on timeout

**assertFileInFirestore(fileID, expectedState): Promise\<void\>**

- Verifies file document exists with expected fields
- Throws if file not found or fields don't match

**assertFileInGCS(bucket, path): Promise\<void\>**

- Verifies object exists in GCS bucket
- Throws if object not found

**cleanup(): Promise\<void\>**

- Deletes all created sessions and files
- Called automatically by fixture

**getFirestore(): Firestore**

- Returns Firestore client instance

**getStorage(): Storage**

- Returns Storage client instance

### Test Data Generators

**generateTestPDFMetadata(overrides?): Object**

- Returns PDF metadata fixture
- Accepts partial overrides

**generateTestEPUBMetadata(overrides?): Object**

- Returns EPUB metadata fixture
- Accepts partial overrides

**generateTestUserID(): string**

- Returns `test-user-{uuid}`

**generateTestSessionID(): string**

- Returns `test-session-{uuid}`

**generateTestFileHash(): string**

- Returns SHA256-like hash string

**generateTestFileContent(size?): Buffer**

- Returns buffer of test content
- Default size: 1024 bytes

**generateTestPDFFile(overrides?): TestFileData**

- Returns complete PDF file data object

**generateTestEPUBFile(overrides?): TestFileData**

- Returns complete EPUB file data object

**generateTestFileBatch(count, type): TestFileData[]**

- Returns array of test files
- type: 'pdf' | 'epub'

### Playwright Fixtures

**helpers: TestHelpers**

- Auto-created TestHelpers instance
- Auto-cleans up after test

**testSession: TestSession**

- Pre-seeded session with 2 PDFs and 1 EPUB
- Includes sessionID, userID, and fileIDs

## Design Principles

1. **Automatic Cleanup**: All fixtures clean up after themselves
2. **Emulator Detection**: Tests skip if emulators aren't running
3. **Type Safety**: Full TypeScript types throughout
4. **Test Isolation**: UUID-based IDs prevent collisions
5. **Composability**: Fixtures can use other fixtures
6. **Deterministic**: Same inputs produce same outputs

## Environment Variables

Required for test execution:

- `FIRESTORE_EMULATOR_HOST` - Firestore emulator address (e.g., `localhost:8081`)
- `STORAGE_EMULATOR_HOST` - Storage emulator address (e.g., `localhost:9199`)

These are automatically exported by `start-emulators.sh`.

## Troubleshooting

### Tests fail with "FIRESTORE_EMULATOR_HOST not set"

Ensure emulators are running and environment variables are exported:

```bash
./infrastructure/scripts/start-emulators.sh
export FIRESTORE_EMULATOR_HOST=localhost:8081
export STORAGE_EMULATOR_HOST=localhost:9199
```

### Tests hang or timeout

- Check emulator logs: `tail -f /tmp/claude/emulators.log`
- Verify emulators are running: `lsof -i :8081` and `lsof -i :9199`
- Restart emulators if needed

### Connection refused errors

Emulators may not be fully started. Wait a few seconds or check health:

```bash
nc -z localhost 8081 && echo "Firestore ready"
nc -z localhost 9199 && echo "Storage ready"
```

## Related Files

- `/infrastructure/scripts/start-emulators.sh` - Start emulators
- `/infrastructure/scripts/stop-emulators.sh` - Stop emulators
- `/pkg/filesync/*_test.go` - Go test patterns using same emulators
