# Complete Tailscale Setup Guide

This guide walks you through setting up Tailscale VPN on both your NixOS server and macOS client using Nix for fully automated, reproducible configuration.

## What is Tailscale?

Tailscale creates a secure mesh VPN between your devices using WireGuard. It's perfect for:

- **WSL2 environments** - Solves IP address changing issues
- **Remote access** - SSH from anywhere (coffee shop, office, home)
- **Zero configuration** - No port forwarding or router setup needed
- **Stable IPs** - Your machine gets a permanent Tailscale IP
- **Encrypted** - All traffic is end-to-end encrypted

## Overview

We'll set up:

1. **NixOS (WSL2/Server)** - Using `nix/nixos/tailscale.nix`
2. **macOS (Client)** - Using `nix/darwin/tailscale.nix`
3. **SSH Configuration** - Automated connection setup

## Part 1: NixOS Setup (Server)

### Step 1: Import the Tailscale Module

**Edit `/etc/nixos/configuration.nix`:**

```bash
sudo nvim /etc/nixos/configuration.nix
```

**Add to imports:**

```nix
{ config, pkgs, ... }:

{
  imports = [
    <nixos-wsl/modules>
    /home/n8/worktrees/1165-fix-tmux-tui-ctrl-space-keybinding/nix/nixos/tailscale.nix
  ];

  # Your other configuration...
}
```

### Step 2: Rebuild NixOS

```bash
sudo nixos-rebuild switch
```

**Expected output:**

- Tailscale service will be installed
- Firewall rules will be configured
- Service will be enabled

### Step 3: Authenticate Tailscale

```bash
# Start Tailscale and authenticate
sudo tailscale up

# This will output a URL like:
# https://login.tailscale.com/a/abc123def456
```

**In your browser:**

1. Open the URL
2. Sign in with Google, Microsoft, or email
3. Authorize the device

### Step 4: Get Your Tailscale IP

```bash
# Get your Tailscale IPv4 address
tailscale ip -4
# Example output: 100.64.1.2

# View all your Tailscale info
tailscale status
```

**Save this IP!** This is your stable, permanent IP for this machine.

### Step 5: Verify NixOS Setup

```bash
# Check service status
systemctl status tailscaled

# Test connectivity
tailscale ping 100.64.1.2  # Ping yourself

# View your machine name
tailscale status | grep "$(hostname)"
```

✅ **NixOS setup complete!**

---

## Part 2: macOS Setup (Client)

### Prerequisites

You need nix-darwin installed. If you don't have it:

```bash
# Install nix-darwin
nix-build https://github.com/LnL7/nix-darwin/archive/master.tar.gz -A installer
./result/bin/darwin-installer
```

### Step 1: Import the Tailscale Module

**Option A: Flake-based nix-darwin (Recommended)**

If you're using a flake, add this repo as an input and import the module:

```nix
# In your darwin configuration flake.nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    darwin.url = "github:LnL7/nix-darwin";
    commons.url = "path:/path/to/this/repo";  # Or use git URL
  };

  outputs = { self, nixpkgs, darwin, commons, ... }: {
    darwinConfigurations.myMac = darwin.lib.darwinSystem {
      system = "aarch64-darwin";  # or x86_64-darwin for Intel Macs
      modules = [
        ./darwin-configuration.nix
        commons.darwinModules.tailscale  # Add this line
      ];
    };
  };
}
```

**Option B: Non-flake nix-darwin**

Edit `~/.nixpkgs/darwin-configuration.nix`:

```nix
{ config, pkgs, ... }:

{
  imports = [
    /path/to/repo/nix/darwin/tailscale.nix
  ];

  # Your other configuration...
}
```

### Step 2: Rebuild macOS Configuration

```bash
# With flakes:
darwin-rebuild switch --flake .#myMac

# Without flakes:
darwin-rebuild switch
```

### Step 3: Authenticate Tailscale

