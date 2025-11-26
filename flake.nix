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

        commonTools = with pkgs; [
          google-cloud-sdk
          gh
          nodejs
          pnpm
          terraform
          bash
          coreutils
          git
          jq
          curl
          # Go toolchain for tmux-tui and Go fullstack scaffolding
          go
          gopls
          gotools
          tmux
          air
          templ
        ];

        devShell = pkgs.mkShell {
          buildInputs = commonTools;

          shellHook = ''
            echo "Fellspiral development environment loaded"
            echo ""

            # Go config
            export GOPATH="$HOME/go"
            export PATH="$GOPATH/bin:$PATH"

            # Playwright config
            export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
            export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true

            # pnpm uses global store by default (~/.pnpm-store)
            # This is shared across all worktrees automatically

            # Smart pnpm install - only when lockfile changes
            if [ ! -d "node_modules" ]; then
              echo "Installing pnpm dependencies..."
              pnpm install
              echo "Dependencies installed"
            elif [ "pnpm-lock.yaml" -nt "node_modules/.modules.yaml" ]; then
              echo "pnpm-lock.yaml changed, reinstalling..."
              pnpm install
              echo "Dependencies updated"
            fi

            # Add node_modules/.bin to PATH
            export PATH="$PWD/node_modules/.bin:$PATH"

            if [ -f infrastructure/scripts/setup-workload-identity.sh ]; then
              chmod +x infrastructure/scripts/*.sh
            fi

            # Build tmux-tui if needed
            if [ -d "tmux-tui" ]; then
              if [ ! -f "tmux-tui/build/tmux-tui" ] || [ "tmux-tui/cmd/tmux-tui/main.go" -nt "tmux-tui/build/tmux-tui" ]; then
                echo "Building tmux-tui..."
                (cd tmux-tui && go build -ldflags "-s -w" -o build/tmux-tui ./cmd/tmux-tui 2>&1 | grep -v "^#" || true)
              fi
            fi

            # Auto-source tmux-tui configuration if in tmux
            if [ -n "$TMUX" ] && [ -f "tmux-tui/tmux-tui.conf" ]; then
              # Always set/update the spawn script path
              tmux set-environment -g TMUX_TUI_SPAWN_SCRIPT "$PWD/tmux-tui/scripts/spawn.sh"

              # Check if hooks are already loaded
              if ! tmux show-hooks -g 2>/dev/null | grep -q "run-shell.*spawn.sh"; then
                echo "Loading tmux-tui configuration..."
                tmux source-file "$PWD/tmux-tui/tmux-tui.conf"
              fi
            fi

            echo ""
            echo "Quick start:"
            echo "  1. Run dev server: pnpm dev"
            echo "  2. Run tests: pnpm test"
            echo "  3. Add packages: pnpm add <pkg>"
            echo ""
          '';

          NIXPKGS_ALLOW_UNFREE = "1";
        };

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

      in {
        devShells = {
          default = devShell;
          ci = ciShell;
        };
      }
    );
}
