# PrintSync E2E Tests

End-to-end tests using Playwright for the PrintSync application.

## Quick Start

```bash
# From repository root
pnpm install

# Run tests (emulators start automatically)
cd printsync/tests
npm test
```

Firebase emulators (Auth, Firestore, Storage) are automatically started before tests run if not already running.

## What Tests Cover

- File approval workflow
- Bulk approval operations
- File rejection workflow
- Mixed approve/reject scenarios
- Trash workflow
- Real-time SSE updates
- Error handling and recovery
- Concurrent operations

## Test Architecture

Tests use Firebase Auth Emulator for authentication:
- Auth tokens are automatically generated for each test
- Tokens are injected via Playwright HTTP headers
- No manual authentication setup required

All test configuration is committed to git - just run `pnpm install` and start the emulators.
