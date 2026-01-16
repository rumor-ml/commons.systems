# NixOS System Configuration Modules

This directory contains NixOS system-level configuration modules that can be imported into `/etc/nixos/configuration.nix` to make your system configuration reproducible across machines.

## Available Modules

### ssh-server.nix

Configures OpenSSH server with secure defaults for remote access.

**Features:**
- Modern security settings (Ed25519 keys, secure ciphers)
- Password authentication enabled by default (disable after SSH key setup)
- Firewall configuration
- mDNS/Avahi support (connect via `hostname.local`)
- Connection keep-alive settings

### tailscale.nix

Provides secure VPN networking with stable IP addresses (perfect for WSL2).

**Features:**
- Stable IP addresses that persist across restarts
- Encrypted peer-to-peer connections
- Works from anywhere (not just LAN)
- No port forwarding required
- Simple hostname-based access
- Firewall pre-configured

**Setup after enabling:**
```bash
sudo nixos-rebuild switch
sudo tailscale up
tailscale ip -4  # Get your stable Tailscale IP
```

## Using These Modules on a New Machine

### Method 1: Direct Import (Quick Setup)

On your new NixOS machine:

1. Clone this repository:
   ```bash
   git clone <your-repo-url> ~/repos/commons
   ```

2. Edit `/etc/nixos/configuration.nix` and add to imports:
   ```nix
   { config, lib, pkgs, ... }:
   {
     imports = [
       /home/n8/repos/commons/nix/nixos/ssh-server.nix
     ];

     # Your other configuration...
   }
   ```

3. Rebuild:
   ```bash
   sudo nixos-rebuild switch
   ```

### Method 2: Flake-Based (Advanced)

If using flakes for your system configuration:

1. Add this repo as a flake input in your system `flake.nix`:
   ```nix
   {
     inputs = {
       commons.url = "path:/home/n8/repos/commons";
     };

     outputs = { self, nixpkgs, commons, ... }: {
       nixosConfigurations.myhost = nixpkgs.lib.nixosSystem {
         modules = [
           commons.nixosModules.ssh-server
           # other modules...
         ];
       };
     };
   }
   ```

### Method 3: Copy Module (Standalone)

Just copy the module file to your system config:

```bash
sudo cp nix/nixos/ssh-server.nix /etc/nixos/
```

Then import it:
```nix
imports = [ ./ssh-server.nix ];
```

## Customizing After Import

### Disable Password Authentication (Recommended)

After you've added your SSH keys and confirmed key-based login works:

```nix
{ config, lib, pkgs, ... }:
{
  imports = [
    /home/n8/repos/commons/nix/nixos/ssh-server.nix
  ];

  # Override the default to disable password auth
  services.openssh.settings.PasswordAuthentication = lib.mkForce false;
}
```

### Use a Different Port

```nix
{
  imports = [
    /home/n8/repos/commons/nix/nixos/ssh-server.nix
  ];

  services.openssh.listenAddresses = lib.mkForce [
    { addr = "0.0.0.0"; port = 2222; }
  ];

  networking.firewall.allowedTCPPorts = [ 2222 ];
}
```

### Restrict to Specific Users

```nix
{
  imports = [
    /home/n8/repos/commons/nix/nixos/ssh-server.nix
  ];

  services.openssh.settings.AllowUsers = [ "n8" "admin" ];
}
```

## Current Machine Setup

To integrate your current `/etc/nixos/configuration.nix` with this module:

1. **Back up your current config:**
   ```bash
   sudo cp /etc/nixos/configuration.nix /etc/nixos/configuration.nix.backup
   ```

2. **Edit your configuration:**
   ```bash
   sudo nvim /etc/nixos/configuration.nix
   ```

3. **Add the import and remove the inline openssh config:**
   ```nix
   { config, lib, pkgs, ... }:
   {
     imports = [
       <nixos-wsl/modules>
       /home/n8/worktrees/1165-fix-tmux-tui-ctrl-space-keybinding/nix/nixos/ssh-server.nix
     ];

     # Remove this block (now in ssh-server.nix):
     # services.openssh = {
     #   enable = true;
     #   settings = {
     #     PermitRootLogin = "no";
     #     PasswordAuthentication = true;
     #   };
     # };

     # Keep your other config...
     wsl.enable = true;
     # ...
   }
   ```

4. **Rebuild:**
   ```bash
   sudo nixos-rebuild switch
   ```

## Verification

After applying the configuration, verify SSH is working:

```bash
# Check service status
systemctl status sshd

# Check listening ports
ss -tlnp | grep :22

# Test connection from another machine
ssh n8@<your-ip>
```

## Full System Configuration Management

For complete reproducibility, you can track your entire `/etc/nixos/configuration.nix` in this repo:

```bash
# Link your system config to the repo (advanced)
sudo mv /etc/nixos/configuration.nix ~/repos/commons/nix/nixos/configuration.nix
sudo ln -s ~/repos/commons/nix/nixos/configuration.nix /etc/nixos/configuration.nix
```

This way, your entire system configuration is version controlled!

## Security Checklist

When setting up a new machine:

- [ ] Deploy with password authentication enabled
- [ ] Add your SSH public key to `~/.ssh/authorized_keys`
- [ ] Test SSH key authentication
- [ ] Disable password authentication via override
- [ ] Rebuild and test
- [ ] Remove password from user account (optional): `sudo passwd -l username`
- [ ] Set up fail2ban or similar (optional)

## Related Documentation

- [NixOS SSH Options](https://search.nixos.org/options?query=services.openssh)
- [OpenSSH Server Manual](https://man.openbsd.org/sshd_config)
- [Home Manager SSH Client](../home/SSH-SETUP.md) (for client-side configuration)
