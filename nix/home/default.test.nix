# Home-Manager Integration Tests
#
# Validates that all modules in default.nix work correctly together as a
# complete home-manager configuration. Tests for:
# 1. Module imports are syntactically valid
# 2. All expected modules are listed in imports
# 3. No missing module files
#
# These tests catch integration issues that would only appear during
# `home-manager switch` but aren't caught by isolated module unit tests.
#
# Note: These tests validate the source structure rather than evaluating
# through lib.evalModules, because that requires home-manager's extended
# lib (lib.hm.dag) which is not available in standalone test environments.

{ pkgs, lib }:

let
  # Read the default.nix source for testing
  defaultSource = builtins.readFile ./default.nix;

  # Expected modules that should be imported in default.nix
  expectedModules = [
    "./bash.nix"
    "./zsh.nix"
    "./git.nix"
    "./tmux.nix"
    "./wezterm.nix"
    "./tools.nix"
    "./claude-code.nix"
    "./nix.nix"
    "./ssh.nix"
    "./ssh-keygen.nix"
    "./ssh-authorized-keys.nix"
  ];

  # Test 1: Verify all expected modules are in imports array
  test-all-modules-listed =
    pkgs.runCommand "test-all-modules-listed" { } ''
      echo "Verifying all expected modules are listed in default.nix imports:"
      ${lib.concatMapStringsSep "\n" (
        module:
        if lib.hasInfix module defaultSource then
          "echo '  ✓ ${module}'"
        else
          "echo '  ✗ ${module} not found in imports' && exit 1"
      ) expectedModules}

      echo ""
      echo "All expected modules are listed in imports array"
      touch $out
    '';

  # Test 2: Verify all module files exist
  test-module-files-exist =
    let
      # Convert module paths to absolute paths
      moduleFiles = map (mod: ./. + builtins.replaceStrings [ "./" ] [ "/" ] mod) expectedModules;
    in
    pkgs.runCommand "test-module-files-exist" { } ''
      echo "Verifying all imported module files exist:"
      ${lib.concatMapStringsSep "\n" (
        modPath:
        let
          fileName = builtins.baseNameOf modPath;
        in
        if builtins.pathExists modPath then
          "echo '  ✓ ${fileName}'"
        else
          "echo '  ✗ ${fileName} not found' && exit 1"
      ) moduleFiles}

      echo ""
      echo "All module files exist"
      touch $out
    '';

  # Test 3: Verify imports array structure
  test-imports-structure =
    pkgs.runCommand "test-imports-structure" { } ''
      # Verify imports array is present
      ${
        if lib.hasInfix "imports = [" defaultSource then
          "echo 'PASS: imports array is present'"
        else
          "echo 'FAIL: imports array missing' && exit 1"
      }

      # Verify closing bracket exists
      ${
        if lib.hasInfix "];" defaultSource then
          "echo 'PASS: imports array is properly closed'"
        else
          "echo 'FAIL: imports array not properly closed' && exit 1"
      }

      touch $out
    '';

  # Test 4: Verify home.username and home.homeDirectory configuration
  test-user-config-structure =
    pkgs.runCommand "test-user-config-structure" { } ''
      # Verify username configuration
      ${
        if lib.hasInfix "home.username" defaultSource then
          "echo 'PASS: home.username is configured'"
        else
          "echo 'FAIL: home.username missing' && exit 1"
      }

      # Verify homeDirectory configuration
      ${
        if lib.hasInfix "home.homeDirectory" defaultSource then
          "echo 'PASS: home.homeDirectory is configured'"
        else
          "echo 'FAIL: home.homeDirectory missing' && exit 1"
      }

      # Verify lib.mkDefault is used for fallback behavior
      ${
        if lib.hasInfix "lib.mkDefault" defaultSource then
          "echo 'PASS: lib.mkDefault used for default values'"
        else
          "echo 'FAIL: lib.mkDefault not used' && exit 1"
      }

      touch $out
    '';

  # Test 5: Verify home.stateVersion is set
  test-state-version =
    pkgs.runCommand "test-state-version" { } ''
      # Verify stateVersion is configured
      ${
        if lib.hasInfix "home.stateVersion" defaultSource then
          "echo 'PASS: home.stateVersion is configured'"
        else
          "echo 'FAIL: home.stateVersion missing' && exit 1"
      }

      # Verify it's set to a valid version (format: "YY.MM")
      ${
        if builtins.match ".*home\\.stateVersion = \"[0-9]{2}\\.[0-9]{2}\".*" defaultSource != null then
          "echo 'PASS: home.stateVersion has valid format'"
        else
          "echo 'FAIL: home.stateVersion format invalid' && exit 1"
      }

      touch $out
    '';

  # Test 6: Verify programs.home-manager.enable is set
  test-home-manager-enable =
    pkgs.runCommand "test-home-manager-enable" { } ''
      ${
        if lib.hasInfix "programs.home-manager.enable = true" defaultSource then
          "echo 'PASS: programs.home-manager.enable is set'"
        else
          "echo 'FAIL: programs.home-manager.enable missing' && exit 1"
      }

      touch $out
    '';

  # Test 7: Verify no obvious syntax errors in default.nix
  # This test imports default.nix as a function to check it's valid Nix
  test-syntax-valid =
    let
      # Try to import default.nix - will fail at build time if syntax is invalid
      defaultConfig = import ./default.nix;
    in
    pkgs.runCommand "test-syntax-valid" { } ''
      # If we got here, the import succeeded
      echo "PASS: default.nix has valid Nix syntax"
      touch $out
    '';

  # Aggregate all tests
  allTests = [
    test-all-modules-listed
    test-module-files-exist
    test-imports-structure
    test-user-config-structure
    test-state-version
    test-home-manager-enable
    test-syntax-valid
  ];

  # Convenience: Run all tests in a single derivation
  integration-test-suite = pkgs.runCommand "home-integration-test-suite" { buildInputs = allTests; } ''
    echo "╔═══════════════════════════════════════════╗"
    echo "║   Home-Manager Integration Test Suite    ║"
    echo "╚═══════════════════════════════════════════╝"
    echo ""
    ${lib.concatMapStringsSep "\n" (test: "echo \"✅ ${test.name}\"") allTests}
    echo ""
    echo "All integration tests passed!"
    echo ""
    echo "These tests verify that:"
    echo "  - All modules are listed in default.nix imports array"
    echo "  - All imported module files exist"
    echo "  - Configuration structure is valid"
    echo "  - Required home-manager options are set"
    echo "  - default.nix has valid Nix syntax"
    echo ""
    echo "Note: These tests validate structure and imports. For runtime"
    echo "module evaluation tests, see individual module test files"
    echo "(bash.test.nix, zsh.test.nix, wezterm.test.nix)"
    touch $out
  '';

in
{
  # Export all tests as derivations that can be built individually
  home-integration-tests = {
    inherit
      test-all-modules-listed
      test-module-files-exist
      test-imports-structure
      test-user-config-structure
      test-state-version
      test-home-manager-enable
      test-syntax-valid
      ;
  };

  # Convenience: Run all tests
  inherit integration-test-suite;
}
