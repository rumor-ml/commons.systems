# Claude Instructions for This Repository

## API Access in CI/CD Environment

This repository's CI/CD environment provides authenticated access to GitHub and Google Cloud Platform APIs via environment variables.

### GitHub API Access

The environment provides a `GITHUB_TOKEN` variable for authenticated GitHub API access.

**Example: Get current repository information**
```bash
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/OWNER/REPO
```

**Example: List pull requests**
```bash
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/OWNER/REPO/pulls
```

**Example: Create an issue**
```bash
curl -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Issue title","body":"Issue description"}' \
  https://api.github.com/repos/OWNER/REPO/issues
```

### Google Cloud Platform API Access

The environment provides GCP credentials via:
- `GOOGLE_APPLICATION_CREDENTIALS_JSON`: Service account credentials in JSON format
- `GCP_PROJECT_ID`: The GCP project ID (currently: `chalanding`)

#### Getting an Access Token

Use the provided helper script to obtain an OAuth2 access token:

```bash
# Source the helper script to set GCP_ACCESS_TOKEN
source get_gcp_token.sh

# The script will:
# - Create a JWT from the service account credentials
# - Exchange it for an OAuth2 access token
# - Cache the token for ~1 hour
# - Auto-refresh when expired (with 5-minute buffer)
```

**Suppress output in scripts:**
```bash
source get_gcp_token.sh 2>/dev/null
```

#### Using the Access Token

Once you've sourced the script, use `$GCP_ACCESS_TOKEN` in your API calls:

**Example: List Cloud Storage buckets**
```bash
source get_gcp_token.sh 2>/dev/null
curl -H "Authorization: Bearer $GCP_ACCESS_TOKEN" \
  "https://storage.googleapis.com/storage/v1/b?project=$GCP_PROJECT_ID"
```

**Example: List Compute Engine zones**
```bash
source get_gcp_token.sh 2>/dev/null
curl -H "Authorization: Bearer $GCP_ACCESS_TOKEN" \
  "https://compute.googleapis.com/compute/v1/projects/$GCP_PROJECT_ID/zones"
```

**Example: List Cloud Run services**
```bash
source get_gcp_token.sh 2>/dev/null
curl -H "Authorization: Bearer $GCP_ACCESS_TOKEN" \
  "https://run.googleapis.com/v2/projects/$GCP_PROJECT_ID/locations/us-central1/services"
```

**Example: Multiple API calls with one token:**
```bash
# Set up token once
source get_gcp_token.sh 2>/dev/null

# Use for multiple calls
curl -H "Authorization: Bearer $GCP_ACCESS_TOKEN" \
  "https://storage.googleapis.com/storage/v1/b?project=$GCP_PROJECT_ID"

curl -H "Authorization: Bearer $GCP_ACCESS_TOKEN" \
  "https://compute.googleapis.com/compute/v1/projects/$GCP_PROJECT_ID/zones"
```

#### Token Caching

The token is cached in `/tmp/gcp_token_cache.json` and automatically refreshed when older than 55 minutes. Subsequent calls to `get_gcp_token.sh` will reuse the cached token without regenerating it.

#### Verification

To verify the credentials work, run:
```bash
./verify_gcp_credentials.sh
```

For usage examples, run:
```bash
./gcp_token_usage_examples.sh
```

For implementation details, see the `get_gcp_token.sh` and `verify_gcp_credentials.sh` scripts.

### Getting the Playwright Server URL for Local Testing

The repository includes a deployed Playwright server on Cloud Run for running E2E tests remotely. To run tests locally against this server, you need to retrieve its URL.

#### Quick Method: Using Helper Scripts

The easiest way to run tests locally is using the provided helper scripts:

```bash
# Option 1: Automatic URL retrieval (requires gcloud CLI)
./run-tests-remote.sh --project chromium

# Option 2: Manual URL (no gcloud required)
./test-with-url.sh https://playwright-server-xxxxx.run.app --project chromium
```

#### Getting the URL via GCP API

If you need to retrieve the URL programmatically using the available GCP credentials:

```bash
# Get access token
source get_gcp_token.sh 2>/dev/null

# Query Cloud Run service for URL
PLAYWRIGHT_SERVER_URL=$(curl -s -H "Authorization: Bearer $GCP_ACCESS_TOKEN" \
  "https://run.googleapis.com/v2/projects/$GCP_PROJECT_ID/locations/us-central1/services/playwright-server" \
  | jq -r '.uri')

echo "Playwright Server URL: $PLAYWRIGHT_SERVER_URL"
```

#### Getting the URL via gcloud CLI

If `gcloud` is available and configured:

```bash
PLAYWRIGHT_SERVER_URL=$(gcloud run services describe playwright-server \
  --platform managed \
  --region us-central1 \
  --format 'value(status.url)')

echo "Playwright Server URL: $PLAYWRIGHT_SERVER_URL"
```

#### Running Tests with the URL

Once you have the URL, set it as an environment variable and use the client script:

```bash
export PLAYWRIGHT_SERVER_URL=https://playwright-server-xxxxx.run.app

# Run all tests
cd playwright-server
node run-tests.js --project chromium

# Run specific test file
node run-tests.js --test-file homepage.spec.js

# Run tests matching a pattern
node run-tests.js --grep "combat"

# Test deployed site
node run-tests.js --deployed

# Run with multiple workers
node run-tests.js --workers 4
```

#### Verifying Server Health

Before running tests, verify the server is responding:

```bash
curl $PLAYWRIGHT_SERVER_URL/health

# Expected response:
# {"status":"healthy","timestamp":"...","version":"1.0.0"}
```

#### When to Use Remote vs Local Playwright

**Use the remote server when:**
- You don't have Playwright browsers installed locally
- You want to save local resources (browsers run on the server)
- You want to test in the exact CI environment
- You need consistent cross-platform testing

**Use local Playwright when:**
- You need headed/UI mode for debugging
- You want faster feedback (no network latency)
- You're actively developing and iterating on tests

## Documentation Policy

**IMPORTANT:** Do NOT create markdown (`.md`) documentation files unless explicitly requested by the user.

### Rules:

1. **Never create new `.md` files** without explicit user request
2. **All user documentation belongs in README.md** - update the main README instead of creating separate files
3. **Inline documentation only** - Use code comments, docstrings, and inline explanations
4. **README.md is the single source of truth** for user-facing documentation

### Exceptions:

The following markdown files are acceptable and should be kept:
- `README.md` (main documentation)
- `fellspiral/rules.md` (game rules - content, not technical documentation)
- `infrastructure/README.md` (minimal pointer to main README)
- This file (`CLAUDE.md`)

### When User Asks for Documentation:

- **Default action**: Update README.md with the new information in the appropriate section
- **Only create separate `.md` files** if the user specifically says "create a separate markdown file" or similar explicit instruction
- **Ask for clarification** if uncertain whether documentation should go in README or a separate file

### Rationale:

- Prevents documentation sprawl across the repository
- Keeps all user-facing documentation in one place (README.md)
- Makes documentation easier to find and maintain
- Reduces cognitive load for contributors

## General Guidelines

### Commit Messages

Use clear, descriptive commit messages:
- Start with imperative verb (Add, Update, Fix, Remove, etc.)
- Keep first line under 72 characters
- Add detailed description if needed

### Code Style

- Follow existing patterns in the codebase
- Use modern JavaScript (ES6+)
- Write self-documenting code with clear variable names
- Add comments only for complex logic

### Testing

- Add tests for new features
- Ensure all tests pass before committing
- Use Playwright best practices for E2E tests
