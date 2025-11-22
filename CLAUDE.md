# Claude Instructions for This Repository

## Core Tools (`claudetool/`)

Utility scripts for debugging and operations. All scripts are self-contained and documented.

### Workflow & Deployment Tools

**`check_workflows.py`** - GitHub Actions status inspector
```bash
./claudetool/check_workflows.py [--branch <name>] [--monitor]
```

**`get_workflow_logs.sh`** - Fetch GitHub Actions logs (handles auth correctly)
```bash
./claudetool/get_workflow_logs.sh <run_id|branch|--latest|--failed>
```
Use this instead of manual curl - it handles multi-step API calls and authentication.

**`add-site.sh`** - Scaffold new monorepo site
```bash
./claudetool/add-site.sh <site-name>
```
Creates site structure, tests, and manual deploy workflow. See "Adding Sites to CI/CD" below for required workflow updates.

### GCP Tools

**`get_gcp_token.sh`** - Generate/cache GCP OAuth2 token
```bash
source claudetool/get_gcp_token.sh 2>/dev/null  # Sets $GCP_ACCESS_TOKEN
```

**`verify_gcp_credentials.sh`** - Verify GCP credentials work

**`debug_gcp_deployment.py`** - Diagnose GCP deployment issues (APIs, permissions, services)

## API Access

### GitHub API
```bash
curl -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/rumor-ml/commons.systems/actions/runs
```

**Auth troubleshooting:** Use `Authorization: token` not `Bearer`. Token does not expire during sessions - check header format first.

### GCP API
```bash
source claudetool/get_gcp_token.sh 2>/dev/null
curl -H "Authorization: Bearer $GCP_ACCESS_TOKEN" \
  "https://run.googleapis.com/v2/projects/$GCP_PROJECT_ID/locations/us-central1/services"
```

Environment provides `GOOGLE_APPLICATION_CREDENTIALS_JSON` and `GCP_PROJECT_ID=chalanding`.

## Debugging Workflow

**Policy:**
- Fetch and analyze logs yourself via API
- Trust user bug reports - investigate code and logs thoroughly
- Fix root causes in the implementation

**Failed deployment workflow:**
1. `./claudetool/check_workflows.py --branch <branch>` - Identify failed run
2. `./claudetool/get_workflow_logs.sh <run_id|--failed>` - Fetch logs
3. Read source code and identify root cause from errors
4. Fix, commit, push
5. `./claudetool/check_workflows.py --branch <branch> --monitor` - Verify fix

**Debug scripts:** Save to `/tmp/` (temporary), not `claudetool/` (permanent utilities only).

## Adding Sites to CI/CD

After running `add-site.sh`, manually update both workflow files:

### `push-main.yml` (Matrix Strategy)
1. Add local test step (line ~53)
2. Add site to matrix array (line ~133): `site: [fellspiral, videobrowser, <sitename>]`
3. Add collect-urls output (line ~327)
4. Add URL retrieval in collect-urls job (line ~360)
5. Add E2E test step (line ~452)
6. Add rollback step (line ~522)
7. (Optional) Add Firebase rules if needed (see lines 235-303)

### `push-feature.yml` (Separate Jobs)
1. Add change detection output (line ~35)
2. Add change check step (line ~81)
3. Add local test step (line ~101)
4. Clone and update complete `deploy-<sitename>` job
5. Clone and update complete `playwright-tests-<sitename>` job

## Manual Deployments

Each site has a manual workflow: `.github/workflows/deploy-<site>-manual.yml`

Use for: on-demand deployments, testing branches, hotfixes, individual site updates.

Runs: local tests → deploy → E2E tests (serial, stop on error).

## Pre-Merge Verification

**Before suggesting merge or PR:**
1. Check workflow status: `./claudetool/check_workflows.py --branch <branch>`
2. Monitor to completion if in-progress: `--monitor`
3. Verify all jobs passed, deployment healthy
4. Suggest merge only after full pipeline success

Deliver fully verified code.

## Documentation Policy

- Update `README.md` for user documentation
- Use inline comments/docstrings for code documentation
- Create new `.md` files only when explicitly requested

## Development Guidelines

### Commit Messages
- Imperative verb (Add, Fix, Update, Remove)
- First line <72 chars
- Detailed description if needed

### Code Style
- Follow existing patterns
- Modern JavaScript (ES6+)
- Self-documenting names
- Comments only for complex logic

### Test-Driven Development

**For bug fixes:**
1. Write test that reproduces the bug
2. Verify test fails
3. Fix bug
4. Verify test passes
5. Run full suite

**For features:**
1. Write tests alongside implementation
2. Verify test coverage
3. Run full suite

**Rules:**
- Claim "fixed" or "complete" only after tests pass
- Commit only when all tests pass
- Add test coverage for bugs and features

**Example workflow:**
```bash
npm test          # Verify failure (bugs) or baseline (features)
# ... implement ...
npm test          # Verify passes
# Only then inform user of completion
```

This ensures bugs stay fixed, features work correctly, and regressions are caught immediately.
