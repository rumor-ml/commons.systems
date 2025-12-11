# Fellspiral E2E Testing Guide

## Testing Modes

### 1. Local Testing (with Emulators)

```bash
pnpm test
```

**Environment:**

- Vite dev server at http://localhost:5173
- Firebase emulators: Firestore (port 8081), Auth (port 9099)
- Test data seeded automatically via global-setup.ts

**Test Coverage:**

- ✅ All tests (including auth UI tests)
- ✅ Card loading and management
- ✅ HTMX navigation
- ✅ Responsive design and accessibility

### 2. Local Channel Testing (Firebase Hosting)

```bash
npm run test:local-channel
```

**Environment:**

- Deployed to Firebase hosting channel named after current git branch
- Production Firestore with branch-specific collection (`cards_preview_{branch}`)
- Production Firebase Auth (GitHub OAuth) - auth tests will NOT authenticate
- Test data seeded to Firestore before test run

**Test Coverage:**

- ✅ Non-auth tests (card loading, navigation, responsive, etc.)
- ⚠️ Auth tests run but only verify UI visibility (no actual login)
- ✅ Tests hosting-specific behavior (routing, asset loading, etc.)

**Cleanup:**

- Channels automatically deleted when branch is deleted (via `.github/workflows/cleanup-preview.yml`)
- Firestore collections cleaned up automatically

### 3. CI Deployed Testing

```bash
DEPLOYED_URL=https://fellspiral--pr-123.web.app pnpm test
```

**Environment:**

- Deployed by CI to PR-specific hosting channel
- Production Firestore with PR-specific collection (`cards_pr_{pr_number}`)
- Production Firebase Auth
- Test data seeded by CI workflow

**Test Coverage:**

- Same as Local Channel Testing
- Used to verify deployment before merge

## Authentication Constraints

**Important:** Firebase Auth emulator cannot be used with deployed sites (local channels or CI deployments). Tests requiring actual authentication must be emulator-only.

**Current auth tests:**

- `auth.spec.js` - Tests auth button visibility (works on deployed sites)
- `auth-aware-ui.spec.js` - Tests auth-controlled UI elements visibility (works on deployed sites)

These tests do NOT perform actual login - they only verify UI states.

## Test File Organization

- `e2e/deployed-htmx-navigation.spec.js` - Explicitly for deployed environments only
- `e2e/auth*.spec.js` - Auth UI tests (no actual authentication)
- `e2e/*.spec.js` - Most tests work on both emulator and deployed environments
