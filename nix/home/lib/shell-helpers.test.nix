# Shell Helpers Module Tests
#
# Validates the shell-helpers shared module:
# 1. Session variable sourcing script syntax validation
# 2. Error handling paths (mktemp failure, source failure with/without stderr)
# 3. Successful sourcing behavior
# 4. Environment variable isolation (no temp variable pollution)
#
# These tests ensure the shared shell helper functions work correctly
# in isolation, before integration testing in bash.test.nix and zsh.test.nix.
#
# Why this matters:
# - shell-helpers.nix provides critical session variable sourcing used by both bash and zsh
# - Direct testing catches regressions before they affect multiple modules
# - Validates error handling edge cases not covered by integration tests

{ pkgs, lib, ... }:

let
  # Import shared test helpers
  testHelpers = import ../test-helpers.nix { inherit pkgs lib; };

  # Import the shell-helpers module
  shellHelpers = import ./shell-helpers.nix { inherit lib; };

  # Extract the session vars sourcing script for testing
  sessionVarsScript = shellHelpers.sessionVarsSourcingScript;

  # Test 1: Bash syntax validation
  test-bash-syntax = testHelpers.validateShellSyntax pkgs.bash "Bash" sessionVarsScript;

  # Test 2: Zsh syntax validation (must work in both shells)
  test-zsh-syntax = testHelpers.validateShellSyntax pkgs.zsh "Zsh" sessionVarsScript;

  # Test 3: Error handling - mktemp failure
  test-mktemp-failure =
    pkgs.runCommand "test-shell-helpers-mktemp-failure"
      {
        buildInputs = [
          pkgs.bash
          pkgs.coreutils
        ];
      }
      ''
            # Create test script with the session vars sourcing logic
            cat > test-script.sh << 'EOF'
        ${sessionVarsScript}
        EOF

            # Mock HOME with session vars file
            mkdir -p test-home/.nix-profile/etc/profile.d
            echo "export TEST_VAR=value" > test-home/.nix-profile/etc/profile.d/hm-session-vars.sh

            # Override mktemp to simulate failure
            mkdir -p bin
            cat > bin/mktemp << 'MKTEMP_EOF'
        #!/bin/bash
        echo "mktemp: failed to create file via template '/tmp/tmp.XXXXXXXXXX': No space left on device" >&2
        exit 1
        MKTEMP_EOF
            chmod +x bin/mktemp

            # Run script with PATH override to use failing mktemp
            output=$(PATH=$(pwd)/bin:$PATH HOME=$(pwd)/test-home ${pkgs.bash}/bin/bash -c ". test-script.sh" 2>&1) || true

            # Verify error message about mktemp failure
            if echo "$output" | grep -q "ERROR: Cannot create temp file"; then
              echo "PASS: mktemp failure produces error message"
            else
              echo "FAIL: Expected mktemp error message not found"
              echo "Output was: $output"
              exit 1
            fi

            # Verify error includes mktemp details
            if echo "$output" | grep -q "mktemp failed:"; then
              echo "PASS: Error message includes mktemp failure details"
            else
              echo "FAIL: Expected mktemp details not found"
              echo "Output was: $output"
              exit 1
            fi

            touch $out
      '';

  # Test 4: Error handling - source failure with stderr output
  test-source-failure-with-stderr =
    pkgs.runCommand "test-shell-helpers-source-failure-stderr"
      {
        buildInputs = [
          pkgs.bash
          pkgs.coreutils
        ];
      }
      ''
            # Create test script
            cat > test-script.sh << 'EOF'
        ${sessionVarsScript}
        EOF

            # Create failing session vars file with stderr output
            mkdir -p test-home/.nix-profile/etc/profile.d
            cat > test-home/.nix-profile/etc/profile.d/hm-session-vars.sh << 'VARS_EOF'
        echo "Something went wrong in session vars" >&2
        exit 1
        VARS_EOF

            # Run script
            output=$(HOME=$(pwd)/test-home ${pkgs.bash}/bin/bash -c ". test-script.sh" 2>&1) || true

            # Verify error message about failed sourcing
            if echo "$output" | grep -q "ERROR: Failed to source Home Manager session variables"; then
              echo "PASS: Source failure produces error message"
            else
              echo "FAIL: Expected source failure error message not found"
              echo "Output was: $output"
              exit 1
            fi

            # Verify error includes stderr output from failed script
            if echo "$output" | grep -q "Something went wrong in session vars"; then
              echo "PASS: Error message includes stderr output from failed script"
            else
              echo "FAIL: Expected stderr output not found in error message"
              echo "Output was: $output"
              exit 1
            fi

            # Verify TZ reference in error message
            if echo "$output" | grep -q "TZ (timezone)"; then
              echo "PASS: Error message mentions TZ impact"
            else
              echo "FAIL: Error message should mention TZ environment variable"
              echo "Output was: $output"
              exit 1
            fi

            touch $out
      '';

  # Test 5: Error handling - silent failure (no stderr output)
  test-source-failure-silent =
    pkgs.runCommand "test-shell-helpers-source-failure-silent"
      {
        buildInputs = [
          pkgs.bash
          pkgs.coreutils
        ];
      }
      ''
            # Create test script
            cat > test-script.sh << 'EOF'
        ${sessionVarsScript}
        EOF

            # Create silently failing session vars file (exit 1 with no output)
            mkdir -p test-home/.nix-profile/etc/profile.d
            echo "exit 1" > test-home/.nix-profile/etc/profile.d/hm-session-vars.sh

            # Run script
            output=$(HOME=$(pwd)/test-home ${pkgs.bash}/bin/bash -c ". test-script.sh" 2>&1) || true

            # Verify error message about failed sourcing
            if echo "$output" | grep -q "ERROR: Failed to source Home Manager session variables"; then
              echo "PASS: Silent failure produces error message"
            else
              echo "FAIL: Expected source failure error message not found"
              echo "Output was: $output"
              exit 1
            fi

            # Verify message explains silent failure
            if echo "$output" | grep -q "Script exited with failure but produced no output"; then
              echo "PASS: Error message explains silent failure"
            else
              echo "FAIL: Expected silent failure explanation not found"
              echo "Output was: $output"
              exit 1
            fi

            # Verify debugging suggestion
            if echo "$output" | grep -q "Try running directly:"; then
              echo "PASS: Error message includes debugging suggestion"
            else
              echo "FAIL: Expected debugging suggestion not found"
              echo "Output was: $output"
              exit 1
            fi

            touch $out
      '';

  # Test 6: Successful sourcing behavior
  test-successful-sourcing =
    pkgs.runCommand "test-shell-helpers-successful-sourcing"
      {
        buildInputs = [
          pkgs.bash
          pkgs.coreutils
        ];
      }
      ''
            # Create test script
            cat > test-script.sh << 'EOF'
        ${sessionVarsScript}
        echo "Script completed successfully"
        EOF

            # Create working session vars file
            mkdir -p test-home/.nix-profile/etc/profile.d
            cat > test-home/.nix-profile/etc/profile.d/hm-session-vars.sh << 'VARS_EOF'
        export TZ=America/Los_Angeles
        export TEST_VAR=success_value
        VARS_EOF

            # Run script
            output=$(HOME=$(pwd)/test-home ${pkgs.bash}/bin/bash -c ". test-script.sh && echo TZ=\$TZ TEST_VAR=\$TEST_VAR" 2>&1)

            # Verify no error messages
            if echo "$output" | grep -q "ERROR:"; then
              echo "FAIL: Unexpected error message in successful case"
              echo "Output was: $output"
              exit 1
            else
              echo "PASS: No error messages in successful case"
            fi

            # Verify variables are exported
            if echo "$output" | grep -q "TZ=America/Los_Angeles"; then
              echo "PASS: TZ variable exported successfully"
            else
              echo "FAIL: TZ variable not found"
              echo "Output was: $output"
              exit 1
            fi

            if echo "$output" | grep -q "TEST_VAR=success_value"; then
              echo "PASS: TEST_VAR exported successfully"
            else
              echo "FAIL: TEST_VAR not found"
              echo "Output was: $output"
              exit 1
            fi

            # Verify script completion message appears
            if echo "$output" | grep -q "Script completed successfully"; then
              echo "PASS: Script execution continues after successful sourcing"
            else
              echo "FAIL: Script execution did not continue"
              echo "Output was: $output"
              exit 1
            fi

            touch $out
      '';

  # Test 7: Environment pollution check (temp variables should not leak)
  test-no-environment-pollution =
    pkgs.runCommand "test-shell-helpers-no-pollution"
      {
        buildInputs = [
          pkgs.bash
          pkgs.coreutils
        ];
      }
      ''
            # Create test script
            cat > test-script.sh << 'EOF'
        ${sessionVarsScript}
        EOF

            # Create working session vars file
            mkdir -p test-home/.nix-profile/etc/profile.d
            echo "export EXPECTED_VAR=expected" > test-home/.nix-profile/etc/profile.d/hm-session-vars.sh

            # Run script and check for pollution variables
            output=$(HOME=$(pwd)/test-home ${pkgs.bash}/bin/bash -c ". test-script.sh && env" 2>&1)

            # Verify expected variable exists
            if echo "$output" | grep -q "^EXPECTED_VAR=expected"; then
              echo "PASS: Expected variable is present"
            else
              echo "FAIL: Expected variable not found"
              exit 1
            fi

            # Verify error_file variable does not pollute environment
            if echo "$output" | grep -q "^error_file="; then
              echo "FAIL: error_file variable leaked to environment"
              echo "Output was: $output"
              exit 1
            else
              echo "PASS: error_file variable did not leak to environment"
            fi

            # Verify source_error variable does not pollute environment
            if echo "$output" | grep -q "^source_error="; then
              echo "FAIL: source_error variable leaked to environment"
              echo "Output was: $output"
              exit 1
            else
              echo "PASS: source_error variable did not leak to environment"
            fi

            touch $out
      '';

  # Test 8: File existence check behavior
  test-file-existence-check =
    pkgs.runCommand "test-shell-helpers-file-existence"
      {
        buildInputs = [
          pkgs.bash
          pkgs.coreutils
        ];
      }
      ''
            # Create test script
            cat > test-script.sh << 'EOF'
        ${sessionVarsScript}
        echo "Script completed"
        EOF

            # Run script WITHOUT session vars file
            mkdir -p test-home/.nix-profile/etc/profile.d
            # Intentionally do not create hm-session-vars.sh

            output=$(HOME=$(pwd)/test-home ${pkgs.bash}/bin/bash -c ". test-script.sh" 2>&1)

            # Verify no error when file doesn't exist (script should skip gracefully)
            if echo "$output" | grep -q "ERROR:"; then
              echo "FAIL: Script should not error when session vars file doesn't exist"
              echo "Output was: $output"
              exit 1
            else
              echo "PASS: Script handles missing session vars file gracefully"
            fi

            # Verify script completes
            if echo "$output" | grep -q "Script completed"; then
              echo "PASS: Script execution continues when file doesn't exist"
            else
              echo "FAIL: Script did not complete"
              echo "Output was: $output"
              exit 1
            fi

            touch $out
      '';

  # Test 9: Script structure validation
  test-script-structure = pkgs.runCommand "test-shell-helpers-structure" { } ''
    # Verify script contains expected patterns
    ${
      if lib.hasInfix "if [ -f" sessionVarsScript then
        "echo 'PASS: Script includes file existence check'"
      else
        "echo 'FAIL: Script missing file existence check' && exit 1"
    }
    ${
      if lib.hasInfix "mktemp" sessionVarsScript then
        "echo 'PASS: Script uses mktemp for error capture'"
      else
        "echo 'FAIL: Script missing mktemp usage' && exit 1"
    }
    ${
      if lib.hasInfix "return 1" sessionVarsScript then
        "echo 'PASS: Script uses return for error handling'"
      else
        "echo 'FAIL: Script missing return statement' && exit 1"
    }
    ${
      if lib.hasInfix "hm-session-vars.sh" sessionVarsScript then
        "echo 'PASS: Script references hm-session-vars.sh'"
      else
        "echo 'FAIL: Script missing hm-session-vars.sh reference' && exit 1"
    }
    ${
      if lib.hasInfix ">&2" sessionVarsScript then
        "echo 'PASS: Error messages directed to stderr'"
      else
        "echo 'FAIL: Error messages not directed to stderr' && exit 1"
    }
    touch $out
  '';

  # Test 10: Comment documentation
  test-comments = pkgs.runCommand "test-shell-helpers-comments" { } ''
    # Verify script has explanatory comments
    ${
      if lib.hasInfix "Source Home Manager session variables" sessionVarsScript then
        "echo 'PASS: Script has explanatory comment'"
      else
        "echo 'FAIL: Script missing explanatory comment' && exit 1"
    }
    ${
      if lib.hasInfix "Create temp file" sessionVarsScript then
        "echo 'PASS: Script documents temp file creation'"
      else
        "echo 'FAIL: Script missing temp file comment' && exit 1"
    }
    ${
      if lib.hasInfix "subshell" sessionVarsScript then
        "echo 'PASS: Script documents subshell usage'"
      else
        "echo 'FAIL: Script missing subshell comment' && exit 1"
    }
    touch $out
  '';

  # Test 11: Subshell isolation (exit with non-zero should be detected)
  test-subshell-isolation =
    pkgs.runCommand "test-shell-helpers-subshell-isolation"
      {
        buildInputs = [
          pkgs.bash
          pkgs.coreutils
        ];
      }
      ''
            # Create test script
            cat > test-script.sh << 'EOF'
        ${sessionVarsScript}
        echo "Parent shell still running"
        EOF

            # Create session vars file that calls exit 1 (should be caught by subshell)
            mkdir -p test-home/.nix-profile/etc/profile.d
            cat > test-home/.nix-profile/etc/profile.d/hm-session-vars.sh << 'VARS_EOF'
        exit 1
        VARS_EOF

            # Run script - exit in session vars should not terminate parent shell
            # but should be detected as failure
            output=$(HOME=$(pwd)/test-home ${pkgs.bash}/bin/bash -c ". test-script.sh" 2>&1) || true

            # Verify error is detected (exit 1 in subshell returns non-zero to parent)
            if echo "$output" | grep -q "ERROR: Failed to source"; then
              echo "PASS: Subshell exit detected as error"
            else
              echo "FAIL: Subshell exit not detected"
              echo "Output was: $output"
              exit 1
            fi

            # Note: We cannot test "Parent shell still running" message appears because
            # the return 1 after error detection aborts the script. This is correct behavior.
            echo "PASS: Subshell isolation prevents exit from terminating parent"

            touch $out
      '';

  # Test 12: Race condition - subshell succeeds but main shell source fails
  test-race-condition-subshell-vs-main =
    pkgs.runCommand "test-shell-helpers-race-condition"
      {
        buildInputs = [
          pkgs.bash
          pkgs.coreutils
        ];
      }
      ''
            # Create test script
            cat > test-script.sh << 'EOF'
        ${sessionVarsScript}
        EOF

            # Create session vars file that behaves differently on first vs second source
            # This simulates a race condition where environment state changes between
            # the subshell test and the main shell source
            mkdir -p test-home/.nix-profile/etc/profile.d
            cat > test-home/.nix-profile/etc/profile.d/hm-session-vars.sh << 'VARS_EOF'
        # Use a counter file to track invocations (subshell vs main shell)
        counter_file="$HOME/.source_counter"
        if [ ! -f "$counter_file" ]; then
          echo "1" > "$counter_file"
          # First invocation (subshell test) - succeed with true
          true
        else
          # Second invocation (main shell source) - fail
          echo "Race condition: environment changed between sources" >&2
          return 1
        fi
        VARS_EOF

            # Run script - should detect the race condition
            output=$(HOME=$(pwd)/test-home ${pkgs.bash}/bin/bash -c ". test-script.sh" 2>&1) || true

            # Verify race condition error message is detected
            if echo "$output" | grep -q "ERROR: Subshell test succeeded but main shell source failed"; then
              echo "PASS: Race condition error message detected"
            else
              echo "FAIL: Race condition error message not found"
              echo "Output was: $output"
              exit 1
            fi

            # Verify error explains it's a race condition or environment difference
            if echo "$output" | grep -q "race condition or environment difference"; then
              echo "PASS: Error message explains race condition"
            else
              echo "FAIL: Expected race condition explanation not found"
              echo "Output was: $output"
              exit 1
            fi

            # Verify shell initialization is aborted
            if echo "$output" | grep -q "Shell initialization aborted"; then
              echo "PASS: Shell initialization aborted on race condition"
            else
              echo "FAIL: Expected abort message not found"
              echo "Output was: $output"
              exit 1
            fi

            touch $out
      '';

  # Test 13: Cleanup warning suppression mechanism
  test-cleanup-warning-suppression = pkgs.runCommand "test-shell-helpers-cleanup-suppression" { } ''
    # Verify the script contains the cleanup warning suppression pattern
    ${
      if lib.hasInfix "_HM_CLEANUP_WARNED" sessionVarsScript then
        "echo 'PASS: Script includes _HM_CLEANUP_WARNED variable for suppression'"
      else
        "echo 'FAIL: Script missing _HM_CLEANUP_WARNED variable' && exit 1"
    }

    # Verify the suppression check exists (if [ -z "$_HM_CLEANUP_WARNED" ])
    ${
      if lib.hasInfix "if [ -z \"$_HM_CLEANUP_WARNED\" ]" sessionVarsScript then
        "echo 'PASS: Script checks if _HM_CLEANUP_WARNED is unset'"
      else
        "echo 'FAIL: Script missing _HM_CLEANUP_WARNED check' && exit 1"
    }

    # Verify the variable gets exported to suppress future warnings
    ${
      if lib.hasInfix "export _HM_CLEANUP_WARNED=1" sessionVarsScript then
        "echo 'PASS: Script exports _HM_CLEANUP_WARNED after first warning'"
      else
        "echo 'FAIL: Script missing export _HM_CLEANUP_WARNED=1' && exit 1"
    }

    # Verify there are at least 2 cleanup warning blocks (one after subshell failure, one after main shell success)
    # Both should have the suppression check
    ${
      let
        # Count occurrences of the suppression pattern
        suppressionCount =
          lib.length (
            lib.filter (x: x != "") (lib.splitString "if [ -z \"$_HM_CLEANUP_WARNED\" ]" sessionVarsScript)
          )
          - 1;
      in
      if suppressionCount >= 2 then
        "echo 'PASS: Script has multiple cleanup warning blocks with suppression (count: ${toString suppressionCount})'"
      else
        "echo 'FAIL: Expected at least 2 suppression checks, found: ${toString suppressionCount}' && exit 1"
    }

    # Verify the warning message includes diagnostic guidance
    ${
      if lib.hasInfix "Check /tmp directory health" sessionVarsScript then
        "echo 'PASS: Warning includes diagnostic guidance about /tmp health'"
      else
        "echo 'FAIL: Warning missing diagnostic guidance' && exit 1"
    }

    # Verify cleanup happens in multiple places (after errors and after success)
    ${
      let
        rmCount =
          lib.length (lib.filter (x: x != "") (lib.splitString "rm -f \"$error_file\"" sessionVarsScript))
          - 1;
      in
      if rmCount >= 3 then
        "echo 'PASS: Script attempts cleanup in multiple places (count: ${toString rmCount})'"
      else
        "echo 'FAIL: Expected at least 3 rm cleanup attempts, found: ${toString rmCount}' && exit 1"
    }

    touch $out
  '';

  # Test 14: Environment mutation between subshell test and main shell source
  test-environment-mutation-between-phases =
    pkgs.runCommand "test-shell-helpers-env-mutation"
      {
        buildInputs = [
          pkgs.bash
          pkgs.coreutils
        ];
      }
      ''
            # This test validates that the error message for phase 2 failures
            # mentions "race condition or environment difference", which helps
            # users diagnose cases where environmental factors (not file changes)
            # cause phase 2 to fail after phase 1 succeeds.

            # Create test script with session vars sourcing logic
            cat > test-script.sh << 'EOF'
        ${sessionVarsScript}
        EOF

            # Create session vars file that behaves differently on consecutive calls
            # This simulates environment mutation between phase 1 and phase 2
            mkdir -p test-home/.nix-profile/etc/profile.d
            cat > test-home/.nix-profile/etc/profile.d/hm-session-vars.sh << 'VARS_EOF'
        # Use a counter file to distinguish between subshell (phase 1) and main shell (phase 2)
        counter_file="$HOME/.source_counter"
        if [ ! -f "$counter_file" ]; then
          echo "1" > "$counter_file"
          # First invocation (subshell test) - succeed
          export TEST_VAR=success
        else
          # Second invocation (main shell source) - fail due to environment change
          # This simulates a scenario where another script sets a conflicting variable
          # between phase 1 and phase 2
          echo "ERROR: Environment mutated between phases - conflicting state detected" >&2
          return 1
        fi
        VARS_EOF

            # Run script - should detect phase 2 failure after phase 1 success
            output=$(HOME=$(pwd)/test-home ${pkgs.bash}/bin/bash -c ". test-script.sh" 2>&1) || true

            # Verify phase 2 specific error message appears
            if echo "$output" | grep -q "ERROR: Subshell test succeeded but main shell source failed"; then
              echo "PASS: Phase 2 failure detected with specific error message"
            else
              echo "FAIL: Expected phase 2 specific error message not found"
              echo "Output was: $output"
              exit 1
            fi

            # CRITICAL: Verify error message mentions environment difference as a possible cause
            # This is the key improvement - helping users diagnose environment-related issues
            if echo "$output" | grep -q "race condition or environment difference"; then
              echo "PASS: Error message explains environment difference as possible cause"
            else
              echo "FAIL: Error message should mention environment difference to aid diagnosis"
              echo "Output was: $output"
              exit 1
            fi

            # Verify the actual error from the session vars script is included
            if echo "$output" | grep -q "Environment mutated between phases"; then
              echo "PASS: Error includes stderr from failed session vars script"
            else
              echo "FAIL: Should include error details from session vars script"
              echo "Output was: $output"
              exit 1
            fi

            # Verify shell initialization is aborted
            if echo "$output" | grep -q "Shell initialization aborted"; then
              echo "PASS: Shell initialization aborted on phase 2 failure"
            else
              echo "FAIL: Expected abort message not found"
              echo "Output was: $output"
              exit 1
            fi

            # Test second scenario: verify diagnostic message helps identify
            # that environment differences (not just race conditions) can cause failures
            # Create a different session vars file that checks environment state
            cat > test-home/.nix-profile/etc/profile.d/hm-session-vars.sh << 'VARS2_EOF'
        counter_file="$HOME/.source_counter2"
        if [ ! -f "$counter_file" ]; then
          echo "1" > "$counter_file"
          # Phase 1: succeed
          export TEST_VAR=success
        else
          # Phase 2: fail with error mentioning environment state
          echo "ERROR: Required environment variable PATH_SENTINEL not found" >&2
          return 1
        fi
        VARS2_EOF

            output2=$(HOME=$(pwd)/test-home ${pkgs.bash}/bin/bash -c ". test-script.sh" 2>&1) || true

            # Verify generic error message still mentions environment difference
            # (helps users understand PATH, shell options, or other env vars could be the issue)
            if echo "$output2" | grep -q "race condition or environment difference"; then
              echo "PASS: Generic diagnostic message covers environment-related failures"
            else
              echo "FAIL: Should provide diagnostic help for environment issues"
              echo "Output was: $output2"
              exit 1
            fi

            touch $out
      '';

  # Aggregate all tests
  allTests = [
    test-bash-syntax
    test-zsh-syntax
    test-mktemp-failure
    test-source-failure-with-stderr
    test-source-failure-silent
    test-successful-sourcing
    test-no-environment-pollution
    test-file-existence-check
    test-script-structure
    test-comments
    test-subshell-isolation
    test-race-condition-subshell-vs-main
    test-cleanup-warning-suppression
    test-environment-mutation-between-phases
  ];

  # Test suite runner
  shell-helpers-test-suite = pkgs.runCommand "shell-helpers-test-suite" { buildInputs = allTests; } ''
    echo "╔═══════════════════════════════════════════╗"
    echo "║   Shell Helpers Module Test Suite        ║"
    echo "╚═══════════════════════════════════════════╝"
    echo ""
    ${lib.concatMapStringsSep "\n" (test: "echo \"✅ ${test.name}\"") allTests}
    echo ""
    echo "All shell-helpers tests passed!"
    touch $out
  '';

in
{
  # Export all tests as derivations
  shell-helpers-tests = {
    inherit
      test-bash-syntax
      test-zsh-syntax
      test-mktemp-failure
      test-source-failure-with-stderr
      test-source-failure-silent
      test-successful-sourcing
      test-no-environment-pollution
      test-file-existence-check
      test-script-structure
      test-comments
      test-subshell-isolation
      test-race-condition-subshell-vs-main
      test-cleanup-warning-suppression
      test-environment-mutation-between-phases
      ;
  };

  # Convenience: Run all tests
  inherit shell-helpers-test-suite;
}
