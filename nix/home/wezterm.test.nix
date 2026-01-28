# WezTerm Module Tests
#
# Validates the WezTerm Home Manager module configuration:
# 1. Lua syntax validation for generated config
# 2. Platform-specific conditional logic (Linux/macOS)
# 3. Variable interpolation (username, home directory)
# 4. Activation script logic for WSL Windows config copy
#
# These tests ensure configuration syntax errors are caught before deployment,
# preventing Lua syntax failures during WezTerm launch. They do not verify
# runtime behavior like font availability or WSL integration.

{ pkgs, lib, ... }:

let
  # Import the wezterm module for testing
  weztermModule = import ./wezterm.nix;

  # Test helper: Evaluate module with mock config
  evaluateModule =
    {
      username ? "testuser",
      homeDirectory ? "/home/testuser",
      isLinux ? true,
      isDarwin ? false,
    }:
    let
      mockPkgs = pkgs // {
        stdenv = pkgs.stdenv // {
          isLinux = isLinux;
          isDarwin = isDarwin;
        };
      };
      mockConfig = {
        home = {
          username = username;
          homeDirectory = homeDirectory;
        };
      };
    in
    weztermModule {
      config = mockConfig;
      pkgs = mockPkgs;
      lib = lib;
    };

  # Test helper: Extract Lua config from module evaluation
  extractLuaConfig = moduleResult: moduleResult.programs.wezterm.extraConfig;

  # TODO(#1615): Add test verifying generated config is actually valid WezTerm configuration
  # Test helper: Validate Lua syntax using lua interpreter
  validateLuaSyntax =
    luaCode:
    let
      luaFile = pkgs.writeText "wezterm-test.lua" luaCode;
    in
    pkgs.runCommand "validate-lua-syntax" { buildInputs = [ pkgs.lua ]; } ''
      # Validate syntax and capture error output
      if ! lua_error=$(${pkgs.lua}/bin/lua -e "assert(loadfile('${luaFile}'))" 2>&1); then
        echo "Lua syntax validation failed:"
        echo "----------------------------------------"
        echo "$lua_error"
        echo "----------------------------------------"
        echo ""
        echo "Generated Lua config (first 50 lines):"
        head -n 50 '${luaFile}'
        echo ""
        echo "Full config at: ${luaFile}"
        exit 1
      fi
      touch $out
    '';

  # Test 1: Basic module structure
  test-module-structure = pkgs.runCommand "test-wezterm-module-structure" { } ''
    # Validate module returns expected attributes
    ${
      if (evaluateModule { }).programs.wezterm.enable or false then
        "echo 'PASS: Module enables wezterm'"
      else
        "echo 'FAIL: Module does not enable wezterm' && exit 1"
    }
    ${
      if (evaluateModule { }).programs.wezterm ? extraConfig then
        "echo 'PASS: Module provides extraConfig'"
      else
        "echo 'FAIL: Module missing extraConfig' && exit 1"
    }
    touch $out
  '';

  # Test 2: Linux-specific configuration
  test-linux-config =
    let
      result = evaluateModule {
        username = "linuxuser";
        homeDirectory = "/home/linuxuser";
        isLinux = true;
        isDarwin = false;
      };
      luaConfig = extractLuaConfig result;
    in
    pkgs.runCommand "test-wezterm-linux-config" { } ''
      # Validate Linux-specific WSL integration is present
      ${
        if lib.hasInfix "default_prog" luaConfig then
          "echo 'PASS: Linux config includes default_prog for WSL'"
        else
          "echo 'FAIL: Linux config missing default_prog' && exit 1"
      }
      ${
        if lib.hasInfix "wsl.exe" luaConfig then
          "echo 'PASS: Linux config includes wsl.exe'"
        else
          "echo 'FAIL: Linux config missing wsl.exe' && exit 1"
      }
      ${
        if lib.hasInfix "/home/linuxuser" luaConfig then
          "echo 'PASS: Linux config includes correct home directory'"
        else
          "echo 'FAIL: Linux config has wrong home directory' && exit 1"
      }
      ${
        if lib.hasInfix "native_macos_fullscreen_mode" luaConfig then
          "echo 'FAIL: Linux config should not include macOS settings' && exit 1"
        else
          "echo 'PASS: Linux config excludes macOS settings'"
      }
      touch $out
    '';

  # Test 3: macOS-specific configuration
  test-macos-config =
    let
      result = evaluateModule {
        username = "macuser";
        homeDirectory = "/Users/macuser";
        isLinux = false;
        isDarwin = true;
      };
      luaConfig = extractLuaConfig result;
    in
    pkgs.runCommand "test-wezterm-macos-config" { } ''
      # Validate macOS-specific settings are present
      ${
        if lib.hasInfix "native_macos_fullscreen_mode" luaConfig then
          "echo 'PASS: macOS config includes native_macos_fullscreen_mode'"
        else
          "echo 'FAIL: macOS config missing native_macos_fullscreen_mode' && exit 1"
      }
      ${
        if lib.hasInfix "default_prog" luaConfig then
          "echo 'FAIL: macOS config should not include WSL settings' && exit 1"
        else
          "echo 'PASS: macOS config excludes WSL settings'"
      }
      ${
        if lib.hasInfix "wsl.exe" luaConfig then
          "echo 'FAIL: macOS config should not include wsl.exe' && exit 1"
        else
          "echo 'PASS: macOS config excludes wsl.exe'"
      }
      touch $out
    '';

  # Test 4: Lua syntax validation for all platform combinations
  test-lua-syntax-linux =
    let
      luaConfig = extractLuaConfig (evaluateModule {
        isLinux = true;
        isDarwin = false;
      });
    in
    validateLuaSyntax luaConfig;

  test-lua-syntax-macos =
    let
      luaConfig = extractLuaConfig (evaluateModule {
        isLinux = false;
        isDarwin = true;
      });
    in
    validateLuaSyntax luaConfig;

  test-lua-syntax-generic =
    let
      luaConfig = extractLuaConfig (evaluateModule {
        isLinux = false;
        isDarwin = false;
      });
    in
    validateLuaSyntax luaConfig;

  # Test 5: Username interpolation
  test-username-interpolation =
    let
      testUsernames = [
        "alice"
        "bob-smith"
        "user_123"
      ];
      results = lib.genAttrs testUsernames (
        username:
        let
          luaConfig = extractLuaConfig (evaluateModule {
            username = username;
            isLinux = true;
          });
        in
        lib.hasInfix username luaConfig
      );
    in
    pkgs.runCommand "test-wezterm-username-interpolation" { } ''
      ${lib.concatMapStringsSep "\n" (
        username:
        if results.${username} then
          "echo 'PASS: Username ${username} interpolated correctly'"
        else
          "echo 'FAIL: Username ${username} not found in config' && exit 1"
      ) testUsernames}
      touch $out
    '';

  # TODO(#1611): Add test for Lua config with special chars in username (quotes, backslashes)
  # Test 6: Activation script conditioned on Linux platform
  test-activation-script-linux =
    let
      weztermSource = builtins.readFile ./wezterm.nix;
    in
    pkgs.runCommand "test-wezterm-activation-script-linux" { } ''
      # Validate source has activation script with Linux condition
      ${
        if lib.hasInfix "home.activation.copyWeztermToWindows" weztermSource then
          "echo 'PASS: Source includes copyWeztermToWindows activation script'"
        else
          "echo 'FAIL: Source missing activation script definition' && exit 1"
      }
      ${
        if lib.hasInfix "lib.mkIf pkgs.stdenv.isLinux" weztermSource then
          "echo 'PASS: Activation script is conditioned on Linux platform'"
        else
          "echo 'FAIL: Activation script missing Linux platform condition' && exit 1"
      }
      touch $out
    '';

  # Test 7: Activation script uses DAG ordering
  test-activation-script-dag =
    let
      weztermSource = builtins.readFile ./wezterm.nix;
    in
    pkgs.runCommand "test-wezterm-activation-script-dag" { } ''
      # Validate activation script uses proper DAG ordering
      ${
        if lib.hasInfix "lib.hm.dag.entryAfter" weztermSource then
          "echo 'PASS: Activation script uses DAG ordering'"
        else
          "echo 'FAIL: Activation script missing DAG ordering' && exit 1"
      }
      ${
        if lib.hasInfix "linkGeneration" weztermSource then
          "echo 'PASS: Activation script depends on linkGeneration'"
        else
          "echo 'FAIL: Activation script missing linkGeneration dependency' && exit 1"
      }
      touch $out
    '';

  # Test 8: Common configuration present in all platforms
  test-common-config =
    let
      testPlatforms = [
        {
          name = "linux";
          isLinux = true;
          isDarwin = false;
        }
        {
          name = "macos";
          isLinux = false;
          isDarwin = true;
        }
        {
          name = "generic";
          isLinux = false;
          isDarwin = false;
        }
      ];
      commonSettings = [
        "font"
        "font_size"
        "color_scheme"
        "scrollback_lines"
        "hide_tab_bar_if_only_one_tab"
        "window_padding"
      ];
    in
    pkgs.runCommand "test-wezterm-common-config" { } ''
      ${lib.concatMapStringsSep "\n" (
        platform:
        let
          luaConfig = extractLuaConfig (evaluateModule {
            isLinux = platform.isLinux;
            isDarwin = platform.isDarwin;
          });
        in
        lib.concatMapStringsSep "\n" (
          setting:
          if lib.hasInfix setting luaConfig then
            "echo 'PASS: ${platform.name} config includes ${setting}'"
          else
            "echo 'FAIL: ${platform.name} config missing ${setting}' && exit 1"
        ) commonSettings
      ) testPlatforms}
      touch $out
    '';

  # Test 9: Activation script source validation
  # Since the activation script uses lib.mkIf and DAG structures, we validate
  # the source wezterm.nix file directly instead of the evaluated structure
  test-activation-script-logic =
    let
      weztermSource = builtins.readFile ./wezterm.nix;
    in
    pkgs.runCommand "test-wezterm-activation-script-logic" { } ''
      # Validate script source contains expected logic
      ${
        if lib.hasInfix "/mnt/c/Users" weztermSource then
          "echo 'PASS: Activation script checks for WSL mount point'"
        else
          "echo 'FAIL: Activation script missing WSL mount check' && exit 1"
      }
      ${
        if lib.hasInfix "WINDOWS_USER" weztermSource then
          "echo 'PASS: Activation script detects Windows username'"
        else
          "echo 'FAIL: Activation script missing Windows username detection' && exit 1"
      }
      ${
        if lib.hasInfix ".wezterm.lua" weztermSource then
          "echo 'PASS: Activation script targets correct filename'"
        else
          "echo 'FAIL: Activation script missing target filename' && exit 1"
      }
      ${
        if lib.hasInfix "grep -v -E" weztermSource then
          "echo 'PASS: Activation script filters system directories'"
        else
          "echo 'FAIL: Activation script missing directory filtering' && exit 1"
      }
      ${
        if lib.hasInfix "copyWeztermToWindows" weztermSource then
          "echo 'PASS: Activation script has correct name'"
        else
          "echo 'FAIL: Activation script missing name' && exit 1"
      }
      touch $out
    '';

  # Test 10: Activation script runtime behavior
  # Tests the actual execution of Windows user detection and config copy logic
  # using shell script tests with mock /mnt/c/Users structures
  test-activation-script-runtime =
    pkgs.runCommand "test-wezterm-activation-script-runtime"
      {
        buildInputs = [ pkgs.bash ];
      }
      ''
        # Run the shell test suite
        ${pkgs.bash}/bin/bash ${./wezterm_test.sh}
        touch $out
      '';

  # Aggregate all tests into a test suite
  allTests = [
    test-module-structure
    test-linux-config
    test-macos-config
    test-lua-syntax-linux
    test-lua-syntax-macos
    test-lua-syntax-generic
    test-username-interpolation
    test-activation-script-linux
    test-activation-script-dag
    test-common-config
    test-activation-script-logic
    test-activation-script-runtime
  ];

  # Convenience: Run all tests in a single derivation
  wezterm-test-suite = pkgs.runCommand "wezterm-test-suite" { buildInputs = allTests; } ''
    echo "╔═══════════════════════════════════════════╗"
    echo "║   WezTerm Module Test Suite              ║"
    echo "╚═══════════════════════════════════════════╝"
    echo ""
    echo "✅ test-module-structure"
    echo "✅ test-linux-config"
    echo "✅ test-macos-config"
    echo "✅ test-lua-syntax-linux"
    echo "✅ test-lua-syntax-macos"
    echo "✅ test-lua-syntax-generic"
    echo "✅ test-username-interpolation"
    echo "✅ test-activation-script-linux"
    echo "✅ test-activation-script-dag"
    echo "✅ test-common-config"
    echo "✅ test-activation-script-logic"
    echo "✅ test-activation-script-runtime"
    echo ""
    echo "All WezTerm tests passed!"
    touch $out
  '';

in
{
  # Export all tests as derivations that can be built
  wezterm-tests = {
    inherit
      test-module-structure
      test-linux-config
      test-macos-config
      test-lua-syntax-linux
      test-lua-syntax-macos
      test-lua-syntax-generic
      test-username-interpolation
      test-activation-script-linux
      test-activation-script-dag
      test-common-config
      test-activation-script-logic
      test-activation-script-runtime
      ;
  };

  # Convenience: Run all tests
  inherit wezterm-test-suite;
}
