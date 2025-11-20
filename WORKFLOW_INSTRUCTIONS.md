# GitHub Actions Workflow Monitoring Instructions

This document provides step-by-step instructions for checking GitHub Actions workflow status via web scraping when direct CLI access is not available.

**Last updated:** 2025-11-19

## Quick Check: Latest Workflow Status

### Step 1: Check All Recent Runs

**REQUIRED URL (for specific branch):** `https://github.com/rumor-ml/commons.systems/actions?query=branch:[BRANCH_NAME]`
**⚠️ DO NOT USE:** `https://github.com/rumor-ml/commons.systems/actions` (general page shows stale/incomplete data)

**WHY branch-filtered URL is REQUIRED:**
- The general actions page often returns stale or cached HTML
- Status may show "In progress" for workflows that actually completed
- Durations may not be visible
- The branch-filtered URL provides accurate, up-to-date status

**CRITICAL PARSING RULES:**

1. **Runtime Duration = Completed Workflow**
   - If you see a duration like "5m 29s", "3m 12s", "45s", the workflow has **COMPLETED**
   - This is the PRIMARY indicator that a workflow finished (not still running)
   - If you see "In progress" text but ALSO see a duration, trust the duration - it means completed

2. **No Duration = Still Running or Queued**
   - If there's NO duration shown, the workflow is still in progress or queued
   - Look for spinner icons (⏳) or "In progress" text

3. **To Determine Pass/Fail:**
   - Duration alone doesn't tell you if it passed or failed
   - You MUST check the individual workflow run page to see Success/Failure status
   - Go to: `https://github.com/rumor-ml/commons.systems/actions/runs/[RUN_ID]`

4. **Use Branch-Filtered URL for Accuracy**
   - The general actions page may show stale/cached data
   - Branch-filtered URLs are more reliable: `?query=branch:BRANCH_NAME`
   - This is especially important for feature branches

**CRITICAL: You MUST extract the actual pass/fail status for each workflow run.**

**What to extract:**
- List of recent workflow runs (up to 20)
- For EACH run, look for:
  - **Runtime duration** (e.g., "5m 29s") - if present, workflow COMPLETED
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

### Step 3: Get Workflow Run Details (if workflow failed)

**How to find the run ID:**
1. From the actions page, find the failed workflow run
2. The URL format is: `https://github.com/rumor-ml/commons.systems/actions/runs/[RUN_ID]`
3. Example: `https://github.com/rumor-ml/commons.systems/actions/runs/19517117436`

**What to extract from the workflow run page:**
- **Overall status**: Look at the top of the page for "Status Success", "Status Failure", or "Status Cancelled"
- **Jobs list**: All jobs with their status icons and durations
  - ✓ green checkmark = passed
  - ✗ red X = failed
  - ⊘ grey circle = skipped
- **Job names and links**: Each job has a link to its detail page (see Step 4)

**Example workflow run page output:**
```
Overall Status: Status Failure

Jobs:
✗ Run Tests - 11s - /actions/runs/19517117436/job/55871594318
✗ Lint Check - 7s - /actions/runs/19517117436/job/55871594338

Warnings:
- Upload test results: No files found at fellspiral/tests/test-results.json
- Upload Playwright report: No files found at fellspiral/tests/playwright-report/
```

### Step 4: Get Job-Level Error Details

**How to find job details:**
1. From the workflow run page, click on a failed job name
2. The URL format is: `https://github.com/rumor-ml/commons.systems/actions/runs/[RUN_ID]/job/[JOB_ID]`
3. Example: `https://github.com/rumor-ml/commons.systems/actions/runs/19517117436/job/55871594318`

**CRITICAL: Extract detailed step-by-step failure information:**

**What to extract from the job detail page:**
- **Job name and overall status**
- **ALL steps in execution order** with status icons (✓/✗)
- **For EACH step**: Name, duration, status
- **For FAILED steps**:
  - The exact command that was run
  - Complete error message and log output
  - Exit code (e.g., "Process completed with exit code 1")
  - Stack traces if present
  - Any specific error messages (e.g., "ENOENT: no such file or directory")

**Example job detail output:**
```
Job: Run Tests
Overall Status: Failed (11s)

Steps:
✓ Checkout code (1s)
✓ Install Nix (2s)
✓ Setup Nix cache (1s)
✓ Load Nix development environment (2s)
✓ Install dependencies (3s)
✗ Run tests (2s) - FAILED
  Command: nix develop .#ci --command npm test --workspace=fellspiral/tests
  Exit code: 1
  Error: ENOENT: no such file or directory, open 'fellspiral/tests/e2e/homepage.spec.js'
  at Object.openSync (node:fs:601:3)

⊘ Upload test results (skipped - test failure)
⊘ Upload test results JSON (skipped - test failure)
```

**Link chain summary:**
1. Actions overview → Find failing workflow → Get RUN_ID
2. Workflow run page (`/runs/[RUN_ID]`) → See all jobs → Get JOB_ID
3. Job detail page (`/runs/[RUN_ID]/job/[JOB_ID]`) → See all steps and error logs

### Step 5: Access Logs from Commit Page (FASTEST Method)

**URL Format:** `https://github.com/rumor-ml/commons.systems/commit/[FULL_COMMIT_SHA]`
**Example:** `https://github.com/rumor-ml/commons.systems/commit/c8d90e0628cfcef65e86fce17be381246bfc798f`

**This is often the FASTEST way to access workflow failure details:**

1. **Navigate to the commit page** using the full 40-character commit SHA
2. **Find the "checks" section** (usually below the commit message and file changes)
3. **Identify failed checks** - look for red ✗ icons next to check names
4. **Click the "Details" link** next to any failed check
5. **You'll be taken directly to the job page** with the specific failure logs

**What to look for in the checks section:**
```
✓ Infrastructure as Code — Passed (8s)
✗ Run Tests — Failed (11s) [Details →]
✗ Lint Check — Failed (9s) [Details →]
```

**Clicking "Details" takes you to:**
- Direct URL format: `https://github.com/rumor-ml/commons.systems/actions/runs/[RUN_ID]/job/[JOB_ID]`
- Example: `https://github.com/rumor-ml/commons.systems/actions/runs/19517357402/job/55872410208`
- This is the SAME job details page from Step 4, but accessed more quickly

**Why use this method:**
- ✅ Faster than navigating: Actions → Workflow → Run → Job
- ✅ Shows ALL checks for this specific commit in one view
- ✅ Direct "Details" links to failed jobs
- ✅ Useful when you have a commit SHA but don't know the run ID

### Step 6: Understanding Log Access

**IMPORTANT:** Detailed execution logs may require authentication to GitHub.

**What you can see WITHOUT authentication:**
- Job name and overall status
- Duration
- Warnings (e.g., "No files found at path...")
- List of steps (but not their detailed output)

**What MAY REQUIRE authentication:**
- Step-by-step console output
- Actual error messages and stack traces
- Command execution logs
- Exit codes from failed commands

**If you see "Sign in to view logs":**
- The job page is accessible but logs require GitHub authentication
- You can still see high-level info (warnings, job status, step list)
- For complete debugging, access the page while signed into GitHub

**Complete Link Chain Summary:**
```
Method 1 (From Actions Overview):
Actions → Workflow runs → Run details → Job details → Logs

Method 2 (From Commit Page - FASTEST):
Commit page → Checks section → "Details" link → Job details → Logs

Both methods lead to the same job details page with execution logs.
```

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
