{
  description = "Fellspiral monorepo development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
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

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
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
        devShell = pkgs.callPackage ./nix/shells/default.nix {
          inherit packageSets tmux-tui gh-workflow-mcp-server;
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
}
