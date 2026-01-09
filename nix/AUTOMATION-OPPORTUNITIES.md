# New Machine Setup Automation Opportunities

This document outlines what's already automated and what additional automation opportunities exist in your setup.

## ✅ Already Automated

### Home Manager (User-Level)
- ✅ **Git configuration** (`nix/home/git.nix`)
  - User identity, aliases, pull settings
- ✅ **Tmux** (`nix/home/tmux.nix`)
  - Terminal settings, mouse support, hooks, tmux-tui integration
- ✅ **Development tools** (`nix/home/tools.nix`)
  - direnv with nix-direnv caching
  - Neovim (basic install, aliases)
- ✅ **Claude Code CLI** (`nix/home/claude-code.nix`)
- ✅ **Nix settings** (`nix/home/nix.nix`)
  - Experimental features enabled
- ✅ **SSH client** (`nix/home/ssh.nix`)
  - Client configuration, agent, connection multiplexing

### NixOS System (System-Level)
- ✅ **SSH server** (`nix/nixos/ssh-server.nix`)
  - Secure defaults, firewall, mDNS/Avahi

### Development Environment (Flake)
- ✅ **Dev shell packages** (`flake.nix`)
  - Go, Node.js, pnpm, Docker, cloud tools
- ✅ **Custom packages**
  - tmux-tui, MCP servers, etc.
- ✅ **Pre-commit hooks**

## 🎯 High-Value Automation Opportunities

### 1. Shell Configuration (Zsh) - HIGH PRIORITY

**Current state:** `.zshrc` exists (33 lines) but not managed by Nix

**What to automate:**
```nix
programs.zsh = {
  enable = true;

  # Shell aliases
  shellAliases = {
    ll = "ls -la";
    gs = "git status";
    gp = "git pull";
    dc = "docker compose";
    # ... your aliases
  };

  # Environment variables
  sessionVariables = {
    EDITOR = "nvim";
    # ... your vars
  };

  # Shell integrations
  enableCompletion = true;
  enableAutosuggestions = true;
  syntaxHighlighting.enable = true;

  # Oh My Zsh or custom prompt
  oh-my-zsh = {
    enable = true;
    theme = "robbyrussell";
    plugins = [ "git" "docker" "golang" ];
  };

  # Custom prompt (like your current one with vcs_info)
  initExtra = ''
    # Your custom prompt logic
    autoload -Uz vcs_info
    # ...
  '';
};
```

**Benefits:**
- Consistent shell environment across all machines
- Automatic plugin management
- Version-controlled aliases and functions

**Migration path:**
1. Create `nix/home/zsh.nix`
2. Migrate your `.zshrc` content to Nix syntax
3. Test with `home-manager switch`
4. Your `.zshrc` will be replaced (backup first!)

---

### 2. GitHub CLI Configuration - MEDIUM PRIORITY

**Current state:** `.config/gh/config.yml` exists with custom settings

**What to automate:**
```nix
programs.gh = {
  enable = true;

  settings = {
    git_protocol = "https";
    prompt = "enabled";

    aliases = {
      co = "pr checkout";
      # Add more aliases
    };
  };
};
```

**Benefits:**
- Consistent gh config across machines
- No manual setup after installing gh
- Version-controlled aliases

---

### 3. NPM/Node.js Configuration - MEDIUM PRIORITY

**Current state:** `.npmrc` exists with `prefix=/home/n8/.npm-global`

**What to automate:**
```nix
# In your home configuration
home.file.".npmrc".text = ''
  prefix=${config.home.homeDirectory}/.npm-global
  # Add other npm settings
'';

# Or use programs.npm if available in your Home Manager version
```

**Benefits:**
- Consistent npm behavior
- Automatic global package directory setup

---

### 4. Development Fonts - MEDIUM PRIORITY

**Current state:** No dev fonts detected

**What to automate:**
```nix
# In home.nix or dedicated fonts.nix
home.packages = with pkgs; [
  # Nerd Fonts for terminal icons
  (nerdfonts.override { fonts = [ "FiraCode" "JetBrainsMono" "Hack" ]; })
];

# Configure font settings
fonts.fontconfig.enable = true;
```

**Benefits:**
- Consistent terminal appearance
- Icons in tmux, nvim, etc.
- No manual font installation

---

### 5. Neovim Configuration Management - LOW-MEDIUM PRIORITY

**Current state:** `.config/nvim/` exists but not managed by Nix

**Options:**

**Option A: Full Nix Management**
```nix
programs.neovim = {
  enable = true;

  plugins = with pkgs.vimPlugins; [
    telescope-nvim
    nvim-lspconfig
    nvim-cmp
    # ... your plugins
  ];

  extraConfig = ''
    " Your vim config
  '';
};
```

**Option B: Just Track the Files**
```nix
# Symlink your existing config
home.file.".config/nvim".source = ./nvim-config;
```

**Benefits:**
- Plugin management via Nix
- Reproducible editor setup
- Or just backup/restore existing config

**Note:** Many devs prefer managing nvim config separately (lazy.nvim, packer, etc.)

---

### 6. Git Credential Helper - LOW PRIORITY

**What to automate:**
```nix
programs.git = {
  extraConfig = {
    credential = {
      helper = "cache --timeout=3600";
      # Or use gh as credential helper
      helper = "!gh auth git-credential";
    };
  };
};
```

---

### 7. Additional System Packages - MEDIUM PRIORITY

**What to automate:** Create a standard set of CLI tools

