# Development Tools Configuration for Home Manager
#
# This module configures essential development tools:
#
# direnv - Automatically loads and unloads environment variables when you
# enter and leave a directory. Particularly useful for:
# - Auto-loading Nix development shells via .envrc files
# - Managing per-project environment variables
# - Seamless workflow without manually running 'nix develop'
#
# Neovim - Modern text editor for terminal-based development. Provides:
# - Fast, efficient text editing
# - Extensive plugin ecosystem
# - LSP (Language Server Protocol) support
# - Terminal integration
#
# After activating this configuration:
#   direnv:
#     1. Run: direnv allow
#     2. cd into a directory with .envrc
#     3. The environment automatically loads
#   neovim:
#     1. Launch with: nvim
#     2. Configure via ~/.config/nvim/ (user responsibility)
#
# Learn more:
#   - direnv: https://direnv.net/
#   - Neovim: https://neovim.io/

{
  config,
  pkgs,
  lib,
  ...
}:

{
  # direnv configuration
  programs.direnv = {
    enable = true;

    # Enable shell integrations based on what shells are enabled
    enableBashIntegration = true;
    enableZshIntegration = true;

    # nix-direnv provides fast caching for Nix environments
    # This significantly speeds up entering directories with .envrc
    # that use 'use flake' or 'use nix'
    nix-direnv.enable = true;
  };

  # Neovim configuration
  programs.neovim = {
    enable = true;

    # Use neovim as the default editor
    defaultEditor = true;

    # Create vim and vi aliases
    viAlias = true;
    vimAlias = true;
    vimdiffAlias = true;
  };
}
