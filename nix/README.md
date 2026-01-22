# Nix Configuration Guide

This directory contains the Nix configuration for the Commons Systems monorepo, providing reproducible development environments, custom packages, and optional system-wide configuration management.

## Table of Contents

1. [Overview](#overview)
2. [Directory Structure](#directory-structure)
3. [Quick Start](#quick-start)
4. [Architecture & Design Decisions](#architecture--design-decisions)
5. [How-To Guide](#how-to-guide)
6. [Extending the Configuration](#extending-the-configuration)
7. [Common Issues & Troubleshooting](#common-issues--troubleshooting)
8. [Performance & Caching](#performance--caching)
9. [Testing & Validation](#testing--validation)
10. [CI Integration](#ci-integration)
11. [Pre-commit Hooks](#pre-commit-hooks)
12. [Future Enhancements](#future-enhancements)
13. [References](#references)

## Overview

### What is Nix?

Nix is a powerful package manager and system configuration tool that enables:

- **Reproducible builds**: The same input always produces the same output
- **Declarative configuration**: Define your environment as code
- **Isolated environments**: Multiple versions of tools without conflicts
- **Atomic upgrades and rollbacks**: Changes are safe and reversible

Unlike traditional package managers (apt, brew, npm), Nix treats packages as immutable and stores them in isolation in the `/nix/store`, referenced by cryptographic hashes. This eliminates "works on my machine" problems and dependency conflicts.

### Why Nix for This Project?

This monorepo benefits from Nix in several key ways:

1. **Reproducibility**: Every developer gets the exact same tool versions, from Go compilers to CLI utilities
2. **Version Control**: Development environment specifications live in Git alongside code
3. **Isolation**: Project dependencies don't interfere with system packages or other projects
4. **Onboarding**: New team members run one command (`nix develop`) to get a fully configured environment
5. **CI/CD Consistency**: CI runners use the same environment specification as local development

### Benefits Compared to Manual Setup

**Traditional Setup:**

```bash
# Install Go (which version?)
brew install go
# Install Node (which version?)
nvm install 20
# Install tools (conflicts? outdated?)
npm install -g firebase-tools
go install github.com/cli/cli/v2/cmd/gh@latest
# Hope everything works together...
```

**Nix Setup:**

```bash
nix develop  # Everything configured, reproducible, isolated
```

With Nix, you get:

- Exact version pinning (Go 1.21.5, not "whatever brew has")
- No global pollution (tools are scoped to the project)
- Instant rollback (bad update? Revert the flake.lock)
- Cross-platform consistency (same environment on macOS, Linux, CI)

## Directory Structure

```
nix/
├── flake.nix                 # Entry point - defines all Nix outputs
├── flake.lock                # Pinned versions of all dependencies
├── package-sets.nix          # Tool collections organized by category
├── lib/
│   └── default.nix          # Shared utility functions
├── shells/
│   ├── default.nix          # Main development shell configuration
│   └── hooks/
│       ├── default.nix      # Hook registry and composition
│       ├── git.nix          # Git worktree setup and validation
│       ├── go.nix           # Go module and environment setup
│       ├── node.nix         # Node.js and pnpm initialization
│       └── tmux.nix         # Tmux session management
├── home/
│   ├── README.md            # Home Manager documentation
│   └── home.nix             # System-wide configuration (optional)
└── packages/
    ├── check-env.nix        # Environment validation script
    ├── tmux-tui.nix         # Custom tmux TUI package
    └── gh-workflow-mcp-server.nix  # GitHub workflow MCP server
```

**Key Files Explained:**

- **flake.nix**: The main entry point that defines what this Nix configuration provides (development shells, packages, apps, Home Manager configurations). Think of it as a "package.json" for Nix.

- **flake.lock**: Automatically generated lockfile that pins exact versions of all dependencies. Similar to package-lock.json or go.sum.

- **package-sets.nix**: Organizes tools into logical categories (developer, cloud, container, git, build). This modular approach makes it easy to compose different tool sets for different shells.

- **shells/default.nix**: Defines the main development shell that you enter with `nix develop`. Includes all necessary tools and runs initialization hooks.

- **shells/hooks/**: Contains modular shell hook functions that run when entering the dev shell. Each hook is responsible for a specific aspect of environment setup (git, go, node, tmux).

- **packages/**: Custom packages built from source or wrapped with additional functionality. These are not available in standard Nix repositories.

- **home/**: Optional Home Manager integration for system-wide dotfile management. You can use the dev shell without ever touching this.

- **lib/default.nix**: Utility functions shared across the configuration (path checking, conditional execution, etc.).

## Quick Start

### Prerequisites

Install Nix with flakes support:

```bash
# Official installer (recommended)
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install

# Or traditional installer
sh <(curl -L https://nixos.org/nix/install) --daemon

# Enable flakes (if using traditional installer)
mkdir -p ~/.config/nix
echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf
```

### Enter the Development Shell

From the repository root:

```bash
nix develop
```

First run takes 5-15 minutes as Nix downloads and builds everything. Subsequent runs are instant (everything is cached).

You'll see initialization messages:

```
Setting up Git worktree environment...
Initializing Go environment...
Initializing Node.js environment...
Starting tmux session: commons-dev-204...
```

### Explore Available Tools

Once in the shell, you have access to all configured tools:

```bash
# Check environment
nix run .#check-env

# Verify tool versions
go version          # Go 1.21.5
node --version      # Node.js 20.x
pnpm --version      # pnpm 8.x
gh --version        # GitHub CLI
gcloud --version    # Google Cloud SDK
firebase --version  # Firebase CLI

# Use custom packages
tmux-tui           # Interactive tmux session manager
gh-workflow-mcp-server --help  # GitHub workflow MCP server
```

### Get Started with Development

```bash
# Install dependencies
pnpm install

# Run development server
pnpm dev

# Run tests
pnpm test

# Build production
pnpm build
```

To exit the Nix shell, simply type `exit` or press Ctrl+D.

## Architecture & Design Decisions

### Modular Tool Organization

**File**: `package-sets.nix`

Tools are organized into logical categories rather than one large list:

```nix
{
  developerTools = [ ... ];    # Core dev tools (ripgrep, jq, etc.)
  cloudTools = [ ... ];         # Cloud provider CLIs
  containerTools = [ ... ];     # Docker, Kubernetes, etc.
  gitTools = [ ... ];           # Git and GitHub tools
  buildTools = [ ... ];         # Compilers, build systems
}
```

**Why this approach?**

1. **Clarity**: Easy to understand what category a tool belongs to
2. **Maintainability**: Adding/removing tools doesn't require scanning a huge list
3. **Composability**: Different shells can include different subsets (e.g., CI shell might exclude containerTools)
4. **Documentation**: Each category serves as inline documentation

**How tools are composed:**

The main dev shell combines all categories:

```nix
buildInputs = with pkgs; [
  packageSets.developerTools
  packageSets.cloudTools
  packageSets.containerTools
  packageSets.gitTools
  packageSets.buildTools
];
```

A minimal CI shell might only include:

```nix
buildInputs = with pkgs; [
  packageSets.developerTools
  packageSets.buildTools
];
```

**When to add a tool:**

- System utility (ripgrep, jq, fzf) → `developerTools`
- Cloud CLI (gcloud, aws, firebase) → `cloudTools`
- Container tool (docker, kubectl, kind) → `containerTools`
- Git-related (gh, git-lfs, hub) → `gitTools`
- Compiler or build system (go, node, pnpm) → `buildTools`

If a tool doesn't fit existing categories, consider whether it warrants a new category or should extend an existing one.

### Shells & Hooks System

**Files**: `shells/default.nix`, `shells/hooks/*.nix`

Shell hooks are environment initialization scripts that run when you enter `nix develop`. They're implemented as separate, composable functions rather than one monolithic script.

**Why hooks are separate functions:**

1. **Modularity**: Each hook handles one concern (git, go, node, tmux)
2. **Testability**: Hooks can be tested independently
3. **Reusability**: Other shells can cherry-pick which hooks to use
4. **Maintainability**: Changes to git setup don't affect node setup

**Hook execution order and dependencies:**

Hooks run in a specific order defined in `shells/hooks/default.nix`:

```nix
gitHooks      # First: Set up git worktree environment
goHooks       # Second: Initialize Go (may depend on git being ready)
nodeHooks     # Third: Initialize Node (may depend on git being ready)
tmuxHooks     # Last: Start tmux session (needs all tools available)
```

**Why order matters:**

- Git hooks must run first because they set up the worktree metadata that other tools may need
- Go and Node hooks can run in parallel (they're independent) but both need git
- Tmux hooks run last because they launch a session that needs all tools configured

**When to add new hooks:**

Add a new hook when you have initialization logic that:

- Runs every time the shell starts
- Sets up environment variables or tool state
- Has clear dependencies or ordering requirements
- Is logically separate from existing hooks

Example: If you add Python to the project, create `shells/hooks/python.nix`:

```nix
{ pkgs, lib }:

''
  echo "Initializing Python environment..."

  # Set Python path
  export PYTHONPATH="$PWD:$PYTHONPATH"

  # Activate virtual environment if it exists
  if [ -f .venv/bin/activate ]; then
    source .venv/bin/activate
  fi

  # Install dependencies if needed
  if [ -f requirements.txt ] && [ ! -d .venv ]; then
    python -m venv .venv
    .venv/bin/pip install -r requirements.txt
  fi
''
```

Then register it in `shells/hooks/default.nix` in the appropriate order.

### Custom Packages

**Files**: `packages/tmux-tui.nix`, `packages/gh-workflow-mcp-server.nix`

Custom packages are tools not available in the standard Nix package repository (nixpkgs). They're built from source or wrapped with additional functionality.

**buildGoModule vs buildNpmPackage vs stdenv.mkDerivation:**

**Use `buildGoModule`** when:

- You're building a Go project from source
- You need Nix to manage Go dependencies
- You want reproducible Go module resolution

Example: `tmux-tui.nix` builds from source:

```nix
buildGoModule rec {
  pname = "tmux-tui";
  version = "0.1.0";

  src = lib.cleanSource ../../tmux-tui;

  vendorHash = "sha256-...";  # Hash of go.mod dependencies

  # Build only this package
  subPackages = [ "cmd/tmux-tui" ];
}
```

**Use `buildNpmPackage`** when:

- You're building a Node.js/TypeScript project from source
- You have a package-lock.json for reproducible dependency resolution
- You want Nix to manage npm dependencies

Example: `gh-workflow-mcp-server.nix` builds from TypeScript source:

```nix
buildNpmPackage {
  pname = "gh-workflow-mcp-server";
  version = "0.1.0";

  src = lib.cleanSource ../../gh-workflow-mcp-server;

  npmDepsHash = "sha256-...";  # Hash of package-lock.json dependencies

  # buildNpmPackage automatically runs: npm ci && npm run build

  postInstall = ''
    mkdir -p $out/bin
    cat > $out/bin/gh-workflow-mcp-server <<'EOF'
#!/usr/bin/env bash
exec ${nodejs}/bin/node $out/lib/node_modules/gh-workflow-mcp-server/dist/index.js "$@"
EOF
    chmod +x $out/bin/gh-workflow-mcp-server
  '';
}
```

**Use `stdenv.mkDerivation`** when:

- You have a pre-built binary
- You're wrapping an existing tool
- You need custom build logic beyond standard language builders

**How lib.cleanSource works:**

Both `buildGoModule` and `buildNpmPackage` use `lib.cleanSource` to filter the source directory:

- Removes files in `.gitignore` (like `dist/`, `node_modules/`, `vendor/`)
- Ensures reproducible builds from source code only
- Prevents accidental inclusion of build artifacts

**How dependency hashes work:**

When building packages, Nix needs to download dependencies reproducibly using content-addressed hashes:

| Language | Hash Parameter | What It Hashes                   | Lock File           |
| -------- | -------------- | -------------------------------- | ------------------- |
| Go       | `vendorHash`   | `go.mod` dependencies            | `go.sum`            |
| Node.js  | `npmDepsHash`  | `package-lock.json` dependencies | `package-lock.json` |

**When to update dependency hashes:**

1. When you change dependencies (go.mod, package.json)
2. When you update lock files (go.sum, package-lock.json)
3. When Nix complains about hash mismatch

**How to find the correct hash:**

```bash
# Method 1: Let Nix tell you (works for both vendorHash and npmDepsHash)
nix build .#tmux-tui
# Error: hash mismatch, got: sha256-xyz...
# Copy the "got" hash to vendorHash/npmDepsHash

# Method 2: Use a placeholder
vendorHash = lib.fakeHash;    # For Go packages
npmDepsHash = lib.fakeHash;   # For npm packages

# Method 3: Use prefetch tools
nix run nixpkgs#prefetch-npm-deps package-lock.json  # For npm
```

**Wrapper purposes:**

Both packages wrap the binary with environment setup:

```nix
postInstall = ''
  wrapProgram $out/bin/tmux-tui \
    --prefix PATH : ${lib.makeBinPath [ pkgs.tmux ]}
'';
```

This ensures that when you run `tmux-tui`, it can find `tmux` in its PATH without requiring tmux to be globally installed.

### Home Manager Integration

**Files**: `home/home.nix`, `home/README.md`

Home Manager is a Nix-based tool for managing user configuration files (dotfiles) and system-wide settings.

**Why optional:**

- Dev shell works independently of Home Manager
- System-wide config is a bigger commitment (manages ~/.bashrc, ~/.gitconfig, etc.)
- Not everyone wants Nix managing their entire system

**System-wide config vs project config:**

| Aspect            | Dev Shell                  | Home Manager                       |
| ----------------- | -------------------------- | ---------------------------------- |
| Scope             | Project-specific           | System-wide                        |
| Activation        | `nix develop`              | `home-manager switch`              |
| Files managed     | None (environment only)    | Dotfiles (~/.bashrc, ~/.config/\*) |
| Tool availability | Only in shell              | Globally available                 |
| Commitment        | Low (try it, exit anytime) | High (takes over config)           |

**When to use Home Manager:**

- You want consistent dotfiles across machines
- You manage multiple systems (laptop, servers, etc.)
- You want declarative system configuration
- You're comfortable with Nix managing your configs

**When to stick with dev shell only:**

- You just want project isolation
- You have existing dotfile management
- You're new to Nix (learn gradually)
- You don't want system-wide changes

**Backward compatibility:**

The configuration is designed so that:

- Dev shell never requires Home Manager
- Home Manager can be added/removed without affecting dev shell
- Both can coexist peacefully

### Flake-utils for Multi-System Support

**File**: `flake.nix`

The configuration uses `flake-utils` to ensure all outputs work on multiple systems (macOS x86_64, macOS ARM64, Linux x86_64, Linux ARM64):

```nix
flake-utils.lib.eachDefaultSystem (system: {
  devShells.default = ...;
  packages = ...;
});
```

Without this, you'd need to manually define outputs for each system. Flake-utils generates:

```nix
{
  devShells.x86_64-linux.default = ...;
  devShells.aarch64-linux.default = ...;
  devShells.x86_64-darwin.default = ...;
  devShells.aarch64-darwin.default = ...;
  # Same for packages, apps, etc.
}
```

This ensures the configuration works on:

- Developer laptops (macOS ARM, macOS Intel)
- CI runners (Linux x86_64)
- Production servers (Linux ARM, Linux x86_64)

## How-To Guide

### How to Add a Tool to Development Shell

**Step 1**: Determine the tool category

Is it a developer tool, cloud CLI, build tool, etc.?

**Step 2**: Add to `package-sets.nix`

```nix
# Add 'ripgrep' to developer tools
developerTools = with pkgs; [
  ripgrep  # Fast grep alternative
  jq
  curl
  # ... existing tools
];
```

**Step 3**: Verify the tool is available

```bash
nix develop
which rg  # Should show /nix/store/...
```

**Full example - Adding Python:**

```nix
# In package-sets.nix, create a new category or extend buildTools
buildTools = with pkgs; [
  go_1_21
  nodejs_20
  nodePackages.pnpm
  python311      # Add Python 3.11
  python311Packages.pip  # Add pip
];
```

### How to Create a Custom Package

**Example**: Package a custom CLI tool written in Go

**Step 1**: Create `packages/my-tool.nix`

```nix
{ lib
, buildGoModule
, makeWrapper
, pkgs
}:

buildGoModule rec {
  pname = "my-tool";
  version = "1.0.0";

  # Build from monorepo
  src = ../.;

  # Set to lib.fakeHash initially, then run nix build to get real hash
  vendorHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

  # Only build this package
  subPackages = [ "cmd/my-tool" ];

  nativeBuildInputs = [ makeWrapper ];

  # Ensure runtime dependencies are available
  postInstall = ''
    wrapProgram $out/bin/my-tool \
      --prefix PATH : ${lib.makeBinPath [ pkgs.git pkgs.curl ]}
  '';

  meta = with lib; {
    description = "My custom CLI tool";
    homepage = "https://github.com/org/repo";
    license = licenses.mit;
    maintainers = [ ];
  };
}
```

**Step 2**: Register in `flake.nix`

```nix
packages = {
  my-tool = pkgs.callPackage ./nix/packages/my-tool.nix {};
  # ... existing packages
};
```

**Step 3**: Build and test

```bash
# Build the package
nix build .#my-tool

# Test the binary
./result/bin/my-tool --help

# Install for use in dev shell
# (Add to package-sets.nix buildTools)
```

**Step 4**: Get the correct vendorHash

```bash
nix build .#my-tool
# Error: hash mismatch
#   got: sha256-xyz123...
# Copy "got" hash to vendorHash in my-tool.nix
```

### How to Add a Shell Hook

**Example**: Add a database initialization hook

**Step 1**: Create `shells/hooks/database.nix`

```nix
{ pkgs, lib }:

''
  echo "Initializing database..."

  # Set database URL
  export DATABASE_URL="postgresql://localhost:5432/dev"

  # Start PostgreSQL if not running
  if ! pgrep -x postgres > /dev/null; then
    echo "Starting PostgreSQL..."
    # Add startup logic
  fi

  # Run migrations if needed
  if [ -d migrations ] && command -v migrate &> /dev/null; then
    echo "Running migrations..."
    migrate -path migrations -database "$DATABASE_URL" up
  fi

  echo "Database ready!"
''
```

**Step 2**: Register in `shells/hooks/default.nix`

```nix
{
  gitHooks = import ./git.nix { inherit pkgs lib; };
  goHooks = import ./go.nix { inherit pkgs lib; };
  nodeHooks = import ./node.nix { inherit pkgs lib; };
  databaseHooks = import ./database.nix { inherit pkgs lib; };  # Add here
  tmuxHooks = import ./tmux.nix { inherit pkgs lib; };
}
```

**Step 3**: Add to shell hook composition in `shells/default.nix`

```nix
shellHook = ''
  ${hooks.gitHooks}
  ${hooks.goHooks}
  ${hooks.nodeHooks}
  ${hooks.databaseHooks}  # Add in appropriate order
  ${hooks.tmuxHooks}
'';
```

**Important**: Consider dependencies. If database hooks need Go tools, ensure they run after `goHooks`.

### How to Set Up Home Manager

**Step 1**: Review `home/README.md` to understand what Home Manager will manage

**Step 2**: Configure git identity before activation

```bash
# Set your git identity (required)
export GIT_AUTHOR_NAME="Your Name"
export GIT_AUTHOR_EMAIL="you@example.com"

# Or ensure it's already in your ~/.gitconfig:
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

**Step 3**: Customize `nix/home/*.nix` files with your preferences

The configuration automatically detects your username and home directory from
environment variables. You can customize tools in the relevant files:

- `nix/home/git.nix` - Git configuration
- `nix/home/tmux.nix` - Tmux configuration
- `nix/home/tools.nix` - CLI tools (direnv, neovim, etc.)
- `nix/home/ssh.nix` - SSH client configuration

**Step 4**: Build the configuration

```bash
nix build .#homeConfigurations.default.activationPackage --impure
```

**Step 5**: Activate Home Manager

```bash
./result/activate
```

**Step 6**: Apply future changes (auto-detects your system architecture)

```bash
home-manager switch --flake .#default --impure
```

Or explicitly specify your system:

```bash
# Linux x86_64
home-manager switch --flake .#x86_64-linux --impure

# macOS ARM (Apple Silicon)
home-manager switch --flake .#aarch64-darwin --impure
```

See `home/README.md` for detailed instructions and troubleshooting.

## Extending the Configuration

### Pattern 1: Adding a System Tool (Simple Case)

**Use case**: Add `htop` for system monitoring

```nix
# In package-sets.nix
developerTools = with pkgs; [
  htop  # System monitor
  ripgrep
  # ... existing tools
];
```

That's it. Next `nix develop` will have htop available.

### Pattern 2: Tool That Needs Initialization (New Hook)

**Use case**: Add Rust with cargo and rustup initialization

**File**: `shells/hooks/rust.nix`

```nix
{ pkgs, lib }:

''
  echo "Initializing Rust environment..."

  # Set CARGO_HOME to project-local directory
  export CARGO_HOME="$PWD/.cargo"
  export PATH="$CARGO_HOME/bin:$PATH"

  # Initialize rustup if needed
  if [ ! -d "$CARGO_HOME" ]; then
    echo "Setting up Rust toolchain..."
    cargo --version > /dev/null 2>&1 || echo "Cargo initialized"
  fi

  echo "Rust ready: $(rustc --version)"
''
```

Add Rust tools to `package-sets.nix`:

```nix
buildTools = with pkgs; [
  # ... existing tools
  rustc
  cargo
  rustfmt
  clippy
];
```

Register in `shells/hooks/default.nix` and compose in `shells/default.nix`.

### Pattern 3: Custom Package from Source

**Use case**: Build a proprietary internal tool

**File**: `packages/internal-tool.nix`

```nix
{ lib
, buildGoModule
, fetchFromGitHub
}:

buildGoModule rec {
  pname = "internal-tool";
  version = "2.1.0";

  # Fetch from private GitHub repo
  src = fetchFromGitHub {
    owner = "your-org";
    repo = "internal-tool";
    rev = "v${version}";
    sha256 = "sha256-AAAA...";  # Get with nix-prefetch-url
  };

  vendorHash = "sha256-BBBB...";

  subPackages = [ "." ];

  # Build with specific tags
  ldflags = [
    "-s" "-w"
    "-X main.version=${version}"
  ];

  meta = with lib; {
    description = "Internal tool for XYZ";
    license = licenses.proprietary;
  };
}
```

### Pattern 4: Home Manager Module

**Use case**: Manage tmux configuration system-wide

Add to `home/home.nix`:

```nix
{
  programs.tmux = {
    enable = true;
    terminal = "screen-256color";
    keyMode = "vi";
    extraConfig = ''
      # Custom tmux config
      set -g mouse on
      set -g status-style 'bg=#1e1e2e fg=#cdd6f4'
    '';
    plugins = with pkgs.tmuxPlugins; [
      sensible
      yank
      resurrect
    ];
  };
}
```

### Pattern 5: CI-Only Tool (Not in Dev Shell)

**Use case**: Add a tool only for CI, not local development

Create `shells/ci.nix`:

```nix
{ pkgs, packageSets }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    packageSets.developerTools
    packageSets.buildTools
    # CI-specific tools
    docker
    kubernetes-helm
    terraform
  ];

  # Minimal shell hook (no tmux, etc.)
  shellHook = ''
    echo "CI environment ready"
  '';
}
```

Register in `flake.nix`:

```nix
devShells = {
  default = pkgs.callPackage ./nix/shells/default.nix { inherit packageSets hooks; };
  ci = pkgs.callPackage ./nix/shells/ci.nix { inherit packageSets; };
};
```

Use in CI:

```yaml
- name: Enter CI shell
  run: nix develop .#ci --command bash -c "make test"
```

### Pattern 6: Conditional Tool (Platform-Specific)

**Use case**: Add macOS-specific or Linux-specific tools

```nix
# In package-sets.nix
developerTools = with pkgs; [
  ripgrep
  jq
  curl
] ++ lib.optionals stdenv.isDarwin [
  # macOS only
  darwin.apple_sdk.frameworks.Security
  darwin.apple_sdk.frameworks.CoreFoundation
] ++ lib.optionals stdenv.isLinux [
  # Linux only
  systemd
  udev
];
```

## Common Issues & Troubleshooting

### "command not found" When in nix develop

**Symptom**: Tool is listed in `package-sets.nix` but not available in shell

**Solutions**:

1. **Exit and re-enter the shell**:

   ```bash
   exit
   nix develop
   ```

2. **Rebuild the dev shell**:

   ```bash
   nix develop --rebuild
   ```

3. **Check the tool is actually in packageSets**:

   ```bash
   nix eval .#devShells.x86_64-darwin.default.buildInputs
   # (adjust system as needed)
   ```

4. **Verify tool exists in nixpkgs**:

   ```bash
   nix search nixpkgs ripgrep
   ```

5. **Check for typos**: Nix package names don't always match binary names
   - Package: `ripgrep` → Binary: `rg`
   - Package: `fd` → Binary: `fd`
   - Package: `nodePackages.pnpm` → Binary: `pnpm`

### "vendorHash mismatch" When Building Packages

**Symptom**: Building Go package fails with hash mismatch error

**Solution**:

```bash
# Nix will tell you the correct hash:
nix build .#tmux-tui

# Output:
# error: hash mismatch in fixed-output derivation '/nix/store/...':
#   specified: sha256-AAAAAAA...
#   got:       sha256-xyz123abc...

# Copy the "got" hash to vendorHash in your package definition
```

**Alternative**: Use fake hash temporarily:

```nix
vendorHash = pkgs.lib.fakeHash;
```

Build once to get the real hash, then replace.

### "flake.lock out of sync with inputs"

**Symptom**: Error about flake.lock not matching flake.nix inputs

**Solution**:

```bash
# Update all inputs
nix flake update

# Or update specific input
nix flake lock --update-input nixpkgs

# Commit the updated flake.lock
git add flake.lock
git commit -m "Update Nix flake inputs"
```

**Prevention**: Commit `flake.lock` changes alongside `flake.nix` changes.

### Home Manager Conflicts with Existing Config

**Symptom**: Home Manager complains about existing dotfiles

**Example**:

```
error: Existing file '/Users/you/.bashrc' is in the way
```

**Solutions**:

1. **Backup and remove existing files**:

   ```bash
   mv ~/.bashrc ~/.bashrc.backup
   mv ~/.gitconfig ~/.gitconfig.backup
   home-manager switch --flake .#default --impure
   ```

2. **Import existing config into Home Manager**:

   ```nix
   programs.bash.initExtra = builtins.readFile ~/.bashrc.backup;
   ```

3. **Use Home Manager for new files only**:

   ```nix
   # Don't manage bash, only new things
   programs.bash.enable = false;
   programs.tmux.enable = true;  # Only manage tmux
   ```

4. **Disable conflicting options**:
   ```nix
   # Let Home Manager manage config but don't write to files
   programs.git.enable = true;
   home.file.".gitconfig".enable = false;
   ```

## Performance & Caching

### Local Caching

Nix caches everything automatically in `/nix/store`. Once you build something, it's cached forever (until garbage collected).

**Cache behavior**:

- First `nix develop`: 5-15 minutes (downloads and builds everything)
- Subsequent `nix develop`: Instant (uses cached store paths)
- After changing `flake.lock`: Only changed packages rebuild
- After changing source code: Only affected packages rebuild

**Check cache usage**:

```bash
# Show what's in your store
nix store ls

# Check path dependencies
nix-store -q --tree $(which tmux-tui)

# Show cache size
du -sh /nix/store
```

**Garbage collection** (free up space):

```bash
# Remove unused store paths
nix-collect-garbage

# Aggressive: Remove everything not currently in use
nix-collect-garbage -d

# Remove older than 30 days
nix-collect-garbage --delete-older-than 30d
```

### CI Caching with Cachix

Cachix is a hosted Nix cache service that dramatically speeds up CI builds.

**Without Cachix**: Every CI run rebuilds everything (5-15 minutes)

**With Cachix**: CI pulls pre-built artifacts (30 seconds)

**How it works**:

1. Developer builds locally → Nix creates `/nix/store` paths
2. Push to Cachix → Uploads built artifacts
3. CI runs → Downloads from Cachix instead of rebuilding

**Setup steps**:

1. **Create Cachix account**: https://cachix.org

2. **Create a cache**:

   ```bash
   cachix create commons-systems
   ```

3. **Get auth token**: From Cachix dashboard

4. **Add secret to GitHub**: `CACHIX_AUTH_TOKEN`

5. **CI automatically uses it**: See `.github/workflows/nix-ci.yml`

**Push from local machine**:

```bash
# Install cachix CLI
nix-env -iA cachix -f https://cachix.org/api/v1/install

# Authenticate
cachix authtoken <YOUR_TOKEN>

# Push all built paths
nix build .#tmux-tui
cachix push commons-systems ./result
```

**Check cache stats**:

```bash
cachix status commons-systems
```

## Testing & Validation

### Validate Nix Configuration

```bash
# Check flake syntax and evaluate all outputs
nix flake check

# Show what the flake provides
nix flake show

# Evaluate dev shell without entering it
nix eval .#devShells.x86_64-darwin.default

# Check for issues with specific package
nix build .#tmux-tui --show-trace
```

### Test Development Shell

```bash
# Enter shell and verify environment
nix develop --command bash -c '
  echo "Go version: $(go version)"
  echo "Node version: $(node --version)"
  echo "pnpm version: $(pnpm --version)"
  echo "PATH: $PATH"
'

# Run environment check script
nix develop --command nix run .#check-env

# Test shell hooks
nix develop --command bash -c 'echo $PWD'
```

### Test Custom Packages

```bash
# Build package
nix build .#tmux-tui

# Test binary
./result/bin/tmux-tui --help

# Check runtime dependencies
nix-store -q --references ./result

# Verify wrapper works
./result/bin/tmux-tui --version
```

### Integration Testing

Create a test script to verify everything works together:

**File**: `nix/test.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "Testing Nix configuration..."

# Test flake
echo "Checking flake..."
nix flake check

# Test packages
echo "Building packages..."
nix build .#tmux-tui
nix build .#gh-workflow-mcp-server
nix build .#check-env

# Test dev shell
echo "Testing dev shell..."
nix develop --command bash -c '
  set -e
  command -v go > /dev/null || exit 1
  command -v node > /dev/null || exit 1
  command -v pnpm > /dev/null || exit 1
  command -v gh > /dev/null || exit 1
  echo "All tools present"
'

echo "All tests passed!"
```

Run with:

```bash
chmod +x nix/test.sh
./nix/test.sh
```

## CI Integration

### What nix-ci.yml Does

The `.github/workflows/nix-ci.yml` workflow:

1. **Installs Nix** on GitHub's Ubuntu runner
2. **Optionally sets up Cachix** for faster builds (if secret exists)
3. **Validates flake** configuration with `nix flake check`
4. **Builds custom packages** to ensure they compile correctly
5. **Tests dev shell** by running the environment check

**Workflow runs on**:

- Every push to `main`
- Every pull request
- Manual trigger via GitHub UI

**Benefits**:

- Catches Nix configuration errors before merge
- Validates packages build on Linux
- Ensures dev shell works in CI
- Provides build artifacts for debugging

### How to Set Up Cachix (Optional)

Cachix is optional but recommended for faster CI builds.

**Step 1**: Create Cachix account at https://cachix.org

**Step 2**: Create a cache:

```bash
cachix create commons-systems
```

**Step 3**: Get auth token from Cachix dashboard

**Step 4**: Add to GitHub secrets:

- Go to: Repository → Settings → Secrets and variables → Actions
- Click "New repository secret"
- Name: `CACHIX_AUTH_TOKEN`
- Value: (paste token)

**Step 5**: Push initial cache:

```bash
nix build .#tmux-tui
cachix push commons-systems ./result

nix build .#gh-workflow-mcp-server
cachix push commons-systems ./result
```

**CI will now**:

- Pull from Cachix (fast)
- Build if cache miss
- Push to Cachix for next run

**Skip Cachix**: If you don't add the secret, the workflow runs without caching (just slower).

### How to Add More Packages to Build

Edit `.github/workflows/nix-ci.yml`:

```yaml
- name: Build tmux-tui package
  run: nix build .#tmux-tui

- name: Build gh-workflow-mcp-server package
  run: nix build .#gh-workflow-mcp-server

- name: Build my-new-package # Add this
  run: nix build .#my-new-package
```

### How to Disable if Needed

If you need to temporarily disable the Nix CI workflow:

**Option 1**: Via GitHub UI

- Go to: Actions → Nix CI → ⋯ menu → Disable workflow

**Option 2**: Edit workflow file

```yaml
name: Nix CI

on:
  # Comment out all triggers
  # push:
  #   branches: [main]
```

**Option 3**: Delete the file (not recommended)

```bash
git rm .github/workflows/nix-ci.yml
```

The workflow is designed to be non-blocking - it won't prevent merges if it fails (unless you configure branch protection rules).

## Pre-commit Hooks

This repo uses [pre-commit-hooks.nix](https://github.com/cachix/pre-commit-hooks.nix) to enforce code quality standards. Hooks run automatically:

1. **On git commit** - When in the `nix develop` shell
2. **Via `nix flake check`** - In CI and for manual validation

### Available Hooks

| Hook                       | Language      | Description                         |
| -------------------------- | ------------- | ----------------------------------- |
| `gofmt`                    | Go            | Format Go code                      |
| `prettier`                 | JS/TS/CSS/etc | Format JavaScript, TypeScript, etc. |
| `nixfmt-rfc-style`         | Nix           | Format Nix files                    |
| `trim-trailing-whitespace` | All           | Remove trailing whitespace          |
| `end-of-file-fixer`        | All           | Ensure files end with newline       |
| `check-yaml`               | YAML          | Validate YAML syntax                |
| `check-json`               | JSON          | Validate JSON syntax                |

### Configuration Files

- **`nix/checks.nix`** - Hook definitions and excludes
- **`.prettierrc.json`** - Prettier formatting rules
- **`.prettierignore`** - Files/directories excluded from prettier

### Running Hooks

**Automatic (on commit):**

When you enter `nix develop`, pre-commit hooks are automatically installed. They run on every `git commit`.

**Manual (all files):**

```bash
nix develop --command pre-commit run --all-files
```

**Run specific hook:**

```bash
nix develop --command pre-commit run gofmt --all-files
nix develop --command pre-commit run prettier --all-files
```

**Via Nix flake check:**

```bash
nix flake check
```

### Disabling Hooks

**Skip for a single commit:**

```bash
git commit --no-verify -m "message"
```

**Skip for a shell session:**

```bash
export PRE_COMMIT_ALLOW_NO_CONFIG=1
```

### Excluded Directories

The following directories are excluded from all hooks:

- `scaffolding/` - Template code with placeholders
- `190-*/` - Orphaned worktree directories

### Adding New Hooks

Edit `nix/checks.nix`:

```nix
hooks = {
  # ... existing hooks

  # Add a new hook
  my-hook = {
    enable = true;
    name = "my-hook";
    description = "Description of what it does";
    entry = "${pkgs.my-tool}/bin/my-tool";
    files = "\\.ext$";  # File pattern to match
    pass_filenames = true;
  };
};
```

After adding, run `nix flake check` to validate.

## Flake Update Notifications

The development shell checks for flake updates once per day and displays a warning banner if upstream changes are available for nixpkgs or home-manager.

### How It Works

- Runs automatically when you enter `nix develop`
- Checks nixpkgs and home-manager for upstream updates
- Compares current locked revisions with latest upstream
- Shows a warning banner if updates are available
- Only runs once per 24 hours (cached)

### Force a Check

To force an immediate check, delete the cache:

```bash
rm -f ~/.cache/nix-flake-update-check/last-check
nix develop
```

### Cache Behavior

- Check runs at most once per 24 hours
- Cache stored at `~/.cache/nix-flake-update-check/last-check`
- Fails silently if offline or network unavailable
- Skips check in non-interactive shells (CI-friendly)

### Example Output

When updates are available, you'll see:

```
╔═══════════════════════════════════════════════════════════╗
║  ⚠  Flake Updates Available                               ║
╠═══════════════════════════════════════════════════════════╣
║  The following inputs have upstream updates:              ║
║                                                           ║
║    • nixpkgs                                              ║
║    • home-manager                                         ║
║                                                           ║
║  To update, run:                                          ║
║                                                           ║
║    1. nix flake update                                    ║
║    2. nix develop --rebuild                               ║
║    3. home-manager switch --flake .#default --impure      ║
║                                                           ║
║  (This check runs once per 24 hours)                      ║
╚═══════════════════════════════════════════════════════════╝
```

## Future Enhancements

Potential expansions to the Nix configuration:

1. **Python Development**:
   - Add Python 3.11+ to buildTools
   - Create `shells/hooks/python.nix` for venv management
   - Package custom Python tools with `buildPythonPackage`

2. **Rust Support**:
   - Add rustc, cargo, rustfmt, clippy to buildTools
   - Create `shells/hooks/rust.nix` for cargo initialization
   - Use `rustPlatform.buildRustPackage` for Rust tools

3. **Database Tools**:
   - Add PostgreSQL, MySQL, Redis to packageSets
   - Create `shells/hooks/database.nix` for auto-start
   - Manage schema migrations in shell hook

4. **Docker Integration**:
   - Use `pkgs.dockerTools.buildImage` for reproducible containers
   - Pin Docker images with Nix expressions
   - Build container images as Nix packages

5. **Multiple Shells**:
   - `devShells.frontend`: Node/pnpm only, no Go
   - `devShells.backend`: Go only, no Node
   - `devShells.ci`: Minimal tools for fast CI
   - `devShells.docs`: Tools for documentation only

6. **Cross-Compilation**:
   - Build for multiple architectures (ARM, x86_64)
   - Use `pkgs.pkgsCross` for target platforms
   - Generate release binaries for all platforms

7. **Development Services**:
   - Use `services.postgresql.enable` in dev shell
   - Auto-start Redis, RabbitMQ, etc.
   - Manage service dependencies

8. ~~**Pre-commit Hooks**~~: ✅ Implemented! See [Pre-commit Hooks](#pre-commit-hooks) section.

9. **IDE Integration**:
   - Generate direnv configuration
   - VSCode devcontainer.json from Nix
   - JetBrains IDE integration

10. **Secrets Management**:
    - Integrate with sops-nix for encrypted secrets
    - Manage API keys, tokens declaratively
    - Auto-inject secrets into dev shell

## References

### Official Documentation

- **Nix Manual**: https://nixos.org/manual/nix/stable/
- **Nixpkgs Manual**: https://nixos.org/manual/nixpkgs/stable/
- **Nix Flakes**: https://nixos.wiki/wiki/Flakes
- **Home Manager**: https://nix-community.github.io/home-manager/

### Learning Resources

- **Nix Pills**: https://nixos.org/guides/nix-pills/ (in-depth tutorial series)
- **Zero to Nix**: https://zero-to-nix.com/ (beginner-friendly guide)
- **Nix by Example**: https://nixos.wiki/wiki/Nix_by_Example

### Community

- **NixOS Discourse**: https://discourse.nixos.org/
- **Nix subreddit**: https://reddit.com/r/NixOS
- **Nix on GitHub**: https://github.com/NixOS/nixpkgs

### Package Search

- **Search Nix packages**: https://search.nixos.org/packages
- **Search Nix options**: https://search.nixos.org/options

### Advanced Topics

- **Building Go with Nix**: https://nixos.org/manual/nixpkgs/stable/#sec-language-go
- **Cachix Documentation**: https://docs.cachix.org/
- **Flake Schema**: https://nixos.wiki/wiki/Flakes#Flake_schema

### Tools

- **nix-tree**: Visualize Nix store dependencies
- **nix-du**: Analyze Nix store disk usage
- **nixfmt**: Format Nix code
- **statix**: Lint Nix code

---

For questions or issues with this Nix configuration, please open a GitHub issue or consult the references above.
