# Migration Guide: setup-dev-tools.sh → Home Manager

## What Changed

The interactive `setup-dev-tools.sh` script has been replaced with declarative Home Manager configuration.

## Benefits

- **Declarative**: All tools defined in version-controlled Nix files
- **Reproducible**: Same setup on every machine
- **Maintainable**: No shell script to maintain
- **Fast updates**: Claude Code available within ~1 hour of release

## Migration Steps

If you previously used `setup-dev-tools.sh`:

1. **Activate Home Manager** (one-time):

   ```bash
   # Auto-detects your system architecture
   nix --extra-experimental-features 'nix-command flakes' run .#home-manager-setup
   exec $SHELL
   ```

   After this first activation, experimental features will be permanently enabled in your Nix config.

2. **Allow direnv** (if not already done):

   ```bash
   cd commons.systems
   direnv allow
   ```

3. **Done!** All tools now managed declaratively.

## What's Included

Home Manager now manages:

- direnv (with shell integration)
- tmux (with project TUI keybinding)
- neovim (with vim/vi aliases)
- Claude Code (auto-updated)
- Git configuration (merged with existing config)

## Backwards Compatibility

- tmux and neovim remain available in `nix develop` for users who don't use Home Manager
- Existing direnv shell hooks in .bashrc/.zshrc continue to work
- Home Manager backs up replaced configs (e.g., ~/.tmux.conf → ~/.tmux.conf.backup)

## Rollback

If needed, rollback using Nix generations:

```bash
home-manager generations  # List generations
home-manager switch --switch-generation <number>
```

## Questions?

See:

- [README.md](./README.md) - Setup instructions
- [nix/home/README.md](./nix/home/README.md) - Home Manager details
- [nix/README.md](./nix/README.md) - Nix configuration guide
