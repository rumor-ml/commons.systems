# SSH Setup Automation - Complete Guide

This document describes the current SSH automation setup and opportunities for improvement.

## Current Implementation

### ✅ What's Automated

#### 1. SSH Client (Home Manager)

**Location:** `nix/home/ssh.nix`

**Features:**

- ✅ SSH config file (`~/.ssh/config`) management
- ✅ SSH agent as systemd service
- ✅ Modern security defaults (Ed25519, ChaCha20-Poly1305)
- ✅ Connection multiplexing (ControlMaster)
- ✅ Host-specific configurations
- ✅ Sockets directory creation

**What it manages:**

```
~/.ssh/config              # Generated from Nix
~/.ssh/sockets/            # Created automatically
SSH agent service          # Auto-started
```

**What it doesn't manage:**

```
~/.ssh/id_*                # Private keys (manual)
~/.ssh/authorized_keys     # Public keys (manual)
~/.ssh/known_hosts         # Host fingerprints (manual)
```

#### 2. SSH Server (NixOS System)

**Location:** `nix/nixos/ssh-server.nix`

**Features:**

- ✅ OpenSSH server configuration
- ✅ Security hardening (modern ciphers, no root login)
- ✅ Firewall rules (port 22 open)
- ✅ mDNS/Avahi for hostname resolution
- ✅ Host key generation (Ed25519 + RSA)

**What it manages:**

```
/etc/ssh/sshd_config       # Generated from Nix
/etc/ssh/ssh_host_*_key    # Host keys
systemd sshd.service       # Auto-started
Firewall rules             # Port 22 allowed
```

### 📖 Documentation

- `nix/home/SSH-SETUP.md` - Client setup guide
- `nix/nixos/README.md` - Server module usage
- `tmp/ssh-lan-access-guide.md` - LAN access quick start

## 🎯 Automation Improvement Opportunities

### 1. SSH Key Generation - HIGH PRIORITY

**Current state:** Manual (`ssh-keygen` by hand)

**Proposed automation:**

```nix
# nix/home/ssh-keys.nix
{ config, lib, pkgs, ... }:

let
  sshDir = "${config.home.homeDirectory}/.ssh";
  keyFile = "${sshDir}/id_ed25519";
in
{
  # Generate SSH key if it doesn't exist
  home.activation.generateSshKey = lib.hm.dag.entryAfter ["writeBoundary"] ''
    if [ ! -f "${keyFile}" ]; then
      $DRY_RUN_CMD ${pkgs.openssh}/bin/ssh-keygen \
        -t ed25519 \
        -C "$(whoami)@$(hostname)" \
        -N "" \
        -f "${keyFile}"
      echo "Generated new SSH key at ${keyFile}"
    fi
  '';

  # Optionally generate keys for specific purposes
  home.activation.generateGitHubKey = lib.hm.dag.entryAfter ["writeBoundary"] ''
    if [ ! -f "${sshDir}/id_ed25519_github" ]; then
      $DRY_RUN_CMD ${pkgs.openssh}/bin/ssh-keygen \
        -t ed25519 \
        -C "github-$(whoami)@$(hostname)" \
        -N "" \
        -f "${sshDir}/id_ed25519_github"
      echo "Generated GitHub-specific SSH key"
    fi
  '';
}
```

**Benefits:**

- ✅ New machines get SSH keys automatically
- ✅ Consistent key naming and types
- ✅ No manual key generation needed

**Considerations:**

- ⚠️ Keys are generated locally (not synced)
- ⚠️ You still need to manually add public keys to services
- ⚠️ Consider if you want per-machine or shared keys

---

### 2. Authorized Keys Management - MEDIUM PRIORITY

**Current state:** Manual editing of `~/.ssh/authorized_keys`

**Option A: Declarative authorized_keys**

```nix
# In nix/home/ssh.nix or dedicated module
programs.ssh = {
  # ... existing config

  # Note: This requires you to have the public keys in your repo
  authorizedKeys = [
    "ssh-ed25519 AAAAC3... user@laptop"
    "ssh-ed25519 AAAAC3... user@desktop"
  ];
};

# Or read from files
home.file.".ssh/authorized_keys".text = lib.concatStringsSep "\n" [
  (builtins.readFile ./ssh-keys/laptop.pub)
  (builtins.readFile ./ssh-keys/desktop.pub)
];
```

