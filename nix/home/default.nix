# Home Manager Configuration Entry Point
#
# Home Manager manages user-specific configuration files and packages in a
# declarative way. This allows you to version control your dotfiles and
# ensures reproducibility across different machines.
#
# This configuration includes shell environments (bash, zsh), development tools
# (direnv, neovim, claude-code), terminal emulators (wezterm), version control
# (git, tmux), SSH management, and Nix settings. See the imports array below for
# the complete list of managed configurations.
#
# To activate this configuration for your system:
#   First time (requires experimental features flags):
#     nix --extra-experimental-features 'nix-command flakes' run home-manager/master -- switch --extra-experimental-features 'nix-command flakes' --flake .#default --impure
#
# TODO(#1576): Add note about PATH setup for home-manager command
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
  # Integration tests in default.test.nix verify all modules work together
  imports = [
    ./bash.nix
    ./zsh.nix
    ./git.nix
    ./gh.nix
    ./tmux.nix
    ./wezterm.nix
    ./tools.nix
    ./claude-code.nix
    ./nix.nix
    ./ssh.nix
    ./ssh-keygen.nix
    ./ssh-authorized-keys.nix
  ];

  # User identity - detect from environment or HOME directory
  # TODO(#1685): Add validation of extracted username values (e.g., check for "..", ".", or "/" prefixes)
  home.username = lib.mkDefault (
    let
      envUser = builtins.getEnv "USER";
      # Fallback: extract username from HOME environment variable
      # Edge case: if HOME=/ then extractedUser would be "/" which passes the empty check
      # but will cause errors in downstream code expecting a valid username.
      # TODO(#1685) will add validation to reject "/", ".", "..", and paths with "/" prefix
      # Note: This fallback is extremely rare - USER is set by login systems in virtually all Unix environments.
      homeDir = builtins.getEnv "HOME";
      extractedUser = if homeDir != "" then builtins.baseNameOf homeDir else "";

      # Build diagnostic message showing actual environment state
      diagnosticMsg = ''
        Could not determine username. Environment variable diagnostics:
          USER=${if envUser != "" then envUser else "(empty)"}
          HOME=${if homeDir != "" then homeDir else "(empty)"}
          Extracted from HOME=${
            if extractedUser != "" then extractedUser else "(empty - HOME is empty or /)"
          }

        To fix:
          - Set USER environment variable to your username, OR
          - Set HOME environment variable to your home directory path
          - Ensure HOME is not set to "/" (root directory)
      '';
    in
    if envUser != "" then
      envUser
    else if extractedUser != "" then
      extractedUser
    else
      throw diagnosticMsg
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
