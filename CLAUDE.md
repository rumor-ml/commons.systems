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

#### `get_workflow_logs.sh` - GitHub Actions Log Fetcher
Fetch logs for GitHub Actions workflow runs and jobs. Handles all the complexity of the GitHub API to retrieve logs reliably.

**Usage:**
```bash
# Get logs for specific run ID
./claudetool/get_workflow_logs.sh 12345678901

# Get logs for specific job in a run
./claudetool/get_workflow_logs.sh 12345678901 98765

# Get logs for latest run on a branch
./claudetool/get_workflow_logs.sh main

# Get logs for latest run (any branch)
./claudetool/get_workflow_logs.sh --latest

# Get logs for latest failed run
./claudetool/get_workflow_logs.sh --failed
```

**Features:**
- Automatically resolves branch names to run IDs
- Shows workflow information before fetching logs
- Lists all jobs with their status
- Interactive prompt for fetching all job logs
- Handles GitHub API authentication correctly
- Provides clear error messages

**Why use this instead of manual curl:**
- Correctly uses `Authorization: token` (not `Bearer`)
- Handles multi-step process (get jobs, then fetch logs for each)
- Provides formatted output with job names and status
- Prevents common authentication errors

#### `add-site.sh` - Add New Site to Monorepo
Scaffolds a new site in the monorepo with all necessary boilerplate, tests, and workflows.

**Usage:**
```bash
./claudetool/add-site.sh <site-name>

# Example
./claudetool/add-site.sh myblog
```

**What it creates:**
- `<site-name>/site/` - Site source code with Vite, Dockerfile, basic HTML/CSS/JS
- `<site-name>/tests/` - Playwright tests with configuration
- `.github/workflows/deploy-<site-name>-manual.yml` - Manual deployment workflow
- Updates `package.json` with new workspaces and scripts

**After running:**
1. Run `npm install` to install dependencies
2. Manually update workflows (see "Adding a New Site to Workflows" section below)
3. Test locally with `npm run dev:<site-name>`
4. Deploy manually via GitHub Actions → Manual Deploy workflow

### Adding a New Site to Workflows

After running `add-site.sh`, you must manually update both workflow files to integrate the new site into the CI/CD pipeline.

#### Update `.github/workflows/push-main.yml` (Main/PR Pipeline)

The main/PR pipeline uses a **matrix strategy** for parallel site deployment. Adding a new site requires these steps:

**a) Add local test step** (around line 53):
```yaml
- name: Test <sitename>
  run: ./infrastructure/scripts/run-local-tests.sh <sitename>
```

**b) Add site to matrix array** (around line 133):
```yaml
strategy:
  matrix:
    site: [fellspiral, videobrowser, audiobrowser, <sitename>]
```

**c) Add collect-urls output** (around line 327):
```yaml
outputs:
  <sitename>-url: ${{ steps.get-urls.outputs.<sitename>-url }}
```

**d) Add URL retrieval in collect-urls job** (around line 360):
```yaml
<SITENAME>_URL=$(gcloud run services describe <sitename>-site \
  --region=${{ env.GCP_REGION }} \
  --project=${{ env.GCP_PROJECT_ID }} \
  --format='value(status.url)')
echo "<sitename>-url=${<SITENAME>_URL}" >> $GITHUB_OUTPUT
```

**e) Add E2E test step** (around line 452):
```yaml
- name: Test <sitename>
  run: ./infrastructure/scripts/run-playwright-tests.sh <sitename> "${{ needs.collect-urls.outputs.<sitename>-url }}" "${{ needs.get-playwright-url.outputs.url }}"
  env:
    PLAYWRIGHT_SERVER_URL: ${{ needs.get-playwright-url.outputs.url }}
    DEPLOYED_URL: ${{ needs.collect-urls.outputs.<sitename>-url }}
    CI: true
```

**f) Add rollback step** (around line 522):
```yaml
- name: Rollback <sitename>
  run: |
    PREVIOUS_REVISION=$(gcloud run services describe <sitename>-site \
      --region=${{ env.GCP_REGION }} \
      --project=${{ env.GCP_PROJECT_ID }} \
      --format='value(status.traffic[1].revisionName)' 2>/dev/null || echo "")
    if [ -n "$PREVIOUS_REVISION" ]; then
      echo "🔄 Rolling back <sitename> to: $PREVIOUS_REVISION"
      gcloud run services update-traffic <sitename>-site \
        --to-revisions="${PREVIOUS_REVISION}=100" \
        --region=${{ env.GCP_REGION }} \
        --project=${{ env.GCP_PROJECT_ID }}
    fi
```

**g) (Optional) Add Firebase rules deployment** if your site needs Firestore or Storage rules:
- See lines 235-303 in push-main.yml for examples
- Add conditional steps using `if: matrix.site == '<sitename>'`

