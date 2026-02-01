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

    # === WezTerm Lua Validation ===
    # Validates Lua syntax in WezTerm configuration to catch errors before runtime
    # Uses luac -p (parse-only mode) to check syntax without executing the code
    # Limitations:
    # - Only validates Lua syntax, not WezTerm-specific API semantics
    # - Does not verify fonts or color schemes are available
    # - Does not test runtime behavior or configuration correctness
    # Integration tests: nix/tests/wezterm-lua-syntax-test.nix (runs via nix flake check)
    wezterm-lua-syntax = {
      enable = true;
      name = "wezterm-lua-syntax";
      description = "Validate WezTerm Lua configuration syntax";
      entry = "${pkgs.writeShellScript "wezterm-lua-syntax" ''
        set -e

        # Extract Lua code from nix/home/wezterm.nix
        # The extraConfig field contains Lua code in a Nix indented string (double-single-quote delimiter)
        LUA_FILE=$(mktemp)
        trap "rm -f $LUA_FILE" EXIT

        # Extract Lua code using nix eval - the only reliable way to extract from Nix strings
        # This approach evaluates the Nix expression to get the exact Lua code.
        # Alternative approaches like grep/sed/awk would fail with:
        # - Nix string interpolation: extraConfig = "font_size = ${toString 12}"
        # - Indented strings with custom indentation handling
        # - Escaped characters in multiline strings
        if ! NIX_OUTPUT=$(${pkgs.nix}/bin/nix eval --raw --impure \
          --expr '(import ./nix/home/wezterm.nix {
            config = {};
            pkgs = import <nixpkgs> {};
            lib = (import <nixpkgs> {}).lib;
          }).programs.wezterm.extraConfig' \
          2>&1); then
          echo ""
          echo "ERROR: Failed to extract Lua code from WezTerm Nix configuration"
          echo "File: nix/home/wezterm.nix"
          echo ""
          echo "Nix evaluation error:"
          echo "$NIX_OUTPUT"
          echo ""
          echo "Fix the Nix configuration errors before committing."
          echo ""
          exit 1
        fi

        echo "$NIX_OUTPUT" > "$LUA_FILE"

        # Validate Lua syntax and capture output
        LUA_ERRORS=$(${pkgs.lua}/bin/luac -p "$LUA_FILE" 2>&1) || {
          echo ""
          echo "ERROR: WezTerm Lua configuration has syntax errors"
          echo "File: nix/home/wezterm.nix (extraConfig field)"
          echo ""
          echo "Lua syntax validation failed with:"
          echo "$LUA_ERRORS"
          echo ""
          echo "Fix the Lua syntax errors in the extraConfig field before committing."
          echo ""
          exit 1
        }

        echo "✅ WezTerm Lua configuration syntax is valid"
      ''}";
      language = "system";
      files = "nix/home/wezterm\\.nix$";
      pass_filenames = false;
    };

    # === Nix Hooks ===
    nixfmt-rfc-style = {
      enable = true;
      name = "nixfmt";
      description = "Format Nix files";
    };

    # === Pre-Push Hooks ===
    # Check for console.log statements in source code before push
    # This catches debug statements that would fail CI
    # Matches the exact check that CI performs in run-local-tests.sh
    no-console-log = {
      enable = true;
      name = "no-console-log";
      description = "Check for console.log statements in source code";
      entry = "${pkgs.writeShellScript "no-console-log" ''
        set -e
        FOUND_LOGS=0

        for site in fellspiral videobrowser audiobrowser print; do
          if [ -d "$site/site/src" ]; then
            # TODO(#1749): Grep errors silently ignored in no-console-log hook
            if grep -r "console\.log" "$site/site/src/" 2>/dev/null; then
              FOUND_LOGS=1
            fi
          fi
        done

        if [ $FOUND_LOGS -eq 1 ]; then
          echo ""
          echo "❌ Found console.log statements in source code"
          echo "Please remove all console.log statements before pushing"
          echo ""
          exit 1
        fi

        echo "✅ No console.log statements found"
      ''}";
      language = "system";
      stages = [ "pre-push" ];
      pass_filenames = false;
      always_run = true;
    };

    # Validate all TypeScript/JavaScript/JSON/Markdown files are formatted before push
    # This catches pre-existing formatting violations that nix flake check would find
    # Note: Checks ALL tracked files (not just changed) to prevent CI failures from
    # formatting drift in files outside the current changeset
    # --ignore-unknown prevents errors on unrecognized file types in the glob pattern
    prettier-check-all = {
      enable = true;
      name = "prettier-check-all";
      description = "Validate all tracked files are formatted (prevents CI failures)";
      entry = "${pkgs.prettier}/bin/prettier --check --ignore-unknown '**/*.{ts,tsx,js,jsx,json,md,yaml,yml,html,css}'";
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
      entry = "${pkgs.bash}/bin/bash ./infrastructure/scripts/run-all-local-tests.sh --changed-only";
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

        # TODO(#1727): Duplicate direnv comment pattern in checks.nix
        # TODO(#1732): Silent fallback to wrong Node.js in pre-commit hook when direnv fails
        # Load direnv environment to ensure Nix Node.js is used instead of Homebrew
        # This prevents ICU4c library version conflicts on macOS
        eval "$(${pkgs.direnv}/bin/direnv export bash 2>/dev/null)" || true

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
          # Use --ignore-scripts to avoid hanging on postinstall scripts (e.g., playwright install)
          if ! ${pkgs.pnpm}/bin/pnpm install --frozen-lockfile --prefer-offline --ignore-scripts > /dev/null 2>&1; then
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

    # Validate Nix development shell loads successfully
    # Catches Nix syntax errors and evaluation failures before CI
    # Allows necessary builds during evaluation to ensure shell loads successfully
    # This catches common Nix issues like syntax errors, missing dependencies, and evaluation failures
    # May take longer (~30s) if builds are required, but ensures accurate validation
    nix-shell-check = {
      enable = true;
      name = "nix-shell-check";
      description = "Validate Nix development shell evaluation";
      entry = "${pkgs.writeShellScript "nix-shell-check" ''
        set -e

        echo "Validating Nix development shell..."

        # Check flake evaluation, allowing necessary builds
        # This ensures the development shell can actually load successfully
        if ! ${pkgs.nix}/bin/nix develop --command echo 'Development shell loads successfully' 2>&1 | grep -q 'Development shell loads successfully'; then
          echo ""
          echo "ERROR: Nix development shell failed to load"
          echo ""
          echo "This check validates that the Nix flake can be evaluated successfully."
          echo "It catches syntax errors, missing dependencies, and evaluation failures."
          echo ""
          echo "To fix this issue:"
          echo "  1. Run: nix develop"
          echo "  2. Review any error messages from Nix"
          echo "  3. Fix the issues in your Nix configuration"
          echo "  4. Retry your push"
          echo ""
          exit 1
        fi

        echo "✅ Nix development shell evaluation successful"
      ''}";
      language = "system";
      stages = [ "pre-push" ];
      pass_filenames = false;
      always_run = true;
    };

    # Validate Home Manager configuration builds
    # Catches Nix evaluation errors in Home Manager modules (including WezTerm) before push
    # Prevents CI failures from Nix syntax errors, invalid packages, or module option mistakes
    home-manager-build-check = {
      enable = true;
      name = "home-manager-build-check";
      description = "Validate Home Manager configuration builds";
      entry = "${pkgs.writeShellScript "home-manager-build-check" ''
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

        # Check if nix/home/ directory or flake.nix changed
        if echo "$CHANGED_FILES" | grep -qE "(nix/home/|flake\.nix)"; then
          echo "Home Manager configuration files changed, validating build..."

          # Validate Home Manager configuration builds
          BUILD_OUTPUT=$(${pkgs.nix}/bin/nix build .#homeConfigurations.aarch64-darwin.activationPackage --impure --no-link 2>&1) || {
            echo ""
            echo "ERROR: Home Manager configuration failed to build"
            echo ""
            echo "Build output:"
            echo "$BUILD_OUTPUT"
            echo "To fix this issue:"
            echo "  1. Review the Nix error messages above"
            echo "  2. Check nix/home/*.nix files for errors"
            echo "  3. Verify all packages exist and options are valid"
            echo "  4. Retry your push"
            echo ""
            exit 1
          }

          echo "✅ Home Manager configuration builds successfully"
        else
          echo "No Home Manager configuration changes detected, skipping build check."
        fi
      ''}";
      language = "system";
      stages = [ "pre-push" ];
      pass_filenames = false;
      always_run = true;
    };
  };
}
