# GitHub Actions Workflow Monitoring Instructions

This document provides step-by-step instructions for checking GitHub Actions workflow status via web scraping when direct CLI access is not available.

**Last updated:** 2025-11-19

## Quick Check: Latest Workflow Status

### Step 1: Check All Recent Runs
**URL:** `https://github.com/rumor-ml/commons.systems/actions`

**CRITICAL: You MUST extract the actual pass/fail status for each workflow run.**

**What to extract:**
- List of recent workflow runs (up to 20)
- For EACH run, look for:
  - Status indicators: green checkmark icon (✓), red X icon (✗), yellow dot (⏳)
  - HTML elements with status classes like "status-success", "status-failure", "status-pending"
  - ARIA labels or data attributes indicating "success", "failure", "in_progress", "completed"
  - Text stating "Success", "Failure", "Completed", "Failed", "In progress"
- DO NOT assume success - you must find explicit evidence of pass/fail status
- If status is unclear, state "Status: Unknown - need to check individual run"

**Expected output format:**
```
CI - Test Suite #5 - commit abc1234 - main - ✓ Success (explicit green checkmark found)
Infrastructure as Code #22 - commit abc1234 - main - ✓ Success
Deploy to GCP #3 - commit abc1234 - main - ✗ Failure (explicit red X found)
CI - Test Suite #4 - commit def5678 - feature-branch - Status unclear (no icon visible)
```

**If you cannot see status icons:**
- State explicitly: "Cannot determine pass/fail status from this view"
- Recommend checking individual workflow run URLs
- Try alternative: Check commit status page at `https://github.com/rumor-ml/commons.systems/commit/[SHA]`

### Step 2: Get Specific Workflow Details
**URL:** `https://github.com/rumor-ml/commons.systems/actions/workflows/ci.yml`

**What to extract:**
- Most recent run on main branch
- Status (in progress, success, failure)
- Duration
- Commit SHA and message

### Step 3: Get Error Details (if workflow failed)
**URL:** `https://github.com/rumor-ml/commons.systems/actions/runs/[RUN_ID]`

Where `[RUN_ID]` is from the failed run (example: 19514524199)

**CRITICAL: Extract detailed failure information:**

**What to extract:**
- **Overall status**: Look for "Success", "Failure", "Cancelled" at the top of the page
- **Job statuses**: For each job (Run Tests, Lint Check, Build, Deploy, etc.):
  - Job name
  - Status icon (✓ green checkmark = passed, ✗ red X = failed, ⊘ grey circle = skipped)
  - Duration
- **For FAILED jobs**:
  - Identify which specific step failed (will have red X next to it)
  - Extract the error message from the failed step
  - Look for exit codes (e.g., "Process completed with exit code 1")
  - Extract relevant log output showing the actual error
- **For SKIPPED jobs**:
  - Note which jobs were skipped (usually due to conditionals or earlier failures)

**Example format for failed run:**
```
Overall Status: ✗ Failure

Job: Run Tests - ✗ Failed (duration: 2m 14s)
  Step "Run tests" failed with exit code 1
  Error: TypeError: Cannot read property 'foo' of undefined

Job: Lint Check - ⊘ Skipped (dependency failed)

Job: Deploy - ⊘ Skipped (not on main branch)
```

**Alternative URL for full logs:**
`https://github.com/rumor-ml/commons.systems/actions/runs/[RUN_ID]/workflow`

### Step 4: Get Job-Level Details
**URL:** `https://github.com/rumor-ml/commons.systems/actions/runs/[RUN_ID]/job/[JOB_ID]`

**What to extract:**
- Step-by-step execution log
- Which step failed (highlighted in red)
- Exact error message
- Command that was run
- Exit code

## Checking Specific Workflows

### CI Workflow
**Direct URL:** `https://github.com/rumor-ml/commons.systems/actions/workflows/ci.yml`

**Expected jobs:**
1. **Run Tests** - Runs Playwright E2E tests
   - Common failures: Dev server didn't start, tests timed out, browser install failed
2. **Lint Check** - Code quality checks
   - Common failures: console.log found in source, grep command errors

### Infrastructure Workflow
**Direct URL:** `https://github.com/rumor-ml/commons.systems/actions/workflows/infrastructure.yml`

**Expected jobs:**
1. **Branch Check** - Always runs, always passes (shows which branch)
2. **Terraform** - Only runs on main branch
   - Common failures: Terraform syntax errors, missing secrets, authentication failures

### Deploy Workflow
**Direct URL:** `https://github.com/rumor-ml/commons.systems/actions/workflows/deploy.yml`

**Expected jobs:**
1. **Build Site** - Creates production build
2. **Run Tests** - Validates build
3. **Deploy to GCP** - Uploads to Cloud Storage
4. **Test Deployed Site** - Validates production deployment
5. **Rollback** - Only runs if deployment tests fail

## Finding the Latest Run for a Specific Commit

### Method 1: By Commit SHA
**URL:** `https://github.com/rumor-ml/commons.systems/actions?query=sha:[COMMIT_SHA]`

