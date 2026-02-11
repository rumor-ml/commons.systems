# Development Environment Rules

This document provides essential developer workflows for the Nix-based development environment and integration with Claude Code. For comprehensive technical details, architecture, and troubleshooting, see `nix/README.md`.

## Nix Development Environment

### Entering the Development Shell

Use `nix develop` to enter a shell with all development tools available:

```bash
cd ~/commons.systems
nix develop
```

The development shell provides:

- Go toolchain (configured version)
- Node.js and pnpm
- Testing tools (gh, tmux, etc.)
- All project-specific dependencies

### Required Flags and Commands

**CRITICAL: Nix commands require sandbox disabled in Claude Code automation:**

```bash
# ✅ CORRECT (in Claude Code automation)
nix develop  # with dangerouslyDisableSandbox: true
nix flake update  # with dangerouslyDisableSandbox: true

# ✅ CORRECT (manual terminal usage)
nix develop
nix flake update
```

### Common Mistakes to Avoid

- ❌ Running Nix commands in sandbox mode via Claude Code (will fail)
- ❌ Wrong directory - must be in repository root (`~/commons.systems/`)
- ❌ Forgetting to re-enter `nix develop` after flake updates

## Home Manager Configuration

### Correct Home Manager Commands

**CRITICAL: Always use the flake-based configuration with required flags:**

```bash
# ✅ CORRECT - The only correct way to apply Home Manager changes
home-manager switch --flake .#default --impure

# ❌ WRONG - Uses standalone config (will fail)
home-manager switch
```

**Flag explanations:**

- `--flake .#default` - Uses the flake-based config at `/home/n8/commons.systems/nix/home/`
- `--impure` - Allows reading environment variables (required for auto-detection)

### Why --flake .#default --impure is Required

The repository uses a **flake-based Home Manager configuration** at `/home/n8/commons.systems/nix/home/` with 14 comprehensive modules:

- `alacritty.nix` - Terminal emulator
- `bat.nix` - Better cat with syntax highlighting
- `direnv.nix` - Automatic environment activation
- `eza.nix` - Better ls
- `fzf.nix` - Fuzzy finder
- `git.nix` - Git configuration
- `go.nix` - Go development tools
- `helix.nix` - Text editor
- `home.nix` - Main entry point
- `nix.nix` - Nix configuration
- `readline.nix` - Command line editing
- `sessionVariables.nix` - Environment variables
- `starship.nix` - Shell prompt
- `tmux.nix` - Terminal multiplexer

Running `home-manager switch` without `--flake .#default` attempts to use a non-existent standalone config and will fail.

### Common Home Manager Mistakes

**Mistake 1: Running without flake flags**

```bash
# ❌ WRONG
home-manager switch

# Error you'll see:
# error: attribute 'genAttrs' missing
# error: attribute 'genAttrs'' missing
```

