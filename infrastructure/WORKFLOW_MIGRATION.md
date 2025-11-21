# Workflow Migration Guide

## Overview

This document describes the refactoring of GitHub Actions workflows to manage step dependencies within workflows rather than making workflows interdependent.

## What Changed

### Before: Interdependent Workflows

The previous architecture used `workflow_run` triggers to chain workflows together:
- `ci.yml` → triggered by `deploy-feature-branch.yml` OR `push`
- `infrastructure.yml` → triggered by `ci.yml`
- `deploy-playwright-server.yml` → triggered by `infrastructure.yml`
- `deploy.yml` (fellspiral) → triggered by `infrastructure.yml`
- `deploy-videobrowser.yml` → triggered by `infrastructure.yml`

This created complex dependencies between workflows and made it difficult to understand the overall flow.

### After: Single Push Workflow with Internal Dependencies

The new architecture uses a single `push.yml` workflow with clearly defined job dependencies:

1. **Local Tests** (series, stop on fail)
   - Run tests for each changed site
   - Detect which components changed

2. **Infrastructure as Code** (only on main)
   - Run Terraform to manage GCP infrastructure
   - Depends on: Local Tests

3. **Deploy** (parallel, only if changed)
   - Deploy Playwright Server (if changed and on main)
   - Deploy Fellspiral (if changed)
   - Deploy Videobrowser (if changed)
     - Includes Firebase configuration injection
     - Deploys Firebase Storage rules
   - Depends on: Local Tests, Infrastructure

4. **Playwright Tests** (parallel, per site)
   - Test Fellspiral (depends only on: Deploy Fellspiral, Playwright Server)
   - Test Videobrowser (depends only on: Deploy Videobrowser, Playwright Server)
   - Each site's tests run independently in parallel

5. **Rollback** (on failure, only on main)
   - Rollback Fellspiral (depends on: Deploy Fellspiral, Playwright Tests Fellspiral)
   - Rollback Videobrowser (depends on: Deploy Videobrowser, Playwright Tests Videobrowser)
   - Each site rolls back independently if its tests fail

## Common Logic Extracted

Created reusable scripts in `infrastructure/scripts/`:

- `check-changes.sh` - Detect file changes in paths
- `sanitize-branch-name.sh` - Convert branch names to service names
- `health-check.sh` - Wait for services to be healthy
- `get-deployment-url.sh` - Get deployment URLs
- `deploy-site.sh` - Deploy sites to Cloud Run
- `deploy-playwright-server.sh` - Deploy Playwright server
- `run-local-tests.sh` - Run local tests
- `run-playwright-tests.sh` - Run Playwright tests

## Workflows Updated

### New Workflows
- ✅ `push.yml` - Main pipeline handling all push events

### Updated Workflows
- ✅ `health-check.yml` - Refactored to run sites in parallel with health checks first

### Unchanged Workflows (No Dependencies)
- ✅ `cleanup-preview.yml` - Branch cleanup (triggered on delete)

### Deprecated Workflows (Can be deleted)
- ❌ `ci.yml` - Replaced by `push.yml` local tests
- ❌ `ci-videobrowser.yml` - Replaced by `push.yml` local tests
- ❌ `infrastructure.yml` - Integrated into `push.yml`
- ❌ `deploy-playwright-server.yml` - Integrated into `push.yml`
- ❌ `deploy.yml` - Replaced by `push.yml` deploy jobs
- ❌ `deploy-videobrowser.yml` - Replaced by `push.yml` deploy jobs
- ❌ `deploy-feature-branch.yml` - Replaced by `push.yml` deploy jobs
- ❌ `deploy-feature-branch-videobrowser.yml` - Replaced by `push.yml` deploy jobs

## Migration Steps

1. **Review and test the new `push.yml` workflow**
   - Push a commit to a feature branch
   - Verify local tests run
   - Verify feature branch deployments work
   - Verify Playwright tests run

2. **Test on main branch**
   - Merge to main
   - Verify infrastructure runs
   - Verify production deployments work
   - Verify Playwright tests run

3. **Delete old workflows** (after confirming new workflow works)
   ```bash
   rm .github/workflows/ci.yml
   rm .github/workflows/ci-videobrowser.yml
   rm .github/workflows/infrastructure.yml
   rm .github/workflows/deploy-playwright-server.yml
   rm .github/workflows/deploy.yml
   rm .github/workflows/deploy-videobrowser.yml
   rm .github/workflows/deploy-feature-branch.yml
   rm .github/workflows/deploy-feature-branch-videobrowser.yml
   ```

4. **Update any documentation** that references old workflows

## Benefits

1. **Clearer Flow**: All logic in one place, easier to understand
2. **DRY**: Common logic extracted to reusable scripts
3. **Better Parallelization**: Sites deploy in parallel when possible
4. **Easier Debugging**: All steps visible in one workflow run
5. **Reduced Complexity**: No more workflow_run triggers
6. **Better Testing**: Health checks before Playwright tests
7. **Atomic Rollbacks**: Failed deployments rollback automatically

## Rollback Plan

If issues arise, you can temporarily re-enable old workflows by:
1. Reverting the commit that added `push.yml`
2. Restoring old workflow files from git history
3. Investigating and fixing issues with new workflow
4. Re-attempting migration

## Support

For issues or questions, create a GitHub issue with the label `workflow-migration`.