Example: `https://github.com/rumor-ml/commons.systems/actions?query=sha:b77216b`

### Method 2: By Branch
**URL:** `https://github.com/rumor-ml/commons.systems/actions?query=branch:[BRANCH_NAME]`

Example: `https://github.com/rumor-ml/commons.systems/actions?query=branch:claude/fix-ci-workflows-01UJV6E51Gorw8c7jC1mECNM`

### Method 3: Check Commits Page
**URL:** `https://github.com/rumor-ml/commons.systems/commits/[BRANCH_NAME]`

**What to look for:**
- Status icons next to each commit (✓ green check, ✗ red X, ⏳ yellow dot)
- Click the icon to see which workflows ran

## Common Error Patterns

### CI Workflow Errors

**"No test results found"**
- Artifact upload failed
- Tests didn't run or didn't generate output
- Path mismatch in workflow config

**"Dev server didn't start"**
- Port already in use
- Build failed before server could start
- Timeout waiting for server

**"Playwright browser install failed"**
- Missing system dependencies
- Insufficient disk space
- Network timeout

### Infrastructure Workflow Errors

**"Invalid workflow file"**
- YAML syntax error (missing closing `}}`, indentation issues)
- Invalid variable references

**"Terraform authentication failed"**
- Workload Identity not configured
- Missing secrets: GCP_WORKLOAD_IDENTITY_PROVIDER, GCP_SERVICE_ACCOUNT
- Service account lacks permissions

**"Terraform plan failed"**
- Invalid Terraform syntax
- Resource conflicts
- Missing required variables

### Deploy Workflow Errors

**"Build failed"**
- npm install errors
- Build script errors
- Missing dependencies

**"Deployment failed"**
- GCS bucket doesn't exist
- Service account lacks storage.admin role
- Network issues

**"Rollback triggered"**
- Deployed site failed health checks
- Previous deployment automatically restored

## Validation Checklist

After pushing a commit to main, verify:

- [ ] CI workflow ran and passed
- [ ] Infrastructure workflow ran (check job passed, terraform skipped on non-main)
- [ ] Deploy workflow ran and passed (only on main branch)
- [ ] All jobs show green checkmarks
- [ ] No error messages in logs
- [ ] Artifacts uploaded successfully (test results, build outputs)

## Troubleshooting Tips

1. **Always check the workflow file first** if you see "workflow does not exist"
   - Verify the file exists in `.github/workflows/`
   - Check YAML syntax with a validator
   - Ensure the workflow has run at least once (GitHub only shows workflows that have executed)

2. **Check secrets** if authentication fails
   - Repository Settings → Secrets and variables → Actions
   - Required secrets: GCP_PROJECT_ID, GCP_WORKLOAD_IDENTITY_PROVIDER, GCP_SERVICE_ACCOUNT, CACHIX_AUTH_TOKEN

3. **Look for rate limits** if GitHub API calls fail
   - GitHub has rate limits on API calls
   - Wait a few minutes and retry

4. **Check branch protection rules** if workflows are blocked
   - Settings → Branches → Branch protection rules
   - Ensure workflows are allowed to run on the branch

5. **If workflows don't trigger after pushing:**
   - **MOST COMMON:** Check if you only modified workflow files (`.github/workflows/*.yml`)
     - GitHub does NOT trigger workflows for workflow-only changes (prevents infinite loops)
     - **Solution:** Make any small change to a non-workflow file (e.g., add comment to README.md) and push
   - Wait 1-2 minutes - GitHub may be queuing the workflows
   - Verify push succeeded: `git log origin/[BRANCH_NAME] --oneline -3`
   - Check GitHub Actions is enabled: Settings → Actions → General → Actions permissions
   - Look for "Workflow runs" at bottom of commits page: `https://github.com/rumor-ml/commons.systems/commits/[BRANCH_NAME]`

6. **If a workflow appears to be stuck/not starting:**
   - Check GitHub Status: https://www.githubstatus.com/
   - Look for queued workflows (yellow dot ⏳)
   - Workflows may be waiting for available runners
   - Organization may have concurrent workflow limits

## Example WebFetch Queries

### Check if latest CI run passed
```
WebFetch URL: https://github.com/rumor-ml/commons.systems/actions/workflows/ci.yml
Prompt: "Show the most recent run on main branch. Extract: status (success/failure), duration, commit SHA, and list of jobs with their status."
```

### Get error details from failed run
```
WebFetch URL: https://github.com/rumor-ml/commons.systems/actions/runs/[RUN_ID]
Prompt: "Extract all error messages. Show which jobs failed, which steps in those jobs failed, and the exact error text or exit codes."
```

### Check all workflows for a commit
```
WebFetch URL: https://github.com/rumor-ml/commons.systems/actions?query=sha:[COMMIT_SHA]
Prompt: "List all workflows that ran for this commit. For each workflow, show: name, status, duration, and whether all jobs passed."
```
