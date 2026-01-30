# Bash Module Tests
#
# Validates the Bash Home Manager module configuration:
# 1. Bash syntax validation for shell script code
# 2. Session variable sourcing logic with error handling
# 3. File path correctness for hm-session-vars.sh
#
# These tests ensure configuration syntax errors are caught at build time
# (via nix build/check), before home-manager switch activates the configuration.
#
# Note: These tests include both source code validation (string pattern matching)
# and module evaluation tests that verify Home Manager module system integration.

# TODO(#1633): Test validation uses generic 'exit 1' without specific exit codes

{ pkgs, lib, ... }:

let
  # Import shared test helpers
  testHelpers = import ./test-helpers.nix { inherit pkgs lib; };

  # Import the bash module for evaluation testing
  bashModule = import ./bash.nix;

  # Read the bash module source for testing
  bashSource = builtins.readFile ./bash.nix;

  # Extract the initExtra content from source using shared helper
  initExtraContent = testHelpers.extractNixStringLiteral bashSource "initExtra";

  # Test helper: Evaluate module with mock config
  # Parameters:
  #   username: string (default: "testuser") - username for config interpolation
  #   homeDirectory: string (default: "/home/testuser") - home directory path
  # Returns: Home Manager module evaluation result
  evaluateModule =
    {
      username ? "testuser",
      homeDirectory ? "/home/testuser",
    }:
    # Validate mock configuration invariants
    assert lib.assertMsg (username != "") "evaluateModule: username cannot be empty";
    assert lib.assertMsg (homeDirectory != "") "evaluateModule: homeDirectory cannot be empty";
    assert lib.assertMsg (lib.hasPrefix "/" homeDirectory)
      "evaluateModule: homeDirectory must be an absolute path starting with /";
    let
      mockConfig = {
        home = {
          username = username;
          homeDirectory = homeDirectory;
        };
      };
    in
    bashModule {
      config = mockConfig;
      pkgs = pkgs;
      lib = lib;
    };

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
      if lib.hasInfix "ERROR: Failed to source Home Manager session variables" initExtraContent then
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
    ${
      if lib.hasInfix "return 1" initExtraContent then
        "echo 'PASS: Config aborts shell initialization on error'"
      else
        "echo 'FAIL: Config missing return 1 to abort initialization' && exit 1"
    }
    ${
      if lib.hasInfix "Shell initialization aborted" initExtraContent then
        "echo 'PASS: Error message explains shell initialization is aborted'"
      else
        "echo 'FAIL: Error message missing abort explanation' && exit 1"
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

  # Test 8: Module evaluation through Home Manager's module system
  test-module-evaluation =
    let
      result = evaluateModule {
        username = "testuser";
        homeDirectory = "/home/testuser";
      };
    in
    pkgs.runCommand "test-bash-module-evaluation" { } ''
      # Verify module evaluates successfully
      ${
        if result.programs.bash.enable or false then
          "echo 'PASS: Module evaluation enables bash'"
        else
          "echo 'FAIL: Module evaluation did not enable bash' && exit 1"
      }
      ${
        if result.programs.bash ? initExtra then
          "echo 'PASS: Module evaluation provides initExtra'"
        else
          "echo 'FAIL: Module evaluation missing initExtra' && exit 1"
      }
      # Verify initExtra content is properly interpolated
      ${
        if lib.hasInfix "hm-session-vars.sh" (result.programs.bash.initExtra or "") then
          "echo 'PASS: Evaluated initExtra includes session variables sourcing'"
        else
          "echo 'FAIL: Evaluated initExtra missing session variables sourcing' && exit 1"
      }
      touch $out
    '';

  # Test 9: Module evaluation with various home directories
  test-module-evaluation-paths =
    let
      testCases = [
        {
          username = "alice";
          homeDirectory = "/home/alice";
        }
        {
          username = "bob";
          homeDirectory = "/home/users/bob";
        }
        {
          username = "root";
          homeDirectory = "/root";
        }
      ];
      results = map (testCase: evaluateModule testCase) testCases;
    in
    pkgs.runCommand "test-bash-module-evaluation-paths"
      {
        buildInputs = [ ];
      }
      ''
        ${lib.concatMapStringsSep "\n" (
          testCase:
          let
            result = evaluateModule testCase;
          in
          if result.programs.bash.enable or false then
            "echo 'PASS: Module evaluates for ${testCase.username} at ${testCase.homeDirectory}'"
          else
            "echo 'FAIL: Module failed to evaluate for ${testCase.username}' && exit 1"
        ) testCases}
        touch $out
      '';

  # Test 10: Bashrc sourcing aborts after source failure
  test-aborts-after-error = pkgs.runCommand "test-bash-aborts-after-error" { buildInputs = [ pkgs.bash ]; } ''
    # Create a mock .bashrc that sources the init script (simulates real usage)
    cat > test-bashrc << 'EOF'
${initExtraContent}
echo "Shell initialization completed"
EOF

    # Create a failing hm-session-vars.sh in a temporary HOME
    mkdir -p test-home/.nix-profile/etc/profile.d
    echo "exit 1" > test-home/.nix-profile/etc/profile.d/hm-session-vars.sh

    # Run bash with our mock .bashrc (simulating sourcing behavior)
    # Note: return 1 aborts .bashrc sourcing but bash shell still starts
    # This allows user to have a shell even if session vars fail, but prevents
    # further misconfiguration from executing rest of .bashrc
    output=$(HOME=$(pwd)/test-home ${pkgs.bash}/bin/bash --rcfile test-bashrc -i -c "echo 'Shell accessible'" 2>&1) || true

    # Verify error message appears
    if echo "$output" | grep -q "ERROR: Failed to source"; then
      echo "PASS: Error message present"
    else
      echo "FAIL: Expected error message not found"
      echo "Output was: $output"
      exit 1
    fi

    if echo "$output" | grep -q "Shell initialization aborted"; then
      echo "PASS: Error message explains initialization is aborted"
    else
      echo "FAIL: Expected abort message not found"
      echo "Output was: $output"
      exit 1
    fi

    # Verify .bashrc sourcing stopped (completion message should not appear)
    if echo "$output" | grep -q "Shell initialization completed"; then
      echo "FAIL: .bashrc should abort before completion message (return 1)"
      echo "Output was: $output"
      exit 1
    else
      echo "PASS: .bashrc sourcing aborted before completion message"
    fi

    # Verify shell is still accessible (important: don't lock user out completely)
    if echo "$output" | grep -q "Shell accessible"; then
      echo "PASS: Shell remains accessible despite session var failure"
    else
      echo "FAIL: Shell should remain accessible for recovery"
      echo "Output was: $output"
      exit 1
    fi

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
    test-module-evaluation
    test-module-evaluation-paths
    test-aborts-after-error
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
      test-module-evaluation
      test-module-evaluation-paths
      test-aborts-after-error
      ;
  };

  # Convenience: Run all tests
  inherit bash-test-suite;
}
