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
    claude-code-nix = {
      url = "github:sadjow/claude-code-nix";
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
      claude-code-nix,
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
          #
          # NOTE: tmux, neovim, and gh are also configured in nix/home/ for Home Manager users.
          # They are kept here for backwards compatibility with users who don't use Home Manager
          # and for CI environments. This duplication is intentional during the migration period.
          commonPackages =
            with pkgs;
            [
              # Core tools
              bash
              coreutils
              git
              gh # Also in nix/home/gh.nix
              jq
              curl
              # Sandbox dependencies for Claude Code
              # TODO(#1584): No documentation on how to activate new packages after flake changes
              socat # Socket relay for sandbox communication
              # Cloud tools
              google-cloud-sdk
              terraform
              # Node.js ecosystem
              # Note: firebase-tools removed - causes segfault in Nix evaluator
              # Install via pnpm instead: pnpm add -g firebase-tools
              nodejs
              pnpm
              # Firebase emulators require Java runtime
              jdk
              # Playwright for E2E tests (NixOS-patched browsers)
              playwright-test
              # Go toolchain
              go
              gopls
              gotools
              air
              templ
              # Dev utilities
              tmux # Also in nix/home/tmux.nix
              neovim # Also in nix/home/tools.nix
            ]
            ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
              # Linux-only sandbox tools
              bubblewrap # Unprivileged sandboxing via Linux kernel namespaces (Linux/WSL2 only - requires user namespace support)
            ];

          # CI shell with inlined packages (avoiding callPackage issues)
          ciShell = pkgs.mkShell {
            buildInputs = commonPackages;

            shellHook = ''
              # Setup Playwright browsers (Nix-patched browsers for NixOS compatibility)
              ${playwrightHook}

              if [ ! -d "node_modules" ]; then
                pnpm install --frozen-lockfile
              fi

              export PATH="$PWD/node_modules/.bin:$PATH"
            '';

            NIXPKGS_ALLOW_UNFREE = "1";
          };

          # Custom packages
          tmux-tui = pkgs.callPackage ./nix/packages/tmux-tui.nix { };
          wezterm-navigator = pkgs.callPackage ./nix/packages/wezterm-navigator.nix { };
          mcp-common = pkgs.callPackage ./nix/packages/mcp-common.nix { };
          gh-workflow-mcp-server = pkgs.callPackage ./nix/packages/gh-workflow-mcp-server.nix {
            inherit mcp-common;
          };
          gh-issue-mcp-server = pkgs.callPackage ./nix/packages/gh-issue-mcp-server.nix {
            inherit mcp-common;
          };
          wiggum-mcp-server = pkgs.callPackage ./nix/packages/wiggum-mcp-server.nix { inherit mcp-common; };
          git-mcp-server = pkgs.callPackage ./nix/packages/git-mcp-server.nix { };
          iac = pkgs.callPackage ./nix/packages/iac.nix { };
          commons-types = pkgs.callPackage ./nix/packages/commons-types.nix { };

          # Hooks
          pnpmHook = pkgs.callPackage ./nix/hooks/pnpm.nix { };
          playwrightHook = pkgs.callPackage ./nix/hooks/playwright.nix { };
          mcpServersHook = pkgs.callPackage ./nix/hooks/mcp-servers.nix { };
          tmuxTuiHook = pkgs.callPackage ./nix/hooks/tmux-tui.nix { };
          goEnvHook = pkgs.callPackage ./nix/hooks/go-env.nix { };
          gitWorktreeHook = pkgs.callPackage ./nix/hooks/git-worktree.nix { };
          flakeUpdateCheckHook = pkgs.callPackage ./nix/hooks/flake-update-check.nix { };

          # Apps for tool discovery and environment checking
          list-tools = pkgs.callPackage ./nix/apps/list-tools.nix { };
          check-env = pkgs.callPackage ./nix/apps/check-env.nix { };
          home-manager-setup = pkgs.callPackage ./nix/apps/home-manager-setup.nix { };

          # Development shell with custom packages added
          # Inlined to avoid callPackage segfault issue (see commit 72d9d78)
          devShell = pkgs.mkShell {
            buildInputs = commonPackages ++ [
              tmux-tui
              wezterm-navigator
              mcp-common
              gh-workflow-mcp-server
              gh-issue-mcp-server
              wiggum-mcp-server
              git-mcp-server
            ];

            shellHook = ''
              ${pre-commit-check.shellHook}

              # Configure git worktree extension (prevents core.bare issues)
              ${gitWorktreeHook}

              # Check for flake updates (runs once per day)
              ${flakeUpdateCheckHook}

              # Initialize Go environment
              ${goEnvHook}

              # Install pnpm dependencies
              ${pnpmHook}

              # Build MCP servers if source changed
              ${mcpServersHook}

              # Setup Playwright browsers
              ${playwrightHook}

              # Load tmux-tui configuration
              ${tmuxTuiHook}

              echo "╔═══════════════════════════════════════════════════════════╗"
              echo "║     Commons.Systems Development Environment              ║"
              echo "╚═══════════════════════════════════════════════════════════╝"
              echo ""
              echo "Custom tools available:"
              echo "  • tmux-tui - Git-aware tmux pane manager"
              echo "  • wezterm-navigator - Persistent navigator for WezTerm"
              echo "  • gh-workflow-mcp-server - GitHub workflow MCP server"
              echo "  • gh-issue-mcp-server - GitHub issue context MCP server"
              echo "  • wiggum-mcp-server - Wiggum PR automation MCP server"
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
              wezterm-navigator
              mcp-common
              gh-workflow-mcp-server
              gh-issue-mcp-server
              wiggum-mcp-server
              git-mcp-server
              iac
              commons-types
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
            home-manager-setup = {
              type = "app";
              program = "${home-manager-setup}/bin/home-manager-setup";
            };
          };

          devShells = {
            default = devShell;
            ci = ciShell;
          };

          checks =
            let
              weztermTests = pkgs.callPackage ./nix/home/wezterm.test.nix { };
              bashTests = pkgs.callPackage ./nix/home/bash.test.nix { };
              zshTests = pkgs.callPackage ./nix/home/zsh.test.nix { };
              shellHelpersTests = pkgs.callPackage ./nix/home/lib/shell-helpers.test.nix { };
              wingetTests = pkgs.callPackage ./windows/winget-packages.test.nix { };
              homeIntegrationTests = pkgs.callPackage ./nix/home/default.test.nix { };
            in
            {
              pre-commit-check = pre-commit-check;

              # WezTerm module tests
              wezterm-test-suite = weztermTests.wezterm-test-suite;

              # Shell module tests
              bash-test-suite = bashTests.bash-test-suite;
              zsh-test-suite = zshTests.zsh-test-suite;
              shell-helpers-test-suite = shellHelpersTests.shell-helpers-test-suite;

              # Home-Manager integration tests
              home-integration-test-suite = homeIntegrationTests.integration-test-suite;

              # Windows configuration tests
              winget-test-suite = wingetTests.winget-test-suite;
            }
            // weztermTests.wezterm-tests
            // bashTests.bash-tests
            // zshTests.zsh-tests
            // shellHelpersTests.shell-helpers-tests
            // wingetTests.winget-tests
            // homeIntegrationTests.home-integration-tests;
        }
      );

      # Home Manager configurations
      # Provides configurations for all supported systems, plus a 'default' that auto-detects
      homeConfigurations =
        let
          mkHomeConfig =
            system:
            let
              basePkgs = import nixpkgs {
                inherit system;
                config = {
                  allowUnfree = true;
                };
                overlays = [ claude-code-nix.overlays.default ];
              };
              # Add custom packages for use in Home Manager modules
              pkgs = basePkgs.extend (
                final: prev: {
                  wezterm-navigator = prev.callPackage ./nix/packages/wezterm-navigator.nix { };
                }
              );
            in
            home-manager.lib.homeManagerConfiguration {
              inherit pkgs;
              modules = [
                ./nix/home/default.nix
              ];
            };

          # Create configurations for all systems
          systemConfigs = builtins.listToAttrs (
            map (system: {
              name = system;
              value = mkHomeConfig system;
            }) flake-utils.lib.defaultSystems
          );
        in
        # Add a 'default' configuration that auto-detects the current system
        # Requires --impure flag: home-manager switch --flake . --impure
        systemConfigs
        // {
          default = mkHomeConfig builtins.currentSystem;
        };
    in
    systemOutputs // { inherit homeConfigurations; };
}
