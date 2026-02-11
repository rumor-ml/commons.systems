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

  # Read shell helpers source for initExtra content
  shellHelpersSource = builtins.readFile ./lib/shell-helpers.nix;

  # Extract the initExtra content from shell-helpers.nix using shared helper
  initExtraContent = testHelpers.extractNixStringLiteral shellHelpersSource "sessionVarsSourcingScript";

  # Test helper: Evaluate module with mock config
  #
  # Evaluates the bash module through Home Manager's module system with mock configuration.
  # This allows testing module evaluation without requiring a full Home Manager setup.
  #
  # Parameters (attribute set):
  #   - username: non-empty string (default: "testuser")
  #       The username for config interpolation. Must not be empty.
  #       Example: "alice", "bob", "root"
  #   - homeDirectory: absolute path string starting with "/" (default: "/home/testuser")
  #       The home directory path. Must be absolute (start with /).
  #       Example: "/home/alice", "/home/users/bob", "/root"
  #
  # Returns: Home Manager module evaluation result with programs.bash configuration
  #
  # Invariants (enforced via assertions):
  #   - username must be non-empty string
  #   - homeDirectory must be non-empty string
  #   - homeDirectory must be an absolute path starting with "/"
  #
  # Example:
  #   evaluateModule { username = "alice"; homeDirectory = "/home/alice"; }
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
      if lib.hasInfix "mktemp" initExtraContent then
        "echo 'PASS: Config uses temp file for error capture'"
      else
        "echo 'FAIL: Config missing temp file error capture' && exit 1"
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
    ${
      if lib.hasInfix "Script exited with failure but produced no output" initExtraContent then
        "echo 'PASS: Error handling covers silent failures'"
      else
        "echo 'FAIL: Missing silent failure handling message' && exit 1"
    }
    ${
      if lib.hasInfix "Try running directly:" initExtraContent then
        "echo 'PASS: Error message provides debugging suggestion'"
      else
        "echo 'FAIL: Missing debugging suggestion in error message' && exit 1"
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
    # Validate TODO comments reference GitHub issues (or no TODOs exist)
    ${
      if lib.hasInfix "TODO" bashSource then
        if lib.hasInfix "TODO(#" bashSource then
          "echo 'PASS: Module uses GitHub issue references in TODOs'"
        else
          "echo 'FAIL: Module has untracked TODOs (must use TODO(#NNN) format)' && exit 1"
      else
        "echo 'PASS: Module has no TODOs'"
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
  test-aborts-after-error =
    pkgs.runCommand "test-bash-aborts-after-error"
      {
        buildInputs = [
          pkgs.bash
          pkgs.coreutils
        ];
      }
      ''
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

  # Test 11: Missing session vars file handling
  test-missing-session-vars-file =
    pkgs.runCommand "test-missing-session-vars-file"
      {
        buildInputs = [
          pkgs.bash
          pkgs.coreutils
        ];
      }
      ''
            # Create a mock .bashrc with initExtra content
            cat > test-bashrc << 'EOF'
        ${initExtraContent}
        echo "Shell initialization completed"
        EOF

            # Create environment WITHOUT hm-session-vars.sh
            mkdir -p test-home
            # Note: Intentionally not creating .nix-profile/etc/profile.d/hm-session-vars.sh

            # Run bash with our mock .bashrc
            output=$(HOME=$(pwd)/test-home ${pkgs.bash}/bin/bash --rcfile test-bashrc -i -c "echo 'Shell works'" 2>&1) || true

            # Verify no error messages (should be graceful fallback)
            if echo "$output" | grep -qi "error"; then
              echo "FAIL: Should not error when session vars file missing"
              echo "Output was: $output"
              exit 1
            else
              echo "PASS: No error messages when session vars file missing"
            fi

            # Verify initialization completed (no abort)
            if echo "$output" | grep -q "Shell initialization completed"; then
              echo "PASS: Shell initialization completed normally"
            else
              echo "FAIL: Shell initialization should complete when file missing"
              echo "Output was: $output"
              exit 1
            fi

            # Verify shell remains functional
            if echo "$output" | grep -q "Shell works"; then
              echo "PASS: Shell remains functional when session vars file missing"
            else
              echo "FAIL: Shell should be functional"
              echo "Output was: $output"
              exit 1
            fi

            touch $out
      '';

  # Test 12: Environment preservation after sourcing error
  test-environment-preservation-after-error =
    pkgs.runCommand "test-environment-preservation-after-error"
      {
        buildInputs = [
          pkgs.bash
          pkgs.coreutils
        ];
      }
      ''
            # Create a mock .bashrc with initExtra content
            cat > test-bashrc << 'EOF'
        # Set up pre-existing environment that should survive errors
        export PRE_EXISTING_VAR="should_survive"
        ${initExtraContent}
        echo "After error return"
        EOF

            # Create failing hm-session-vars.sh
            mkdir -p test-home/.nix-profile/etc/profile.d
            echo "exit 1" > test-home/.nix-profile/etc/profile.d/hm-session-vars.sh

            # Run bash and verify pre-existing vars survive sourcing failure
            output=$(PRE_EXISTING_VAR="should_survive" HOME=$(pwd)/test-home ${pkgs.bash}/bin/bash --rcfile test-bashrc -i \
                     -c "echo PATH=\$PATH; echo PRE_EXISTING_VAR=\$PRE_EXISTING_VAR; \
                         ${pkgs.coreutils}/bin/true && echo 'Command succeeded'" 2>&1) || true

            # Verify pre-existing environment variables are preserved
            if echo "$output" | grep -q "PRE_EXISTING_VAR=should_survive"; then
              echo "PASS: Pre-existing environment variables preserved after sourcing error"
            else
              echo "FAIL: Environment corrupted after sourcing failure"
              echo "Output was: $output"
              exit 1
            fi

            # Verify PATH is not empty/corrupted (shell needs PATH to work)
            if echo "$output" | grep -q "PATH=" && ! echo "$output" | grep -q "PATH=$"; then
              echo "PASS: PATH environment variable preserved"
            else
              echo "FAIL: PATH corrupted after sourcing failure"
              echo "Output was: $output"
              exit 1
            fi

            # Verify shell can execute child processes after sourcing error
            if echo "$output" | grep -q "Command succeeded"; then
              echo "PASS: Shell can execute child processes after sourcing error"
            else
              echo "FAIL: Shell cannot execute commands after error"
              echo "Output was: $output"
              exit 1
            fi

            touch $out
      '';

  # Test 13: Environment variable propagation
  test-environment-variable-propagation =
    pkgs.runCommand "test-environment-variable-propagation"
      {
        buildInputs = [
          pkgs.bash
          pkgs.coreutils
        ];
      }
      ''
            # Create a mock .bashrc with initExtra content
            cat > test-bashrc << 'EOF'
        ${initExtraContent}
        echo "Shell initialization completed"
        EOF

            # Create a mock hm-session-vars.sh that exports test variables
            mkdir -p test-home/.nix-profile/etc/profile.d
            cat > test-home/.nix-profile/etc/profile.d/hm-session-vars.sh << 'VARS_EOF'
        # Mock Home Manager session variables
        export TZ=America/New_York
        export TEST_VAR=test_value
        export HM_SESSION_LOADED=yes
        VARS_EOF

            # Test 1: Variables are accessible via echo
            output=$(HOME=$(pwd)/test-home ${pkgs.bash}/bin/bash --rcfile test-bashrc -i -c "echo TZ=\$TZ TEST_VAR=\$TEST_VAR HM_SESSION_LOADED=\$HM_SESSION_LOADED" 2>&1)

            if echo "$output" | grep -q "TZ=America/New_York"; then
              echo "PASS: TZ variable is accessible"
            else
              echo "FAIL: TZ variable not accessible"
              echo "Output was: $output"
              exit 1
            fi

            if echo "$output" | grep -q "TEST_VAR=test_value"; then
              echo "PASS: TEST_VAR is accessible"
            else
              echo "FAIL: TEST_VAR not accessible"
              echo "Output was: $output"
              exit 1
            fi

            if echo "$output" | grep -q "HM_SESSION_LOADED=yes"; then
              echo "PASS: HM_SESSION_LOADED is accessible"
            else
              echo "FAIL: HM_SESSION_LOADED not accessible"
              echo "Output was: $output"
              exit 1
            fi

            # Test 2: Variables are exported to environment (visible in env output)
            env_output=$(HOME=$(pwd)/test-home ${pkgs.bash}/bin/bash --rcfile test-bashrc -i -c "env" 2>&1)

            if echo "$env_output" | grep -q "^TZ=America/New_York"; then
              echo "PASS: TZ is exported to environment"
            else
              echo "FAIL: TZ not found in environment"
              echo "env output: $env_output"
              exit 1
            fi

            if echo "$env_output" | grep -q "^TEST_VAR=test_value"; then
              echo "PASS: TEST_VAR is exported to environment"
            else
              echo "FAIL: TEST_VAR not found in environment"
              exit 1
            fi

            # Test 3: TZ variable affects date command
            # Set TZ in the mock session vars and verify date respects it
            utc_date=$(TZ=UTC ${pkgs.coreutils}/bin/date '+%Z')
            ny_date=$(HOME=$(pwd)/test-home ${pkgs.bash}/bin/bash --rcfile test-bashrc -i -c "${pkgs.coreutils}/bin/date '+%Z'" 2>&1 | grep -v "Shell initialization" || true)

            if [ "$utc_date" != "$ny_date" ] || echo "$ny_date" | grep -q "EST\|EDT"; then
              echo "PASS: TZ variable affects date command (shows EST/EDT, not UTC)"
            else
              echo "FAIL: TZ variable does not affect date command"
              echo "UTC date timezone: $utc_date"
              echo "NY date timezone: $ny_date"
              exit 1
            fi

            # Test 4: Variables persist after executing other commands
            persist_output=$(HOME=$(pwd)/test-home ${pkgs.bash}/bin/bash --rcfile test-bashrc -i -c "echo 'dummy command' > /dev/null; echo \$TEST_VAR" 2>&1 | grep -v "Shell initialization" || true)

            if echo "$persist_output" | grep -q "test_value"; then
              echo "PASS: Variables persist after executing other commands"
            else
              echo "FAIL: Variables do not persist"
              echo "Output was: $persist_output"
              exit 1
            fi

            # Test 5: Variables are available in subshells (child processes)
            subshell_output=$(HOME=$(pwd)/test-home ${pkgs.bash}/bin/bash --rcfile test-bashrc -i -c "${pkgs.bash}/bin/bash -c 'echo \$TEST_VAR'" 2>&1 | grep -v "Shell initialization" || true)

            if echo "$subshell_output" | grep -q "test_value"; then
              echo "PASS: Variables are available in child processes"
            else
              echo "FAIL: Variables not available in child processes"
              echo "Output was: $subshell_output"
              exit 1
            fi

            touch $out
      '';

  # Test 14: Syntax error in session vars file
  test-syntax-error-in-session-vars =
    pkgs.runCommand "test-syntax-error-in-session-vars"
      {
        buildInputs = [
          pkgs.bash
          pkgs.coreutils
        ];
      }
      ''
            # Create a mock .bashrc with initExtra content
            cat > test-bashrc << 'EOF'
        ${initExtraContent}
        echo "Shell initialization completed"
        EOF

            # Create hm-session-vars.sh with bash syntax error (unclosed string)
            mkdir -p test-home/.nix-profile/etc/profile.d
            cat > test-home/.nix-profile/etc/profile.d/hm-session-vars.sh << 'VARS_EOF'
        export TZ="America/New_York
        export TEST_VAR=test_value
        VARS_EOF

            # Run bash with our mock .bashrc
            output=$(HOME=$(pwd)/test-home ${pkgs.bash}/bin/bash --rcfile test-bashrc -i -c "echo 'Shell accessible'" 2>&1) || true

            # Verify error message appears
            if echo "$output" | grep -q "ERROR: Failed to source"; then
              echo "PASS: Error message present for syntax error"
            else
              echo "FAIL: Expected error message not found for syntax error"
              echo "Output was: $output"
              exit 1
            fi

            # Verify shell initialization aborted message
            if echo "$output" | grep -q "Shell initialization aborted"; then
              echo "PASS: Error message explains initialization is aborted"
            else
              echo "FAIL: Expected abort message not found"
              echo "Output was: $output"
              exit 1
            fi

            # Verify syntax error details are captured in output
            # The two-phase sourcing (subshell test) should capture stderr from bash
            if echo "$output" | grep -qi "unexpected\|syntax"; then
              echo "PASS: Syntax error details captured in error output"
            else
              echo "FAIL: Syntax error details should be captured"
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

            # Verify shell remains accessible for recovery
            if echo "$output" | grep -q "Shell accessible"; then
              echo "PASS: Shell remains accessible despite syntax error in session vars"
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
    test-missing-session-vars-file
    test-environment-preservation-after-error
    test-environment-variable-propagation
    test-syntax-error-in-session-vars
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
      test-missing-session-vars-file
      test-environment-preservation-after-error
      test-environment-variable-propagation
      test-syntax-error-in-session-vars
      ;
  };

  # Convenience: Run all tests
  inherit bash-test-suite;
}