#### Update `.github/workflows/push-feature.yml` (Feature Branch Pipeline)

The feature branch pipeline uses **separate jobs per site** for conditional deployment. Adding a new site requires:

**a) Add change detection output** (around line 35):
```yaml
<sitename>-changed: ${{ steps.check-changes.outputs.<sitename>-changed }}
```

**b) Add change check step** (around line 81):
```bash
if git diff --name-only HEAD^ HEAD | grep -q "^<sitename>/"; then
  echo "<sitename>-changed=true" >> $GITHUB_OUTPUT
else
  echo "<sitename>-changed=false" >> $GITHUB_OUTPUT
fi
```

**c) Add local test step** (around line 101):
```yaml
- name: Test <sitename>
  if: steps.check-changes.outputs.<sitename>-changed == 'true'
  run: ./infrastructure/scripts/run-local-tests.sh <sitename>
```

**d) Add complete `deploy-<sitename>` job**:
- Copy an existing deploy job (e.g., `deploy-fellspiral`)
- Update job name to `deploy-<sitename>`
- Update condition: `if: needs.local-tests.outputs.<sitename>-changed == 'true'`
- Update all references to site name
- Include Firebase configuration step
- Remove Firebase rules deployment unless your site needs it

**e) Add complete `playwright-tests-<sitename>` job**:
- Copy an existing playwright test job (e.g., `playwright-tests-fellspiral`)
- Update job name to `playwright-tests-<sitename>`
- Update dependencies: `needs: [deploy-<sitename>, deploy-playwright-server]`
- Update condition to check `deploy-<sitename>` result
- Update all site references

### When to Use These Tools

- **Debugging deployment failures**: Use `check_workflows.py` to see workflow status, then `get_workflow_logs.sh` to fetch logs
- **Fetching workflow logs**: ALWAYS use `get_workflow_logs.sh` - it handles authentication correctly
- **GCP setup issues**: Use `debug_gcp_deployment.py` to diagnose configuration problems
- **Monitoring deployments**: Use `check_workflows.py --monitor` to watch deployment progress
- **Verifying GCP access**: Use `verify_gcp_credentials.sh` before attempting GCP operations
- **Adding new sites**: Use `add-site.sh` to scaffold new sites with all necessary files

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

**CRITICAL: GitHub Token Policy**

**NEVER assume the GitHub token is expired.** The token is managed by the system and remains valid throughout the session.

**Troubleshooting API Access**

If GitHub API calls return "Bad credentials" (401 error):
1. **NEVER assume the token is expired** - this is almost never the cause
2. Check the Authorization header format: use `Authorization: token $GITHUB_TOKEN` (not `Bearer`)
3. Verify the token variable is set correctly: `echo ${#GITHUB_TOKEN}` should show length > 0
4. Try using the gh CLI instead: `gh api /repos/rumor-ml/commons.systems/actions/runs`
5. Check for shell escaping issues or variable expansion problems
6. **DO NOT mention token expiration to the user** - investigate other causes first

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

**ALWAYS use the helper script for fetching logs:**

```bash
# Recommended: Use the helper script
./claudetool/get_workflow_logs.sh <run_id_or_branch>
```

**If you must use curl directly, follow this exact pattern:**

#### Step 1: Get Workflow Run Information

```bash
# CRITICAL: Use 'Authorization: token' NOT 'Authorization: Bearer'
RUN_ID=12345678901

curl -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/rumor-ml/commons.systems/actions/runs/$RUN_ID"
```

#### Step 2: Get Jobs for the Workflow Run

```bash
# Get all jobs - you need job IDs to fetch logs
curl -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/rumor-ml/commons.systems/actions/runs/$RUN_ID/jobs"
```

#### Step 3: Get Logs for Each Job

```bash
# Use the job ID from step 2
JOB_ID=98765

curl -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/rumor-ml/commons.systems/actions/jobs/$JOB_ID/logs"
```

#### Alternative: Download All Logs as ZIP Archive

```bash
# This returns a redirect to a ZIP file with all logs
curl -L \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/rumor-ml/commons.systems/actions/runs/$RUN_ID/logs" \
  -o workflow-logs.zip
```

#### Common Mistakes to Avoid

**❌ WRONG - Using Bearer instead of token:**
```bash
# This will fail with 401 Bad credentials
curl -H "Authorization: Bearer $GITHUB_TOKEN" ...
```

**✅ CORRECT - Using token:**
```bash
# This works correctly
curl -H "Authorization: token $GITHUB_TOKEN" ...
```

**❌ WRONG - Trying to get logs directly from run ID:**
```bash
# This endpoint doesn't exist - will return 404
curl "https://api.github.com/repos/.../runs/$RUN_ID/logs"
```

