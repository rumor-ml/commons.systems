# nix/checks.nix
# Git hooks configuration (pre-commit and pre-push)
#
# This module defines code quality checks that run:
# 1. Automatically on git commit (via pre-commit hooks)
# 2. Automatically on git push (via pre-push hooks)
# 3. Via `nix flake check` in CI
#
# Hooks are organized by language and purpose.
{
  pkgs,
  pre-commit-hooks,
  src,
}:

pre-commit-hooks.lib.${pkgs.system}.run {
  inherit src;

  # Global excludes for all hooks
  excludes = [
    "^190-.*/"
    "^scaffolding/"
  ];

  hooks = {
    # === Go Hooks ===
    gofmt = {
      enable = true;
      name = "gofmt";
      description = "Format Go code";
    };

    # Disabled: govet requires go.mod dependencies which aren't available in Nix sandbox
    # This is a structural limitation - consider running govet in CI instead
    # govet = {
    #   enable = true;
    #   name = "govet";
    #   description = "Go static analysis";
    # };

    # === TypeScript/JavaScript Hooks ===
    prettier = {
      enable = true;
      name = "prettier";
      description = "Format TypeScript/JavaScript/CSS/JSON";
    };

    # === Templ Hooks ===
    # Disabled: templ fmt requires Go to be in PATH which isn't available in Nix sandbox
    # templ-fmt = {
    #   enable = true;
    #   name = "templ-fmt";
    #   entry = "${pkgs.templ}/bin/templ fmt";
    #   files = "\\.templ$";
    #   pass_filenames = true;
    # };

    # === General Quality Hooks ===
    trim-trailing-whitespace = {
      enable = true;
      name = "trailing-whitespace";
      description = "Remove trailing whitespace";
    };

    end-of-file-fixer = {
      enable = true;
      name = "end-of-file-fixer";
      description = "Ensure files end with newline";
    };

    check-yaml = {
      enable = true;
      name = "check-yaml";
      description = "Validate YAML syntax";
    };

    check-json = {
      enable = true;
      name = "check-json";
      description = "Validate JSON syntax";
    };

    # === Nix Hooks ===
    nixfmt-rfc-style = {
      enable = true;
      name = "nixfmt";
      description = "Format Nix files";
    };

    # === Pre-Push Hooks ===
    # Validate all TypeScript/JavaScript/JSON/Markdown files are formatted before push
    # This catches pre-existing formatting violations that nix flake check would find
    prettier-check-all = {
      enable = true;
      name = "prettier-check-all";
      description = "Validate all tracked files are formatted (prevents CI failures)";
      entry = "${pkgs.prettier}/bin/prettier --check --ignore-unknown '**/*.{ts,tsx,js,jsx,json,md,yaml,yml}'";
      language = "system";
      stages = [ "pre-push" ];
      pass_filenames = false;
      always_run = true;
    };

    # Run tests before allowing push
    pre-push-tests = {
      enable = true;
      name = "pre-push-tests";
      description = "Run tests on changed apps before push";
      entry = "./infrastructure/scripts/run-all-local-tests.sh --changed-only";
      language = "system";
      stages = [ "pre-push" ];
      pass_filenames = false;
      always_run = true;
    };

    # Build MCP servers when their files change
    # Runs infrastructure/scripts/build-mcp-servers.sh which validates:
    # - npm build succeeds (TypeScript compilation)
    # - Nix build succeeds (dependency hashes and git-tracked files)
    # Only runs when MCP server files are modified.
    mcp-nix-build = {
      enable = true;
      name = "mcp-nix-build";
      description = "Build MCP servers when their files change";
      entry = "${pkgs.writeShellScript "mcp-nix-build" ''
        set -e

        # Get list of changed files between main and current branch
        CHANGED_FILES=$(git diff --name-only origin/main...HEAD 2>/dev/null || echo "")

        # Check if any MCP server directories were modified
        # Note: mcp-common/ will be added in issue #265 (shared error handling package)
        if echo "$CHANGED_FILES" | grep -qE "(gh-issue-mcp-server|gh-workflow-mcp-server|wiggum-mcp-server|git-mcp-server|mcp-common)/"; then
          echo "MCP server files changed, running Nix build validation..."
          ./infrastructure/scripts/build-mcp-servers.sh
        else
          echo "No MCP server changes detected, skipping Nix build."
        fi
      ''}";
      language = "system";
      stages = [ "pre-push" ];
      pass_filenames = false;
      always_run = true;
    };

    # Validate pnpm lockfile consistency
    # Prevents CI failures from lockfile mismatches (CI runs pnpm install --frozen-lockfile which fails if out of sync)
    pnpm-lockfile-check = {
      enable = true;
      name = "pnpm-lockfile-check";
      description = "Validate pnpm lockfile matches package.json files";
      entry = "${pkgs.writeShellScript "pnpm-lockfile-check" ''
        set -e

        # Check if any pnpm-related files changed
        CHANGED_FILES=$(git diff --name-only origin/main...HEAD 2>/dev/null || echo "")

        if echo "$CHANGED_FILES" | grep -qE "(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)"; then
          echo "Package files changed, validating lockfile consistency..."

          # Use --frozen-lockfile to fail if lockfile doesn't match package.json
          # Use --prefer-offline to avoid network calls and use local cache for speed
          if ! ${pkgs.pnpm}/bin/pnpm install --frozen-lockfile --prefer-offline > /dev/null 2>&1; then
            echo ""
            echo "ERROR: pnpm lockfile is out of sync with package.json files"
            echo ""
            echo "This means pnpm-lock.yaml doesn't match the dependencies declared in package.json."
            echo "This check prevents CI failures from lockfile mismatches."
            echo ""
            echo "To fix this issue:"
            echo "  1. Run: pnpm install"
            echo "  2. Review the changes to pnpm-lock.yaml"
            echo "  3. Stage the updated lockfile: git add pnpm-lock.yaml"
            echo "  4. Retry your push"
            echo ""
            exit 1
          fi

          echo "Lockfile is consistent with package.json files"
        else
          echo "No package files changed, skipping lockfile validation."
        fi
      ''}";
      language = "system";
      stages = [ "pre-push" ];
      pass_filenames = false;
      always_run = true;
    };
  };
}
