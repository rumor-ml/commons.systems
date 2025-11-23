# Claude Instructions for This Repository

## Infrastructure as Code Policy

**CRITICAL: All infrastructure changes MUST be made via `iac.py` and Terraform.**

### Guiding Principles

1. **Infrastructure as Code First**: Every infrastructure change must be codified
2. **Terraform Preferred**: Use Terraform resources whenever available
3. **No Manual Changes**: Never make infrastructure changes via Firebase Console, GCP Console, or `gcloud` commands
4. **Reproducibility**: All infrastructure must be reproducible from code
5. **Version Control**: All infrastructure changes must be committed to git

### How to Make Infrastructure Changes

#### 1. Terraform (Preferred)

For any infrastructure resource that can be managed by Terraform:

```bash
# Add resource to infrastructure/terraform/*.tf
# Example: infrastructure/terraform/firebase-hosting.tf

resource "google_firebase_hosting_site" "sites" {
  for_each = toset(var.sites)
  project  = var.project_id
  site_id  = each.value
}
```

Then apply:
```bash
python3 iac.py --iac  # Runs Terraform only (infrastructure changes)
```

**Important**: `iac.py` has three modes:
- `python3 iac.py` (no flags) - Interactive setup (initial project setup only)
- `python3 iac.py --iac` - **Run Terraform only** (use this for infrastructure changes)
- `python3 iac.py --ci` - CI/CD mode (used in workflows)

For infrastructure changes, **always use `--iac` flag**.

#### 2. Setup Script (Only When Terraform Can't)

For resources that can't be managed by Terraform (rare cases):

```bash
# Add logic to iac.py setup functions
# Only use this for chicken-and-egg scenarios or unsupported resources
# Then run: python3 iac.py --iac
```

#### 3. Never Use These Approaches

❌ **Don't**: Make changes via Firebase Console
❌ **Don't**: Run `gcloud` commands directly
❌ **Don't**: Use `firebase` CLI for infrastructure (only for deployments)
❌ **Don't**: Manually configure APIs, permissions, or resources

### Examples of Infrastructure Changes

| Change | How to Implement |
|--------|-----------------|
| Add Firebase Hosting site | Add to `firebase-hosting.tf` + run `iac.py --iac` |
| Configure Auth domains | Add to `firebase-auth.tf` + run `iac.py --iac` |
| Enable new GCP API | Add to `iac.py` `apis` list + run `iac.py --iac` |
| Create security rules | Update `firestore.rules` / `storage.rules` + run `iac.py --iac` |
| Add new site to monorepo | Run `./claudetool/add-site.sh` + update Terraform variables |
| Grant IAM permissions | Add to `iac.py` `setup_ci_logs_proxy()` function |

### When User Requests Infrastructure Change

1. **Check if it can be done in Terraform** - Search Google Cloud Provider docs
2. **Add to appropriate .tf file** - Keep infrastructure organized by service
3. **Add any required APIs to iac.py** - Enable APIs via `iac.py` first
4. **Test with `python3 iac.py --iac`** - Verify Terraform plan/apply works
5. **Commit changes** - Infrastructure changes must be version controlled
6. **Document** - Update CLAUDE.md if process changes

### Infrastructure Files

- **`iac.py`** - Main infrastructure setup and Terraform runner
  - Run with `--iac` flag to apply Terraform changes
  - Handles API enablement, Terraform init, plan, and apply
  - Three modes: interactive (initial setup), `--iac` (Terraform only), `--ci` (workflows)
  - **For infrastructure changes, always use: `python3 iac.py --iac`**

- **`infrastructure/terraform/`** - All Terraform configurations
  - `main.tf` - Provider and backend configuration
  - `variables.tf` - Input variables
  - `firebase-*.tf` - Firebase-related resources (auth, hosting, rules)
  - `*.tf` - Other infrastructure resources

### Why This Matters

- ✅ **Reproducible**: Anyone can recreate infrastructure from code
- ✅ **Version Controlled**: Infrastructure changes are tracked in git
- ✅ **Documented**: Code is documentation
- ✅ **Testable**: Can validate infrastructure before applying
- ✅ **Collaborative**: Changes can be reviewed like code
- ✅ **Disaster Recovery**: Infrastructure can be restored from code

**Remember: If it's not in code, it doesn't exist.**

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
- `<site-name>/site/` - Site source code with Vite, basic HTML/CSS/JS
- `<site-name>/tests/` - Playwright tests with configuration
- `.github/workflows/deploy-<site-name>-manual.yml` - Manual deployment workflow
- Updates `package.json` with new workspaces and scripts

