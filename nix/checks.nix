# nix/checks.nix
# Pre-commit hooks configuration
#
# This module defines code quality checks that run:
# 1. Automatically on git commit (via pre-commit hooks)
# 2. Via `nix flake check` in CI
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
      excludes = [ "^scaffolding/" ];
    };

    end-of-file-fixer = {
      enable = true;
      name = "end-of-file-fixer";
      description = "Ensure files end with newline";
      excludes = [ "^scaffolding/" ];
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

    # === TypeScript Build Checks ===
    # Verify TypeScript MCP servers build successfully
    # Note: Can be enabled for stricter pre-commit checking, but may slow down commits
    # For now, run manually with: ./infrastructure/scripts/build-mcp-servers.sh
    # Or enable by setting enable = true below
    typescript-build = {
      enable = false;
      name = "typescript-build";
      description = "Build TypeScript MCP servers to catch compilation errors";
      entry = "./infrastructure/scripts/build-mcp-servers.sh";
      language = "system";
      files = "\\.(ts|json)$";
      pass_filenames = false;
    };

    # === Pre-Push Hooks ===
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
  };
}
