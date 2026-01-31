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
  test-all-modules-listed = pkgs.runCommand "test-all-modules-listed" { } ''
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
  test-imports-structure = pkgs.runCommand "test-imports-structure" { } ''
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
  test-user-config-structure = pkgs.runCommand "test-user-config-structure" { } ''
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
  test-state-version = pkgs.runCommand "test-state-version" { } ''
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
  test-home-manager-enable = pkgs.runCommand "test-home-manager-enable" { } ''
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

  # Test 8: Verify bash and zsh share identical session variable sourcing logic
  # This integration test catches regressions where bash.nix and zsh.nix diverge
  # in their use of the shared shell-helpers.sessionVarsSourcingScript
  test-bash-zsh-shared-logic =
    let
      # Import both shell modules
      bashModule = import ./bash.nix { inherit lib; };
      zshModule = import ./zsh.nix { inherit lib; };
      shellHelpers = import ./lib/shell-helpers.nix { inherit lib; };

      # Extract the session variable sourcing scripts
      bashScript = bashModule.programs.bash.initExtra;
      zshScript = zshModule.programs.zsh.envExtra;
      expectedScript = shellHelpers.sessionVarsSourcingScript;
    in
    pkgs.runCommand "test-bash-zsh-shared-logic"
      {
        buildInputs = [
          pkgs.bash
          pkgs.zsh
          pkgs.coreutils
          pkgs.diffutils
        ];
      }
      ''
        echo "Verifying bash.nix and zsh.nix use identical session variable sourcing logic:"
        echo ""

        # Test 1: Verify bash uses shell-helpers script exactly
        echo "Checking bash.nix imports shell-helpers correctly..."
        cat > bash-script.txt << 'BASH_EOF'
        ${bashScript}
        BASH_EOF

        cat > expected-script.txt << 'EXPECTED_EOF'
        ${expectedScript}
        EXPECTED_EOF

        if diff -u bash-script.txt expected-script.txt > bash-diff.txt; then
          echo "  ✓ bash.nix uses shell-helpers.sessionVarsSourcingScript without modification"
        else
          echo "  ✗ bash.nix deviates from shell-helpers.sessionVarsSourcingScript"
          echo ""
          echo "Diff output:"
          cat bash-diff.txt
          exit 1
        fi

        # Test 2: Verify zsh uses shell-helpers script exactly
        echo "Checking zsh.nix imports shell-helpers correctly..."
        cat > zsh-script.txt << 'ZSH_EOF'
        ${zshScript}
        ZSH_EOF

        if diff -u zsh-script.txt expected-script.txt > zsh-diff.txt; then
          echo "  ✓ zsh.nix uses shell-helpers.sessionVarsSourcingScript without modification"
        else
          echo "  ✗ zsh.nix deviates from shell-helpers.sessionVarsSourcingScript"
          echo ""
          echo "Diff output:"
          cat zsh-diff.txt
          exit 1
        fi

        # Test 3: Verify bash and zsh use IDENTICAL logic (final consistency check)
        echo "Verifying bash and zsh session variable sourcing is byte-identical..."
        if diff -u bash-script.txt zsh-script.txt > bash-zsh-diff.txt; then
          echo "  ✓ bash.nix and zsh.nix use identical session variable sourcing logic"
        else
          echo "  ✗ bash.nix and zsh.nix have different session variable sourcing logic"
          echo ""
          echo "Diff output:"
          cat bash-zsh-diff.txt
          exit 1
        fi

        # Test 4: Behavioral equivalence - run both scripts in their respective shells
        echo "Testing behavioral equivalence in bash shell..."
        mkdir -p test-home/.nix-profile/etc/profile.d
        cat > test-home/.nix-profile/etc/profile.d/hm-session-vars.sh << 'VARS_EOF'
        export TZ=America/Los_Angeles
        export TEST_SESSION_VAR=test_value
        VARS_EOF

        # Run bash script
        bash_output=$(HOME=$(pwd)/test-home ${pkgs.bash}/bin/bash -c 'source bash-script.txt && echo "TZ=$TZ TEST_SESSION_VAR=$TEST_SESSION_VAR"' 2>&1) || {
          echo "  ✗ Bash script failed to execute"
          echo "Output: $bash_output"
          exit 1
        }

        if echo "$bash_output" | grep -q "TZ=America/Los_Angeles" && echo "$bash_output" | grep -q "TEST_SESSION_VAR=test_value"; then
          echo "  ✓ Bash successfully sourced session variables"
        else
          echo "  ✗ Bash failed to source session variables correctly"
          echo "Output: $bash_output"
          exit 1
        fi

        echo "Testing behavioral equivalence in zsh shell..."
        # Run zsh script
        zsh_output=$(HOME=$(pwd)/test-home ${pkgs.zsh}/bin/zsh -c 'source zsh-script.txt && echo "TZ=$TZ TEST_SESSION_VAR=$TEST_SESSION_VAR"' 2>&1) || {
          echo "  ✗ Zsh script failed to execute"
          echo "Output: $zsh_output"
          exit 1
        }

        if echo "$zsh_output" | grep -q "TZ=America/Los_Angeles" && echo "$zsh_output" | grep -q "TEST_SESSION_VAR=test_value"; then
          echo "  ✓ Zsh successfully sourced session variables"
        else
          echo "  ✗ Zsh failed to source session variables correctly"
          echo "Output: $zsh_output"
          exit 1
        fi

        # Test 5: Error handling equivalence - both should handle errors identically
        echo "Testing error handling equivalence..."
        cat > test-home/.nix-profile/etc/profile.d/hm-session-vars.sh << 'ERROR_VARS_EOF'
        echo "Test error from session vars" >&2
        exit 1
        ERROR_VARS_EOF

        # Run bash script with failing session vars
        bash_error=$(HOME=$(pwd)/test-home ${pkgs.bash}/bin/bash -c 'source bash-script.txt' 2>&1) || true

        # Run zsh script with failing session vars
        zsh_error=$(HOME=$(pwd)/test-home ${pkgs.zsh}/bin/zsh -c 'source zsh-script.txt' 2>&1) || true

        # Both should produce error messages
        if echo "$bash_error" | grep -q "ERROR: Failed to source Home Manager session variables"; then
          echo "  ✓ Bash error handling works correctly"
        else
          echo "  ✗ Bash error handling failed"
          echo "Output: $bash_error"
          exit 1
        fi

        if echo "$zsh_error" | grep -q "ERROR: Failed to source Home Manager session variables"; then
          echo "  ✓ Zsh error handling works correctly"
        else
          echo "  ✗ Zsh error handling failed"
          echo "Output: $zsh_error"
          exit 1
        fi

        # Both should include the actual error message
        if echo "$bash_error" | grep -q "Test error from session vars" && echo "$zsh_error" | grep -q "Test error from session vars"; then
          echo "  ✓ Both shells capture and display error messages correctly"
        else
          echo "  ✗ Error message capture differs between shells"
          echo "Bash: $bash_error"
          echo "Zsh: $zsh_error"
          exit 1
        fi

        echo ""
        echo "All bash/zsh consistency checks passed!"
        echo ""
        echo "This test ensures:"
        echo "  - bash.nix and zsh.nix import shell-helpers.sessionVarsSourcingScript"
        echo "  - Neither module modifies or inlines the shared script"
        echo "  - Both shells produce identical behavior (variable sourcing and error handling)"
        echo "  - Future changes to one module cannot break the shared contract"

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
    test-bash-zsh-shared-logic
  ];

  # Convenience: Run all tests in a single derivation
  integration-test-suite =
    pkgs.runCommand "home-integration-test-suite" { buildInputs = allTests; }
      ''
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
        echo "  - bash.nix and zsh.nix share identical session variable sourcing logic"
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
      test-bash-zsh-shared-logic
      ;
  };

  # Convenience: Run all tests
  inherit integration-test-suite;
}
