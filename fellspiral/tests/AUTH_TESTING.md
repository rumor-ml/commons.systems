# OAuth Testing with Playwright

This directory contains Playwright tests for GitHub OAuth authentication flow.

## Overview

The test suite includes:
- **UI Tests** - Test auth component visibility and styling (no credentials required)
- **OAuth Flow Tests** - Test complete GitHub OAuth flow (requires credentials)
- **Protected Features Tests** - Test authenticated-only features (requires credentials)

## Running Tests

### Option 1: Without Authentication (UI Tests Only)

```bash
# Run from fellspiral/tests directory
npx playwright test

# Or from root
npm run test:fellspiral
```

This will:
- ✅ Test auth button visibility
- ✅ Test user profile component
- ✅ Test CSS styling
- ⏩ Skip OAuth flow tests (no credentials)

### Option 2: With Authentication (Full Test Suite)

```bash
# Set test credentials
export GITHUB_TEST_USER="your-github-username"
export GITHUB_TEST_PASSWORD="your-github-password"

# Run tests
npx playwright test

# Or in one line
GITHUB_TEST_USER=user GITHUB_TEST_PASSWORD=pass npx playwright test
```

This will:
1. **Global Setup** - Authenticate once with GitHub OAuth
2. **Save Auth State** - Store cookies/localStorage to `.auth/user.json`
3. **Run All Tests** - Including OAuth flow and protected features
4. **Reuse Auth State** - All tests use the same authenticated session

## Test Files

### `e2e/auth.spec.js`
Basic UI tests for auth components (no credentials required).
- Sign in button visibility
- User profile visibility
- CSS styling verification

### `e2e/auth-flow.spec.js`
Complete OAuth flow tests (requires credentials).
- Full GitHub OAuth authentication
- Sign out functionality
- Protected features access
- User profile display
- Auth state persistence

## Auth Setup Architecture

### Files

- **`auth-setup.js`** - Global setup that handles GitHub OAuth
- **`fixtures/auth.js`** - Test fixtures for authenticated tests
- **`.auth/user.json`** - Saved auth state (gitignored)
- **`.gitignore`** - Excludes `.auth/` directory

### How It Works

1. **First Run** (with credentials):
   ```
   Global Setup → GitHub OAuth → Save Auth State → Run Tests
   ```

2. **Subsequent Runs**:
   ```
   Load Auth State → Run Tests (already authenticated)
   ```

3. **Without Credentials**:
   ```
   Skip Auth Setup → Run UI Tests Only
   ```

## Security

- ✅ Auth state is saved to `.auth/` (gitignored)
- ✅ Credentials are only used in global setup
- ✅ Auth state is reused across all tests (efficient)
- ⚠️  Never commit `.auth/` directory
- ⚠️  Use test accounts, not production accounts

## CI/CD Integration

### GitHub Actions

Add secrets to GitHub repository:
- `GITHUB_TEST_USER`
- `GITHUB_TEST_PASSWORD`

Example workflow:
```yaml
- name: Run Playwright tests with auth
  env:
    GITHUB_TEST_USER: ${{ secrets.GITHUB_TEST_USER }}
    GITHUB_TEST_PASSWORD: ${{ secrets.GITHUB_TEST_PASSWORD }}
    DEPLOYED_URL: ${{ needs.deploy.outputs.url }}
  run: |
    cd fellspiral/tests
    npx playwright test
```

## Debugging

### View Browser During Tests

```bash
# Run in headed mode
npx playwright test --headed

# Run with slow motion
npx playwright test --headed --slow-mo=1000
```

### Debug Specific Test

```bash
# Run specific test file
npx playwright test auth-flow.spec.js

# Run specific test
npx playwright test -g "should show user profile"

# Debug mode (opens Playwright Inspector)
npx playwright test --debug
```

### Check Auth State

```bash
# View saved auth state
cat .auth/user.json | jq
```

## Limitations

- **2FA**: Tests may fail if test account has 2FA enabled
  - Workaround: Use test account without 2FA, or use personal access tokens
- **Rate Limiting**: GitHub may rate limit auth requests
  - Workaround: Reuse auth state (don't re-authenticate on every run)
- **Session Expiry**: Auth state expires after some time
  - Solution: Delete `.auth/user.json` and re-run to re-authenticate

## Troubleshooting

### "Skipping auth setup - no test credentials"
Set `GITHUB_TEST_USER` and `GITHUB_TEST_PASSWORD` environment variables.

### "Authentication failed - user profile not visible"
- Check credentials are correct
- Check GitHub account doesn't have 2FA
- Check network connectivity
- Try running with `--headed` to see what's happening

### "Auth state file not found"
Run tests with credentials to generate auth state first.

### Tests are slow
Auth setup only runs once. Subsequent runs reuse auth state and are fast.

## Best Practices

1. **Use Test Accounts** - Don't use production GitHub accounts
2. **Reuse Auth State** - Don't delete `.auth/` between test runs
3. **Separate UI Tests** - Keep UI-only tests separate from auth tests
4. **Handle Skips Gracefully** - Tests should skip gracefully when no credentials
5. **Document Requirements** - Clearly mark which tests require credentials

## Examples

### Run Only Auth Flow Tests

```bash
GITHUB_TEST_USER=user GITHUB_TEST_PASSWORD=pass \
  npx playwright test auth-flow.spec.js
```

### Run on Deployed Site

```bash
DEPLOYED=true \
DEPLOYED_URL=https://fellspiral-preview.run.app \
GITHUB_TEST_USER=user \
GITHUB_TEST_PASSWORD=pass \
  npx playwright test
```

### CI/CD Full Flow

```bash
# This is what runs in GitHub Actions
DEPLOYED=true \
DEPLOYED_URL=$DEPLOYED_URL \
PLAYWRIGHT_SERVER_URL=$PLAYWRIGHT_SERVER_URL \
GITHUB_TEST_USER=$GITHUB_TEST_USER \
GITHUB_TEST_PASSWORD=$GITHUB_TEST_PASSWORD \
CI=true \
  npx playwright test
```