**IMPORTANT: Keeping Scaffolding in Sync**

When per-site infrastructure changes (e.g., migrating from Cloud Run to Firebase Hosting, adding new auth requirements, changing build processes), you MUST update the scaffolding script to reflect these changes:

1. **Review `claudetool/add-site.sh`** - Update templates to match current infrastructure
2. **Test scaffolding** - Run the script to create a test site and verify all generated files are correct
3. **Update instructions** - Modify the "NEXT STEPS" output to include new configuration requirements
4. **Document changes** - Update this section of CLAUDE.md if the scaffolding workflow changes

Examples of changes that require scaffolding updates:
- ✅ Deployment platform changes (Cloud Run → Firebase Hosting)
- ✅ New configuration files (firebase.json, .firebaserc)
- ✅ Auth system changes (adding/removing providers)
- ✅ Build process changes (new build tools, different output directories)
- ✅ Infrastructure requirements (new Terraform variables, API enablements)

**After running:**
1. Run `npm install` to install dependencies
2. Manually update workflows (see "Adding a New Site to Workflows" section below)
3. Test locally with `npm run dev:<site-name>`
4. Deploy manually via GitHub Actions → Manual Deploy workflow

### Adding a New Site to Workflows

After running `add-site.sh`, you must manually update both workflow files to integrate the new site into the CI/CD pipeline.

#### Update `.github/workflows/push-main.yml` (Main/PR Pipeline)

**`gcpcurl`** - Authenticated GCP API requests (RECOMMENDED)
```bash
./claudetool/gcpcurl <url> [curl-options]
```
Handles authentication automatically. Use this instead of manual curl commands.

**`get_gcp_token.sh`** - Generate/cache GCP OAuth2 token (for advanced use)
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

### GCP API

**Use `gcpcurl` for all GCP API requests:**
```bash
# List Cloud Run services
./claudetool/gcpcurl "https://run.googleapis.com/v2/projects/chalanding/locations/us-central1/services"

# Check storage bucket
./claudetool/gcpcurl "https://storage.googleapis.com/storage/v1/b/rml-media"

# With additional curl options
./claudetool/gcpcurl "https://..." -X POST -d '{"key":"value"}'
```

