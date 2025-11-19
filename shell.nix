# Legacy Nix shell configuration
# For users not using flakes, run: nix-shell

{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    # GCP tools
    google-cloud-sdk

    # GitHub CLI
    gh

    # Node.js and package managers
    nodejs_20
    nodePackages.npm

    # Infrastructure as Code
    terraform

    # Playwright dependencies
    playwright-driver.browsers

    # Shell utilities
    bash
    coreutils
    git

    # Utilities
    jq
    curl
  ];

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
    echo "Quick start:"
    echo "  1. Run setup: cd infrastructure/scripts && ./setup-workload-identity.sh"
    echo "  2. Install dependencies: npm install"
    echo "  3. Run tests: npm test"
    echo "  4. Deploy: cd infrastructure/scripts && ./deploy.sh"
    echo ""

    # Set up Playwright
    export PLAYWRIGHT_BROWSERS_PATH=${pkgs.playwright-driver.browsers}
    export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true

    # Ensure npm install works properly
    export npm_config_cache="$PWD/.npm-cache"

    # Make scripts executable
    if [ -f infrastructure/scripts/setup-workload-identity.sh ]; then
      chmod +x infrastructure/scripts/*.sh
    fi
  '';

  NIXPKGS_ALLOW_UNFREE = "1";
}
