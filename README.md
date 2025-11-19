# Commons.Systems Monorepo

A monorepo for commons.systems projects, starting with Fellspiral - a tactical tabletop RPG.

## Projects

### Fellspiral
A tactical tabletop RPG with detailed combat mechanics featuring initiative-based gameplay, zones, and strategic decision-making.

- **Site**: `/fellspiral/site` - Static website showcasing game rules
- **Tests**: `/fellspiral/tests` - E2E and integration tests
- **Docs**: `/fellspiral/rules.md` - Game rules documentation

## Quick Start

```bash
# Clone the repository
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

The site is automatically deployed to GCP Cloud Storage + CDN via GitHub Actions.

### Automatic Deployment (GitHub Actions)

1. **On Pull Request**: Runs full test suite
2. **On Merge to Main**: Builds, tests, deploys, and validates deployment
3. **Every 6 Hours**: Health check ensures site is operational

### Manual Deployment

```bash
cd infrastructure/scripts
cp .env.example .env
# Edit .env with your GCP project details
./deploy.sh
```

### Infrastructure Setup

Choose one method:

**Automated Script (Easiest):**
```bash
cd infrastructure/scripts
./setup-gcp.sh
```

**Terraform (Recommended):**
```bash
cd infrastructure/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars
terraform init
terraform apply
```

See [SETUP.md](SETUP.md) for detailed instructions.

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

1. **CI** (`.github/workflows/ci.yml`)
   - Triggers: All pushes and PRs
   - Runs: Build + full test suite
   - Outputs: Test reports and coverage

2. **Deploy** (`.github/workflows/deploy.yml`)
   - Triggers: Push to main, manual dispatch
   - Steps: Build → Test → Deploy → Validate
   - Environments: Production (extensible to staging)

3. **Health Check** (`.github/workflows/health-check.yml`)
   - Triggers: Every 6 hours, manual dispatch
   - Runs: Smoke tests against live site
   - Creates issue on failure

### Required Secrets

- `GCP_PROJECT_ID`: Your GCP project ID
- `GCP_SA_KEY`: Service account key JSON (roles: storage.admin, compute.loadBalancerAdmin)

See [SETUP.md](SETUP.md) for configuration details.

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

- [SETUP.md](SETUP.md) - Detailed setup instructions
- [CONTRIBUTING.md](CONTRIBUTING.md) - How to contribute
- [infrastructure/README.md](infrastructure/README.md) - Infrastructure details
- [fellspiral/rules.md](fellspiral/rules.md) - Game rules

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Development workflow
- Code standards
- Testing guidelines
- Pull request process

## License

MIT
