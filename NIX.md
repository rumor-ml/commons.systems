# Nix/direnv Development Environment

This project includes a Nix flake for a fully reproducible development environment.

## Prerequisites

Install Nix with flakes enabled:

```bash
# Install Nix (if not already installed)
sh <(curl -L https://nixos.org/nix/install) --daemon

# Enable flakes (add to ~/.config/nix/nix.conf or /etc/nix/nix.conf)
experimental-features = nix-command flakes
```

## Quick Start

### Option 1: Using direnv (Recommended)

Install direnv:

```bash
# macOS
brew install direnv

# Linux
# See: https://direnv.net/docs/installation.html

# Add to your shell config (~/.bashrc, ~/.zshrc, etc)
eval "$(direnv hook bash)"  # or zsh, fish, etc
```

Then just `cd` into the project:

```bash
cd commons.systems
direnv allow  # First time only
```

All tools will be automatically available!

### Option 2: Using nix develop

```bash
cd commons.systems
nix develop
```

## What's Included

The Nix environment provides:

- ✅ `gcloud` - Google Cloud SDK
- ✅ `gh` - GitHub CLI
- ✅ `node` - Node.js v20
- ✅ `npm` - Package manager
- ✅ `terraform` - Infrastructure as Code
- ✅ `playwright` - Browser automation (with browsers)
- ✅ All system dependencies for testing
- ✅ **Automatic npm dependency installation**

When you enter the Nix shell (via `direnv` or `nix develop`), npm dependencies are automatically installed if `node_modules` doesn't exist.

## Usage

Once in the Nix shell (automatically with direnv):

```bash
# Dependencies are installed automatically!

# One-time setup (creates GCP resources and GitHub secrets)
cd infrastructure/scripts
./setup-workload-identity.sh

# Run development server
npm run dev

# Run tests
npm test

# Deploy (after setup)
cd infrastructure/scripts
./deploy.sh
```

### Manual Dependency Installation

If you need to reinstall dependencies:

```bash
rm -rf node_modules
# Exit and re-enter the shell, or run:
npm install
```

## Benefits

### Reproducibility
- Everyone gets the exact same tool versions
- No "works on my machine" issues
- CI/CD and local environments match

### Zero System Pollution
- Tools are isolated to the project
- No global npm/node/terraform installations needed
- Clean uninstall: just delete the project

### Automatic Setup
- With direnv, tools load automatically on `cd`
- No manual PATH management
- Shell hook shows available commands

## Troubleshooting

### "command not found: direnv"
Install direnv and add the hook to your shell config.

### "error: experimental Nix feature 'nix-command' is disabled"
Enable flakes in your Nix configuration:
```bash
mkdir -p ~/.config/nix
echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf
```

### Playwright browsers not working
The environment automatically sets `PLAYWRIGHT_BROWSERS_PATH`. If issues persist:
```bash
# Inside nix shell
npx playwright install
```

## Files

- `flake.nix` - Nix flake configuration
- `.envrc` - direnv configuration (auto-loads flake)
- `.gitignore` - Excludes Nix build artifacts

## CI/CD

The GitHub Actions workflows already have all necessary tools installed. This Nix configuration is for local development only.
