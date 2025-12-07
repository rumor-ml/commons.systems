# Home Manager Configuration

## Overview

Home Manager is a system for managing user-specific configuration files (dotfiles) and packages using Nix. It allows you to declaratively configure applications like git, tmux, vim, and many others in a reproducible way.

### When to Use Home Manager

Use Home Manager when you want to:

- Version control your dotfiles and configuration
- Share consistent configuration across multiple machines
- Take advantage of Nix's declarative configuration approach
- Ensure reproducible development environments

### When NOT to Use Home Manager

You might prefer traditional dotfiles if:

- You want direct, immediate control over config files
- You're working on a machine where you can't install Home Manager
- You need to make quick, temporary changes without activating a new configuration
- You're uncomfortable with the Nix language

## Quick Start

### Installation

First, install the home-manager command if you don't have it:

```bash
nix run home-manager/master -- init
```

### Activation

Activate the Home Manager configuration for your system:

```bash
# For macOS on Apple Silicon
home-manager switch --flake .#aarch64-darwin

# For macOS on Intel
home-manager switch --flake .#x86_64-darwin

# For Linux on x86_64
home-manager switch --flake .#x86_64-linux

# For Linux on ARM64
home-manager switch --flake .#aarch64-linux
```

After making changes to the configuration files in `nix/home/`, re-run the same command to activate them.

## What Gets Configured

This Home Manager configuration currently manages:

- **Git** (`nix/home/git.nix`):
  - User identity (userName, userEmail)
  - Pull strategy (rebase by default)
  - Default branch name (main)
  - Common aliases (st, co, br, ci, etc.)

- **Tmux** (`nix/home/tmux.nix`):
  - Terminal type (256 color support)
  - Hyperlink support
  - Passthrough mode
  - Project-specific TUI keybinding (Prefix + t)

## Customizing

### Local Overrides

To override configuration locally without modifying the repository:

1. Create a local override file:

   ```bash
   mkdir -p ~/.config/home-manager
   ```

2. Create `~/.config/home-manager/override.nix`:

   ```nix
   { config, pkgs, ... }:
   {
     programs.git = {
       userName = "Your Actual Name";
       userEmail = "your.actual.email@example.com";
     };
   }
   ```

3. Import it in your flake activation:
   ```bash
   home-manager switch --flake . --override-input override ~/.config/home-manager/override.nix
   ```

### Editing Repository Configuration

To modify the shared configuration:

1. Edit the relevant module in `nix/home/`:
   - `git.nix` for Git configuration
   - `tmux.nix` for Tmux configuration
   - `default.nix` to add new modules

2. Activate your changes:
   ```bash
   home-manager switch --flake .#default
   ```

## Coexistence with Existing Configurations

### Git

Home Manager **merges** with your existing `~/.gitconfig`:

- Settings defined in `nix/home/git.nix` will be applied
- Settings in your existing `~/.gitconfig` that aren't overridden will be preserved
- If there's a conflict, Home Manager settings take precedence

### Tmux

Home Manager **replaces** your existing `~/.tmux.conf`:

- Your original `~/.tmux.conf` will be backed up
- All tmux configuration should be defined in `nix/home/tmux.nix`
- To keep custom settings, add them to `extraConfig` in `tmux.nix`

## Troubleshooting

### Activation Script Failed

If you see errors during `home-manager switch`:

1. Check the error message for which module failed
2. Verify your Nix syntax in the relevant module file
3. Ensure all required attributes are set (especially `home.username` and `home.homeDirectory`)

### home-manager Command Not Found

If the `home-manager` command isn't available:

```bash
# Install home-manager
nix run home-manager/master -- init

# Or use the flake directly
nix run .#homeConfigurations.default.activationPackage
```

### Git Config Not Applied

If your git configuration isn't showing up:

1. Check that Home Manager activated successfully:

   ```bash
   home-manager switch --flake .#default
   ```

2. Verify the configuration was written:

   ```bash
   cat ~/.config/git/config
   ```

3. Remember that `~/.gitconfig` settings may override Home Manager settings for some values

### Existing Config Conflicts

If you have conflicting configuration:

**For Git:**

- Home Manager merges, so conflicts are rare
- Check `~/.gitconfig` and `~/.config/git/config` for conflicting values

**For Tmux:**

- Home Manager replaces the entire config
- Move any custom settings from `~/.tmux.conf` to `nix/home/tmux.nix`
- Your original file will be backed up to `~/.tmux.conf.backup`

### Reverting Home Manager Changes

To remove Home Manager configuration:

```bash
# Uninstall Home Manager
home-manager uninstall

# Restore backed-up dotfiles if needed
mv ~/.tmux.conf.backup ~/.tmux.conf  # If it exists
```
