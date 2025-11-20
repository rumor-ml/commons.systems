# Commons.Systems Monorepo

A monorepo for commons.systems projects, starting with Fellspiral - a tactical tabletop RPG.

<!-- Workflows verified: CI tests run on push, infrastructure only on main -->
<!-- CI/Infrastructure workflows run on all branches, Deploy workflow runs only on main -->

## Projects

### Fellspiral
A tactical tabletop RPG with detailed combat mechanics featuring initiative-based gameplay, zones, and strategic decision-making.

- **Site**: `/fellspiral/site` - Static website showcasing game rules
- **Tests**: `/fellspiral/tests` - E2E and integration tests
- **Docs**: `/fellspiral/rules.md` - Game rules documentation

---

## Table of Contents

- [Quick Start](#quick-start)
- [Local Development](#local-development)
- [Deployment](#deployment)
- [CI/CD Pipeline](#cicd-pipeline)
- [Architecture](#architecture)
- [Testing](#testing)
- [Contributing](#contributing)
- [Cost](#cost)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

Deploy the Fellspiral site to GCP with **zero local setup** or **one local command**.

### Option A: GitHub Codespaces (Recommended - Zero Local Setup)

**Time:** 2 minutes
**Local setup:** None
**Requirements:** GitHub account with Codespaces enabled
**Result:** Fully configured dev environment + infrastructure setup

#### Steps

1. **Open in Codespaces**:
   - Click the green "Code" button on GitHub
   - Select "Codespaces" tab
   - Click "Create codespace on your-branch"
   - Wait 2-3 minutes for container to build

2. **Load the Nix environment** (all tools are accessed via Nix):
   ```bash
   nix develop
   ```

3. **Run the initialization script**:
   ```bash
   cd infrastructure/scripts
   ./setup-workload-identity.sh
   ```

4. **The script handles everything**:
   - Checks GCP authentication (prompts `gcloud auth login` if needed)
   - Checks GitHub authentication (prompts `gh auth login` if needed)
   - Creates Workload Identity Pool & Provider
   - Creates service accounts with IAM permissions
   - Offers to create GitHub secrets automatically

5. **Done!** Close Codespace, merge PR, and deployments work automatically

**Benefits:**
- ✅ No local tool installation needed
- ✅ Consistent environment (same Nix flake as CI/CD)
- ✅ All tools pre-installed (gcloud, gh, terraform, node, npm)
- ✅ Works from any machine with a browser
- ✅ Free tier available (60 hours/month)

### Option B: Local Setup Script

**Time:** 1 minute (with `gh` CLI) or 2 minutes (without)
**Local commands:** 1
**Manual steps:** 0 (with `gh` CLI) or add 3 GitHub secrets (without)
**Result:** Fully automated infrastructure + deployment

#### Prerequisites

**Required:**
- Google Cloud Platform account
- GCP Project created
- `gcloud` CLI installed locally ([install guide](https://cloud.google.com/sdk/docs/install))

**Optional (recommended):**
- GitHub CLI (`gh`) for automatic secret creation ([install guide](https://cli.github.com/))
- Nix + direnv for reproducible development environment (see [Local Development](#local-development))

#### Step 1: Run Setup Script (30 seconds)

```bash
cd infrastructure/scripts
./setup-workload-identity.sh
```

This script:
- ✅ Enables required GCP APIs
- ✅ Creates Workload Identity Pool & Provider (keyless auth)
- ✅ Creates service account with correct permissions
- ✅ **Automatically creates GitHub secrets** (if you have `gh` CLI)

**No keys, no tokens, completely secure!**

#### With GitHub CLI (Recommended)
The script detects `gh` CLI and offers to create secrets automatically:
- Answer `y` when prompted
- Secrets created instantly
- **Skip to Step 2!**

#### Without GitHub CLI
Add secrets manually:
1. Go to: `https://github.com/your-org/commons.systems/settings/secrets/actions`
2. Add the 3 secrets shown by the script:
   - `GCP_PROJECT_ID`
   - `GCP_WORKLOAD_IDENTITY_PROVIDER`
   - `GCP_SERVICE_ACCOUNT`

### Step 2: Merge PR (30 seconds)

Merge your PR to `main`.

**What happens automatically:**

1. **Infrastructure workflow** runs (~ 2 minutes):
   - ✅ Terraform creates Cloud Storage bucket
   - ✅ Terraform creates Cloud CDN + Load Balancer
   - ✅ Terraform creates Static IP
   - ✅ Terraform creates deployment service account

2. **Deploy workflow** runs (~5 minutes):
   - ✅ Builds the site
   - ✅ Runs full test suite
   - ✅ Deploys to GCP
   - ✅ Tests the deployed site
   - ✅ **Automatic rollback on test failure**

3. **Done!** Your site is live at the IP shown in the workflow output.

### What You Get

#### Automated Forever
- ✅ **Every PR** → Tests run automatically
- ✅ **Every merge to main** → Infrastructure updates (if changed) + site deploys
- ✅ **On test failure** → Automatic rollback to previous version
- ✅ **Optional health checks** → Can be enabled for periodic monitoring

#### Infrastructure as Code
- Edit any file in `infrastructure/terraform/` and commit
- **On PR** → Terraform plan shown in PR comment
- **On merge** → Terraform apply runs automatically
- **Service accounts, CDN, storage** → All managed by Terraform

#### Zero Maintenance
- No keys to rotate (Workload Identity is keyless)
- No manual deployments
- No infrastructure drift
- Automatic rollback on deployment failures

---

## Local Development

### Option 1: GitHub Codespaces (Easiest)

For instant setup with zero local configuration:

**Setup:**
1. Click "Code" → "Codespaces" → "Create codespace"
2. Wait 2-3 minutes for environment to build
3. Start developing immediately

**What you get:**
- ✅ All tools pre-installed via Nix (gcloud, gh, terraform, node, npm)
- ✅ Automatic dependency installation
- ✅ VS Code in browser with extensions
- ✅ Same environment as CI/CD
- ✅ Port forwarding for dev server (port 3000)

**Development:**
```bash
# First, enter the Nix environment (provides all tools)
nix develop

# Then run your development commands
npm run dev    # Start dev server
npm test       # Run tests
npm run build  # Build site
```

**When to use:**
- Quick prototyping or testing
- Contributing without local setup
- Consistent environment across machines
- Teaching or demos

### Option 2: Nix/direnv (Local Machine)

For a fully reproducible environment on your local machine:

#### Prerequisites

Install Nix with flakes enabled:

```bash
# Install Nix (if not already installed)
sh <(curl -L https://nixos.org/nix/install) --daemon

# Enable flakes (add to ~/.config/nix/nix.conf or /etc/nix/nix.conf)
experimental-features = nix-command flakes
```

#### Install direnv

```bash
# macOS
brew install direnv

# Linux
# See: https://direnv.net/docs/installation.html

# Add to your shell config (~/.bashrc, ~/.zshrc, etc)
eval "$(direnv hook bash)"  # or zsh, fish, etc
```

#### Setup

```bash
cd commons.systems
direnv allow  # First time only - loads environment + installs npm dependencies automatically!
npm run dev   # Dependencies already installed
```

All tools automatically available:
- ✅ `gcloud` - Google Cloud SDK
- ✅ `gh` - GitHub CLI
- ✅ `node` v20 - Node.js
- ✅ `npm` - Package manager
- ✅ `terraform` - Infrastructure as Code
- ✅ `playwright` - Browser automation (with browsers)
- ✅ **Automatic npm dependency installation**

#### Benefits

- **Reproducibility**: Everyone gets exact same tool versions
- **Zero System Pollution**: Tools isolated to project
- **Automatic Setup**: With direnv, tools load on `cd`
- **CI/CD Consistency**: Same Nix environment used in GitHub Actions

#### Troubleshooting Nix

**"command not found: direnv"**
Install direnv and add the hook to your shell config.

**"error: experimental Nix feature 'nix-command' is disabled"**
Enable flakes:
```bash
mkdir -p ~/.config/nix
echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf
```

**Playwright browsers not working**
The environment automatically sets `PLAYWRIGHT_BROWSERS_PATH`. If issues persist:
```bash
npx playwright install
```

### Option 3: Manual Setup

```bash
# Install prerequisites: Node.js 20, gcloud CLI, gh CLI
git clone <repository-url>
cd commons.systems

# Install dependencies
npm install

# Run local development server
npm run dev
```

Visit `http://localhost:3000` to view the site.

### Available Commands

```bash
# Development
npm run dev                # Start dev server (port 3000)
npm run build             # Build site for production
npm run preview           # Preview production build

# Testing
npm test                  # Run all tests
npm run test:deployed     # Test deployed site

# Per-workspace commands
npm run dev --workspace=fellspiral/site
npm test --workspace=fellspiral/tests
```

### Running Tests

```bash
# Install test dependencies (first time)
cd fellspiral/tests
npx playwright install

# Run tests
npm test                  # All tests, all browsers
npm run test:ui          # Interactive UI mode
npm run test:headed      # See browser during tests
```

---

## Deployment

### Automated Deployment (Recommended)

**One local command, then fully automated forever:**

See [Quick Start](#quick-start) for complete deployment guide.

### Alternative: Manual Terraform

If you prefer local control:

```bash
cd infrastructure/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars
terraform init && terraform apply
```

### Alternative: Shell Script

```bash
cd infrastructure/scripts
./setup-deployment.sh  # All-in-one setup
```

### Alternative: Manual Deployment

```bash
cd infrastructure/scripts
cp .env.example .env
# Edit .env with your GCP project details
./deploy.sh
```

---

## CI/CD Pipeline

All workflows use Nix for consistent environments across local development and CI/CD.

### Workflows

#### 1. Infrastructure (`.github/workflows/infrastructure.yml`)
- **Triggers:** PR (plan) + Push to main (apply)
- **Uses:** Nix-provided Terraform and gcloud
- **On PR:** Shows Terraform plan in PR comment
- **On merge:** Applies changes automatically
- **Manages:** Storage, CDN, Load Balancer, Service Accounts, Backup Bucket

#### 2. CI (`.github/workflows/ci.yml`)
- **Triggers:** All pushes and PRs
- **Uses:** Nix development environment
- **Runs:** Build + full test suite
- **Outputs:** Test reports and coverage

#### 3. Deploy (`.github/workflows/deploy.yml`)
- **Triggers:** Push to main, manual dispatch
- **Uses:** Nix CI environment
- **Steps:** Build → Test → Deploy → Validate → Rollback (if tests fail)
- **Auth:** Workload Identity (keyless)
- **Environments:** Production (extensible to staging)
- **Rollback:** Automatic restoration of previous deployment if tests fail

#### 4. Health Check (`.github/workflows/health-check.yml`)
- **Triggers:** Manual dispatch only (scheduled checks disabled by default)
- **Uses:** Nix CI environment
- **Runs:** Smoke tests against live site
- **On failure:** Creates GitHub issue

### Required Secrets

Three secrets enable keyless authentication via Workload Identity Federation:

- `GCP_PROJECT_ID`: Your GCP project ID
- `GCP_WORKLOAD_IDENTITY_PROVIDER`: Workload Identity Provider resource name
- `GCP_SERVICE_ACCOUNT`: Service account email for authentication

**Optional:**
- `CACHIX_AUTH_TOKEN`: For Nix binary cache (improves build speed)

**Setup:** Run `./infrastructure/scripts/setup-workload-identity.sh` to create these resources.

**Security Benefits:**
- ✅ No keys or tokens stored in GitHub
- ✅ No key rotation needed
- ✅ Automatic credential management
- ✅ Short-lived tokens only

### Automatic Rollback

If deployment tests fail after deploying to production:
1. Previous deployment is backed up before each deploy
2. On test failure, backup is automatically restored
3. GitHub issue is created with failure details
4. Site remains on last known good version

### Enabling Health Checks

Health checks are disabled by default. To enable:

Edit `.github/workflows/health-check.yml`:

```yaml
on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours
  workflow_dispatch:
```

Uncomment the `schedule` section.

**Custom Schedule:**
```yaml
- cron: '0 */1 * * *'   # Every hour
- cron: '0 */12 * * *'  # Every 12 hours
- cron: '0 0 * * *'     # Daily at midnight
- cron: '0 0 * * 1'     # Weekly on Monday
```

**Manual Health Check:**
1. Go to Actions tab
2. Select "Health Check" workflow
3. Click "Run workflow"

---

## Architecture

### System Architecture

```
Static Site (Vite) → Cloud Storage → Cloud CDN → Global Users
                          ↓
                    Playwright Tests
                          ↓
                    Backup Bucket (Rollback)
```

### Infrastructure Components

#### Cloud Storage Bucket
- Hosts static files (HTML, CSS, JS)
- Configured for website hosting
- Publicly accessible
- Lifecycle policies for cost optimization

#### Backup Bucket
- Automatic pre-deployment backups
- 7-day retention policy
- Enables automatic rollback on failure

#### Cloud CDN
- Global content delivery network
- Caches static assets
- Reduces latency
- Minimizes origin requests

#### Load Balancer
- HTTP(S) load balancing
- URL map routing
- Static IP address
- SSL termination (when configured)

### Technology Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Build Tool**: Vite 5
- **Testing**: Playwright (E2E, accessibility, performance)
- **Hosting**: GCP Cloud Storage + Cloud CDN
- **CI/CD**: GitHub Actions with Nix
- **IaC**: Terraform
- **Dev Environment**: Nix + direnv

---

## Testing

### Test Suite

Comprehensive testing covering:
- **Functionality**: Navigation, tabs, content display
- **Accessibility**: ARIA, keyboard navigation, contrast
- **Performance**: Load times, bundle sizes
- **Responsive**: Mobile, tablet, desktop
- **Deployment**: Live site validation

**Test Stats:**
- 50+ test scenarios
- 5 browser/device combinations
- <15 minute execution time
- Parallel execution

### Writing Tests

Tests are located in `fellspiral/tests/e2e/`.

Example test structure:

```javascript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should do something', async ({ page }) => {
    const element = page.locator('.selector');
    await expect(element).toBeVisible();
  });
});
```

### Test Categories

1. **Homepage tests**: Basic page loading and structure
2. **Feature tests**: Specific functionality (tabs, navigation)
3. **Accessibility tests**: ARIA attributes, keyboard navigation
4. **Performance tests**: Load times, bundle sizes
5. **Responsive tests**: Mobile/tablet/desktop layouts

---

## Contributing

### Development Workflow

1. **Fork and Clone**
   ```bash
   git clone <your-fork-url>
   cd commons.systems
   ```

2. **Create a Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make Changes**
   - Follow existing code style
   - Write clear commit messages
   - Add tests for new features

4. **Test Your Changes**
   ```bash
   npm test                    # Run all tests
   cd fellspiral/tests && npm run test:ui  # Debug tests
   cd ../site && npm run build && npm run preview  # Test build
   ```

5. **Submit a Pull Request**
   - Push branch to your fork
   - Open PR against main repository
   - Describe changes clearly
   - Link related issues

### Code Standards

#### HTML
- Use semantic HTML5 elements
- Include proper accessibility attributes
- Keep markup clean and readable

#### CSS
- Follow BEM naming where appropriate
- Use CSS custom properties (variables)
- Mobile-first responsive design
- Keep selectors specific but not complex

#### JavaScript
- Use modern ES6+ syntax
- Write clear, self-documenting code
- Add comments for complex logic
- Avoid global variables

### Running Tests

```bash
# All tests
npm test

# Specific file
npx playwright test homepage.spec.js

# Specific test
npx playwright test -g "should display hero"

# Debug mode
npx playwright test --debug
```

### Code of Conduct

- Be respectful and constructive
- Welcome newcomers
- Focus on what is best for the project
- Show empathy towards others

---

## Cost

### Estimated Monthly Cost

Designed for minimal GCP costs:

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

### Monitoring Costs

```bash
# Storage usage
gsutil du -sh gs://your-bucket-name

# CDN hit rate
gcloud compute backend-buckets describe fellspiral-backend

# Request logs
gcloud logging read "resource.type=gcs_bucket"
```

---

## Project Structure

```
commons.systems/
├── fellspiral/
│   ├── site/                    # Static website
│   │   ├── src/
│   │   │   ├── index.html       # Main page
│   │   │   ├── styles/          # CSS
│   │   │   └── scripts/         # JavaScript
│   │   ├── package.json
│   │   └── vite.config.js
│   ├── tests/                   # Test suite
│   │   ├── e2e/                 # E2E tests
│   │   ├── playwright.config.js
│   │   └── package.json
│   └── rules.md                 # Game rules
├── infrastructure/              # GCP infrastructure
│   ├── terraform/               # IaC
│   │   ├── main.tf              # Main resources
│   │   ├── outputs.tf           # Terraform outputs
│   │   └── variables.tf         # Input variables
│   ├── scripts/                 # Deploy scripts
│   │   ├── setup-workload-identity.sh
│   │   └── deploy.sh
│   └── README.md
├── .github/
│   └── workflows/               # CI/CD pipelines
│       ├── ci.yml
│       ├── deploy.yml
│       ├── infrastructure.yml
│       └── health-check.yml
├── flake.nix                    # Nix development environment
├── .envrc                       # direnv configuration
├── package.json                 # Root workspace
└── README.md                    # This file
```

---

## Troubleshooting

### Local Development

**Tests Failing Locally**
```bash
cd fellspiral/tests
npx playwright install --with-deps
```

**Nix Environment Issues**
```bash
# Reload environment
direnv reload

# Reinstall dependencies
rm -rf node_modules
direnv reload  # Or: npm install
```

### Deployment

**"Workload Identity Provider not found"**
- Run `./infrastructure/scripts/setup-workload-identity.sh`
- Check provider value in GitHub secrets matches script output

**"Permission denied"**
- Script creates service account with required permissions
- Check GCP IAM console for service account roles

**"Terraform plan fails"**
- First merge creates infrastructure
- Check workflow logs for details
- Verify GCP project ID is correct

**Deployment Failing**
```bash
# Check authentication
gcloud auth list
gcloud config get-value project

# Check bucket exists
gsutil ls -b gs://your-project-id-fellspiral-site
```

### Site Access

**Site Not Loading**

1. Check bucket is public:
   ```bash
   gsutil iam get gs://your-bucket-name
   ```

2. Check files uploaded:
   ```bash
   gsutil ls gs://your-bucket-name
   ```

3. Check load balancer:
   ```bash
   gcloud compute forwarding-rules describe fellspiral-http-forwarding-rule --global
   ```

**High Costs**

Check egress and CDN hit rate:
```bash
# Egress
gcloud logging read "resource.type=gcs_bucket AND metric.type=storage.googleapis.com/network/sent_bytes_count"

# CDN hit rate
gcloud monitoring read "compute.googleapis.com/https/request_count"
```

### Rollback Issues

**Manual Rollback**

If automatic rollback fails:
```bash
# List available backups
gsutil ls gs://your-project-id-fellspiral-site-backup/

# Restore from specific backup
gsutil -m rsync -r -d \
  gs://your-project-id-fellspiral-site-backup/rollback-TIMESTAMP/ \
  gs://your-project-id-fellspiral-site/
```

---

## Additional Resources

- [GCP Cloud Storage Documentation](https://cloud.google.com/storage/docs)
- [GCP Cloud CDN Documentation](https://cloud.google.com/cdn/docs)
- [Terraform GCP Provider](https://registry.terraform.io/providers/hashicorp/google/latest/docs)
- [Nix Package Manager](https://nixos.org/manual/nix/stable/)
- [direnv Documentation](https://direnv.net/)
- [Playwright Testing](https://playwright.dev/)

---

## License

MIT