```bash
# Start Tailscale and authenticate
sudo tailscale up

# Opens browser automatically for authentication
```

**In your browser:**

1. Authenticate with the same account as NixOS
2. Authorize this device
3. Your machines are now on the same network!

### Step 4: Get Your macOS Tailscale IP

```bash
tailscale ip -4
# Example output: 100.64.1.3

tailscale status
```

### Step 5: Test Connection to NixOS

```bash
# Ping your NixOS machine (using its Tailscale IP)
tailscale ping 100.64.1.2

# Or use the hostname
tailscale ping nixos

# Try SSH
ssh n8@100.64.1.2
```

✅ **macOS setup complete!**

---

## Part 3: SSH Configuration

Now let's make SSH even easier by adding Tailscale hosts to your SSH config.

### Option 1: Home Manager (Recommended)

**Edit `nix/home/ssh.nix`:**

```nix
programs.ssh = {
  enable = true;

  matchBlocks = {
    # Existing GitHub config...
    "github.com" = {
      hostname = "github.com";
      user = "git";
      identityFile = "~/.ssh/id_ed25519";
    };

    # Add Tailscale hosts
    "nixos" = {
      hostname = "100.64.1.2";  # Or use: nixos.your-tailnet.ts.net
      user = "n8";
      identityFile = "~/.ssh/id_ed25519";
    };

    # Auto-accept Tailscale host keys (they're on your private network)
    "*.ts.net" = {
      strictHostKeyChecking = false;
      userKnownHostsFile = "/dev/null";
    };

    # Or match by Tailscale IP range
    "100.64.*" = {
      strictHostKeyChecking = false;
      userKnownHostsFile = "/dev/null";
    };
  };

  # ... rest of your SSH config
};
```

**Rebuild:**

```bash
home-manager switch --flake .#x86_64-linux --impure
```

### Option 2: Manual SSH Config

**Edit `~/.ssh/config`:**

```
# NixOS via Tailscale
Host nixos
    HostName 100.64.1.2
    User n8
    IdentityFile ~/.ssh/id_ed25519

# Auto-accept Tailscale hosts
Host *.ts.net
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null

Host 100.64.*
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
```

### Test Easy SSH

```bash
# From macOS, just type:
ssh nixos

# That's it! No IP needed!
```

---

## Part 4: Verification & Testing

### Test Full Connectivity

**From macOS:**

```bash
# 1. Check Tailscale status
tailscale status
# Should show both machines

# 2. Ping NixOS
ping 100.64.1.2
# Should respond

# 3. SSH to NixOS
ssh nixos
# Should connect without password

# 4. Test reverse connection (from NixOS to macOS)
ssh n8@100.64.1.3  # Use your macOS Tailscale IP
```

### View Your Tailnet

```bash
# See all devices on your network
tailscale status

# Example output:
# 100.64.1.2   nixos     user@      linux   -
# 100.64.1.3   macbook   user@      macOS   -
```

### Test from Anywhere

The magic of Tailscale is it works from anywhere!

1. Take your MacBook to a coffee shop
2. Connect to their WiFi
3. SSH to your NixOS machine: `ssh nixos`
4. It just works! ✨

---

## Advanced Configuration

### 1. Exit Nodes (VPN Gateway)

Use NixOS as a VPN gateway:

**On NixOS:**

```bash
# Advertise as exit node
sudo tailscale up --advertise-exit-node

# In Tailscale admin console, approve the exit node
```

**On macOS:**

```bash
# Route all traffic through NixOS
sudo tailscale up --exit-node=nixos

# Disable exit node
sudo tailscale up --exit-node=""
```

### 2. Subnet Routing

Share a network through a machine:

**On NixOS (if it has access to a 192.168.1.0/24 network):**

```bash
sudo tailscale up --advertise-routes=192.168.1.0/24
```

**Enable in Tailscale admin console:**

- Go to https://login.tailscale.com/admin/machines
- Click on the machine
- Enable "Subnet routes"

