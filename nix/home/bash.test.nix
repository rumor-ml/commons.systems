# Bash Module Tests
#
# Validates the Bash Home Manager module configuration:
# 1. Bash syntax validation for shell script code
# 2. Session variable sourcing logic with error handling
# 3. File path correctness for hm-session-vars.sh
#
# These tests ensure configuration syntax errors are caught before deployment,
# preventing bash initialization failures that would break login shells.
#
# Note: These tests validate the module source code directly rather than
# evaluating it through Home Manager's module system, since bash.nix is
# designed to be imported as a Home Manager module.

# TODO(#1633): Test validation uses generic 'exit 1' without specific exit codes

{ pkgs, lib, ... }:

let
  # Import shared test helpers
  testHelpers = import ./test-helpers.nix { inherit pkgs lib; };

  # Read the bash module source for testing
  bashSource = builtins.readFile ./bash.nix;

  # Extract the initExtra content from source using shared helper
  initExtraContent = testHelpers.extractNixStringLiteral bashSource "initExtra";

  # Test 1: Module structure
  test-module-structure = pkgs.runCommand "test-bash-module-structure" { } ''
    # Validate module has expected structure
    ${
      if lib.hasInfix "programs.bash" bashSource then
        "echo 'PASS: Module defines programs.bash'"
      else
        "echo 'FAIL: Module missing programs.bash' && exit 1"
    }
    ${
      if lib.hasInfix "enable = true" bashSource then
        "echo 'PASS: Module enables bash'"
      else
        "echo 'FAIL: Module does not enable bash' && exit 1"
    }
    ${
      if lib.hasInfix "initExtra" bashSource then
        "echo 'PASS: Module provides initExtra'"
      else
        "echo 'FAIL: Module missing initExtra' && exit 1"
    }
    touch $out
  '';

  # Test 2: Session variables sourcing
  test-session-variables = pkgs.runCommand "test-bash-session-variables" { } ''
    # Validate session variable sourcing logic is present
    ${
      if lib.hasInfix "hm-session-vars.sh" initExtraContent then
        "echo 'PASS: Config includes hm-session-vars.sh sourcing'"
      else
        "echo 'FAIL: Config missing session variable sourcing' && exit 1"
    }
    ${
      if lib.hasInfix ".nix-profile/etc/profile.d/hm-session-vars.sh" initExtraContent then
        "echo 'PASS: Config uses correct path to hm-session-vars.sh'"
      else
        "echo 'FAIL: Config has incorrect path to hm-session-vars.sh' && exit 1"
    }
    ${
      if lib.hasInfix "if [ -f" initExtraContent then
        "echo 'PASS: Config checks file existence before sourcing'"
      else
        "echo 'FAIL: Config missing file existence check' && exit 1"
    }
    ${
      if lib.hasInfix "\$HOME" initExtraContent then
        "echo 'PASS: Config uses \$HOME variable for portability'"
      else
        "echo 'FAIL: Config missing \$HOME variable usage' && exit 1"
    }
    touch $out
  '';

  # Test 3: Error handling
  test-error-handling = pkgs.runCommand "test-bash-error-handling" { } ''
    # Validate error messages are present
    ${
      if lib.hasInfix "WARNING: Failed to source Home Manager session variables" initExtraContent then
        "echo 'PASS: Config includes error message for failed sourcing'"
      else
        "echo 'FAIL: Config missing error message' && exit 1"
    }
    ${
      if lib.hasInfix ">&2" initExtraContent then
        "echo 'PASS: Error messages go to stderr'"
      else
        "echo 'FAIL: Error messages not directed to stderr' && exit 1"
    }
    ${
      if lib.hasInfix "TZ (timezone)" initExtraContent then
        "echo 'PASS: Error message mentions TZ environment variable'"
      else
        "echo 'FAIL: Error message missing TZ reference' && exit 1"
    }
    ${
      if lib.hasInfix "if ! source_error=" initExtraContent then
        "echo 'PASS: Config uses conditional for error detection'"
      else
        "echo 'FAIL: Config missing error detection pattern' && exit 1"
    }
    touch $out
  '';

  # Test 4: Bash syntax validation
  test-bash-syntax = testHelpers.validateShellSyntax pkgs.bash "Bash" initExtraContent;

  # Test 5: Comment documentation
  test-comments = pkgs.runCommand "test-bash-comments" { } ''
    # Validate module has proper documentation
    ${
      if lib.hasInfix "Source Home Manager session variables" initExtraContent then
        "echo 'PASS: initExtra has explanatory comment'"
      else
        "echo 'FAIL: initExtra missing explanatory comment' && exit 1"
    }
    ${
      if lib.hasInfix "interactive shells" bashSource then
        "echo 'PASS: Module documents shell type handling'"
      else
        "echo 'FAIL: Module missing shell type documentation' && exit 1"
    }
    ${
      if lib.hasInfix "Bash Shell Configuration" bashSource then
        "echo 'PASS: Module has header documentation'"
      else
        "echo 'FAIL: Module missing header documentation' && exit 1"
    }
    touch $out
  '';

  # Test 6: WSL-specific context
  test-wsl-context = pkgs.runCommand "test-bash-wsl-context" { } ''
    # Validate WSL-related documentation and logic
    ${
      if lib.hasInfix "WSL" bashSource then
        "echo 'PASS: Module documents WSL context'"
      else
        "echo 'FAIL: Module missing WSL documentation' && exit 1"
    }
    ${
      if lib.hasInfix "non-login interactive shells" bashSource then
        "echo 'PASS: Module explains non-login shell handling'"
      else
        "echo 'FAIL: Module missing non-login shell explanation' && exit 1"
    }
    touch $out
  '';

  # Test 7: TODO tracking
  test-todo-references = pkgs.runCommand "test-bash-todo-references" { } ''
    # Validate TODO comments reference GitHub issues
    ${
      if lib.hasInfix "TODO(#" bashSource then
        "echo 'PASS: Module uses GitHub issue references in TODOs'"
      else
        "echo 'FAIL: Module has untracked TODOs' && exit 1"
    }
    touch $out
  '';

  # Aggregate all tests into a test suite
  allTests = [
    test-module-structure
    test-session-variables
    test-error-handling
    test-bash-syntax
    test-comments
    test-wsl-context
    test-todo-references
  ];

  # Convenience: Run all tests in a single derivation
  bash-test-suite = pkgs.runCommand "bash-test-suite" { buildInputs = allTests; } ''
    echo "╔═══════════════════════════════════════════╗"
    echo "║   Bash Module Test Suite                  ║"
    echo "╚═══════════════════════════════════════════╝"
    echo ""
    ${lib.concatMapStringsSep "\n" (test: "echo \"✅ ${test.name}\"") allTests}
    echo ""
    echo "All Bash tests passed!"
    touch $out
  '';

in
{
  # Export all tests as derivations that can be built
  bash-tests = {
    inherit
      test-module-structure
      test-session-variables
      test-error-handling
      test-bash-syntax
      test-comments
      test-wsl-context
      test-todo-references
      ;
  };

  # Convenience: Run all tests
  inherit bash-test-suite;
}
