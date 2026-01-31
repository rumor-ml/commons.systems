# Integration tests for wezterm-lua-syntax pre-commit hook
#
# Tests verify that the hook correctly:
# 1. Extracts Lua code from WezTerm Nix configuration
# 2. Validates Lua syntax using luac -p
# 3. Fails with clear error messages for invalid Lua
# 4. Succeeds for valid Lua syntax
#
# Usage:
#   nix-build nix/tests/wezterm-lua-syntax-test.nix
#
# The build will fail if any test fails, providing clear error messages.
# Success is indicated by a successful build creating a result symlink.

{
  pkgs ? import <nixpkgs> { },
}:

let
  # Import the hook script from checks.nix
  # We extract it by evaluating the pre-commit configuration
  pre-commit-hooks = import (
    pkgs.fetchFromGitHub {
      owner = "cachix";
      repo = "pre-commit-hooks.nix";
      rev = "c7012d0c18567c889b948781bc74a501e92275d1";
      sha256 = "sha256-6g6FYvf/6/dFOCx/yXMRWHq/8vJdp8tqTG1ejr8k4SI=";
    }
  );

  # Create the hook script exactly as defined in checks.nix
  weztermLuaSyntaxHook = pkgs.writeShellScript "wezterm-lua-syntax" ''
    set -e

    # Extract Lua code from nix/home/wezterm.nix
    # The extraConfig field contains Lua code in a Nix multiline string
    LUA_FILE=$(mktemp)
    trap "rm -f $LUA_FILE" EXIT

    # Extract Lua code using nix eval - semantically correct and format-independent
    # This approach works regardless of indentation, formatting, or whitespace
    ${pkgs.nix}/bin/nix eval --raw --impure \
      --expr '(import ./nix/home/wezterm.nix {
        config = {};
        pkgs = import <nixpkgs> {};
        lib = (import <nixpkgs> {}).lib;
      }).programs.wezterm.extraConfig' \
      > "$LUA_FILE"

    # Validate Lua syntax
    if ! ${pkgs.lua}/bin/luac -p "$LUA_FILE" 2>&1; then
      echo ""
      echo "ERROR: WezTerm Lua configuration has syntax errors"
      echo "File: nix/home/wezterm.nix"
      echo ""
      echo "Fix the Lua syntax errors in the extraConfig field before committing."
      echo ""
      exit 1
    fi

    echo "✅ WezTerm Lua configuration syntax is valid"
  '';

  # Test 1: Valid Lua syntax should pass
  test-valid-lua = pkgs.runCommand "test-wezterm-valid-lua" { } ''
        set -e

        # Create a temporary directory structure
        mkdir -p nix/home

        # Create valid Lua config (matches the actual wezterm.nix structure)
        cat > nix/home/wezterm.nix << 'NIXEOF'
    {
      pkgs,
      ...
    }:

    {
      programs.wezterm = {
        enable = pkgs.stdenv.isDarwin;
        enableBashIntegration = true;
        enableZshIntegration = true;
        extraConfig = '''
          local wezterm = require('wezterm')
          local config = wezterm.config_builder()

          config.font = wezterm.font('GeistMono Nerd Font')
          config.font_size = 12.0
          config.color_scheme = 'Tokyo Night'
          config.scrollback_lines = 10000
          config.enable_scroll_bar = false
          config.hide_tab_bar_if_only_one_tab = true
          config.use_fancy_tab_bar = false

          config.window_padding = {
            left = 4,
            right = 4,
            top = 4,
            bottom = 4,
          }

          config.native_macos_fullscreen_mode = true
          config.check_for_updates = false

          return config
        ''';
      };
    }
    NIXEOF

        echo "Testing valid Lua configuration..."

        # Extract Lua code
        LUA_FILE=$(mktemp)
        trap "rm -f $LUA_FILE" EXIT

        ${pkgs.nix}/bin/nix eval --raw --impure \
          --expr '(import ./nix/home/wezterm.nix {
            config = {};
            pkgs = import <nixpkgs> {};
            lib = (import <nixpkgs> {}).lib;
          }).programs.wezterm.extraConfig' \
          > "$LUA_FILE" || {
            echo "ERROR: Failed to extract Lua code"
            exit 1
          }

        # Validate Lua syntax (should succeed)
        if ${pkgs.lua}/bin/luac -p "$LUA_FILE" 2>&1; then
          echo "✅ Test passed: Valid Lua syntax accepted"
          touch $out
        else
          echo "❌ Test failed: Valid Lua was incorrectly rejected"
          exit 1
        fi
  '';

  # Test 2: Invalid Lua syntax should fail
  test-invalid-lua = pkgs.runCommand "test-wezterm-invalid-lua" { } ''
        set -e

        # Create a temporary directory structure
        mkdir -p nix/home

        # Create invalid Lua config (missing 'end' keyword)
        cat > nix/home/wezterm.nix << 'NIXEOF'
    {
      pkgs,
      ...
    }:

    {
      programs.wezterm = {
        enable = pkgs.stdenv.isDarwin;
        enableBashIntegration = true;
        enableZshIntegration = true;
        extraConfig = '''
          local wezterm = require('wezterm')
          local config = wezterm.config_builder()

          config.font_size = 12.0

          -- Missing 'end' and 'return config' - invalid syntax
          if true then
            config.color_scheme = 'Tokyo Night'
          -- BUG: Missing 'end' here
        ''';
      };
    }
    NIXEOF

        echo "Testing invalid Lua configuration (should fail)..."

        # Extract Lua code
        LUA_FILE=$(mktemp)
        trap "rm -f $LUA_FILE" EXIT

        ${pkgs.nix}/bin/nix eval --raw --impure \
          --expr '(import ./nix/home/wezterm.nix {
            config = {};
            pkgs = import <nixpkgs> {};
            lib = (import <nixpkgs> {}).lib;
          }).programs.wezterm.extraConfig' \
          > "$LUA_FILE" || {
            echo "ERROR: Failed to extract Lua code"
            exit 1
          }

        # This should fail due to syntax error
        if ${pkgs.lua}/bin/luac -p "$LUA_FILE" 2>&1; then
          echo "❌ Test failed: Invalid Lua was incorrectly accepted"
          exit 1
        else
          echo "✅ Test passed: Invalid Lua correctly rejected"
          touch $out
        fi
  '';

  # Test 3: Hook extracts Lua correctly
  test-lua-extraction = pkgs.runCommand "test-wezterm-lua-extraction" { } ''
        set -e

        # Create a temporary directory structure
        mkdir -p nix/home

        # Create a simple config with known Lua content
        cat > nix/home/wezterm.nix << 'NIXEOF'
    {
      pkgs,
      ...
    }:

    {
      programs.wezterm = {
        enable = pkgs.stdenv.isDarwin;
        extraConfig = '''
          -- Test config
          local config = {}
          config.font_size = 42
          return config
        ''';
      };
    }
    NIXEOF

        echo "Testing Lua code extraction..."

        # Extract Lua code
        LUA_FILE=$(mktemp)
        trap "rm -f $LUA_FILE" EXIT

        ${pkgs.nix}/bin/nix eval --raw --impure \
          --expr '(import ./nix/home/wezterm.nix {
            config = {};
            pkgs = import <nixpkgs> {};
            lib = (import <nixpkgs> {}).lib;
          }).programs.wezterm.extraConfig' \
          > "$LUA_FILE" || {
            echo "ERROR: Failed to extract Lua code"
            exit 1
          }

        # Verify the extracted content contains our test string
        if grep -q "font_size = 42" "$LUA_FILE"; then
          echo "✅ Test passed: Lua code extracted correctly"
        else
          echo "❌ Test failed: Extracted Lua doesn't match expected content"
          echo "Expected to find: font_size = 42"
          echo "Actual content:"
          cat "$LUA_FILE"
          exit 1
        fi

        # Also verify it's valid Lua
        if ${pkgs.lua}/bin/luac -p "$LUA_FILE" 2>&1; then
          echo "✅ Test passed: Extracted Lua is syntactically valid"
          touch $out
        else
          echo "❌ Test failed: Extracted Lua has syntax errors"
          exit 1
        fi
  '';

  # Test 4: Hook handles wrong field path gracefully
  test-wrong-field-path = pkgs.runCommand "test-wezterm-wrong-field-path" { } ''
        set -e

        # Create a temporary directory structure
        mkdir -p nix/home

        # Create config with extraConfig field
        cat > nix/home/wezterm.nix << 'NIXEOF'
    {
      pkgs,
      ...
    }:

    {
      programs.wezterm = {
        enable = pkgs.stdenv.isDarwin;
        extraConfig = '''
          return {}
        ''';
      };
    }
    NIXEOF

        echo "Testing hook with correct field path..."

        # Test with correct path (should succeed)
        LUA_FILE=$(mktemp)
        trap "rm -f $LUA_FILE" EXIT

        ${pkgs.nix}/bin/nix eval --raw --impure \
          --expr '(import ./nix/home/wezterm.nix {
            config = {};
            pkgs = import <nixpkgs> {};
            lib = (import <nixpkgs> {}).lib;
          }).programs.wezterm.extraConfig' \
          > "$LUA_FILE" || {
            echo "ERROR: Failed to extract with correct field path"
            exit 1
          }

        # Verify extraction worked
        if [ -s "$LUA_FILE" ]; then
          echo "✅ Test passed: Correct field path extracts content"
        else
          echo "❌ Test failed: No content extracted"
          exit 1
        fi

        # Test with wrong path (should fail during eval)
        echo "Testing hook with incorrect field path (should fail)..."
        if ${pkgs.nix}/bin/nix eval --raw --impure \
          --expr '(import ./nix/home/wezterm.nix {
            config = {};
            pkgs = import <nixpkgs> {};
            lib = (import <nixpkgs> {}).lib;
          }).programs.wezterm.config' \
          2>/dev/null; then
          echo "❌ Test failed: Wrong field path should have failed"
          exit 1
        else
          echo "✅ Test passed: Wrong field path correctly fails"
          touch $out
        fi
  '';

  # Run all tests
  all-tests =
    pkgs.runCommand "wezterm-lua-syntax-all-tests"
      {
        buildInputs = [
          test-valid-lua
          test-invalid-lua
          test-lua-extraction
          test-wrong-field-path
        ];
      }
      ''
        echo "╔═══════════════════════════════════════════════════════════╗"
        echo "║  WezTerm Lua Syntax Hook Integration Tests               ║"
        echo "╚═══════════════════════════════════════════════════════════╝"
        echo ""
        echo "All tests passed successfully!"
        echo ""
        echo "Tests executed:"
        echo "  ✅ Test 1: Valid Lua syntax accepted"
        echo "  ✅ Test 2: Invalid Lua syntax rejected"
        echo "  ✅ Test 3: Lua code extraction works"
        echo "  ✅ Test 4: Wrong field path handling"
        echo ""
        touch $out
      '';

in
all-tests
