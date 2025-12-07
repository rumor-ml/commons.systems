# Commons.Systems Monorepo

A monorepo for commons.systems projects.

---

## Quick Start

Deploy the to GCP with **zero local setup** and **one local command**.

### Development with Nix (Recommended)

Get a fully configured, reproducible development environment in one command:

```bash
# Install Nix (one-time setup)
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install

# Enter development shell
nix develop

# Verify environment
nix run .#check-env

# Start developing
pnpm install
pnpm dev
```

**Why Nix?**

- **Reproducible**: Everyone gets the exact same tool versions
- **Isolated**: Project dependencies don't interfere with your system
- **Version Controlled**: Development environment lives in Git
- **Fast Onboarding**: One command to get started

**What you get:**

- Go 1.21.5, Node.js 20.x, pnpm 8.x
- Firebase CLI, GitHub CLI, Google Cloud SDK
- tmux, ripgrep, jq, and other developer tools
- Custom tooling (tmux-tui, gh-workflow-mcp-server)
- Automatic environment initialization

**Comparison:**

| Aspect        | Nix               | Codespaces                 |
| ------------- | ----------------- | -------------------------- |
| Setup time    | 1 command         | Click + wait for container |
| Tool versions | Exact, pinned     | Container-defined          |
| Works offline | Yes               | No                         |
| Cost          | Free              | Free for 120 hours/month   |
| Ideal for     | Daily development | Quick experiments          |

**Learn more:**

- Comprehensive guide: [nix/README.md](nix/README.md)
- Home Manager setup: [nix/home/README.md](nix/home/README.md)

### GitHub Codespaces (Alternative)

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

## Wiggum Agent

The Wiggum agent automates the complete PR lifecycle: creation, CI monitoring, code quality fixes, and review handling.

### Usage

Invoke via: `Task(subagent_type="Wiggum")`

### Execution Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     WIGGUM AGENT FLOW                           │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ STEP 0: SETUP                                           │   │
│  │ • Check uncommitted changes → /commit-merge-push        │   │
│  │ • Validate not on main                                  │   │
│  │ • Push branch & create PR if needed                     │   │
│  │ • Initialize iteration=0 (max=10)                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    MAIN LOOP                             │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │ STEP 1: CI/CD CHECKS                               │  │  │
│  │  │ • Monitor workflow (gh_monitor_run)                │  │  │
│  │  │ • Monitor PR checks (gh_monitor_pr_checks)         │  │  │
│  │  │ • On failure: Plan → Fix → Commit → LOOP           │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │                         │ success                        │  │
│  │                         ▼                                │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │ STEP 2: CODE QUALITY                               │  │  │
│  │  │ • Fetch github-code-quality bot comments           │  │  │
│  │  │ • Evaluate critically (skip invalid)               │  │  │
│  │  │ • If valid issues: Fix → Commit → LOOP             │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │                         │ none/done                      │  │
│  │                         ▼                                │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │ STEP 3: PR REVIEW                                  │  │  │
│  │  │ • Run /pr-review-toolkit:review-pr                 │  │  │
│  │  │ • If issues: Post comment → Fix → Commit → LOOP    │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │                         │ no issues                      │  │
│  │                         ▼                                │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │ STEP 4: SECURITY REVIEW                            │  │  │
│  │  │ • Run /security-review                             │  │  │
│  │  │ • If issues: Post comment → Fix → Commit → LOOP    │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │                         │ no issues                      │  │
│  └─────────────────────────┼────────────────────────────────┘  │
│                            ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ SUCCESS: Approve PR & Exit                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ COMMIT SUBROUTINE (used by all fix steps)               │   │
│  │ ┌─────────────────────────────────────────────────────┐ │   │
│  │ │ /commit-merge-push                                  │ │   │
│  │ │    │                                                │ │   │
│  │ │    ├── SUCCESS → return                             │ │   │
│  │ │    │                                                │ │   │
│  │ │    └── FAILURE (hook errors) ──┐                    │ │   │
│  │ │                                │                    │ │   │
│  │ │         ┌──────────────────────┘                    │ │   │
│  │ │         ▼                                           │ │   │
│  │ │    Plan (opus) → Fix (sonnet) → retry               │ │   │
│  │ │         │                                           │ │   │
│  │ │         └────────── loop until success ─────────────│ │   │
│  │ └─────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  iteration++ after each fix cycle (exit if ≥10)                │
└─────────────────────────────────────────────────────────────────┘
```

The Wiggum agent recursively monitors CI/CD workflows, addresses automated code quality feedback, handles PR reviews, and performs security reviews until the PR is approved or the iteration limit (10) is reached.

## Cost

Optimize infrastructure for cost.

### Estimated Monthly Cost (Per Site)

| Service                   | Cost             | Notes                               |
| ------------------------- | ---------------- | ----------------------------------- |
| Cloud Run (scale-to-zero) | ~$0.10/month     | Minimal idle time, fast cold starts |
| Artifact Registry Storage | ~$0.05/month     | Docker images with cleanup policies |
| Cloud Run Requests        | ~$0.03/month     | 1000 requests                       |
| Egress                    | ~$0.02/month     | 1GB outbound traffic                |
| **Total per site**        | **~$0.20/month** | With moderate traffic               |
| **Two sites (current)**   | **~$0.40/month** | Fellspiral + Video Browser          |