**✅ CORRECT - Get jobs first, then job logs:**
```bash
# First get jobs, then get logs for each job
curl ".../runs/$RUN_ID/jobs"
curl ".../jobs/$JOB_ID/logs"
```

#### Quick Reference for Common Tasks

**Get latest failed workflow run ID:**
```bash
curl -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/rumor-ml/commons.systems/actions/runs?status=completed&conclusion=failure&per_page=1" \
  | jq -r '.workflow_runs[0].id'
```

**Get latest run for specific branch:**
```bash
BRANCH="main"
curl -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/rumor-ml/commons.systems/actions/runs?per_page=20" \
  | jq -r ".workflow_runs[] | select(.head_branch == \"$BRANCH\") | .id" \
  | head -1
```

**List all jobs with their status:**
```bash
RUN_ID=12345678901
curl -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/rumor-ml/commons.systems/actions/runs/$RUN_ID/jobs" \
  | jq -r '.jobs[] | "\(.id) - \(.name) - \(.conclusion // .status)"'
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

### Workflow for Debugging Failed Deployments

When a workflow fails, follow this exact sequence:

1. **Identify the failed run:**
   ```bash
   # Use check_workflows.py or get latest failed run
   ./claudetool/check_workflows.py --branch <branch-name>
   # OR
   ./claudetool/get_workflow_logs.sh --failed
   ```

2. **Fetch and analyze logs:**
   ```bash
   # Get logs for the failed run
   ./claudetool/get_workflow_logs.sh <run_id>
   # OR for latest failed run
   ./claudetool/get_workflow_logs.sh --failed
   ```

3. **Identify the root cause:**
   - Look for error messages in job logs
   - Check which step failed
   - Identify the specific command or test that failed

4. **Fix the issue:**
   - Make necessary code changes
   - Commit and push
   - Verify the fix in the new workflow run

5. **Verify success:**
   ```bash
   # Monitor the new deployment
   ./claudetool/check_workflows.py --branch <branch-name> --monitor
   ```

**NEVER** skip fetching logs or assume the issue without seeing actual error messages.

### Debug Scripts Policy

**IMPORTANT:** Debug scripts should be temporary and NOT committed to the repository.

#### Rules:

1. **Save debug scripts to `/tmp/`** - All one-off debugging scripts should be created in `/tmp/` directory
2. **Never commit debug scripts** - Debugging scripts are temporary investigation tools, not permanent utilities
3. **Use `claudetool/` for permanent tools only** - Only production-ready, reusable utilities belong in `claudetool/`

#### Examples:

**Temporary debug script (DO):**
```bash
# Create one-off diagnostic script in /tmp
cat > /tmp/debug_issue_123.sh << 'EOF'
#!/bin/bash
# Temporary script to debug specific issue
...
EOF
chmod +x /tmp/debug_issue_123.sh
/tmp/debug_issue_123.sh
```

**Permanent utility (DO):**
```bash
# Production-ready tool in claudetool/ with documentation in CLAUDE.md
./claudetool/check_workflows.py --branch main
```

**Wrong approach (DON'T):**
```bash
# Don't commit one-off debug scripts
git add claudetool/debug_specific_issue.sh
git commit -m "Add debug script"  # ❌ Wrong!
```

#### When to Use Each:

- **`/tmp/` scripts**: One-off debugging, ad-hoc investigations, temporary diagnostics
- **`claudetool/` scripts**: Reusable utilities, documented tools, production workflows

## Manual Deployment Workflows

Each site in the monorepo has a dedicated manual deployment workflow for on-demand deployments.

### Available Workflows

- **Manual Deploy - Fellspiral**: `.github/workflows/deploy-fellspiral-manual.yml`
- **Manual Deploy - Videobrowser**: `.github/workflows/deploy-videobrowser-manual.yml`

### Workflow Structure

Each manual deploy workflow runs in serial (stop on error):
1. **Local Tests** - Run site-specific local tests
2. **Deploy** - Deploy site to Cloud Run (production or feature branch)
3. **Playwright Tests** - Run end-to-end tests against deployed site

### Parameters

- **branch** (required): Branch to deploy (default: main)
- **skip_tests** (optional): Skip tests if needed (use with caution)

### When to Use

- **On-demand deployments**: Deploy specific sites without triggering full pipeline
- **Testing deployments**: Deploy and test a specific branch
- **Hotfixes**: Quick deployments with option to skip tests (not recommended for production)
- **Individual site updates**: Deploy one site without affecting others

### Example Usage

Via GitHub Actions UI:
1. Go to Actions → Select workflow (e.g., "Manual Deploy - Fellspiral")
2. Click "Run workflow"
3. Select branch and options
4. Click "Run workflow"

The workflow will:
- Run local tests (build, lint)
- Deploy the site to Cloud Run
- Wait for health check
- Run Playwright tests against deployed site
- Provide deployment summary

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
