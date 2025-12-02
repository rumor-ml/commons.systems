# Git Configuration Module
#
# This module configures Git settings through Home Manager.
# Home Manager will merge these settings with your existing ~/.gitconfig,
# so any settings you have defined manually will be preserved unless
# explicitly overridden here.

{ config, pkgs, ... }:

{
  programs.git = {
    enable = true;

    # User identity - OVERRIDE THESE IN YOUR LOCAL CONFIG
    # You can override these by creating ~/.config/home-manager/override.nix
    # or by setting them in your existing ~/.gitconfig
    userName = "Your Name";
    userEmail = "your.email@example.com";

    # Core settings
    extraConfig = {
      pull = {
        rebase = true;
      };
      init = {
        defaultBranch = "main";
      };
    };

    # Common aliases
    aliases = {
      st = "status";
      co = "checkout";
      br = "branch";
      ci = "commit";
      unstage = "reset HEAD --";
      last = "log -1 HEAD";
      visual = "log --graph --oneline --all";
    };
  };
}
