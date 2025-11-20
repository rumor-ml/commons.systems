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
          config = {
            allowUnfree = true;
          };
        };

        # Common tools used across development and CI
        commonTools = with pkgs; [
          # GCP tools
          google-cloud-sdk

          # GitHub CLI
          gh

          # Node.js and package managers
          nodejs  # Standard nodejs package with good binary cache coverage
          nodePackages.npm

          # Infrastructure as Code
          terraform

          # Shell utilities
          bash
          coreutils
          git
          jq
          curl
        ];

        # Fellspiral site package
        fellspiral-site = pkgs.buildNpmPackage rec {
          pname = "fellspiral-site";
          version = "1.0.0";

          src = ./.;

          npmDepsHash = pkgs.lib.fakeSha256;  # Replace with actual hash after first build

          # Build only the site workspace
          buildPhase = ''
            npm run build --workspace=fellspiral/site
          '';

          installPhase = ''
            mkdir -p $out
            cp -r fellspiral/site/dist/* $out/
          '';

          meta = with pkgs.lib; {
            description = "Fellspiral static website";
            license = licenses.mit;
          };
        };

        # Development shell with all tools
        devShell = pkgs.mkShell {
          buildInputs = commonTools;

          shellHook = ''
            echo "🚀 Fellspiral development environment loaded"
            echo ""
            echo "Available tools:"
            echo "  - gcloud (Google Cloud SDK)"
            echo "  - gh (GitHub CLI)"
            echo "  - node v$(node --version)"
            echo "  - npm v$(npm --version)"
            echo "  - terraform v$(terraform version -json | jq -r .terraform_version)"
            echo ""

            # Set up Playwright - use writable cache directory
            export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
            export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true

            # Ensure npm install works properly
            export npm_config_cache="$PWD/.npm-cache"

            # Make scripts executable if they aren't already
            if [ -f infrastructure/scripts/setup-workload-identity.sh ]; then
              chmod +x infrastructure/scripts/*.sh
            fi

            # Auto-install npm dependencies if needed
            # Note: In future, this will be replaced by Nix-managed dependencies
            if [ ! -d "node_modules" ]; then
              echo "📦 Installing npm dependencies..."
              npm install
              echo "✅ Dependencies installed"
              echo ""
            fi

            echo "Quick start:"
            echo "  1. Run setup: cd infrastructure/scripts && ./setup-workload-identity.sh"
            echo "  2. Run dev server: npm run dev"
            echo "  3. Run tests: npm test"
            echo "  4. Build with Nix: nix build .#fellspiral-site"
            echo ""
          '';

          # Environment variables
          NIXPKGS_ALLOW_UNFREE = "1";
        };

        # CI shell with same tools but no interactive features
        ciShell = pkgs.mkShell {
          buildInputs = commonTools;

          shellHook = ''
            # Set up Playwright - use environment variable if set, otherwise use default writable path
            if [ -z "$PLAYWRIGHT_BROWSERS_PATH" ]; then
              export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
            fi
            export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true

            # Ensure npm install works properly
            export npm_config_cache="$PWD/.npm-cache"
          '';

          NIXPKGS_ALLOW_UNFREE = "1";
        };

      in
      {
        packages = {
          default = fellspiral-site;
          fellspiral-site = fellspiral-site;
        };

        devShells = {
          default = devShell;
          ci = ciShell;
        };

        # Make common tools available as app
        apps.build = {
          type = "app";
          program = "${pkgs.writeShellScript "build" ''
            ${pkgs.nodejs}/bin/npm run build
          ''}";
        };
      }
    );
}
