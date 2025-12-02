# PrintSync E2E Tests

End-to-end tests using Playwright for the PrintSync application.

## Quick Start

```bash
# From repository root
pnpm install

# Start Firebase emulators (Auth, Firestore, Storage)
./infrastructure/scripts/start-emulators.sh

# Run tests
cd printsync/tests
npm test
```

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
