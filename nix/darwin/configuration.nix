# nix-darwin configuration
# This provides declarative system configuration for macOS
#
# Usage:
#   1. Install nix-darwin (see README.md)
#   2. Link this file: ln -s ~/path/to/repo/nix/darwin/configuration.nix ~/.nixpkgs/darwin-configuration.nix
#   3. Run: darwin-rebuild switch
#
# Or use the flake.nix in this directory for flake-based setup

{ config, pkgs, ... }:

{
  imports = [
    ./tailscale.nix
  ];

  # Allow unfree packages (required for claude-code and some other tools)
  nixpkgs.config.allowUnfree = true;

  # Match existing Nix installation's nixbld group ID
  ids.gids.nixbld = 350;

  # System packages available to all users
  environment.systemPackages = with pkgs; [
    # Core utilities
    vim
    git
    curl
    wget

    # Developer tools
    tmux
    direnv

    # Shell
    zsh
  ];

  # Fonts
  fonts = {
    packages = with pkgs; [
      nerd-fonts.geist-mono
      nerd-fonts.hack
      nerd-fonts.fira-code
    ];
  };

  # Homebrew integration (optional - uncomment if you use Homebrew)
  # homebrew = {
  #   enable = true;
  #   casks = [
  #     # Add GUI apps here
  #   ];
  #   brews = [
  #     # Add CLI tools here
  #   ];
  # };

  # macOS system settings
  system = {
    # Primary user for system defaults that require a user context
    primaryUser = "n8";

    defaults = {
      # Dock settings
      dock = {
        autohide = true;
        mru-spaces = false;
        orientation = "bottom";
        show-recents = false;
      };

      # Finder settings
      finder = {
        AppleShowAllExtensions = true;
        FXEnableExtensionChangeWarning = false;
        ShowPathbar = true;
        ShowStatusBar = true;
      };

      # Global macOS settings
      NSGlobalDomain = {
        # Expand save and print dialogs by default
        NSNavPanelExpandedStateForSaveMode = true;
        PMPrintingExpandedStateForPrint = true;

        # Disable automatic capitalization
        NSAutomaticCapitalizationEnabled = false;

        # Disable smart quotes and dashes
        NSAutomaticQuoteSubstitutionEnabled = false;
        NSAutomaticDashSubstitutionEnabled = false;

        # Keyboard repeat settings
        InitialKeyRepeat = 15;
        KeyRepeat = 2;

        # Mouse/trackpad settings
        "com.apple.mouse.tapBehavior" = 1; # Tap to click
      };

      # Trackpad settings
      trackpad = {
        Clicking = true;
        TrackpadThreeFingerDrag = true;
      };

      # Screenshot settings
      screencapture = {
        location = "~/Pictures/Screenshots";
        type = "png";
      };
    };

    # Keyboard settings
    keyboard = {
      enableKeyMapping = true;
      remapCapsLockToControl = true;
    };

    # Auto-upgrade nix-darwin
    # activationScripts.extraUserActivation.text = ''
    #   softwareupdate --install --all
    # '';
  };

  # Shell configuration
  programs.zsh = {
    enable = true;
    enableCompletion = true;
    enableBashCompletion = true;
  };

  # Nix configuration
  nix = {
    settings = {
      experimental-features = [
        "nix-command"
        "flakes"
      ];
      trusted-users = [ "@admin" ];
    };

    # Auto garbage collection
    gc = {
      automatic = true;
      interval = {
        Weekday = 7;
      }; # Run on Sundays
      options = "--delete-older-than 30d";
    };
  };

  # Used for backwards compatibility, please read the changelog before changing.
  # $ darwin-rebuild changelog
  system.stateVersion = 4;
}