**Reason**: Without `--flake .#default`, Home Manager looks for `~/.config/home-manager/home.nix` (which doesn't exist or is a minimal template). The error occurs because the standalone config expects different library functions.

**Solution**: Always use `--flake .#default --impure`

**Mistake 2: Running from wrong directory**

```bash
# ❌ WRONG
cd ~/worktrees/some-branch
home-manager switch --flake .#default --impure

# Error you'll see:
# error: getting status of '/home/n8/worktrees/some-branch/flake.nix': No such file or directory
```

**Solution**: Always run from repository root (`~/commons.systems/`)

**Mistake 3: Forgetting --impure flag**

```bash
# ❌ WRONG
home-manager switch --flake .#default

# May fail if config needs environment variable detection
```

**Solution**: Always include `--impure`

## Worktree-Based Workflow

### Directory Structure

- **Main branch**: `~/commons.systems/` (always stays on `main`)
- **Feature branches**: `~/worktrees/BRANCH-NAME/` (each branch in its own directory)

Example:

```
~/commons.systems/              # main branch
~/worktrees/1234-add-feature/   # feature branch 1234-add-feature
~/worktrees/5678-fix-bug/       # feature branch 5678-fix-bug
```

### NEVER Use git checkout or git switch

**CRITICAL: Worktree directories are tied to specific branches. Never switch branches within a worktree.**

```bash
# ❌ NEVER DO THIS
git checkout main
git switch other-branch

# ✅ CORRECT - Navigate to the appropriate worktree directory
cd ~/commons.systems/              # for main branch
cd ~/worktrees/1234-add-feature/  # for feature branch
```

**Why this matters:**

- Worktree directory names match their branch names
- Switching branches breaks this contract and causes confusion
- Build artifacts, `.envrc` files, and other state are tied to the worktree

**Reference**: See `CLAUDE.md` for complete worktree workflow documentation.

## Common Workflows

### Setting Up New Developer Environment

**Initial setup** (first time on a new machine):

```bash
# 1. Clone repository
cd ~
git clone <repo-url> commons.systems
cd commons.systems

# 2. Enter Nix development shell
nix develop

# 3. Apply Home Manager configuration
home-manager switch --flake .#default --impure

# 4. Verify setup
which go      # Should show Nix store path
which pnpm    # Should show Nix store path
echo $EDITOR  # Should show configured editor
```

### Updating Nix Configuration

**When you modify `flake.nix` or files in `nix/` directory:**

```bash
# 1. Update flake lock file (if dependencies changed)
nix flake update  # Requires dangerouslyDisableSandbox in Claude Code

# 2. Exit and re-enter dev shell to pick up changes
exit
nix develop
```

### Applying Home Manager Changes

**When you modify files in `nix/home/` directory:**

```bash
# 1. Ensure you're in repository root
cd ~/commons.systems

# 2. Apply changes
home-manager switch --flake .#default --impure

# 3. Verify changes
# - Check ~/nix/home-manager/files/ for generated files
# - Restart affected applications (terminal, editor, etc.)
# - Check session variables: echo $VARIABLE_NAME
```

### Troubleshooting Environment Issues

**Issue: Command not found after Home Manager switch**

```bash
# Solution: Re-enter shell or source profile
exec $SHELL
# or
source ~/.bashrc  # or ~/.zshrc
```

**Issue: Environment variables not set**

```bash
# Check Home Manager session variables file
cat ~/nix/home-manager/files/.nix-profile/etc/profile.d/hm-session-vars.sh

# Ensure direnv is working
cd ~/commons.systems
direnv allow  # If prompted
```

**Issue: Old packages still showing after update**

```bash
# Check which package is being used
which <command>  # Should show /nix/store/... path

# If it shows system path, reload shell
exec $SHELL

# Verify Home Manager generation
home-manager generations
```

## Integration with Claude Code

### Nix Commands in Automation

When Claude Code runs Nix or Home Manager commands, they **must** use `dangerouslyDisableSandbox: true`:

```javascript
// ✅ CORRECT
{
  "command": "nix develop",
  "dangerouslyDisableSandbox": true
}

// ✅ CORRECT
{
  "command": "home-manager switch --flake .#default --impure",
  "dangerouslyDisableSandbox": true
}

// ❌ WRONG - Will fail in sandbox
{
  "command": "nix develop"
}
```

### Sandbox Requirements

**Commands that require `dangerouslyDisableSandbox: true`:**

- All `nix` commands (`nix develop`, `nix flake update`, `nix build`, etc.)
- All `home-manager` commands
- All `git` commands (`git commit`, `git push`, etc.)
- All `gh` commands (GitHub CLI)
- All `gcloud` commands
- `go mod tidy`
- `pnpm` commands in some contexts

**Reference**: See `CLAUDE.md` for complete sandbox requirements.

### When to Use dangerouslyDisableSandbox

**Automatic approval** (from `.claude/settings.json`):

- Standard git commands: `git status`, `git diff`, `git log`, `git add`, `git commit`, `git push`
- Standard gh commands: `gh pr`, `gh issue`, `gh api`
- Standard Nix commands: `nix develop`, `nix flake update`

**Manual approval required**:

- Destructive operations: `git reset --hard`, `git clean -f`, `rm -rf`
- Force operations: `git push --force`
- System modifications outside project directory

## See Also

**For deep technical details:**

- `nix/README.md` - Complete Nix architecture, how to extend configuration, advanced troubleshooting (1600+ lines)
- `nix/home/README.md` - Home Manager module details, available options, customization

**For workflow context:**

- `CLAUDE.md` - Project-wide rules including worktree workflow, git hooks, slash commands
- `.claude/rules/issue-tracking.md` - Issue management, out-of-scope handling, TODO comments
- `.claude/settings.json` - Auto-approved commands, sandbox permissions

**For Home Manager reference:**

- [Home Manager Manual](https://nix-community.github.io/home-manager/) - Official documentation
- [Home Manager Options](https://nix-community.github.io/home-manager/options.xhtml) - All available configuration options
