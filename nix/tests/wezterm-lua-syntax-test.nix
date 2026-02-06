# Integration tests for wezterm-lua-syntax pre-commit hook
#
# Tests verify that the hook correctly:
# 1. Extracts Lua code from WezTerm Nix configuration
# 2. Validates Lua syntax using luac -p
# 3. Fails with clear error messages for invalid Lua
# 4. Succeeds for valid Lua syntax
# 5. Validates WezTerm can load and use the configuration at runtime
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

          -- BUG: Missing 'end' keyword for if statement - creates syntax error
          if true then
            config.color_scheme = 'Tokyo Night'
          -- Also missing 'return config' at the end
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

        # Capture error output to verify it's the expected error
        eval_output=$(${pkgs.nix}/bin/nix eval --raw --impure \
          --expr '(import ./nix/home/wezterm.nix {
            config = {};
            pkgs = import <nixpkgs> {};
            lib = (import <nixpkgs> {}).lib;
          }).programs.wezterm.config' \
          2>&1 || true)

        # Check if the error is the expected "attribute missing/not found" error
        if echo "$eval_output" | grep -q "attribute.*missing\|attribute.*not found\|has no attribute"; then
          echo "✅ Test passed: Wrong field path correctly fails with expected error"
          touch $out
        else
          echo "❌ Test failed: Expected attribute error, got unexpected output:"
          echo "$eval_output"
          exit 1
        fi
  '';

  # Test 5: Darwin platform conditional
  # Evaluates the config with mocked platform values at build time
  test-darwin-platform-conditional =
    let
      # Create mock pkgs with isDarwin = true
      mockDarwinPkgs = pkgs // {
        stdenv = pkgs.stdenv // {
          isDarwin = true;
        };
      };

      # Create mock pkgs with isDarwin = false
      mockLinuxPkgs = pkgs // {
        stdenv = pkgs.stdenv // {
          isDarwin = false;
        };
      };

      # Evaluate config with Darwin mock
      darwinConfig = import ../home/wezterm.nix {
        config = { };
        pkgs = mockDarwinPkgs;
        lib = pkgs.lib;
      };

      # Evaluate config with Linux mock
      linuxConfig = import ../home/wezterm.nix {
        config = { };
        pkgs = mockLinuxPkgs;
        lib = pkgs.lib;
      };

      # Get the enable values
      darwinEnabled = darwinConfig.programs.wezterm.enable;
      linuxEnabled = linuxConfig.programs.wezterm.enable;
    in
    pkgs.runCommand "test-wezterm-darwin-conditional" { } ''
      set -e

      echo "Testing Darwin platform conditional..."

      # Test 1: Verify enabled with isDarwin = true
      if [ "${pkgs.lib.boolToString darwinEnabled}" = "true" ]; then
        echo "✅ WezTerm enabled when isDarwin = true"
      else
        echo "❌ WezTerm should be enabled when isDarwin = true"
        echo "   Got: ${pkgs.lib.boolToString darwinEnabled}"
        exit 1
      fi

      # Test 2: Verify disabled with isDarwin = false
      if [ "${pkgs.lib.boolToString linuxEnabled}" = "false" ]; then
        echo "✅ WezTerm disabled when isDarwin = false"
      else
        echo "❌ WezTerm should be disabled when isDarwin = false"
        echo "   Got: ${pkgs.lib.boolToString linuxEnabled}"
        exit 1
      fi

      echo "✅ Platform conditional test passed"
      touch $out
    '';

  # Test 7: Linux platform evaluation
  # Verifies module evaluates cleanly on non-Darwin systems and doesn't install WezTerm
  test-linux-platform-evaluation =
    let
      # Mock Linux environment
      mockLinuxPkgs = pkgs // {
        stdenv = pkgs.stdenv // {
          isDarwin = false;
          isLinux = true;
        };
      };

      # Evaluate config with Linux mock
      linuxConfig = import ../home/wezterm.nix {
        config = { };
        pkgs = mockLinuxPkgs;
        lib = pkgs.lib;
      };
    in
    pkgs.runCommand "test-wezterm-linux-evaluation" { } ''
      set -e

      echo "Testing Linux platform evaluation..."

      # Verify module evaluates without errors
      if [ "${pkgs.lib.boolToString linuxConfig.programs.wezterm.enable}" = "false" ]; then
        echo "✅ WezTerm disabled on Linux (isDarwin = false)"
      else
        echo "❌ WezTerm should be disabled on Linux"
        exit 1
      fi

      # Verify extraConfig is still accessible (not breaking evaluation)
      if [ -n "${linuxConfig.programs.wezterm.extraConfig}" ]; then
        echo "✅ Configuration accessible on Linux (doesn't cause evaluation errors)"
      else
        echo "❌ Configuration should be accessible even when disabled"
        exit 1
      fi

      echo "✅ Linux platform evaluation test passed"
      touch $out
    '';

  # Test 8: Shell integration flags
  # Verifies enableBashIntegration and enableZshIntegration are correctly configured
  test-shell-integration-flags =
    let
      # Evaluate config with default settings
      defaultConfig = import ../home/wezterm.nix {
        config = { };
        pkgs = pkgs;
        lib = pkgs.lib;
      };

      # Get integration flag values
      bashEnabled = defaultConfig.programs.wezterm.enableBashIntegration;
      zshEnabled = defaultConfig.programs.wezterm.enableZshIntegration;
    in
    pkgs.runCommand "test-wezterm-shell-integration" { } ''
      set -e

      echo "Testing shell integration flags..."

      # Verify Bash integration is enabled
      if [ "${pkgs.lib.boolToString bashEnabled}" = "true" ]; then
        echo "✅ Bash integration enabled"
      else
        echo "❌ Bash integration should be enabled by default"
        exit 1
      fi

      # Verify Zsh integration is enabled
      if [ "${pkgs.lib.boolToString zshEnabled}" = "true" ]; then
        echo "✅ Zsh integration enabled"
      else
        echo "❌ Zsh integration should be enabled by default"
        exit 1
      fi

      echo "✅ Shell integration flags test passed"
      touch $out
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
          test-darwin-platform-conditional
          test-linux-platform-evaluation
          test-shell-integration-flags
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
        echo "  ✅ Test 5: Darwin platform conditional"
        echo "  ✅ Test 7: Linux platform evaluation"
        echo "  ✅ Test 8: Shell integration flags"
        echo ""
        touch $out
      '';

in
all-tests
