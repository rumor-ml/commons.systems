# Nix Flake Configuration for Commons.Systems Monorepo
#
# This flake provides:
# - devShells: Reproducible development environments with all necessary tools
#   Usage: nix develop (main dev shell) or nix develop .#ci (CI shell)
#
# - packages: Custom-built tools not available in nixpkgs
#   Usage: nix build .#tmux-tui or nix build .#gh-workflow-mcp-server
#
# - apps: Utility scripts for environment management
#   Usage: nix run .#check-env (verify environment) or nix run .#list-tools (show available tools)
#
# - homeConfigurations: Optional system-wide dotfile management via Home Manager
#   Usage: home-manager switch --flake .#<system> (e.g., .#x86_64-darwin)
#
# Quick Start:
#   nix develop          # Enter development shell
#   nix run .#check-env  # Verify environment setup
#   nix flake check      # Validate configuration
#
# Learn more: See nix/README.md for comprehensive documentation
{
  description = "Fellspiral monorepo development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    home-manager = {
      url = "github:nix-community/home-manager/master";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  nixConfig = {
    extra-substituters = [
      "https://cache.nixos.org"
      "https://nix-community.cachix.org"
    ];
    extra-trusted-public-keys = [
      "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY="
      "nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs="
    ];
  };

  outputs = { self, nixpkgs, flake-utils, home-manager }:
    let
      # Per-system outputs
      systemOutputs = flake-utils.lib.eachDefaultSystem (system:
        let
          pkgs = import nixpkgs {
            inherit system;
            config = { allowUnfree = true; };
          };

          # Import modular package sets
          packageSets = pkgs.callPackage ./nix/package-sets.nix { };

          # Use the 'all' package set for universal development shell
          commonTools = packageSets.all;

          ciShell = pkgs.mkShell {
            buildInputs = commonTools;

            shellHook = ''
              if [ -z "$PLAYWRIGHT_BROWSERS_PATH" ]; then
                export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
              fi
              export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true

              if [ ! -d "node_modules" ]; then
                pnpm install --frozen-lockfile
              fi

              export PATH="$PWD/node_modules/.bin:$PATH"
            '';

            NIXPKGS_ALLOW_UNFREE = "1";
          };

          # Custom packages
          tmux-tui = pkgs.callPackage ./nix/packages/tmux-tui.nix { };
          gh-workflow-mcp-server = pkgs.callPackage ./nix/packages/gh-workflow-mcp-server.nix { };

          # Apps for tool discovery and environment checking
          list-tools = pkgs.callPackage ./nix/apps/list-tools.nix { };
          check-env = pkgs.callPackage ./nix/apps/check-env.nix { };

          # Development shell using modular configuration
          devShell = pkgs.mkShell {
            buildInputs = packageSets.core ++ packageSets.cloud ++ packageSets.nodejs ++ packageSets.golang ++ packageSets.devtools;
          };

        in {
          packages = {
            inherit tmux-tui gh-workflow-mcp-server;
            default = tmux-tui;
          };

          apps = {
            list-tools = {
              type = "app";
              program = "${list-tools}/bin/list-tools";
            };
            check-env = {
              type = "app";
              program = "${check-env}/bin/check-env";
            };
          };

          devShells = {
            default = devShell;
            ci = ciShell;
          };
        }
      );

      # Home Manager configurations
      # Creates username-based configurations for easy activation
      homeConfigurations =
        let
          username = builtins.getEnv "USER";
          mkHomeConfig = system: home-manager.lib.homeManagerConfiguration {
            pkgs = import nixpkgs {
              inherit system;
              config = { allowUnfree = true; };
            };
            modules = [
              ./nix/home/default.nix
            ];
          };
        in {
          # Primary config for current user (auto-detects system)
          "${username}" = mkHomeConfig builtins.currentSystem;

          # System-specific variants (e.g., "n8@aarch64-darwin")
        } // builtins.listToAttrs (
          map (system: {
            name = "${username}@${system}";
            value = mkHomeConfig system;
          }) flake-utils.lib.defaultSystems
        );
    in
      systemOutputs // { inherit homeConfigurations; };
}
