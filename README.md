# Commons.Systems Monorepo

A monorepo for commons.systems projects, starting with Fellspiral - a tactical tabletop RPG.

## Projects

### Fellspiral
A tactical tabletop RPG with detailed combat mechanics featuring initiative-based gameplay, zones, and strategic decision-making.

- **Site**: `/fellspiral/site` - Static website showcasing game rules
- **Tests**: `/fellspiral/tests` - E2E and integration tests
- **Docs**: `/fellspiral/rules.md` - Game rules documentation

## Quick Start

### 🚀 Deploy to GCP

Deploy in **1 minute** with **one command**:

1. Run `./infrastructure/scripts/setup-workload-identity.sh` (30 sec)
   - Optionally creates GitHub secrets automatically (via `gh` CLI)
2. Merge PR → Infrastructure + site deploy automatically! (30 sec)

**👉 See [QUICKSTART.md](QUICKSTART.md) for step-by-step instructions.**

**Features:**
- ✅ Keyless authentication (Workload Identity - no keys!)
- ✅ Automatic GitHub secret creation (via `gh` CLI)
- ✅ Infrastructure managed by Terraform automatically
- ✅ Service accounts created and managed by Terraform
- ✅ Zero maintenance - merge and forget

### 💻 Local Development

#### Option 1: Nix/direnv (Recommended)

For a fully reproducible environment with all tools:

```bash
# Install Nix with flakes + direnv (one-time)
# See NIX.md for installation instructions

cd commons.systems
direnv allow  # Loads all tools automatically
npm install
npm run dev
```

See **[NIX.md](NIX.md)** for complete Nix setup instructions.

#### Option 2: Manual Setup

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

## Development

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

## Deployment

### Automated Deployment (Recommended)

**One local command, then fully automated forever:**

1. **One-time Setup** (1 minute):
   ```bash
   cd infrastructure/scripts
   ./setup-workload-identity.sh
   ```
   - Sets up keyless authentication (Workload Identity)
   - Creates service account with correct permissions
   - **Optionally creates GitHub secrets automatically** (if `gh` CLI available)
   - Or outputs 3 values to add manually

2. **Merge PR** → Everything automatic:
   - ✅ Infrastructure created/updated via Terraform
   - ✅ Site builds and deploys
   - ✅ Tests run against deployed site

3. **Ongoing** (zero maintenance):
   - Every PR → Tests run
   - Every merge → Infrastructure updates + deployment
   - Every 6 hours → Health checks
   - On failure → GitHub issue created

**👉 Complete guide:** [QUICKSTART.md](QUICKSTART.md) (1-2 minutes total)

### Alternative: Local Setup

If you prefer local control:

**Terraform:**
```bash
cd infrastructure/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars
terraform init && terraform apply
```

**Shell Script:**
```bash
cd infrastructure/scripts
./setup-deployment.sh  # All-in-one setup
```

**Manual Deployment:**
```bash
cd infrastructure/scripts
cp .env.example .env
# Edit .env with your GCP project details
./deploy.sh
```

See [SETUP.md](SETUP.md) for detailed local setup instructions.

## Architecture

```
Static Site (Vite) → Cloud Storage → Cloud CDN → Global Users
                          ↓
                    Playwright Tests
```

### Technology Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Build Tool**: Vite 5
- **Testing**: Playwright (E2E, accessibility, performance)
- **Hosting**: GCP Cloud Storage + Cloud CDN
- **CI/CD**: GitHub Actions
- **IaC**: Terraform

## Cost Optimization

Designed for minimal GCP costs:

| Service | Cost | Notes |
|---------|------|-------|
| Cloud Storage | ~$0.002/month | 100MB storage |
| Storage Operations | ~$0.05/month | 10k requests |
| Cloud CDN | ~$0.08/month | 1GB egress |
| Static IP | $0.00 | Free when attached |
| **Total** | **~$0.13/month** | For ~1000 visitors |

**Cost Features:**
- Static-only (no compute instances)
- Aggressive CDN caching
- Lifecycle policies for old content
- Compressed assets
- Optimized cache headers

## CI/CD Pipeline

### Workflows

1. **Infrastructure** (`.github/workflows/infrastructure.yml`)
   - Triggers: PR (plan) + Push to main (apply)
   - Runs Terraform to manage GCP infrastructure
   - **On PR**: Shows plan in comment
   - **On merge**: Applies changes automatically
   - Manages: Storage, CDN, Load Balancer, Service Accounts

2. **CI** (`.github/workflows/ci.yml`)
   - Triggers: All pushes and PRs
   - Runs: Build + full test suite
   - Outputs: Test reports and coverage

3. **Deploy** (`.github/workflows/deploy.yml`)
   - Triggers: Push to main, manual dispatch
   - Steps: Build → Test → Deploy → Validate
   - Uses Workload Identity (keyless auth)
   - Environments: Production (extensible to staging)

4. **Health Check** (`.github/workflows/health-check.yml`)
   - Triggers: Every 6 hours, manual dispatch
   - Runs: Smoke tests against live site
   - Creates issue on failure
   - Uses Workload Identity (keyless auth)

### Required Secrets

Three secrets enable keyless authentication via Workload Identity Federation:

- `GCP_PROJECT_ID`: Your GCP project ID
- `GCP_WORKLOAD_IDENTITY_PROVIDER`: Workload Identity Provider resource name
- `GCP_SERVICE_ACCOUNT`: Service account email for authentication

**Setup:** Run `./infrastructure/scripts/setup-workload-identity.sh` to create these resources and get the values.

**Security Benefits:**
- ✅ No keys or tokens stored in GitHub
- ✅ No key rotation needed
- ✅ Automatic credential management
- ✅ Short-lived tokens only

See [QUICKSTART.md](QUICKSTART.md) for step-by-step setup.

## Testing

Comprehensive test suite covering:

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
│   ├── scripts/                 # Deploy scripts
│   └── README.md
├── .github/workflows/           # CI/CD
├── package.json                 # Root workspace
├── README.md                    # This file
├── SETUP.md                     # Setup guide
└── CONTRIBUTING.md              # Contribution guide
```

## Documentation

### Getting Started
- **[QUICKSTART.md](QUICKSTART.md)** - Deploy in 1-2 minutes
- **[NIX.md](NIX.md)** - Reproducible dev environment with Nix/direnv
- [SETUP.md](SETUP.md) - Detailed local setup instructions
- [CONTRIBUTING.md](CONTRIBUTING.md) - How to contribute

### Technical Details
- [infrastructure/README.md](infrastructure/README.md) - Architecture and infrastructure
- [fellspiral/rules.md](fellspiral/rules.md) - Game rules documentation

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Development workflow
- Code standards
- Testing guidelines
- Pull request process

## License

MIT
