# SSH Configuration Guide

This guide explains how to use the reproducible SSH configuration managed by Home Manager.

## Quick Start

### 1. Activate the SSH Configuration

If this is your first time using Home Manager:

```bash
nix --extra-experimental-features 'nix-command flakes' run home-manager/master -- switch \
  --extra-experimental-features 'nix-command flakes' --flake .#x86_64-linux
```

If you've already activated Home Manager before:

```bash
home-manager switch --flake .#x86_64-linux
```

Replace `x86_64-linux` with your system type:
- Linux (x86_64): `x86_64-linux`
- Linux (ARM): `aarch64-linux`
- macOS (Intel): `x86_64-darwin`
- macOS (Apple Silicon): `aarch64-darwin`

### 2. Generate SSH Keys (if you don't have them)

Generate a modern Ed25519 key:

```bash
ssh-keygen -t ed25519 -C "your_email@example.com"
```

For legacy systems that don't support Ed25519, use RSA:

```bash
ssh-keygen -t rsa -b 4096 -C "your_email@example.com"
```

### 3. Add Your Key to SSH Agent

The SSH agent is automatically started by Home Manager. Add your key:

```bash
ssh-add ~/.ssh/id_ed25519
```

List loaded keys:

```bash
ssh-add -l
```

### 4. Test Your Configuration

Test GitHub connection (example):

```bash
ssh -T git@github.com
```

## Features

Your SSH configuration includes:

✅ **Security-focused defaults**:
- Modern ciphers (ChaCha20-Poly1305, AES-GCM)
- Modern key exchange algorithms (Curve25519)
- SHA-2 based MACs
- Ed25519 and RSA-SHA2 host keys only

✅ **Performance optimizations**:
- Connection multiplexing (ControlMaster)
- Connection persistence (10 minutes)
- Connection keep-alive

✅ **SSH Agent**:
- Automatically started as a systemd user service
- Manages your keys securely in memory

## Customizing Your Configuration

Edit `nix/home/ssh.nix` to add or modify host configurations.

### Adding a New Host

Add a new entry to `programs.ssh.matchBlocks`:

```nix
"myserver" = {
  hostname = "example.com";
  user = "username";
  port = 22;
  identityFile = "~/.ssh/id_ed25519";
  forwardAgent = false;  # Set to true if you need agent forwarding
};
```

### Using a Short Alias

```nix
"prod" = {
  hostname = "production.example.com";
  user = "deploy";
  identityFile = "~/.ssh/id_rsa_deploy";
};
```

Then connect with:

```bash
ssh prod
```

### Port Forwarding Example

```nix
"db-tunnel" = {
  hostname = "db.example.com";
  user = "dbuser";
  localForwards = [
    {
      bind.port = 5432;
      host.address = "localhost";
      host.port = 5432;
    }
  ];
};
```

### Jump Host (Bastion) Configuration

```nix
"internal-server" = {
  hostname = "10.0.1.100";
  user = "admin";
  proxyJump = "bastion.example.com";
};
```

## Advanced Configuration

### Multiple Keys for Different Services

```nix
"github.com" = {
  hostname = "github.com";
  user = "git";
  identityFile = "~/.ssh/id_ed25519_github";
  identitiesOnly = true;
};

"gitlab.com" = {
  hostname = "gitlab.com";
  user = "git";
  identityFile = "~/.ssh/id_ed25519_gitlab";
  identitiesOnly = true;
};
```

### Per-Host Connection Settings

```nix
"slow-server" = {
  hostname = "slow.example.com";
  serverAliveInterval = 30;
  serverAliveCountMax = 10;
};
```

## Applying Changes

After editing `nix/home/ssh.nix`:

1. The file is tracked by git in the flake, so you need to stage changes:
   ```bash
   git add nix/home/ssh.nix
   ```

2. Apply the new configuration:
   ```bash
   home-manager switch --flake .#x86_64-linux
   ```

3. Your `~/.ssh/config` will be automatically updated!

## Troubleshooting

### SSH Agent Not Running

Check the service status:

```bash
systemctl --user status ssh-agent
```

Start it manually if needed:

```bash
systemctl --user start ssh-agent
```

### Permission Denied (publickey)

1. Verify your key is loaded:
   ```bash
   ssh-add -l
   ```

2. Add your key if missing:
   ```bash
   ssh-add ~/.ssh/id_ed25519
   ```

3. Test with verbose output:
   ```bash
   ssh -vvv user@hostname
   ```

### Connection Multiplexing Issues

If you encounter issues with ControlMaster, you can disable it per-host:

```nix
"problematic-host" = {
  hostname = "example.com";
  extraOptions = {
    ControlMaster = "no";
  };
};
```

Or remove the control socket:

```bash
rm ~/.ssh/sockets/*
```

## Files Managed by Home Manager

Once activated, Home Manager manages:

- `~/.ssh/config` - Your SSH client configuration
- `~/.ssh/sockets/` - Directory for connection multiplexing

**Note**: Your SSH keys (`~/.ssh/id_*`) are NOT managed by Home Manager and remain under your control.

## Security Best Practices

1. **Use Ed25519 keys** - They're more secure and faster than RSA
2. **Use unique keys per service** - Limit blast radius if a key is compromised
3. **Never commit private keys** - Only configuration goes in the repo
4. **Use `identitiesOnly = true`** - Prevents trying all keys in ssh-agent
5. **Disable agent forwarding** - Unless you specifically need it
6. **Use jump hosts** - Instead of agent forwarding when possible

## Migration from Manual SSH Config

If you have an existing `~/.ssh/config`:

1. **Back it up first**:
   ```bash
   cp ~/.ssh/config ~/.ssh/config.backup
   ```

2. **Convert your hosts** to Nix format in `ssh.nix`

3. **Test the configuration** before removing your backup:
   ```bash
   ssh -F ~/.ssh/config your-host
   ```

4. Home Manager will **replace** `~/.ssh/config`, so make sure all your hosts are in `ssh.nix` first!

## Resources

- [Home Manager SSH Options](https://nix-community.github.io/home-manager/options.xhtml#opt-programs.ssh.enable)
- [OpenSSH Client Config](https://man.openbsd.org/ssh_config)
- [SSH Key Generation Best Practices](https://infosec.mozilla.org/guidelines/openssh)