```nix
# nix/home/cli-tools.nix
{ pkgs, ... }:
{
  home.packages = with pkgs; [
    # Better Unix tools
    ripgrep      # Better grep (rg)
    fd           # Better find
    bat          # Better cat
    eza          # Better ls
    fzf          # Fuzzy finder

    # Development tools
    htop         # Process monitor
    tree         # Directory visualization
    wget         # Downloads
    unzip        # Archive handling

    # Network tools
    nmap         # Network scanning
    curl         # HTTP client

    # JSON/YAML tools
    jq           # JSON processor
    yq-go        # YAML processor

    # Container tools
    dive         # Docker image explorer
    lazydocker   # Docker TUI

    # Git tools
    lazygit      # Git TUI (already in .config)
    delta        # Better git diff
  ];
}
```

---

### 8. XDG Base Directory Specification - LOW PRIORITY

**What to automate:** Ensure clean home directory

```nix
xdg = {
  enable = true;

  # This ensures apps use ~/.config, ~/.cache, ~/.local/share
  # instead of polluting home directory

  configFile = {
    # Symlink configs that support XDG
  };
};
```

---

### 9. Environment Variables & PATH - LOW PRIORITY

**Current state:** `.zshenv` exists

**What to automate:**
```nix
# In your zsh.nix or home.nix
home.sessionVariables = {
  EDITOR = "nvim";
  VISUAL = "nvim";
  PAGER = "less";
  LESS = "-R";

  # Go
  GOPATH = "${config.home.homeDirectory}/go";

  # Node
  NPM_CONFIG_PREFIX = "${config.home.homeDirectory}/.npm-global";

  # Custom paths
  PROJECTS_DIR = "${config.home.homeDirectory}/repos";
};

home.sessionPath = [
  "${config.home.homeDirectory}/.npm-global/bin"
  "${config.home.homeDirectory}/go/bin"
  "${config.home.homeDirectory}/.local/bin"
];
```

---

### 10. Cloud CLI Configurations - LOW PRIORITY

**Current state:** `.config/gcloud` exists

**What to automate:**
```nix
# Google Cloud SDK with gcloud
home.packages = [ pkgs.google-cloud-sdk ];

# Kubernetes tools
home.packages = with pkgs; [
  kubectl
  k9s          # Kubernetes TUI
  kubectx      # Context switching
];

# AWS CLI (if needed)
programs.awscli = {
  enable = true;
  # settings = { ... };
};
```

---

## 🔐 What NOT to Automate (Security)

These should be managed separately, not in version control:

- ❌ **SSH private keys** (`.ssh/id_*` private keys)
- ❌ **Cloud credentials** (gcloud auth, AWS credentials)
- ❌ **API tokens** (GitHub PAT, etc.)
- ❌ **GPG private keys**
- ❌ **Application secrets** (database passwords, etc.)

**Instead, use:**
- `pass` (password store) with Nix integration
- `sops-nix` for encrypted secrets in Nix configs
- `agenix` for age-encrypted secrets
- Manual setup on each machine

---

## 📋 Recommended Implementation Order

### Phase 1: Shell & Core Tools (Highest Impact)
1. ✅ **Zsh configuration** - Your primary interface
2. ✅ **CLI tools package** - ripgrep, fd, bat, etc.
3. ✅ **Development fonts** - Better terminal experience

### Phase 2: Developer Tools
4. ✅ **GitHub CLI config**
5. ✅ **NPM configuration**
6. ✅ **Git credential helper**

### Phase 3: Advanced (Optional)
7. ⚠️ **Neovim config management** (if desired)
8. ⚠️ **Cloud CLI configs** (if needed)
9. ⚠️ **XDG directory cleanup**

---

## 🚀 Getting Started

### Quick Win: Zsh Configuration

Create `nix/home/zsh.nix`:

```bash
# Back up your current config
cp ~/.zshrc ~/.zshrc.backup

# Create the Nix module
nvim nix/home/zsh.nix

# Test it
home-manager switch --flake .#x86_64-linux

# If it breaks, restore:
cp ~/.zshrc.backup ~/.zshrc
```

### Test New Modules Safely

```bash
# Test build without activating
nix build .#homeConfigurations.x86_64-linux.activationPackage

# If successful, activate
home-manager switch --flake .#x86_64-linux
```

---

## 📊 Automation Coverage

Current state:

```
User-Level Config:
├── ✅ SSH client
├── ✅ Git basic config
├── ✅ Tmux
├── ✅ Direnv
├── ✅ Neovim (basic)
├── ✅ Claude Code CLI
├── ✅ Nix settings
├── ❌ Zsh (manual .zshrc)
├── ❌ GitHub CLI (manual config)
├── ❌ NPM (manual .npmrc)
├── ❌ CLI tools (partial)
├── ❌ Fonts (none)
└── ❌ Environment variables (partial)

System-Level Config:
├── ✅ SSH server
├── ✅ Docker
├── ✅ Zsh package
├── ✅ User account
└── ❌ Additional system tools

Development Environment:
├── ✅ Language toolchains
├── ✅ Custom packages
├── ✅ Pre-commit hooks
└── ✅ Shell hooks
```

**Current Coverage: ~60%**
**Potential Coverage: ~90%** (excluding secrets)

---

## 🎯 Next Steps

Want me to implement any of these? Here are the highest-value items:

1. **Zsh configuration module** - Would you like me to migrate your `.zshrc`?
2. **CLI tools package** - Add ripgrep, fd, bat, fzf, etc.?
3. **Development fonts** - Add Nerd Fonts for better terminal experience?
4. **GitHub CLI config** - Automate your gh settings?

Let me know which you'd like to tackle first!
