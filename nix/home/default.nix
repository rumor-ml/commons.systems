# Home Manager Configuration Entry Point
#
# Home Manager manages user-specific configuration files and packages in a
# declarative way. This allows you to version control your dotfiles and
# ensures reproducibility across different machines.
#
# This configuration includes:
# - Git configuration (git.nix)
# - Tmux configuration (tmux.nix)
# - Development tools: direnv, neovim (tools.nix)
# - Claude Code CLI (claude-code.nix)
# - Nix settings: experimental features (nix.nix)
# - SSH client and agent configuration (ssh.nix)
# - SSH key auto-generation (ssh-keygen.nix)
# - SSH authorized keys management (ssh-authorized-keys.nix)
#
# To activate this configuration for your system:
#   First time (requires experimental features flags):
#     nix --extra-experimental-features 'nix-command flakes' run home-manager/master -- switch --extra-experimental-features 'nix-command flakes' --flake .#default --impure
#
#   After first activation (auto-detects system architecture):
#     home-manager switch --flake .#default --impure
#
#   Or explicitly specify system (x86_64-linux, aarch64-linux, x86_64-darwin, aarch64-darwin):
#     home-manager switch --flake .#x86_64-linux --impure
#
# Note: --impure is required because home.username and home.homeDirectory are
# automatically detected from your environment using builtins.getEnv.

{
  config,
  pkgs,
  lib,
  ...
}:

{
  imports = [
    ./git.nix
    ./tmux.nix
    ./tools.nix
    ./claude-code.nix
    ./nix.nix
    ./ssh.nix
    ./ssh-keygen.nix
    ./ssh-authorized-keys.nix
  ];

  # User identity - detect from environment or HOME directory
  home.username = lib.mkDefault (
    let
      envUser = builtins.getEnv "USER";
      # Fallback: extract username from HOME environment variable
      # e.g., /home/username -> username
      homeDir = builtins.getEnv "HOME";
      extractedUser = if homeDir != "" then builtins.baseNameOf homeDir else "";
    in
    if envUser != "" then
      envUser
    else if extractedUser != "" then
      extractedUser
    else
      throw "Could not determine username. Please set USER or HOME environment variable."
  );

  home.homeDirectory = lib.mkDefault (
    let
      envHome = builtins.getEnv "HOME";
    in
    if envHome != "" then
      envHome
    else if pkgs.stdenv.isDarwin then
      "/Users/${config.home.username}"
    else
      "/home/${config.home.username}"
  );

  # Let Home Manager manage itself
  programs.home-manager.enable = true;

  # Disable version mismatch check since we're using home-manager/master with nixos-unstable
  # Both track the latest changes, so the version check warning is not relevant
  home.enableNixpkgsReleaseCheck = false;

  # This value determines the Home Manager release that your configuration is
  # compatible with. This helps avoid breakage when a new Home Manager release
  # introduces backwards incompatible changes.
  #
  # You should not change this value, even if you update Home Manager. If you do
  # want to update the value, then make sure to first check the Home Manager
  # release notes.
  home.stateVersion = "24.11";
}
