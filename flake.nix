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
    pre-commit-hooks = {
      url = "github:cachix/pre-commit-hooks.nix";
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

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      home-manager,
      pre-commit-hooks,
    }:
    let
      # Per-system outputs
      systemOutputs = flake-utils.lib.eachDefaultSystem (
        system:
        let
          pkgs = import nixpkgs {
            inherit system;
            config = {
              allowUnfree = true;
            };
          };

          # Import modular package sets
          # Note: Currently unused due to callPackage segfault workaround (commit 72d9d78)
          # Kept for reference and potential future use once Nix fixes the segfault issue
          # The modular organization in nix/package-sets.nix represents the intended
          # architecture. See commonPackages below for the current inlined workaround.
          packageSets = import ./nix/package-sets.nix { inherit pkgs; };

          # Pre-commit checks configuration
          pre-commit-check = import ./nix/checks.nix {
            inherit pkgs pre-commit-hooks;
            src = ./.;
          };

          # Common packages shared between dev and CI shells
          #
          # Why inlined instead of using nix/package-sets.nix?
          # Using callPackage to import nix/shells/default.nix causes a segmentation
          # fault in the Nix evaluator (discovered in commit 72d9d78). The issue appears
          # to be related to complex attribute set manipulations in callPackage.
          #
          # Workaround: Define packages inline using simple let-binding. This avoids
          # the callPackage mechanism while maintaining the same package list.
          #
          # TODO: Re-evaluate using modular approach once Nix fixes underlying issue
          commonPackages = with pkgs; [
            # Core tools
            bash
            coreutils
            git
            gh
            jq
            curl
            # Cloud tools
            google-cloud-sdk
            terraform
            # Node.js ecosystem
            # Note: firebase-tools removed - causes segfault in Nix evaluator
            # Install via pnpm instead: pnpm add -g firebase-tools
            nodejs
            pnpm
            # Go toolchain
            go
            gopls
            gotools
            air
            templ
            # Dev utilities
            tmux
          ];

          # CI shell with inlined packages (avoiding callPackage issues)
          ciShell = pkgs.mkShell {
            buildInputs = commonPackages;

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
          gh-issue-mcp-server = pkgs.callPackage ./nix/packages/gh-issue-mcp-server.nix { };
          wiggum-mcp-server = pkgs.callPackage ./nix/packages/wiggum-mcp-server.nix { };
          iac = pkgs.callPackage ./nix/packages/iac.nix { };

          # Apps for tool discovery and environment checking
          list-tools = pkgs.callPackage ./nix/apps/list-tools.nix { };
          check-env = pkgs.callPackage ./nix/apps/check-env.nix { };

          # Development shell with custom packages added
          # Inlined to avoid callPackage segfault issue (see commit 72d9d78)
          devShell = pkgs.mkShell {
            buildInputs = commonPackages ++ [
              tmux-tui
              gh-workflow-mcp-server
              gh-issue-mcp-server
              wiggum-mcp-server
            ];

            shellHook = ''
              ${pre-commit-check.shellHook}
              echo "╔═══════════════════════════════════════════════════════════╗"
              echo "║     Commons.Systems Development Environment              ║"
              echo "╚═══════════════════════════════════════════════════════════╝"
              echo ""
              echo "Custom tools available:"
              echo "  • tmux-tui - Git-aware tmux pane manager"
              echo "  • gh-workflow-mcp-server - GitHub workflow MCP server"
              echo "  • gh-issue-mcp-server - GitHub issue context MCP server"
              echo "  • wiggum-mcp-server - Wiggum PR automation orchestration MCP server"
              echo ""
              echo "Quick start:"
              echo "  • Run dev server: pnpm dev"
              echo "  • Run tests: pnpm test"
              echo "  • Check environment: nix run .#check-env"
            '';

            NIXPKGS_ALLOW_UNFREE = "1";
          };

        in
        {
          packages = {
            inherit
              tmux-tui
              gh-workflow-mcp-server
              gh-issue-mcp-server
              wiggum-mcp-server
              iac
              ;
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

          checks = {
            pre-commit-check = pre-commit-check;
          };
        }
      );

      # Home Manager configurations
      # Creates username-based configurations for easy activation
      homeConfigurations =
        let
          username = builtins.getEnv "USER";
          mkHomeConfig =
            system:
            home-manager.lib.homeManagerConfiguration {
              pkgs = import nixpkgs {
                inherit system;
                config = {
                  allowUnfree = true;
                };
              };
              modules = [
                ./nix/home/default.nix
              ];
            };
        in
        {
          # Primary config for current user (auto-detects system)
          "${username}" = mkHomeConfig builtins.currentSystem;

          # System-specific variants (e.g., "n8@aarch64-darwin")
        }
        // builtins.listToAttrs (
          map (system: {
            name = "${username}@${system}";
            value = mkHomeConfig system;
          }) flake-utils.lib.defaultSystems
        );
    in
    systemOutputs // { inherit homeConfigurations; };
}
