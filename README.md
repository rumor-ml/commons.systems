# Commons.Systems Monorepo

A monorepo for commons.systems projects.

## Projects

### Fellspiral
A tactical tabletop RPG with detailed combat mechanics featuring initiative-based gameplay, zones, and strategic decision-making.

- **Site**: `/fellspiral/site` - Static website showcasing game rules
- **Tests**: `/fellspiral/tests` - E2E and integration tests
- **Docs**: `/fellspiral/rules.md` - Game rules documentation

---

## Table of Contents

- [Quick Start](#quick-start)
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

