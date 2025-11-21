# Claude Instructions for This Repository

## Claude Debugging Tools

The `claudetool/` directory contains utility scripts for Claude Code debugging and operational tasks. These tools help with common debugging workflows like checking deployment status, verifying GCP credentials, and monitoring workflows.

### Available Tools

#### `check_workflows.py` - GitHub Actions Workflow Inspector
Check GitHub Actions workflow status with optional continuous monitoring.

**Usage:**
```bash
# Check recent workflows (all branches)
./claudetool/check_workflows.py

# Check workflows for specific branch
./claudetool/check_workflows.py --branch <branch-name>

# Continuously monitor latest workflow
./claudetool/check_workflows.py --monitor

# Monitor specific branch continuously
./claudetool/check_workflows.py --branch <branch-name> --monitor
```

This tool replaces the older `check_deployment_status.sh`, `check_workflow_status.py`, and `monitor_deployment.sh` scripts with a unified, flexible interface.

#### `debug_gcp_deployment.py` - GCP Prerequisites Debugger
Comprehensive diagnostic tool for GCP deployment issues. Checks APIs, permissions, Artifact Registry repositories, and Cloud Run services.

**Usage:**
```bash
./claudetool/debug_gcp_deployment.py
```

Provides recommendations for fixing any issues found.

#### `get_gcp_token.sh` - GCP Access Token Manager
Generates and caches GCP OAuth2 access tokens for API calls. See the "Google Cloud Platform API Access" section below for detailed usage.

#### `verify_gcp_credentials.sh` - GCP Credentials Verifier
Quick verification that GCP credentials are properly configured and working.

**Usage:**
```bash
./claudetool/verify_gcp_credentials.sh
```

### When to Use These Tools

- **Debugging deployment failures**: Use `check_workflows.py` to see workflow status, then fetch logs via API
- **GCP setup issues**: Use `debug_gcp_deployment.py` to diagnose configuration problems
- **Monitoring deployments**: Use `check_workflows.py --monitor` to watch deployment progress
- **Verifying GCP access**: Use `verify_gcp_credentials.sh` before attempting GCP operations

## API Access in CI/CD Environment

This repository's CI/CD environment provides authenticated access to GitHub and Google Cloud Platform APIs via environment variables.

### GitHub API Access

The environment provides a `GITHUB_TOKEN` variable for authenticated GitHub API access.

**Example:**
```bash
curl -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/rumor-ml/commons.systems/actions/runs
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
source claudetool/get_gcp_token.sh

# The script will:
# - Create a JWT from the service account credentials
# - Exchange it for an OAuth2 access token
# - Cache the token for ~1 hour
# - Auto-refresh when expired (with 5-minute buffer)
```

**Suppress output in scripts:**
```bash
source claudetool/get_gcp_token.sh 2>/dev/null
```

#### Using the Access Token

```bash
# Set up token
source claudetool/get_gcp_token.sh 2>/dev/null

# Use in API calls
curl -H "Authorization: Bearer $GCP_ACCESS_TOKEN" \
  "https://run.googleapis.com/v2/projects/$GCP_PROJECT_ID/locations/us-central1/services"
```

#### Token Caching

The token is cached in `/tmp/gcp_token_cache.json` and automatically refreshed when older than 55 minutes. Subsequent calls to `get_gcp_token.sh` will reuse the cached token without regenerating it.

#### Verification

To verify the credentials work, run:
```bash
./claudetool/verify_gcp_credentials.sh
```

For implementation details, see the scripts in the `claudetool/` directory.

## Debugging and Log Access

**IMPORTANT:** Never ask the user to check logs when you have access to them via API.

### Accessing GitHub Actions Workflow Logs

Always fetch and analyze logs via API instead of asking the user.

```bash
# Get workflow logs
curl -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/rumor-ml/commons.systems/actions/runs/RUN_ID/logs"
```

### Accessing Cloud Run Logs

```bash
source claudetool/get_gcp_token.sh 2>/dev/null
curl -H "Authorization: Bearer $GCP_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "https://logging.googleapis.com/v2/entries:list" \
  -d '{"resourceNames": ["projects/chalanding"], "filter": "resource.type=\"cloud_run_revision\"", "orderBy": "timestamp desc", "pageSize": 50}'
```

### Rule: Always Fetch Logs Yourself

**DO:** Fetch logs via API, analyze them, and present findings with solutions
**DON'T:** Ask users to check logs or investigate manually

## CI/CD Pipeline Verification Before Merge

**CRITICAL:** Always verify full successful execution of the CI/CD pipeline for feature branches before prompting the user to merge or create a pull request.

### Rules:

1. **NEVER prompt for merge** without confirming pipeline success
2. **ALWAYS check workflow status** using the GitHub API or `check_workflows.py` tool
3. **ALWAYS verify deployment completion** if the workflow includes deployment steps
4. **WAIT for in-progress workflows** to complete before suggesting merge

### Full Successful Execution Criteria:

1. ✅ All workflow runs completed with no failed jobs
2. ✅ All checks passed (build, test, lint)
3. ✅ Deployment completed and healthy (if applicable)
4. ✅ No pending workflows

### Verification Process:

```bash
# 1. Check workflow status
./claudetool/check_workflows.py --branch <branch-name>

# 2. Monitor if in-progress
./claudetool/check_workflows.py --branch <branch-name> --monitor

# 3. Verify deployment health (if applicable)
source claudetool/get_gcp_token.sh 2>/dev/null
curl -H "Authorization: Bearer $GCP_ACCESS_TOKEN" \
  "https://run.googleapis.com/v2/projects/$GCP_PROJECT_ID/locations/us-central1/services/<service-name>"
```

Only after ALL checks pass, suggest merge.

### Correct Workflow:

✅ Check status → Monitor completion → Verify all passed → Suggest merge

### Incorrect Workflow:

❌ Suggest merge without verifying pipeline status

### Handling In-Progress or Failed Workflows:

- **In-Progress**: Wait for completion or inform user verification is pending
- **Failed**: Fetch logs, diagnose, fix, then restart verification
- **No Workflow**: Investigate why and ensure workflows run before merge

**Remember**: Deliver fully verified, production-ready code. Never shortcut verification.

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

- **Default**: Update README.md in the appropriate section
- **Only create separate `.md` files** if explicitly requested
- **Ask for clarification** if uncertain

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
