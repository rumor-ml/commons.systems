# nix-darwin Configuration Modules

This directory contains nix-darwin (macOS) system-level configuration modules that can be imported into your nix-darwin configuration to make your macOS setup reproducible.

## Available Modules

### tailscale.nix

Provides secure VPN networking with stable IP addresses for macOS clients.

**Features:**
- Automated Tailscale service installation and startup
- Works seamlessly with nix-darwin
- Simple CLI configuration
- Connects to your Tailscale network (tailnet)

**Setup:**
```bash
sudo tailscale up
tailscale ip -4  # Get your stable Tailscale IP
```

## Prerequisites

You need nix-darwin installed on your macOS machine. If you don't have it:

```bash
# Install nix-darwin
nix-build https://github.com/LnL7/nix-darwin/archive/master.tar.gz -A installer
./result/bin/darwin-installer
```

## Using These Modules

### Method 1: Import in nix-darwin Configuration

On your macOS machine, add to your nix-darwin configuration:

**For standalone configuration** (`~/.nixpkgs/darwin-configuration.nix`):
```nix
{ config, pkgs, ... }:

{
  imports = [
    /path/to/this/repo/nix/darwin/tailscale.nix
  ];

  # Your other configuration...
}
```

**For flake-based configuration:**
```nix
# In your darwin configuration flake.nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    darwin.url = "github:LnL7/nix-darwin";
    commons.url = "path:/path/to/this/repo";
  };

  outputs = { self, nixpkgs, darwin, commons, ... }: {
    darwinConfigurations.myMac = darwin.lib.darwinSystem {
      system = "aarch64-darwin";  # or x86_64-darwin
      modules = [
        commons.darwinModules.tailscale
        ./darwin-configuration.nix
      ];
    };
  };
}
```

### Method 2: Copy Module

Copy the module to your nix-darwin configuration directory:

```bash
cp nix/darwin/tailscale.nix ~/.nixpkgs/modules/
```

Then import it:
```nix
imports = [ ./modules/tailscale.nix ];
```

## Applying Changes

After adding modules to your configuration:

```bash
# Rebuild your system
darwin-rebuild switch --flake .#myMac

# Or without flakes:
darwin-rebuild switch
```

## Tailscale Setup (macOS)

### 1. Enable the Module

Add to your darwin configuration as shown above.

### 2. Rebuild

```bash
darwin-rebuild switch
```

### 3. Authenticate Tailscale

```bash
sudo tailscale up
# Opens browser for authentication
```

### 4. Get Your Tailscale IP

```bash
tailscale ip -4
# Example: 100.64.1.3
```

### 5. Connect to Other Machines

```bash
# SSH to your NixOS machine
ssh n8@nixos.your-tailnet.ts.net

# Or using Tailscale IP
ssh n8@100.64.1.2
```

## Tailscale Features

### Exit Nodes

Use another machine as an exit node (VPN gateway):

```bash
# Enable exit node on the server (NixOS)
sudo tailscale up --advertise-exit-node

# Use it from macOS
sudo tailscale up --exit-node=nixos
```

### Subnet Routing

Share a network through a machine:

```bash
# On the subnet router (e.g., NixOS with access to 192.168.1.0/24)
sudo tailscale up --advertise-routes=192.168.1.0/24

# Enable in Tailscale admin console
# Then other machines can access that subnet
```

### Magic DNS

Access machines by name:

```bash
# Instead of IP, use hostname
ssh n8@nixos
ping macbook
```

## Integration with SSH Config

Add to your `~/.ssh/config`:

```
# Via Home Manager (recommended)
programs.ssh.matchBlocks = {
  "nixos" = {
    hostname = "nixos.your-tailnet.ts.net";
    user = "n8";
  };

  "*.ts.net" = {
    # Auto-accept Tailscale host keys
    strictHostKeyChecking = false;
    userKnownHostsFile = "/dev/null";
  };
};
```

Or manually:
```
Host nixos
    HostName nixos.your-tailnet.ts.net
    User n8

Host *.ts.net
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
```

Then connect with just:
```bash
ssh nixos
```

## Verification

Check Tailscale status:

```bash
# View connection status
tailscale status

# View your IPs
tailscale ip

# Ping another machine
tailscale ping nixos

# Check routing
tailscale netcheck
```

## Troubleshooting

### Service not starting

```bash
# Check service status
sudo launchctl list | grep tailscale

# Restart service
sudo launchctl stop com.tailscale.tailscaled
sudo launchctl start com.tailscale.tailscaled
```

### Can't connect to other machines

```bash
# Verify you're authenticated
tailscale status

# Check network connectivity
tailscale netcheck

# Re-authenticate if needed
sudo tailscale up
```

### Firewall blocking

macOS firewall shouldn't block Tailscale, but if you have issues:

```bash
# Check firewall status
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate

# Allow Tailscale (usually not needed)
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /Applications/Tailscale.app/Contents/MacOS/Tailscale
```

## Security Notes

- Tailscale uses WireGuard for encryption
- All traffic is end-to-end encrypted
- No traffic goes through Tailscale servers (peer-to-peer)
- Access is controlled by your Tailscale account
- Can enable MFA on your Tailscale account for extra security

## Resources

- [Tailscale Documentation](https://tailscale.com/kb/)
- [nix-darwin Documentation](https://github.com/LnL7/nix-darwin)
- [Tailscale Admin Console](https://login.tailscale.com/admin/)
