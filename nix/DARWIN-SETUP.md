# macOS Setup with nix-darwin

Complete guide to setting up your macOS machine with declarative, reproducible configuration using nix-darwin.

## Prerequisites

- macOS machine with Nix installed
- This repository cloned on your Mac

If you don't have Nix installed:

```bash
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install
```

## Quick Start (5 minutes)

### 1. Clone This Repo (if not already)

```bash
git clone <repo-url>
cd commons.systems
```

### 2. Install and Activate nix-darwin

```bash
# One command to install and activate
nix run nix-darwin -- switch --flake ./nix/darwin

# This will:
# - Install nix-darwin
# - Apply the configuration
# - Install Tailscale
# - Set up macOS defaults
# - Integrate Home Manager
```

### 3. Set Up for Easy Updates

```bash
# Create symlink for future rebuilds
ln -s ~/path/to/commons.systems/nix/darwin ~/.config/nix-darwin

# Now you can rebuild anytime with:
darwin-rebuild switch --flake ~/.config/nix-darwin
```

### 4. Activate Tailscale

```bash
# Authenticate (opens browser)
sudo tailscale up

# Get your stable Tailscale IP
tailscale ip -4
# Example: 100.78.113.37

# Save this IP!
```

### 5. Test Connection to NixOS

```bash
# SSH to your NixOS machine via Tailscale
ssh n8@100.78.113.36

# Success! You're connected securely from anywhere.
```

### 6. Restart Your Shell

```bash
exec $SHELL
```

All done! Your macOS machine is now fully configured and can securely connect to your NixOS machine from anywhere.

## What You Get

### System Configuration

- ✅ **Tailscale VPN** - Secure networking with stable IPs
- ✅ **macOS Defaults** - Sensible system settings
  - Dock auto-hide, no recent apps
  - Finder shows extensions, path bar, status bar
  - Fast keyboard repeat
  - Tap to click enabled
  - Caps Lock → Control
- ✅ **Development Tools** - Git, tmux, direnv, vim, curl, wget
- ✅ **Shell** - Zsh with completions
- ✅ **Fonts** - GeistMono, Hack, FiraCode Nerd Fonts

### Home Manager Integration

The configuration automatically uses the Home Manager config from `../home`, giving you:

- Git configuration
- SSH client with modern security
- Tmux configuration
- Claude Code CLI
- All your dotfiles

### Nix Configuration

- ✅ Flakes and nix-command enabled
- ✅ Auto garbage collection (weekly, 30-day retention)
- ✅ Trusted users configured

## Architecture

```
nix/darwin/
├── flake.nix           # Main flake entry point
├── configuration.nix   # System configuration
├── tailscale.nix       # Tailscale module
└── README.md          # Module documentation

nix/home/              # Home Manager config (shared with NixOS)
├── default.nix
├── git.nix
├── ssh.nix
└── ...
```

## Making Changes

### Edit System Configuration

```bash
# Edit the configuration
vim ~/path/to/commons.systems/nix/darwin/configuration.nix

# Apply changes
darwin-rebuild switch --flake ~/.config/nix-darwin
```

### Edit Home Manager Configuration

```bash
# Edit home config (shared with NixOS)
vim ~/path/to/commons.systems/nix/home/default.nix

# Rebuild to apply
darwin-rebuild switch --flake ~/.config/nix-darwin
```

### Add System Packages

Edit `nix/darwin/configuration.nix`:

```nix
environment.systemPackages = with pkgs; [
  vim
  git
  # Add more packages here
  htop
  ripgrep
  jq
];
```

Then rebuild:

```bash
darwin-rebuild switch --flake ~/.config/nix-darwin
```

### Customize macOS Settings

Edit `nix/darwin/configuration.nix`:

```nix
system.defaults = {
  dock = {
    autohide = true;
    orientation = "left";  # Change dock position
  };

  finder = {
    AppleShowAllExtensions = true;
  };
};
```

## Troubleshooting

### Build Errors

```bash
# Check nix-darwin version
darwin-rebuild --version

# Clean and rebuild
nix-collect-garbage -d
darwin-rebuild switch --flake ~/.config/nix-darwin
```

### Tailscale Not Starting

```bash
# Check service status
sudo launchctl list | grep tailscale

# Re-authenticate
sudo tailscale up

# Check connectivity
tailscale status
tailscale netcheck
```

### Home Manager Conflicts

If you have existing Home Manager config, it may conflict. Options:

1. **Remove old Home Manager** (recommended):

```bash
home-manager uninstall
# Then use integrated version via nix-darwin
```

2. **Disable integration** in `nix/darwin/flake.nix`:

```nix
# Comment out the home-manager module section
```

### SSH to NixOS Not Working

```bash
# Verify Tailscale is running
tailscale status

# Ping the NixOS machine
tailscale ping nixos

# Check SSH keys
ssh-add -l

# Test connection
ssh -v n8@100.78.113.36
```

## Advanced Configuration

### Enable Homebrew Integration

Edit `nix/darwin/configuration.nix`:

```nix
homebrew = {
  enable = true;
  casks = [
    "visual-studio-code"
    "firefox"
  ];
  brews = [
    "mas"  # Mac App Store CLI
  ];
};
```

### Multiple Machine Configs

Create different configurations in the flake:

```nix
darwinConfigurations = {
  macbook = darwin.lib.darwinSystem { ... };
  imac = darwin.lib.darwinSystem { ... };
};
```

Then specify which one:

```bash
darwin-rebuild switch --flake ~/.config/nix-darwin#macbook
```

## Next Steps

1. **Set up SSH config** to connect to NixOS by name:
   - Edit `nix/home/ssh.nix`
   - Add match block for your NixOS machine
   - Rebuild to apply

2. **Explore Tailscale features**:
   - Exit nodes (VPN gateway)
   - Subnet routing
   - Magic DNS

3. **Customize to your preferences**:
   - macOS defaults
   - Keyboard shortcuts
   - Dock behavior

4. **Keep it updated**:

```bash
# Update flake inputs
cd ~/path/to/commons.systems
nix flake update nix/darwin

# Rebuild with latest
darwin-rebuild switch --flake ~/.config/nix-darwin
```

## Resources

- [nix-darwin Documentation](https://github.com/LnL7/nix-darwin)
- [Home Manager Manual](https://nix-community.github.io/home-manager/)
- [Tailscale Documentation](https://tailscale.com/kb/)
- [macOS Defaults Reference](https://macos-defaults.com/)

## Help

If you encounter issues:

1. Check the logs: `darwin-rebuild switch --show-trace`
2. Review this documentation
3. Check `nix/darwin/README.md` for module-specific help
4. See `nix/TAILSCALE-SETUP.md` for VPN setup details
