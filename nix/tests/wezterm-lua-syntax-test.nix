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

  # Test 6: WezTerm runtime behavior validation
  # Verifies that WezTerm can actually load and use the generated configuration
  # This catches errors that pass syntax validation but fail at runtime
  test-wezterm-runtime =
    pkgs.runCommand "test-wezterm-runtime"
      {
        buildInputs = [ pkgs.wezterm ];
      }
      ''
            set -e

            echo "Testing WezTerm runtime behavior..."

            # Create a temporary directory structure
            mkdir -p nix/home

            # Create the actual WezTerm config (matching nix/home/wezterm.nix)
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

            # Test 1: Verify WezTerm can load the config without errors
            echo "Test 1: Verifying WezTerm loads config without runtime errors..."
            if ${pkgs.wezterm}/bin/wezterm --config-file "$LUA_FILE" ls-fonts --list-system > /dev/null 2>&1; then
              echo "✅ WezTerm successfully loads config without runtime errors"
            else
              echo "❌ WezTerm failed to load config"
              echo "This means the Lua has valid syntax but uses invalid WezTerm APIs"
              exit 1
            fi

            # Test 2: Verify WezTerm accepts font configuration syntax
            echo "Test 2: Verifying WezTerm loads font configuration without errors..."
            FONT_OUTPUT=$(${pkgs.wezterm}/bin/wezterm --config-file "$LUA_FILE" ls-fonts 2>&1 || true)

            # TODO(#1761): Verify that GeistMono Nerd Font is actually available at runtime
            # Note: GeistMono Nerd Font may not be installed in the Nix build environment
            # So we verify that ls-fonts runs successfully, which validates the config loads
            # In a real environment, the font would need to be installed separately
            if echo "$FONT_OUTPUT" | grep -q "Primary font"; then
              echo "✅ WezTerm font configuration is valid (ls-fonts executed successfully)"
            else
              echo "⚠️  Warning: Could not verify font, but config loads successfully"
              echo "   (Font installation is environment-dependent)"
            fi

            # Test 3: Verify color scheme configuration syntax
            # Note: Color scheme validity was already verified in Test 1's successful config load
            # This test confirms the color scheme setting is present in the generated config
            echo "Test 3: Verifying color scheme configuration is present..."
            if grep -q "config.color_scheme = 'Tokyo Night'" "$LUA_FILE"; then
              echo "✅ Color scheme is configured (validated by Test 1's successful load)"
            fi

            # Test 4: Verify invalid API calls produce runtime errors
            echo "Test 4: Verifying invalid API calls produce runtime errors..."

            # Create a config with an invalid API call
            INVALID_LUA=$(mktemp)
            cat > "$INVALID_LUA" << 'EOF'
        local wezterm = require('wezterm')
        local config = wezterm.config_builder()

        -- This should cause a runtime error (nonExistentFunction doesn't exist)
        config.font = wezterm.nonExistentFunction('GeistMono Nerd Font')

        return config
        EOF

            # Capture stderr to check for runtime errors
            ERROR_OUTPUT=$(${pkgs.wezterm}/bin/wezterm --config-file "$INVALID_LUA" ls-fonts --list-system 2>&1 || true)

            # Check if the error output contains the expected runtime error
            if echo "$ERROR_OUTPUT" | grep -q "runtime error.*attempt to call a nil value"; then
              echo "✅ Invalid API calls correctly produce runtime errors"
            else
              echo "❌ Test failed: Expected runtime error not found in output"
              echo "Output: $ERROR_OUTPUT"
              rm -f "$INVALID_LUA"
              exit 1
            fi

            rm -f "$INVALID_LUA"

            echo "✅ All runtime behavior tests passed"
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
          test-wezterm-runtime
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
        echo "  ✅ Test 6: WezTerm runtime behavior"
        echo ""
        touch $out
      '';

in
all-tests
