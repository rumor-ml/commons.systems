# Commons.Systems Monorepo

A monorepo for commons.systems projects.

## Projects

This monorepo hosts multiple static sites with shared infrastructure and CI/CD pipelines.

### Fellspiral
A tactical tabletop RPG with detailed combat mechanics featuring initiative-based gameplay, zones, and strategic decision-making.

- **Site**: `/fellspiral/site` - Static website showcasing game rules
- **Tests**: `/fellspiral/tests` - E2E and integration tests
- **Docs**: `/fellspiral/rules.md` - Game rules documentation

### Video Browser
A video navigation interface for exploring video files stored in GCS bucket `rml-media/video`.

- **Site**: `/videobrowser/site` - Interactive video browser with playback
- **Tests**: `/videobrowser/tests` - E2E tests for video browser functionality

---

## Table of Contents

- [Quick Start](#quick-start)
- [Monorepo Architecture](#monorepo-architecture)
- [Adding a New Site](#adding-a-new-site)
- [CICD Requirements](#cicd-requirements)
- [Code Standards](#code-standards)
- [CI/CD Pipeline](#cicd-pipeline)
- [Architecture](#architecture)
- [Testing](#testing)
- [Contributing](#contributing)
- [Cost](#cost)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

Deploy the to GCP with **zero local setup** and **one local command**.

### GitHub Codespaces

1. **Open in Codespaces**:
   - Click the green "Code" button on GitHub
   - Select "Codespaces" tab
   - Click "Create codespace on your-branch"
   - Wait for container to build

2. **Run the initialization script**:
   ```bash
   cd infrastructure/scripts
   ./setup-workload-identity.sh
   ```
   
   **The script handles everything**:
   - Checks GCP authentication (prompts `gcloud auth login` if needed)
   - Checks GitHub authentication (prompts `gh auth login` if needed)
   - Creates Workload Identity Pool & Provider
   - Creates service accounts with IAM permissions
   - Offers to create GitHub secrets automatically

3. <!-- UPDATE THIS: what is the next state for a user that deploys after cloning the repo -->

---

## Monorepo Architecture

This repository is structured as a monorepo hosting multiple static sites with shared infrastructure.

### Structure

```
commons.systems/
├── fellspiral/              # Fellspiral RPG site
│   ├── site/               # Vite project
│   └── tests/              # Playwright tests
├── videobrowser/           # Video Browser site
│   ├── site/               # Vite project
│   └── tests/              # Playwright tests
├── playwright-server/      # Shared test infrastructure
├── infrastructure/         # Shared Terraform infrastructure
│   └── terraform/
│       ├── modules/
│       │   └── static-site/  # Reusable site module
│       ├── main.tf         # Core infrastructure
│       └── sites.tf        # Site-specific resources
└── .github/workflows/      # CI/CD workflows
```

### Key Principles

1. **Each site is independent** - Sites can be developed, tested, and deployed separately
2. **Shared infrastructure** - Common resources (Terraform modules, test server) are reused
3. **Workspace-based builds** - npm workspaces manage dependencies and builds
4. **Path-based CI/CD** - Workflows only trigger when relevant files change
5. **Cost-effective** - Each site costs ~$0.13/month (static hosting + CDN only)

### Infrastructure Pattern

Each site uses the reusable `static-site` Terraform module which provisions:
- GCS bucket for static hosting
- Cloud CDN with configurable TTL
- Global load balancer with static IP
- Optional backup bucket with lifecycle policies

Sites share:
- Terraform state backend (GCS)
- Service accounts for deployment
- Playwright server for testing

---

## Adding a New Site

Follow this reproducible process to add a new site to the monorepo.

### Step 1: Create Site Structure

```bash
# Create directory structure
mkdir -p newsite/site/src
mkdir -p newsite/tests/e2e

# Create site package.json
cat > newsite/site/package.json <<'EOF'
{
  "name": "@commons/newsite-site",
  "version": "1.0.0",
  "description": "Description of your new site",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "vite": "^5.0.0"
  }
}
EOF

# Create vite.config.js (adjust port as needed)
cat > newsite/site/vite.config.js <<'EOF'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 3002,  // Use unique port
    open: true
  }
})
EOF

# Create tests package.json
cat > newsite/tests/package.json <<'EOF'
{
  "name": "@commons/newsite-tests",
  "version": "1.0.0",
  "description": "Test suite for New Site",
  "type": "module",
  "scripts": {
    "test": "playwright test",
    "test:ui": "playwright test --ui",
    "test:headed": "playwright test --headed",
    "test:deployed": "DEPLOYED=true playwright test",
    "test:report": "playwright show-report"
  },
  "devDependencies": {
    "@playwright/test": "^1.40.0",
    "http-server": "^14.1.1"
  }
}
EOF

# Create playwright.config.js
cat > newsite/tests/playwright.config.js <<'EOF'
import { defineConfig, devices } from '@playwright/test';

const isDeployed = process.env.DEPLOYED === 'true';
const baseURL = isDeployed
  ? process.env.DEPLOYED_URL || 'https://newsite.commons.systems'
  : 'http://localhost:3002';  // Match Vite port

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: [['html'], ['list'], ['json', { outputFile: 'test-results.json' }]],
  use: {
    baseURL,
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        },
      },
    },
  ],
  webServer: isDeployed ? undefined : {
    command: process.env.CI
      ? 'npx http-server ../site/dist -p 3002 -s'
      : 'cd ../site && npm run dev',
    url: 'http://localhost:3002',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
EOF
```

### Step 2: Update Root package.json

Add your site to the workspaces and scripts:

```json
{
  "workspaces": [
    "fellspiral/site",
    "fellspiral/tests",
    "videobrowser/site",
    "videobrowser/tests",
    "newsite/site",
    "newsite/tests"
  ],
  "scripts": {
    "dev:newsite": "npm run dev --workspace=newsite/site",
    "build:newsite": "npm run build --workspace=newsite/site",
    "test:newsite": "npm test --workspace=newsite/tests",
    "test:newsite:deployed": "npm run test:deployed --workspace=newsite/tests",
    "preview:newsite": "npm run preview --workspace=newsite/site"
  }
}
```

### Step 3: Add Infrastructure

Edit `infrastructure/terraform/sites.tf` to add your site:

```hcl
module "newsite" {
  source = "./modules/static-site"

  project_id = var.project_id
  site_name  = "newsite"
  region     = var.region

  enable_cdn    = true
  cdn_ttl       = 3600
  cdn_max_ttl   = 86400
  enable_backup = true  # Optional
}

# Add outputs
output "newsite_bucket_name" {
  value       = module.newsite.bucket_name
  description = "New Site storage bucket name"
}

output "newsite_site_url" {
  value       = module.newsite.site_url
  description = "New Site URL"
}

output "newsite_site_ip" {
  value       = module.newsite.site_ip
  description = "New Site static IP"
}
```

### Step 4: Create CI/CD Workflows

Create `.github/workflows/ci-newsite.yml`:

```yaml
name: CI - New Site

on:
  push:
    branches: ['**']
    paths:
      - 'newsite/**'
      - '.github/workflows/ci-newsite.yml'
      - 'package.json'

jobs:
  test:
    name: Build & Test New Site
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm install
      - run: npm run build:newsite
      - run: cd newsite/tests && npx playwright install --with-deps chromium
      - run: npm run test:newsite -- --project=chromium
        env:
          CI: true
```

Create `.github/workflows/deploy-newsite.yml` (copy and modify from `deploy-videobrowser.yml`).

### Step 5: Implement Your Site

1. Create HTML, CSS, and JavaScript in `newsite/site/src/`
2. Create basic tests in `newsite/tests/e2e/`
3. Test locally: `npm run dev:newsite`
4. Build and test: `npm run build:newsite && npm run test:newsite`

### Step 6: Deploy

1. Commit and push to your branch
2. CI workflow will run automatically
3. Merge to main to deploy:
   - Infrastructure workflow creates GCS bucket, CDN, load balancer
   - Deploy workflow builds and uploads your site
   - Site will be available at the static IP

### Example: Video Browser

See the `videobrowser/` directory for a complete reference implementation that:
- Fetches videos from GCS bucket using the Storage JSON API
- Displays videos in a browsable interface with search
- Includes video player with keyboard shortcuts
- Has comprehensive E2E tests

---

## CI/CD Requirements

- All workflows use Nix for consistent environments across local development and CI/CD.
- Single script CI/CD initialization for all required auth.
- Infrastructure as code.
- Infrastucture hosted on GCP.
- Tests must run locally and in CI.
- Run tests on push.
- Run infrastructure as code, deployment, and deployment validation on push to main.
- If deployment validation fails, automated rollback.
- Manual health checks (scheduled checks disabled by default).
- CI completes < 15 minutes.

## Code Standards

### HTML
- Use semantic HTML5 elements
- Include proper accessibility attributes
- Keep markup clean and readable

### CSS
- Follow BEM naming where appropriate
- Use CSS custom properties (variables)
- Mobile-first responsive design
- Keep selectors specific but not complex

### JavaScript
- Use modern ES6+ syntax
- Write clear, self-documenting code
- Add comments for complex logic
- Avoid global variables

---

## CI/CD Pipeline

The repository uses GitHub Actions workflows that ensure code quality and safe deployments.

### Workflow Pattern

```
Push to any branch
    └─> CI workflow runs
        ├─> Build & Test
        └─> Lint Check

Push to main
    └─> CI workflow runs
         └─> (on success) IAC workflow runs
              └─> (on success) Concurrently:
                   ├─> Deploy to GCP
                   │    ├─> Verify CI succeeded
                   │    ├─> Build site
                   │    ├─> Deploy to Cloud Storage
                   │    ├─> Test deployed site
                   │    └─> (on failure) Rollback to previous version
                   │
                   └─> Deploy Playwright Server (only if playwright-server/ changed)
                        ├─> Build Docker image
                        ├─> Deploy to Cloud Run
                        └─> Test deployment
```

### Workflows

- **CI - Test Suite** (`.github/workflows/ci.yml`)
  - Runs on every push to any branch
  - Builds site, runs Playwright tests, and lints code
  - Must succeed before deployment can proceed

- **Infrastructure as Code** (`.github/workflows/infrastructure.yml`)
  - Runs on push to main (after CI succeeds)
  - Manages GCP infrastructure via Terraform
  - Creates/updates buckets, CDN, static IP, etc.

- **Deploy to GCP** (`.github/workflows/deploy.yml`)
  - Triggers after IAC workflow completes
  - Verifies CI also succeeded before deploying
  - Deploys site to Cloud Storage
  - Runs deployment tests
  - Automatically rolls back on test failure

- **Deploy Playwright Server** (`.github/workflows/deploy-playwright-server.yml`)
  - Triggers after IAC workflow completes
  - Only runs if `playwright-server/` directory has changes
  - Builds and deploys containerized Playwright server to Cloud Run

- **Health Check** (`.github/workflows/health-check.yml`)
  - Manual trigger only (scheduled checks disabled)
  - Runs deployment tests against production site
  - Creates issue on failure

### Deployment Safety

- **Prerequisite verification**: Deploy only runs if both CI and IAC succeed
- **No duplicate runs**: Deploy triggers once per commit (after IAC completes)
- **Automated rollback**: On test failure, automatically restores previous version
- **Conditional deploys**: Playwright server only deploys when relevant files change

---

## Cost

Optimize infrastructure for cost.

### Estimated Monthly Cost

| Service | Cost | Notes |
|---------|------|-------|
| Cloud Storage | ~$0.002/month | 100MB storage |
| Storage Operations | ~$0.05/month | 10k requests |
| Cloud CDN | ~$0.08/month | 1GB egress |
| Static IP | $0.00 | Free when attached |
| Backup Storage | ~$0.001/month | 7-day retention |
| **Total** | **~$0.13/month** | For ~1000 visitors |

### Cost Optimization Features

- Static-only (no compute instances)
- Aggressive CDN caching
- Lifecycle policies for old content
- Compressed assets
- Optimized cache headers
- Automatic backup cleanup (7 days)
