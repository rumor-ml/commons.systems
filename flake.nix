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
          firebase-tools  # For Firebase Emulator Suite
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

            # Install Playwright browsers if needed (after pnpm install has made npx available)
            PLAYWRIGHT_CHROMIUM_DIR=$(find "$PLAYWRIGHT_BROWSERS_PATH" -maxdepth 1 -type d -name "chromium-*" 2>/dev/null | head -1)
            if [ -z "$PLAYWRIGHT_CHROMIUM_DIR" ]; then
              echo "Installing Playwright browsers..."
              npx playwright install chromium
            fi

            # Build tmux-tui if needed
            if [ -d "tmux-tui" ]; then
              if [ ! -f "tmux-tui/build/tmux-tui" ] || [ "tmux-tui/cmd/tmux-tui/main.go" -nt "tmux-tui/build/tmux-tui" ]; then
                echo "Building tmux-tui..."
                (cd tmux-tui && go build -ldflags "-s -w" -o build/tmux-tui ./cmd/tmux-tui 2>&1 | grep -v "^#" || true)
              fi
            fi

            # Build gh-workflow-mcp-server if needed
            if [ -d "gh-workflow-mcp-server" ]; then
              if [ ! -f "gh-workflow-mcp-server/dist/index.js" ] || [ "gh-workflow-mcp-server/src/index.ts" -nt "gh-workflow-mcp-server/dist/index.js" ]; then
                echo "Building gh-workflow-mcp-server..."
                (cd gh-workflow-mcp-server && npm run build 2>&1 || true)
              fi
            fi

            # tmux-tui configuration with stable default + dev override
            if [ -n "$TMUX" ] && [ -f "tmux-tui/tmux-tui.conf" ]; then
              # Default: use stable ~/commons.systems installation
              DEFAULT_TUI="$HOME/commons.systems/tmux-tui/scripts/spawn.sh"

              # Dev override: use local version if TMUX_TUI_DEV is set
              if [ -n "$TMUX_TUI_DEV" ] && [ -f "$PWD/tmux-tui/scripts/spawn.sh" ]; then
                SPAWN_SCRIPT="$PWD/tmux-tui/scripts/spawn.sh"
                echo "Using dev tmux-tui from: $PWD"
              elif [ -f "$DEFAULT_TUI" ]; then
                SPAWN_SCRIPT="$DEFAULT_TUI"
              else
                SPAWN_SCRIPT="$PWD/tmux-tui/scripts/spawn.sh"  # Fallback
              fi

              tmux set-environment -g TMUX_TUI_SPAWN_SCRIPT "$SPAWN_SCRIPT"

              # Load config from selected spawn script location (may differ from local tmux-tui/)
              if ! tmux show-hooks -g 2>/dev/null | grep -q "run-shell.*spawn.sh"; then
                TMUX_TUI_CONFIG="''${SPAWN_SCRIPT%/scripts/spawn.sh}/tmux-tui.conf"
                if [ -f "$TMUX_TUI_CONFIG" ]; then
                  echo "Loading tmux-tui configuration..."
                  tmux source-file "$TMUX_TUI_CONFIG"
                fi
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