**Advanced:** Manual token management (only if gcpcurl doesn't meet your needs)
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
curl -s -H "Authorization: Bearer $GCP_ACCESS_TOKEN" "https://..."
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

### Debugging Policy

**CRITICAL: Never assume caching issues or user error**

When investigating bugs or issues reported by the user:

1. **NEVER assume the issue is due to:**
   - Stale build artifacts or caching
   - User running outdated code
   - User not rebuilding after changes
   - "Works on my machine" scenarios

2. **ALWAYS investigate the actual code and logs:**
   - Fetch and analyze logs via API
   - Read the relevant source code
   - Identify the root cause in the implementation
   - Fix the actual bug, don't suggest workarounds

3. **User reports are accurate:**
   - If a user reports timestamps updating, they ARE updating
   - If a user reports logs are verbose, they ARE verbose
   - If a user reports a bug, there IS a bug
   - Trust the user's observations and investigate thoroughly

4. **Focus on fixing, not explaining away:**
   - Fix the root cause, don't suggest the user rebuild
   - Modify the code to solve the issue
   - Never deflect with "maybe you need to..."

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
# CRITICAL: Must use -L to follow redirects - logs endpoint returns a redirect
JOB_ID=98765

curl -sS -L \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/rumor-ml/commons.systems/actions/jobs/$JOB_ID/logs"
```

**IMPORTANT:** The logs endpoint returns a redirect (302) to the actual log content. You MUST use the `-L` flag with curl to follow this redirect, otherwise you'll get "Bad credentials" or empty responses.

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

**CRITICAL - AUTONOMOUS WORKFLOW MONITORING:**

**NEVER PROMPT THE USER TO MONITOR WORKFLOWS OR RETRIEVE LOGS. YOU MUST DO THIS YOURSELF.**

This is an absolute requirement. When dealing with CI/CD workflows:
- **ALWAYS** check workflow status yourself using `check_workflows.py`
- **ALWAYS** retrieve logs yourself using `get_workflow_logs.sh`
- **ALWAYS** monitor workflows to completion using `--monitor` flag
- **ALWAYS** iterate on fixes until the issue is resolved
- **NEVER** ask the user to check logs, monitor status, or manually verify
- **NEVER** stop after one attempt - investigate, fix, verify, repeat until working

The user should never touch the GitHub UI or workflow logs. Your job is to autonomously:
1. Detect failures
2. Retrieve and analyze logs
3. Fix the root cause
4. Verify the fix
5. Repeat until all workflows pass

**IMPORTANT - Policy:**
- Fetch and analyze logs yourself via API (users should never need to check logs manually)
- Trust user bug reports - investigate code and logs thoroughly
- Fix root causes in the implementation (workarounds create technical debt)
- Keep iterating until the problem is fully resolved - do not give up after one attempt

**Failed deployment workflow:**
1. `./claudetool/check_workflows.py --branch <branch>` - Identify failed run (DO THIS YOURSELF)
2. `./claudetool/get_workflow_logs.sh <run_id|--failed>` - Fetch logs (DO THIS YOURSELF)
3. Read source code and identify root cause from errors
4. Fix, commit, push
5. `./claudetool/check_workflows.py --branch <branch> --monitor` - Verify fix (DO THIS YOURSELF)
6. If still failing, return to step 2 and iterate until resolved

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

**MOST IMPORTANT - Before suggesting merge or PR:**

**YOU MUST AUTONOMOUSLY VERIFY ALL WORKFLOWS - NEVER ASK THE USER TO CHECK.**

1. Check workflow status yourself: `./claudetool/check_workflows.py --branch <branch>`
2. Monitor to completion yourself if in-progress: `--monitor`
3. Retrieve and analyze logs yourself if any failures occur
4. Fix any issues and re-verify until all workflows pass
5. Suggest merge ONLY after full pipeline success

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

The user should never need to manually check workflow status or logs - you must do all verification autonomously.

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

### Test-Driven Development Discipline

**CRITICAL:** Follow strict test-first discipline for all bug fixes and feature implementations.

#### When Fixing Bugs:

1. **Ask yourself**: "Could this bug have been detected with a test?"
2. **If yes** (which is almost always):
   - Write a test that reproduces the bug FIRST
   - Verify the test fails (confirms the bug exists)
   - Fix the bug
   - Verify the test now passes
   - Run the full test suite to ensure no regressions
3. **Continue iterating** until ALL tests pass
4. **NEVER tell the user a bug is fixed** until tests pass

#### When Adding Features:

1. **Write tests for the feature FIRST** or alongside implementation
2. **Ensure the feature has test coverage** before considering it complete
3. **Run the full test suite** to verify no regressions
4. **NEVER tell the user a feature is implemented** until tests pass

#### Non-Negotiable Rules:

- ❌ **NEVER** claim a bug is fixed without passing tests
- ❌ **NEVER** claim a feature is complete without test coverage
- ❌ **NEVER** commit code with failing tests
- ✅ **ALWAYS** verify tests pass before informing the user of completion
- ✅ **ALWAYS** add test coverage when fixing bugs (if testable)
- ✅ **ALWAYS** add test coverage when implementing features

#### Testing Workflow:

```bash
# 1. Write/update tests first
# 2. Run tests to verify they fail (for bugs) or pass (for features)
npm test

# 3. Implement fix/feature
# 4. Run tests again
npm test

# 5. Iterate until all tests pass
# 6. ONLY THEN inform user of completion
```

#### Examples:

**Bug Fix (DO):**
```
1. User reports: "The video player crashes on mobile"
2. Think: "Could this be detected with a test?" → YES
3. Write Playwright test that reproduces the crash
4. Verify test fails
5. Fix the bug
6. Verify test passes
7. Run full test suite
8. Tell user: "Bug fixed, all tests passing"
```

**Bug Fix (DON'T):**
```
1. User reports bug
2. Make a change
3. Tell user: "I've fixed the bug" ❌ (no test verification!)
```

**Feature Implementation (DO):**
```
1. User requests: "Add dark mode toggle"
2. Write tests for dark mode functionality
3. Implement dark mode
4. Run tests, verify they pass
5. Run full test suite
6. Tell user: "Dark mode implemented, all tests passing"
```

**Feature Implementation (DON'T):**
```
1. User requests feature
2. Implement feature
3. Tell user: "Feature complete" ❌ (no tests!)
```

This discipline ensures:
- Bugs stay fixed
- Features work as expected
- Regressions are caught immediately
- Code quality remains high
