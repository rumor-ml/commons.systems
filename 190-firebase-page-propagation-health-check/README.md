# Commons.Systems Monorepo

A monorepo for commons.systems projects.

---

## Quick Start

Deploy the to GCP with **zero local setup** and **one local command**.

### GitHub Codespaces

1. **Open in Codespaces**:
   - Click the green "Code" button on GitHub
   - Select "Codespaces" tab
   - Click "Create codespace on your-branch"
   - Wait for container to build

2. **Run the setup script**:
   ```bash
   python3 iac.py
   ```

   **The script handles everything**:
   - Gathers all inputs upfront (project ID defaults to gcloud config)
   - Enables all required GCP APIs (Firebase, Cloud Run, Artifact Registry, etc.)
   - Sets up Workload Identity Federation
   - Creates service accounts with IAM permissions
   - Configures Artifact Registry
   - Initializes Firebase on your GCP project
   - Creates GitHub secrets automatically
   <!-- TODO: must handle github auth app creation -->

3. <!-- TODO: what is the next step for a user that deploys after cloning the repo -->

## Monorepo Architecture

This repository is structured as a monorepo hosting multiple apps with shared infrastructure.

### App Infrastructure

- Scaffolding
    - Firebase
    - Native go
    - go server
- Shared infrastructure
    - nix system configuration
    - single script gcp iac
    - GitHub CI/CD workflows
    - Playwright browser server for CI/CD testing

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

## Cost

Optimize infrastructure for cost.

### Estimated Monthly Cost (Per Site)

| Service | Cost | Notes |
|---------|------|-------|
| Cloud Run (scale-to-zero) | ~$0.10/month | Minimal idle time, fast cold starts |
| Artifact Registry Storage | ~$0.05/month | Docker images with cleanup policies |
| Cloud Run Requests | ~$0.03/month | 1000 requests |
| Egress | ~$0.02/month | 1GB outbound traffic |
| **Total per site** | **~$0.20/month** | With moderate traffic |
| **Two sites (current)** | **~$0.40/month** | Fellspiral + Video Browser |