Now all Tailscale machines can access that subnet!

### 3. Magic DNS

Tailscale provides DNS for your machines:

```bash
# Instead of IP, use hostname
ssh n8@nixos

# Works for any machine on your tailnet
ping macbook
curl http://nixos:8080
```

### 4. SSH Key Distribution via Tailscale

Since all machines are on the same secure network, you can use Tailscale IPs in your authorized keys setup:

```bash
# From macOS, add your key to NixOS
ssh-copy-id n8@nixos

# Or use the Nix config method we set up earlier
```

---

## Maintenance & Management

### Viewing Logs

**NixOS:**

```bash
sudo journalctl -u tailscaled -f
```

**macOS:**

```bash
log stream --predicate 'subsystem == "com.tailscale"'
```

### Updating Tailscale

**NixOS:**

```bash
# Update nixpkgs, then rebuild
sudo nixos-rebuild switch --upgrade
```

**macOS:**

```bash
# Update with nix-darwin
darwin-rebuild switch --upgrade
```

### Managing Devices

**Web Admin Console:**

- Visit: https://login.tailscale.com/admin/machines
- View all devices
- Disable/remove devices
- Configure sharing and access

**CLI:**

```bash
# List all devices
tailscale status

# Remove this device
sudo tailscale logout
```

---

## Troubleshooting

### Can't authenticate

```bash
# Re-authenticate
sudo tailscale up --force-reauth
```

### Can't connect to other machines

```bash
# Check Tailscale is running
tailscale status

# Restart Tailscale
sudo systemctl restart tailscaled  # NixOS
# or
sudo launchctl restart com.tailscale.tailscaled  # macOS

# Check network
tailscale netcheck
```

### WSL2 IP still changing

This is fine! Use Tailscale IP instead:

```bash
# Don't use: ssh n8@192.168.12.228
# Use this: ssh n8@100.64.1.2
```

### Firewall blocking

**NixOS:**

```bash
# Check firewall
sudo iptables -L -n | grep tailscale

# Our module already configures this, but verify:
sudo systemctl status tailscaled
```

**macOS:**
Usually no issues, but if needed:

```bash
# Check firewall
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate
```

---

## Security Best Practices

1. **Enable MFA** on your Tailscale account
2. **Use key expiry** in Tailscale admin console (devices auto-expire after inactivity)
3. **Review access** regularly in admin console
4. **Use ACLs** for fine-grained access control (advanced)
5. **Keep Tailscale updated** via Nix updates

---

## Summary: What You've Accomplished

✅ **Automated Tailscale setup** on both NixOS and macOS
✅ **Stable IP addresses** that never change
✅ **Secure VPN** with end-to-end encryption
✅ **Remote access** from anywhere in the world
✅ **SSH configuration** with easy hostnames
✅ **Reproducible** via Nix configuration
✅ **Zero port forwarding** or router configuration needed

### Your Network Now:

```
☁️  Internet
     │
     ├─ macOS (100.64.1.3)
     │    └─ Tailscale ←→ Encrypted tunnel
     │                      ↕
     └─ NixOS (100.64.1.2) ←→ Encrypted tunnel
          └─ WSL2 on Windows

All connected securely via Tailscale mesh VPN!
```

### Quick Commands Reference:

```bash
# View network status
tailscale status

# Get your IP
tailscale ip -4

# SSH to NixOS (from anywhere)
ssh nixos

# SSH to macOS (from anywhere)
ssh n8@100.64.1.3

# Check connectivity
tailscale ping nixos

# Admin console
open https://login.tailscale.com/admin/
```

---

## Next Steps

1. ✅ Add more devices to your Tailscale network
2. ✅ Set up exit nodes for VPN functionality
3. ✅ Configure subnet routing if needed
4. ✅ Share access with team members (Tailscale supports sharing)
5. ✅ Set up monitoring and alerts

**Everything is now automated and reproducible via Nix!** 🎉