**Option B: System-level (NixOS)**

```nix
# In /etc/nixos/configuration.nix or module
users.users.n8 = {
  openssh.authorizedKeys.keys = [
    "ssh-ed25519 AAAAC3... user@laptop"
    "ssh-ed25519 AAAAC3... user@desktop"
  ];
};
```

**Benefits:**

- ✅ Declarative key management
- ✅ Version controlled
- ✅ Consistent across machines

**Considerations:**

- ⚠️ Public keys in git repo (fine, they're public)
- ⚠️ Need to update config when adding new devices
- ⚠️ Less flexible than manual management

**Recommendation:** Use for stable keys, keep `authorized_keys` for temporary access

---

### 3. Known Hosts Management - MEDIUM PRIORITY

**Current state:** Built up manually as you connect to hosts

**Proposed automation:**

```nix
# In nix/home/ssh.nix
programs.ssh = {
  matchBlocks = {
    "github.com" = {
      hostname = "github.com";
      user = "git";
      identityFile = "~/.ssh/id_ed25519";
    };
  };

  # Pre-populate known_hosts with trusted fingerprints
  knownHosts = {
    "github.com" = {
      hostNames = [ "github.com" ];
      publicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl";
    };

    "myserver.example.com" = {
      hostNames = [ "myserver.example.com" "192.168.1.100" ];
      publicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI...";
    };
  };
};
```

**Benefits:**

- ✅ No "unknown host" prompts for known servers
- ✅ Protection against MITM attacks
- ✅ Consistent known_hosts across machines

**How to get host keys:**

```bash
ssh-keyscan github.com
ssh-keyscan myserver.example.com
```

---

### 4. Multi-Machine Public Key Distribution - HIGH PRIORITY

**Current state:** Manual `ssh-copy-id` on each machine

**Proposed solution:** Centralized public key repository

```bash
# Directory structure in repo
nix/ssh-keys/
├── README.md
├── machines/
│   ├── laptop.pub          # Public key for laptop
│   ├── desktop.pub         # Public key for desktop
│   └── wsl-nix.pub         # Public key for WSL
└── users/
    └── n8.pub              # Your main public key
```

**Implementation:**

```nix
# nix/home/ssh-authorized-keys.nix
{ config, lib, pkgs, ... }:

let
  sshKeysDir = ./ssh-keys;

  # Import all machine public keys
  machineKeys = builtins.map builtins.readFile [
    "${sshKeysDir}/machines/laptop.pub"
    "${sshKeysDir}/machines/desktop.pub"
    "${sshKeysDir}/machines/wsl-nix.pub"
  ];

  # Import user keys
  userKeys = builtins.map builtins.readFile [
    "${sshKeysDir}/users/n8.pub"
  ];

  allKeys = machineKeys ++ userKeys;
in
{
  home.file.".ssh/authorized_keys".text = lib.concatStringsSep "\n" allKeys;
}
```

**Workflow:**

1. Generate key on new machine (or auto-generate with #1)
2. Copy public key to `nix/ssh-keys/machines/newmachine.pub`
3. Commit to repo
4. Run `home-manager switch` on all machines
5. All machines can now SSH to each other!

**Benefits:**

- ✅ One-time key addition
- ✅ Automatic distribution to all machines
- ✅ Central audit of all authorized keys
- ✅ Easy to revoke access (remove from repo, rebuild)

---

### 5. SSH Certificate Authority (Advanced) - LOW PRIORITY

**For larger setups (5+ machines):**

```nix
# Generate CA keys (once)
# ssh-keygen -t ed25519 -f ~/.ssh/ca_user_key

# Sign user keys with CA
# ssh-keygen -s ~/.ssh/ca_user_key -I user_n8 -n n8 -V +52w ~/.ssh/id_ed25519.pub

# Configure servers to trust CA
services.openssh.extraConfig = ''
  TrustedUserCAKeys /etc/ssh/ca_user_key.pub
'';
```

**Benefits:**

- ✅ Single source of trust
- ✅ Easy to issue/revoke certificates
- ✅ Time-limited access (certificates expire)

**Complexity:** High - only worth it for large deployments

---

### 6. Secrets Management Integration - MEDIUM PRIORITY

**Problem:** Private keys shouldn't be in git

**Solution A: sops-nix (Secrets OPerationS)**

```nix
# flake.nix
inputs.sops-nix.url = "github:Mic92/sops-nix";

# In home configuration
imports = [ inputs.sops-nix.homeManagerModules.sops ];

sops = {
  age.keyFile = "/home/n8/.config/sops/age/keys.txt";

  secrets.ssh_private_key = {
    sopsFile = ./secrets/ssh.yaml;
    path = "/home/n8/.ssh/id_ed25519";
    mode = "0600";
  };
};
```

**Solution B: agenix**

Similar to sops-nix but uses age encryption.

**Benefits:**

- ✅ Encrypted secrets in git
- ✅ Automated secret deployment
- ✅ Can version control private keys (encrypted)

**Use case:** If you want to sync private keys across machines

**Warning:** Most people prefer unique keys per machine for security

---

### 7. SSH Server Security Enhancements - MEDIUM PRIORITY

**Add to `nix/nixos/ssh-server.nix`:**

```nix
# fail2ban integration
services.fail2ban = {
  enable = true;
  jails = {
    ssh = ''
      enabled = true
      port = ssh
      filter = sshd
      maxretry = 3
      findtime = 600
      bantime = 3600
    '';
  };
};

# Port knocking (advanced)
services.knockd = {
  enable = true;
  interface = "eth0";
  knockSequence = [ 7000 8000 9000 ];
  openCommand = "iptables -A INPUT -s %IP% -p tcp --dport 22 -j ACCEPT";
  closeCommand = "iptables -D INPUT -s %IP% -p tcp --dport 22 -j ACCEPT";
};

# SSH auditing
services.openssh.extraConfig = ''
  # Log all commands
  ForceCommand /usr/bin/script -q -c $SHELL /var/log/ssh_sessions/$(date +%Y%m%d_%H%M%S)_$USER.log
'';
```

---

### 8. Dynamic DNS / Hostname Resolution - HIGH PRIORITY (WSL2)

**Problem:** WSL2 IP changes on restart

**Solution A: Avahi/mDNS (Already implemented!)**

```bash
# Connect using hostname instead of IP
ssh n8@nixos.local
```

**Solution B: Dynamic DNS script**

```nix
# systemd service to update DNS on IP change
systemd.services.update-dns = {
  description = "Update dynamic DNS on IP change";
  wantedBy = [ "multi-user.target" ];

  serviceConfig = {
    Type = "oneshot";
    ExecStart = pkgs.writeScript "update-dns" ''
      #!/bin/sh
      IP=$(ip -4 addr show eth1 | grep inet | awk '{print $2}' | cut -d/ -f1)
      # Update DNS service (Cloudflare, DuckDNS, etc.)
      curl "https://api.duckdns.org/update?domains=mynixbox&token=TOKEN&ip=$IP"
    '';
  };
};

# Trigger on network changes
systemd.paths.update-dns-watcher = {
  wantedBy = [ "multi-user.target" ];
  pathConfig = {
    PathChanged = "/sys/class/net/eth1/carrier";
  };
};
```

---

### 9. Tailscale/WireGuard Integration - HIGH PRIORITY (Remote Access)

**For secure remote access without port forwarding:**

```nix
# nix/nixos/tailscale.nix
{ config, pkgs, ... }:

{
  services.tailscale = {
    enable = true;
    # Auto-accept routes
    useRoutingFeatures = "both";
  };

  # Open firewall for Tailscale
  networking.firewall = {
    trustedInterfaces = [ "tailscale0" ];
    allowedUDPPorts = [ config.services.tailscale.port ];
  };
}
```

**Benefits:**

- ✅ Stable IP even when WSL2 IP changes
- ✅ Works from anywhere (not just LAN)
- ✅ End-to-end encrypted
- ✅ No router configuration needed

**SSH over Tailscale:**

```bash
ssh n8@nixbox.tailnet-name.ts.net
```

---

### 10. SSH Config Templating - LOW PRIORITY

**For managing many similar hosts:**

```nix
# Generate SSH config for multiple similar hosts
let
  servers = [ "web1" "web2" "db1" "db2" ];

  mkServerConfig = name: {
    hostname = "${name}.example.com";
    user = "deploy";
    identityFile = "~/.ssh/id_ed25519_deploy";
    port = 22;
  };
in
{
  programs.ssh.matchBlocks = builtins.listToAttrs (
    map (name: { name = name; value = mkServerConfig name; }) servers
  );
}
```

---

## 🎯 Recommended Implementation Priority

### Phase 1: Immediate Wins (Do Now)

1. ✅ **Multi-machine key distribution** - Central key repository
2. ✅ **Tailscale integration** - Solve WSL2 IP changing
3. ✅ **Known hosts for common services** - GitHub, GitLab, etc.

### Phase 2: Quality of Life (Soon)

4. ✅ **Auto SSH key generation** - New machines get keys automatically
5. ✅ **fail2ban** - Protect SSH from brute force
6. ✅ **Declarative authorized_keys** - Manage access centrally

### Phase 3: Advanced (Later)

7. ⚠️ **Secrets management** - Only if syncing private keys
8. ⚠️ **SSH CA** - Only for large deployments
9. ⚠️ **Port knocking** - Only if high security needed

---

## 📋 Implementation Examples

### Quick Win #1: Multi-Machine Key Distribution

```bash
# 1. Create key directory
mkdir -p nix/ssh-keys/{machines,users}

# 2. Copy public keys
cp ~/.ssh/id_ed25519.pub nix/ssh-keys/machines/wsl-nix.pub

# 3. Create module
cat > nix/home/ssh-authorized-keys.nix << 'EOF'
{ config, lib, ... }:
{
  home.file.".ssh/authorized_keys".text = lib.concatStringsSep "\n" (
    builtins.map builtins.readFile [
      ./ssh-keys/machines/wsl-nix.pub
      # Add more as you create them
    ]
  );
}
EOF

# 4. Import in default.nix
# Add ./ssh-authorized-keys.nix to imports

# 5. Apply
home-manager switch --flake .#x86_64-linux
```

### Quick Win #2: Tailscale Setup

```bash
# 1. Create Tailscale module
cat > nix/nixos/tailscale.nix << 'EOF'
{ config, pkgs, ... }:
{
  services.tailscale.enable = true;
  networking.firewall.trustedInterfaces = [ "tailscale0" ];
}
EOF

# 2. Import in /etc/nixos/configuration.nix
sudo nvim /etc/nixos/configuration.nix
# Add: imports = [ /path/to/nix/nixos/tailscale.nix ];

# 3. Rebuild
sudo nixos-rebuild switch

# 4. Authenticate
sudo tailscale up

# 5. SSH using Tailscale IP
ssh n8@$(tailscale ip -4)
```

---

## 🔍 Current vs. Future State

### Current State

```
SSH Setup Automation: 65%

✅ Client config managed
✅ Server config managed
✅ Security defaults set
❌ Key generation manual
❌ Key distribution manual
❌ Known hosts manual
❌ IP address changes (WSL2)
❌ Remote access requires port forwarding
```

### Future State (After Improvements)

```
SSH Setup Automation: 95%

✅ Client config managed
✅ Server config managed
✅ Security defaults set
✅ Keys auto-generated
✅ Keys auto-distributed
✅ Known hosts pre-populated
✅ Stable network (Tailscale)
✅ Remote access built-in
✅ fail2ban protection
```

---

## 📖 Related Documentation

- SSH client: `nix/home/SSH-SETUP.md`
- SSH server: `nix/nixos/README.md`
- LAN access: `tmp/ssh-lan-access-guide.md`
- Overall automation: `nix/AUTOMATION-OPPORTUNITIES.md`

---

## 🚀 Next Steps

Would you like me to implement:

1. **Multi-machine key distribution** (high value, low complexity)
2. **Tailscale integration** (solves WSL2 IP issues)
3. **Auto key generation** (convenience)
4. **fail2ban** (security)

Or all of the above?
