# Commons.Systems Monorepo

A monorepo for commons.systems projects.

---

## Dev Environment Setup

### Prerequisites

Choose your platform and complete the prerequisites:

#### Windows: Install NixOS-WSL

1. **Enable WSL on Windows**

   Open PowerShell as Administrator and run:

   ```powershell
   wsl --install
   ```

   Restart your computer when prompted.

2. **Install NixOS-WSL**

   Download the latest NixOS-WSL tarball from [nix-community/NixOS-WSL releases](https://github.com/nix-community/NixOS-WSL/releases):

   ```powershell
   # Download the tarball (adjust version as needed)
   # Example: nixos-wsl-x86_64-linux.tar.gz

   # Import into WSL (replace paths as needed)
   wsl --import NixOS $env:USERPROFILE\NixOS nixos-wsl.tar.gz

   # Set as default
   wsl --set-default NixOS

   # Launch NixOS-WSL
   wsl
   ```

3. **Initial NixOS-WSL configuration** (inside WSL)

   ```bash
   # Set your username (replace 'yourname')
   sudo nix-shell -p vim
   sudo vim /etc/nixos/configuration.nix
   # Add under users.users: yourname = { isNormalUser = true; extraGroups = [ "wheel" ]; };

   # Rebuild system
   sudo nixos-rebuild switch

   # Exit and restart WSL
   exit
   ```

   Relaunch WSL - you should now log in as your user.

#### macOS: Install Nix

```bash
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install
```

Follow the prompts and **restart your shell** when complete.

---

### Common Setup Steps

After completing platform prerequisites, follow these steps (identical for all platforms):

**1. Clone the repository**

```bash
git clone <repository-url>
cd commons.systems
```

**Platform-specific note for NixOS-WSL:** Since NixOS-WSL doesn't include git by default, use a temporary shell:

```bash
nix-shell -p git  # Temporary git access
git clone <repository-url>
cd commons.systems
exit  # Exit temporary shell
```

**2. Activate Home Manager configuration**

This installs and configures all development tools declaratively:

```bash
# One-command setup (auto-detects your system)
nix --extra-experimental-features 'nix-command flakes' run .#home-manager-setup

# Restart your shell to apply changes
exec $SHELL
```

**Note**: After the first activation, Home Manager will manage your Nix configuration and enable experimental features permanently, so you won't need those flags again.

**What this provides:**

- **git** - Version control (macOS: config merge; NixOS-WSL: permanent install)
- **direnv** - Auto-loads project environment (with shell integration)
- **tmux** - Terminal multiplexer with project-specific TUI
- **neovim** - Modern text editor (vim/vi aliases)
- **Claude Code** - AI coding assistant CLI

**3. Allow direnv for this repository**

After Home Manager activation and shell restart:

```bash
cd commons.systems
direnv allow
```

The development environment will now load automatically when you enter the directory.

**4. Verify setup**

```bash
nix run .#check-env
```

**5. Start developing** (optional - for web apps)

```bash
pnpm install
pnpm dev
```

## Configuration & Automation

The repository includes comprehensive Nix-based automation for reproducible machine setup.

### 📚 Documentation

- **[Automation Opportunities](nix/AUTOMATION-OPPORTUNITIES.md)** - Overview of what's automated and opportunities for improvement
- **[SSH Automation Guide](nix/SSH-AUTOMATION.md)** - Complete SSH setup automation with improvement opportunities
- **[Tailscale Setup Guide](nix/TAILSCALE-SETUP.md)** - Secure VPN networking for NixOS and macOS
- **[macOS Setup with nix-darwin](nix/DARWIN-SETUP.md)** - Complete declarative macOS configuration

#### SSH Configuration

- **[SSH Client Setup](nix/home/SSH-SETUP.md)** - Home Manager SSH client configuration
- **[SSH Server Module](nix/nixos/README.md)** - NixOS SSH server deployment
- **[SSH Key Management](nix/ssh-keys/README.md)** - Central SSH key repository

#### Tailscale VPN

- **[NixOS Tailscale Module](nix/nixos/tailscale.nix)** - Tailscale for NixOS/WSL2
- **[macOS Tailscale Module](nix/darwin/README.md)** - Tailscale for nix-darwin

#### macOS Configuration

- **[nix-darwin Setup Guide](nix/DARWIN-SETUP.md)** - Complete macOS setup with nix-darwin
- **[nix-darwin Modules](nix/darwin/README.md)** - Available darwin modules and usage

### ⚙️ What's Automated

**User-Level (Home Manager):**

- Git configuration with auto-detected identity
- Tmux with project-specific TUI integration
- SSH client with agent and modern security defaults
- Development tools (direnv, neovim)
- Claude Code CLI

**System-Level (NixOS):**

- SSH server with security hardening
- Firewall configuration
- mDNS/Avahi for hostname resolution
- Tailscale VPN with mesh networking

**System-Level (macOS via nix-darwin):**

- Complete declarative system configuration
- Tailscale VPN integration
- macOS defaults (dock, finder, keyboard, trackpad)
- Font management with Nerd Fonts
- Home Manager integration

**Development Environment:**

- Language toolchains (Go, Node.js, pnpm)
- Cloud tools (gcloud, terraform)
- Custom packages (tmux-tui, MCP servers)
- Pre-commit hooks

### 🚀 New Machine Setup

See [AUTOMATION-OPPORTUNITIES.md](nix/AUTOMATION-OPPORTUNITIES.md) for detailed setup instructions and additional automation opportunities.

## Infrastructure Quick Start

Deploy the to GCP with **zero local setup** and **one local command**.

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

| Service                  | Cost             | Notes                                         |
| ------------------------ | ---------------- | --------------------------------------------- |
| Firebase Hosting         | Free             | Generous free tier for hosting                |
| Cloud Storage            | ~$0.02/month     | Firebase Storage for media files              |
| Firestore                | ~$0.01/month     | Database with free tier                       |
| Egress                   | ~$0.02/month     | 1GB outbound traffic                          |
| **Total per site**       | **~$0.05/month** | With moderate traffic                         |
| **Four sites (current)** | **~$0.20/month** | Fellspiral, Videobrowser, Audiobrowser, Print |
