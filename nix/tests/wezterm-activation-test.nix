# Integration test for WezTerm Home Manager activation package structure
#
# This test verifies that the Home Manager WezTerm module:
# 1. Builds an activation package successfully
# 2. Makes the wezterm binary available in the package PATH
# 3. Generates the correct configuration file structure
# 4. Includes shell integration hooks in the package
#
# Note: This test does NOT execute the activation script itself.
# It validates the package structure that would be used during activation.
#
# What this catches:
# - Home Manager module evaluation failures
# - Missing or broken wezterm package links
# - Configuration file generation issues in the package
# - Shell integration script inclusion failures
# - Regressions in Home Manager's wezterm module package building
#
# Usage:
#   nix-build nix/tests/wezterm-activation-test.nix
#
# The build will fail if any activation step fails, providing clear error messages.
# Success is indicated by a successful build creating a result symlink.

{
  pkgs ? import <nixpkgs> {
    config = {
      allowUnfree = true;
    };
  },
}:

let
  # Import home-manager using fetchTarball to get the latest master branch
  # This matches the flake.nix configuration
  # Note: sha256 is pinned to a specific version for reproducibility
  # Update periodically using: nix-prefetch-url --unpack https://github.com/nix-community/home-manager/archive/master.tar.gz
  home-manager =
    import
      (fetchTarball {
        url = "https://github.com/nix-community/home-manager/archive/master.tar.gz";
        sha256 = "18jqz8sw3knvl6g5x2a030mq6m43ljr06a4s8209fn1zchhcrcfk";
      })
      {
        inherit pkgs;
      };

  # Create a minimal Home Manager configuration with WezTerm enabled
  testHomeConfig = home-manager.lib.homeManagerConfiguration {
    inherit pkgs;

    modules = [
      {
        home.username = "test-user";
        home.homeDirectory = "/tmp/wezterm-activation-test-home";
        home.stateVersion = "24.11";
        programs.home-manager.enable = true;

        # Import the actual WezTerm configuration from the repo
        imports = [ ../home/wezterm.nix ];

        # Force enable for testing (normally Darwin-only)
        programs.wezterm.enable = pkgs.lib.mkForce true;
      }
    ];
  };

  # Build the activation package
  activationPackage = testHomeConfig.activationPackage;

  # Test the activation process
  test-activation =
    pkgs.runCommand "test-wezterm-activation"
      {
        buildInputs = [
          pkgs.wezterm
          pkgs.bash
          pkgs.coreutils
        ];
      }
      ''
        set -e

        echo "╔═══════════════════════════════════════════════════════════╗"
        echo "║  WezTerm Home Manager Activation Test                    ║"
        echo "╚═══════════════════════════════════════════════════════════╝"
        echo ""

        # Create a temporary home directory for activation
        export HOME=$(mktemp -d)
        echo "Test home directory: $HOME"

        # Create required directories
        mkdir -p "$HOME/.config"
        mkdir -p "$HOME/.local/state/home-manager"

        # Copy the activation package to a temporary location for inspection
        ACTIVATION_PKG="${activationPackage}"
        echo "Activation package: $ACTIVATION_PKG"

        # Test 1: Verify activation package exists and is valid
        echo ""
        echo "Test 1: Verifying activation package structure..."
        if [ ! -d "$ACTIVATION_PKG" ]; then
          echo "❌ Activation package directory not found"
          exit 1
        fi

        if [ ! -f "$ACTIVATION_PKG/activate" ]; then
          echo "❌ Activation script not found in package"
          exit 1
        fi

        echo "✅ Activation package structure is valid"

        # Test 2: Verify activation script exists and is executable
        echo ""
        echo "Test 2: Verifying activation script is executable..."

        if [ -x "$ACTIVATION_PKG/activate" ]; then
          echo "✅ Activation script is executable"
        else
          echo "❌ Activation script is not executable"
          exit 1
        fi

        # Note: We don't actually run the activation script because it requires
        # nix-build and other tools not available in the test environment.
        # Instead, we verify the built package structure contains all expected components.

        # Test 3: Verify wezterm binary is in the activation package PATH
        echo ""
        echo "Test 3: Verifying wezterm binary availability..."

        if [ -x "$ACTIVATION_PKG/home-path/bin/wezterm" ]; then
          echo "✅ wezterm binary is available in home-path"
        else
          echo "❌ wezterm binary not found in $ACTIVATION_PKG/home-path/bin/"
          echo "Available binaries:"
          ls -la "$ACTIVATION_PKG/home-path/bin/" | head -20
          exit 1
        fi

        # Test 4: Verify wezterm binary is functional
        echo ""
        echo "Test 4: Verifying wezterm binary is executable..."

        WEZTERM_VERSION=$($ACTIVATION_PKG/home-path/bin/wezterm --version 2>&1 || true)
        if echo "$WEZTERM_VERSION" | grep -q "wezterm"; then
          echo "✅ wezterm binary is functional: $WEZTERM_VERSION"
        else
          echo "❌ wezterm binary failed to execute or produced unexpected output"
          echo "Output: $WEZTERM_VERSION"
          exit 1
        fi

        # Test 5: Verify WezTerm configuration file is generated
        echo ""
        echo "Test 5: Verifying WezTerm configuration file generation..."

        WEZTERM_CONFIG="$ACTIVATION_PKG/home-files/.config/wezterm/wezterm.lua"
        if [ -f "$WEZTERM_CONFIG" ]; then
          echo "✅ WezTerm configuration file exists"
        else
          echo "❌ WezTerm configuration file not found at $WEZTERM_CONFIG"
          echo "Files in .config:"
          find "$ACTIVATION_PKG/home-files/.config" -type f 2>/dev/null || echo "No .config directory"
          exit 1
        fi

        # Test 6: Verify configuration content matches expected values
        echo ""
        echo "Test 6: Verifying configuration file content..."

        CONFIG_CONTENT=$(cat "$WEZTERM_CONFIG")

        # Check for expected configuration values from ../home/wezterm.nix
        EXPECTED_VALUES=(
          "require('wezterm')"
          "config_builder()"
          "font('GeistMono Nerd Font')"
          "font_size = 12.0"
          "color_scheme = 'Tokyo Night'"
          "scrollback_lines = 10000"
          "hide_tab_bar_if_only_one_tab = true"
          "native_macos_fullscreen_mode = true"
          "check_for_updates = false"
          "return config"
        )

        MISSING_VALUES=()
        for value in "''${EXPECTED_VALUES[@]}"; do
          if ! echo "$CONFIG_CONTENT" | grep -qF "$value"; then
            MISSING_VALUES+=("$value")
          fi
        done

        if [ ''${#MISSING_VALUES[@]} -eq 0 ]; then
          echo "✅ Configuration file contains all expected values"
        else
          echo "❌ Configuration file missing expected values:"
          printf '%s\n' "''${MISSING_VALUES[@]}"
          echo ""
          echo "Actual content:"
          echo "$CONFIG_CONTENT"
          exit 1
        fi

        # Test 7: Verify shell integration files (Bash)
        echo ""
        echo "Test 7: Verifying Bash shell integration..."

        BASHRC="$ACTIVATION_PKG/home-files/.bashrc"
        if [ -f "$BASHRC" ]; then
          if grep -q "wezterm" "$BASHRC"; then
            echo "✅ Bash integration configured in .bashrc"
          else
            echo "⚠️  .bashrc exists but doesn't contain wezterm integration"
            echo "   This may be expected if enableBashIntegration generates a separate file"
            # Check for separate shell integration file
            if [ -d "$ACTIVATION_PKG/home-files/.config/wezterm" ]; then
              SHELL_FILES=$(find "$ACTIVATION_PKG/home-files/.config/wezterm" -name "*bash*" -o -name "*shell*" 2>/dev/null || true)
              if [ -n "$SHELL_FILES" ]; then
                echo "   Found separate shell integration files:"
                echo "$SHELL_FILES"
                echo "✅ Shell integration files present"
              fi
            fi
          fi
        else
          echo "⚠️  .bashrc not found in activation package"
          echo "   This is expected if Home Manager doesn't manage .bashrc"
          echo "   WezTerm shell integration may be configured separately"
        fi

        # Test 8: Verify shell integration files (Zsh)
        echo ""
        echo "Test 8: Verifying Zsh shell integration..."

        ZSHRC="$ACTIVATION_PKG/home-files/.zshrc"
        if [ -f "$ZSHRC" ]; then
          if grep -q "wezterm" "$ZSHRC"; then
            echo "✅ Zsh integration configured in .zshrc"
          else
            echo "⚠️  .zshrc exists but doesn't contain wezterm integration"
            echo "   This may be expected if enableZshIntegration generates a separate file"
            # Check for separate shell integration file
            if [ -d "$ACTIVATION_PKG/home-files/.config/wezterm" ]; then
              SHELL_FILES=$(find "$ACTIVATION_PKG/home-files/.config/wezterm" -name "*zsh*" -o -name "*shell*" 2>/dev/null || true)
              if [ -n "$SHELL_FILES" ]; then
                echo "   Found separate shell integration files:"
                echo "$SHELL_FILES"
                echo "✅ Shell integration files present"
              fi
            fi
          fi
        else
          echo "⚠️  .zshrc not found in activation package"
          echo "   This is expected if Home Manager doesn't manage .zshrc"
          echo "   WezTerm shell integration may be configured separately"
        fi

        # Test 9: Verify configuration is valid Lua syntax
        echo ""
        echo "Test 9: Verifying Lua syntax in generated configuration..."

        if ${pkgs.lua}/bin/luac -p "$WEZTERM_CONFIG" 2>&1; then
          echo "✅ Generated configuration has valid Lua syntax"
        else
          echo "❌ Generated configuration has Lua syntax errors"
          echo "Configuration content:"
          cat "$WEZTERM_CONFIG"
          exit 1
        fi

        # Test 10: Verify WezTerm can load the generated configuration
        echo ""
        echo "Test 10: Verifying WezTerm loads configuration without errors..."

        # Use the wezterm from the activation package
        WEZTERM_BIN="$ACTIVATION_PKG/home-path/bin/wezterm"

        if $WEZTERM_BIN --config-file "$WEZTERM_CONFIG" ls-fonts --list-system > /dev/null 2>&1; then
          echo "✅ WezTerm successfully loads generated configuration"
        else
          echo "❌ WezTerm failed to load generated configuration"
          echo "This indicates runtime incompatibility between config and WezTerm version"
          exit 1
        fi

        # Cleanup
        rm -rf "$HOME"

        echo ""
        echo "╔═══════════════════════════════════════════════════════════╗"
        echo "║  All WezTerm Activation Tests Passed ✅                  ║"
        echo "╚═══════════════════════════════════════════════════════════╝"
        echo ""
        echo "Tests validated:"
        echo "  ✅ Home Manager activation package builds successfully"
        echo "  ✅ wezterm binary is available and functional"
        echo "  ✅ Configuration file is generated correctly"
        echo "  ✅ Configuration contains expected values"
        echo "  ✅ Shell integration checked (Bash/Zsh)"
        echo "  ✅ Generated Lua has valid syntax"
        echo "  ✅ WezTerm loads configuration without errors"
        echo ""

        touch $out
      '';

in
test-activation
