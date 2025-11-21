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

**Troubleshooting API Access**

If GitHub API calls return "Bad credentials" (401 error):
1. **DO NOT assume the token is expired** - verify the request format first
2. Check the Authorization header format: use `Authorization: token $GITHUB_TOKEN` (not `Bearer`)
3. Verify the token variable is set correctly
4. Test with a simple endpoint first: `curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user`
5. Only report token expiration if the user confirms it needs renewal

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

## Debugging and Log Access

**IMPORTANT:** Never ask the user to check logs when you have access to them via API.

### Accessing GitHub Actions Workflow Logs

You have access to GitHub Actions workflow logs via the GitHub API. Always fetch and analyze logs directly instead of asking the user to check them.

**Get workflow run logs:**
```bash
# List recent workflow runs
curl -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/rumor-ml/commons.systems/actions/runs"

# Get specific workflow run details
curl -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/rumor-ml/commons.systems/actions/runs/RUN_ID"

# Get workflow run logs (download URL)
curl -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/rumor-ml/commons.systems/actions/runs/RUN_ID/logs"

# List jobs for a workflow run
curl -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/rumor-ml/commons.systems/actions/runs/RUN_ID/jobs"
```

### Accessing Cloud Run Logs

You have access to Cloud Run logs via the GCP Logging API.

**Get Cloud Run service logs:**
```bash
source get_gcp_token.sh 2>/dev/null

# List recent Cloud Run logs
curl -H "Authorization: Bearer $GCP_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -d '{
    "resourceNames": ["projects/chalanding"],
    "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"fellspiral-site\"",
    "orderBy": "timestamp desc",
    "pageSize": 50
  }'
```

### Rule: Always Fetch Logs Yourself

When debugging deployment issues or investigating failures:

1. **DO:** Fetch and analyze logs via API directly
2. **DO:** Present relevant log excerpts to the user with your analysis
3. **DON'T:** Ask the user to "check the logs" or "view the GitHub Actions page"
4. **DON'T:** Suggest the user manually investigate when you have API access

**Example of correct behavior:**
```
User: "The deployment failed"
Claude: *fetches workflow logs via API*
Claude: "The deployment failed because of X error in the build step. Here's the relevant log excerpt: [shows logs]. The issue is Y. Here's how to fix it: Z"
```

**Example of incorrect behavior:**
```
User: "The deployment failed"
Claude: "Can you check the GitHub Actions logs and tell me what error you see?"  ❌ WRONG
```

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
