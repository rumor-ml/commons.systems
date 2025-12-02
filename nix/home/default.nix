# Home Manager Configuration Entry Point
#
# Home Manager manages user-specific configuration files and packages in a
# declarative way. This allows you to version control your dotfiles and
# ensures reproducibility across different machines.
#
# This configuration includes:
# - Git configuration (git.nix)
# - Tmux configuration (tmux.nix)
#
# To activate this configuration for your system:
#   home-manager switch --flake .#aarch64-darwin
#   home-manager switch --flake .#x86_64-linux
#   home-manager switch --flake .#x86_64-darwin
#   home-manager switch --flake .#aarch64-linux
#
# Note: home.username and home.homeDirectory will be automatically detected
# from your environment when you run home-manager switch.

{ config, pkgs, lib, ... }:

{
  imports = [
    ./git.nix
    ./tmux.nix
  ];

  # User identity - these will be set automatically from environment
  home.username = lib.mkDefault (builtins.getEnv "USER");
  home.homeDirectory = lib.mkDefault (
    if pkgs.stdenv.isDarwin
    then "/Users/${config.home.username}"
    else "/home/${config.home.username}"
  );

  # Let Home Manager manage itself
  programs.home-manager.enable = true;

  # This value determines the Home Manager release that your configuration is
  # compatible with. This helps avoid breakage when a new Home Manager release
  # introduces backwards incompatible changes.
  #
  # You should not change this value, even if you update Home Manager. If you do
  # want to update the value, then make sure to first check the Home Manager
  # release notes.
  home.stateVersion = "24.11";
}
