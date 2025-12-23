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

    # Disabled: govet requires access to Go module dependencies at runtime.
    # Nix pre-commit hooks run in a pure sandbox without access to downloaded dependencies.
    #
    # Technical challenges with sandbox execution:
    # - Would require packaging all transitive Go dependencies in Nix derivation
    # - Dependency resolution must handle replace directives, local paths, and vendoring
    # - Significantly slows every commit (must rebuild/fetch all Go deps)
    # - Breaks incremental development workflow expectations
    #
    # Current approach: govet runs in CI where dependencies are already available.
    # For local validation before push: cd <go-project> && go vet ./...
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
    # Note: Checks ALL tracked files (not just changed) to prevent CI failures from
    # formatting drift in files outside the current changeset
    # --ignore-unknown prevents errors on unrecognized file types in the glob pattern
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

        # Verify we're in a git repository
        if ! git rev-parse --git-dir > /dev/null 2>&1; then
          echo "ERROR: Not in a git repository"
          exit 1
        fi

        # Verify origin/main exists
        if ! git rev-parse --verify origin/main > /dev/null 2>&1; then
          echo "ERROR: Remote branch 'origin/main' not found"
          echo "Please fetch from origin: git fetch origin"
          exit 1
        fi

        # Get list of changed files between main and current branch
        CHANGED_FILES=$(git diff --name-only origin/main...HEAD) || {
          echo "ERROR: Failed to determine changed files"
          echo "This may indicate repository corruption or detached HEAD state"
          exit 1
        }

        # Check if any MCP server directories were modified
        # Future: Add mcp-common/ to this pattern when issue #265 is implemented
        if echo "$CHANGED_FILES" | grep -qE "(gh-issue-mcp-server|gh-workflow-mcp-server|wiggum-mcp-server|git-mcp-server)/"; then
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

    # Run npm tests for MCP servers when their files change
    # Ensures tests pass before push (complements mcp-nix-build which validates builds)
    mcp-npm-test = {
      enable = true;
      name = "mcp-npm-test";
      description = "Run tests for changed MCP servers";
      entry = "${pkgs.writeShellScript "mcp-npm-test" ''
        set -e

        # Verify we're in a git repository
        if ! git rev-parse --git-dir > /dev/null 2>&1; then
          echo "ERROR: Not in a git repository"
          exit 1
        fi

        # Verify origin/main exists
        if ! git rev-parse --verify origin/main > /dev/null 2>&1; then
          echo "ERROR: Remote branch 'origin/main' not found"
          echo "Please fetch from origin: git fetch origin"
          exit 1
        fi

        # Get list of changed files between main and current branch
        CHANGED_FILES=$(git diff --name-only origin/main...HEAD) || {
          echo "ERROR: Failed to determine changed files"
          echo "This may indicate repository corruption or detached HEAD state"
          exit 1
        }

        # Define MCP servers to test
        MCP_SERVERS=(wiggum-mcp-server gh-workflow-mcp-server gh-issue-mcp-server git-mcp-server)
        FAILED=0

        for server in "''${MCP_SERVERS[@]}"; do
          if echo "$CHANGED_FILES" | grep -q "^$server/"; then
            echo "Running tests for $server..."
            if ! (cd "$server" && npm test); then
              echo "FAIL: Tests failed for $server"
              FAILED=1
            fi
          fi
        done

        if [ $FAILED -eq 1 ]; then
          echo ""
          echo "ERROR: MCP server tests failed"
          echo "Fix the failing tests before pushing."
          exit 1
        fi

        # Check if any MCP servers were tested
        TESTED=0
        for server in "''${MCP_SERVERS[@]}"; do
          if echo "$CHANGED_FILES" | grep -q "^$server/"; then
            TESTED=1
            break
          fi
        done

        if [ $TESTED -eq 0 ]; then
          echo "No MCP server changes detected, skipping tests."
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

        # Verify we're in a git repository
        if ! git rev-parse --git-dir > /dev/null 2>&1; then
          echo "ERROR: Not in a git repository"
          exit 1
        fi

        # Verify origin/main exists
        if ! git rev-parse --verify origin/main > /dev/null 2>&1; then
          echo "ERROR: Remote branch 'origin/main' not found"
          echo "Please fetch from origin: git fetch origin"
          exit 1
        fi

        # Check if any pnpm-related files changed
        CHANGED_FILES=$(git diff --name-only origin/main...HEAD) || {
          echo "ERROR: Failed to determine changed files"
          echo "This may indicate repository corruption or detached HEAD state"
          exit 1
        }

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
