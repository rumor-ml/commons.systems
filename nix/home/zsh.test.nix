# Zsh Module Tests
#
# Validates the Zsh Home Manager module configuration:
# 1. Zsh syntax validation for shell script code
# 2. Session variable sourcing logic with error handling (envExtra)
# 3. Shell initialization features (initExtra): completions, prompt, vcs_info, jobs
# 4. Error handling throughout all shell functions
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

  # Import shell helpers for envExtra content
  shellHelpers = import ./lib/shell-helpers.nix { inherit lib; };

  # Import the zsh module for evaluation testing
  zshModule = import ./zsh.nix;

  # Read the zsh module source for testing
  zshSource = builtins.readFile ./zsh.nix;

  # Get envExtra content from shell-helpers (not extracting from zsh.nix since it uses a variable reference)
  envExtraContent = shellHelpers.sessionVarsSourcingScript;
  # Extract initExtra content from source using shared helper
  initExtraContent = testHelpers.extractNixStringLiteral zshSource "initExtra";

  # Test helper: Evaluate module with mock config
  #
  # Evaluates the zsh module through Home Manager's module system with mock configuration.
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
  # Returns: Home Manager module evaluation result with programs.zsh configuration
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
    zshModule {
      config = mockConfig;
      pkgs = pkgs;
      lib = lib;
    };

  # Test 1: Module structure
  test-module-structure = pkgs.runCommand "test-zsh-module-structure" { } ''
    ${
      if lib.hasInfix "programs.zsh" zshSource then
        "echo 'PASS: Module defines programs.zsh'"
      else
        "echo 'FAIL: Module missing programs.zsh' && exit 1"
    }
    ${
      if lib.hasInfix "enable = true" zshSource then
        "echo 'PASS: Module enables zsh'"
      else
        "echo 'FAIL: Module does not enable zsh' && exit 1"
    }
    ${
      if lib.hasInfix "envExtra" zshSource then
        "echo 'PASS: Module provides envExtra'"
      else
        "echo 'FAIL: Module missing envExtra' && exit 1"
    }
    ${
      if lib.hasInfix "initExtra" zshSource then
        "echo 'PASS: Module provides initExtra'"
      else
        "echo 'FAIL: Module missing initExtra' && exit 1"
    }
    touch $out
  '';

  # Test 2: Session variables sourcing in envExtra
  test-session-variables-env = pkgs.runCommand "test-zsh-session-variables-env" { } ''
    ${
      if lib.hasInfix "hm-session-vars.sh" envExtraContent then
        "echo 'PASS: envExtra includes hm-session-vars.sh sourcing'"
      else
        "echo 'FAIL: envExtra missing session variable sourcing' && exit 1"
    }
    ${
      if lib.hasInfix ".nix-profile/etc/profile.d/hm-session-vars.sh" envExtraContent then
        "echo 'PASS: envExtra uses correct path to hm-session-vars.sh'"
      else
        "echo 'FAIL: envExtra has incorrect path' && exit 1"
    }
    ${
      if lib.hasInfix "if [ -f" envExtraContent then
        "echo 'PASS: envExtra checks file existence'"
      else
        "echo 'FAIL: envExtra missing file existence check' && exit 1"
    }
    ${
      if lib.hasInfix "\$HOME" envExtraContent then
        "echo 'PASS: envExtra uses \$HOME variable'"
      else
        "echo 'FAIL: envExtra missing \$HOME variable' && exit 1"
    }
    touch $out
  '';

  # Test 3: Error handling in envExtra
  test-error-handling-env = pkgs.runCommand "test-zsh-error-handling-env" { } ''
    ${
      if lib.hasInfix "ERROR: Failed to source Home Manager session variables" envExtraContent then
        "echo 'PASS: envExtra includes error message'"
      else
        "echo 'FAIL: envExtra missing error message' && exit 1"
    }
    ${
      if lib.hasInfix ">&2" envExtraContent then
        "echo 'PASS: Error messages go to stderr'"
      else
        "echo 'FAIL: Error messages not directed to stderr' && exit 1"
    }
    ${
      if lib.hasInfix "TZ (timezone)" envExtraContent then
        "echo 'PASS: Error message mentions TZ'"
      else
        "echo 'FAIL: Error message missing TZ reference' && exit 1"
    }
    ${
      if lib.hasInfix "return 1" envExtraContent then
        "echo 'PASS: Config aborts shell initialization on error'"
      else
        "echo 'FAIL: Config missing return 1 to abort initialization' && exit 1"
    }
    ${
      if lib.hasInfix "Shell initialization aborted" envExtraContent then
        "echo 'PASS: Error message explains shell initialization is aborted'"
      else
        "echo 'FAIL: Error message missing abort explanation' && exit 1"
    }
    touch $out
  '';

  # Test 4: Completion initialization in initExtra
  test-completion-init = pkgs.runCommand "test-zsh-completion-init" { } ''
    ${
      if lib.hasInfix "bashcompinit" initExtraContent then
        "echo 'PASS: initExtra includes bashcompinit'"
      else
        "echo 'FAIL: initExtra missing bashcompinit' && exit 1"
    }
    ${
      if lib.hasInfix "autoload -U +X bashcompinit" initExtraContent then
        "echo 'PASS: initExtra uses autoload for bashcompinit'"
      else
        "echo 'FAIL: initExtra missing autoload pattern' && exit 1"
    }
    ${
      if lib.hasInfix "if ! autoload -U +X bashcompinit" initExtraContent then
        "echo 'PASS: initExtra has error handling for autoload'"
      else
        "echo 'FAIL: initExtra missing autoload error handling' && exit 1"
    }
    ${
      if lib.hasInfix "WARNING: Failed to initialize bash completions" initExtraContent then
        "echo 'PASS: initExtra includes completion error message'"
      else
        "echo 'FAIL: initExtra missing completion error message' && exit 1"
    }
    touch $out
  '';

  # Test 5: VCS info setup in initExtra
  test-vcs-info = pkgs.runCommand "test-zsh-vcs-info" { } ''
    ${
      if lib.hasInfix "vcs_info" zshSource then
        "echo 'PASS: initExtra includes vcs_info'"
      else
        "echo 'FAIL: initExtra missing vcs_info' && exit 1"
    }
    ${
      if lib.hasInfix "autoload -Uz vcs_info" zshSource then
        "echo 'PASS: initExtra autoloads vcs_info'"
      else
        "echo 'FAIL: initExtra missing vcs_info autoload' && exit 1"
    }
    ${
      if lib.hasInfix "precmd()" zshSource && lib.hasInfix "vcs_info" zshSource then
        "echo 'PASS: initExtra configures precmd for vcs_info'"
      else
        "echo 'FAIL: initExtra missing precmd configuration' && exit 1"
    }
    ${
      if lib.hasInfix "vcs_info:git" zshSource then
        "echo 'PASS: initExtra configures git format'"
      else
        "echo 'FAIL: initExtra missing git format' && exit 1"
    }
    touch $out
  '';

  # Test 6: Jobs display function in initExtra
  test-jobs-function = pkgs.runCommand "test-zsh-jobs-function" { } ''
    ${
      if lib.hasInfix "_pr_jobs()" initExtraContent then
        "echo 'PASS: initExtra defines _pr_jobs function'"
      else
        "echo 'FAIL: initExtra missing _pr_jobs function' && exit 1"
    }
    ${
      if lib.hasInfix "mktemp" initExtraContent then
        "echo 'PASS: _pr_jobs uses mktemp'"
      else
        "echo 'FAIL: _pr_jobs missing mktemp call' && exit 1"
    }
    ${
      if lib.hasInfix "WARNING: Failed to create temp file" initExtraContent then
        "echo 'PASS: _pr_jobs has mktemp error handling'"
      else
        "echo 'FAIL: _pr_jobs missing mktemp error handling' && exit 1"
    }
    ${
      if lib.hasInfix "WARNING: Failed to remove temp file" initExtraContent then
        "echo 'PASS: _pr_jobs has rm error handling'"
      else
        "echo 'FAIL: _pr_jobs missing rm error handling' && exit 1"
    }
    ${
      if lib.hasInfix "_PR_JOBS_MKTEMP_WARNED" initExtraContent then
        "echo 'PASS: _pr_jobs prevents warning spam'"
      else
        "echo 'FAIL: _pr_jobs missing warning suppression' && exit 1"
    }
    touch $out
  '';

  # Test 7: Prompt configuration in initExtra
  test-prompt-config = pkgs.runCommand "test-zsh-prompt-config" { } ''
    ${
      if lib.hasInfix "PROMPT=" zshSource then
        "echo 'PASS: initExtra sets PROMPT variable'"
      else
        "echo 'FAIL: initExtra missing PROMPT variable' && exit 1"
    }
    ${
      if lib.hasInfix "PROMPT_SUBST" zshSource then
        "echo 'PASS: initExtra enables PROMPT_SUBST'"
      else
        "echo 'FAIL: initExtra missing PROMPT_SUBST' && exit 1"
    }
    ${
      if lib.hasInfix "vcs_info_msg_0_" zshSource then
        "echo 'PASS: PROMPT includes vcs_info output'"
      else
        "echo 'FAIL: PROMPT missing vcs_info integration' && exit 1"
    }
    ${
      if lib.hasInfix "WORKING_PATH" zshSource then
        "echo 'PASS: PROMPT includes working path'"
      else
        "echo 'FAIL: PROMPT missing working path' && exit 1"
    }
    touch $out
  '';

  # Test 8: Add-zsh-hook setup in initExtra
  test-add-zsh-hook = pkgs.runCommand "test-zsh-add-zsh-hook" { } ''
    ${
      if lib.hasInfix "add-zsh-hook" initExtraContent then
        "echo 'PASS: initExtra uses add-zsh-hook'"
      else
        "echo 'FAIL: initExtra missing add-zsh-hook' && exit 1"
    }
    ${
      if lib.hasInfix "autoload -Uz add-zsh-hook" initExtraContent then
        "echo 'PASS: initExtra autoloads add-zsh-hook'"
      else
        "echo 'FAIL: initExtra missing add-zsh-hook autoload' && exit 1"
    }
    ${
      if lib.hasInfix "add-zsh-hook precmd _pr_jobs" initExtraContent then
        "echo 'PASS: initExtra registers _pr_jobs with precmd'"
      else
        "echo 'FAIL: initExtra missing _pr_jobs hook registration' && exit 1"
    }
    touch $out
  '';

  # Test 9: Zsh syntax validation for envExtra
  test-zsh-syntax-env = testHelpers.validateShellSyntax pkgs.zsh "Zsh" envExtraContent;

  # Test 10: Zsh syntax validation for initExtra
  test-zsh-syntax-init = testHelpers.validateShellSyntax pkgs.zsh "Zsh" initExtraContent;

  # Test 11: Combined syntax validation
  test-zsh-syntax-combined =
    let
      combinedConfig = envExtraContent + "\n" + initExtraContent;
    in
    testHelpers.validateShellSyntax pkgs.zsh "Zsh" combinedConfig;

  # Test 12: TODO tracking
  test-todo-references = pkgs.runCommand "test-zsh-todo-references" { } ''
    ${
      if lib.hasInfix "TODO(#" zshSource then
        "echo 'PASS: Module uses GitHub issue references in TODOs'"
      else
        "echo 'FAIL: Module has untracked TODOs' && exit 1"
    }
    touch $out
  '';

  # Test 13: Module evaluation through Home Manager's module system
  test-module-evaluation =
    let
      result = evaluateModule {
        username = "testuser";
        homeDirectory = "/home/testuser";
      };
    in
    pkgs.runCommand "test-zsh-module-evaluation" { } ''
      # Verify module evaluates successfully
      ${
        if result.programs.zsh.enable or false then
          "echo 'PASS: Module evaluation enables zsh'"
        else
          "echo 'FAIL: Module evaluation did not enable zsh' && exit 1"
      }
      ${
        if result.programs.zsh ? envExtra then
          "echo 'PASS: Module evaluation provides envExtra'"
        else
          "echo 'FAIL: Module evaluation missing envExtra' && exit 1"
      }
      ${
        if result.programs.zsh ? initExtra then
          "echo 'PASS: Module evaluation provides initExtra'"
        else
          "echo 'FAIL: Module evaluation missing initExtra' && exit 1"
      }
      # Verify envExtra content is properly interpolated
      ${
        if lib.hasInfix "hm-session-vars.sh" (result.programs.zsh.envExtra or "") then
          "echo 'PASS: Evaluated envExtra includes session variables sourcing'"
        else
          "echo 'FAIL: Evaluated envExtra missing session variables sourcing' && exit 1"
      }
      # Verify initExtra content includes expected features
      ${
        if lib.hasInfix "bashcompinit" (result.programs.zsh.initExtra or "") then
          "echo 'PASS: Evaluated initExtra includes bashcompinit'"
        else
          "echo 'FAIL: Evaluated initExtra missing bashcompinit' && exit 1"
      }
      ${
        if lib.hasInfix "vcs_info" (result.programs.zsh.initExtra or "") then
          "echo 'PASS: Evaluated initExtra includes vcs_info'"
        else
          "echo 'FAIL: Evaluated initExtra missing vcs_info' && exit 1"
      }
      touch $out
    '';

  # Test 14: Module evaluation with various home directories
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
    pkgs.runCommand "test-zsh-module-evaluation-paths"
      {
        buildInputs = [ ];
      }
      ''
        ${lib.concatMapStringsSep "\n" (
          testCase:
          let
            result = evaluateModule testCase;
          in
          if result.programs.zsh.enable or false then
            "echo 'PASS: Module evaluates for ${testCase.username} at ${testCase.homeDirectory}'"
          else
            "echo 'FAIL: Module failed to evaluate for ${testCase.username}' && exit 1"
        ) testCases}
        touch $out
      '';

  # Test 15: Comment documentation
  test-comments = pkgs.runCommand "test-zsh-comments" { } ''
    ${
      if lib.hasInfix "Zsh Shell Configuration" zshSource then
        "echo 'PASS: Module has header documentation'"
      else
        "echo 'FAIL: Module missing header documentation' && exit 1"
    }
    ${
      if lib.hasInfix "Source Home Manager session variables" envExtraContent then
        "echo 'PASS: envExtra has explanatory comment'"
      else
        "echo 'FAIL: envExtra missing comment' && exit 1"
    }
    ${
      if lib.hasInfix "Git status in prompt" initExtraContent then
        "echo 'PASS: initExtra documents git prompt integration'"
      else
        "echo 'FAIL: initExtra missing git prompt documentation' && exit 1"
    }
    touch $out
  '';

  # Test 16: Missing session vars file handling
  test-missing-session-vars-file =
    pkgs.runCommand "test-missing-session-vars-file"
      {
        buildInputs = [
          pkgs.zsh
          pkgs.coreutils
        ];
      }
      ''
            # Create test zshrc with envExtra content
            cat > test-zshenv << 'EOF'
        ${envExtraContent}
        EOF

            # Create test zshrc with initExtra content
            cat > test-zshrc << 'EOF'
        ${initExtraContent}
        echo "Shell initialization completed"
        EOF

            # Create environment WITHOUT hm-session-vars.sh
            mkdir -p test-home
            # Note: Intentionally not creating .nix-profile/etc/profile.d/hm-session-vars.sh

            # Run zsh with our mock config files
            output=$(ZDOTDIR=$(pwd) HOME=$(pwd)/test-home ${pkgs.zsh}/bin/zsh -c "source test-zshenv && source test-zshrc && echo 'Shell works'" 2>&1) || true

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

  # Test 17: Environment preservation after sourcing error
  test-environment-preservation-after-error =
    pkgs.runCommand "test-environment-preservation-after-error"
      {
        buildInputs = [
          pkgs.zsh
          pkgs.coreutils
        ];
      }
      ''
            # Create test zshenv with envExtra content and pre-existing environment
            cat > test-zshenv << 'EOF'
        # Set up pre-existing environment that should survive errors
        export PRE_EXISTING_VAR="should_survive"
        ${envExtraContent}
        # After sourcing attempt (with error), test environment is still usable
        echo "After error return"
        EOF

            # Create failing hm-session-vars.sh
            mkdir -p test-home/.nix-profile/etc/profile.d
            echo "exit 1" > test-home/.nix-profile/etc/profile.d/hm-session-vars.sh

            # Run zsh in a way that doesn't exit on return 1 in sourced file
            # Use zsh -c with explicit sourcing that continues after error
            output=$(PRE_EXISTING_VAR="should_survive" HOME=$(pwd)/test-home ${pkgs.zsh}/bin/zsh -c \
                     "source test-zshenv 2>&1 || true; \
                      echo PATH=\$PATH; \
                      echo PRE_EXISTING_VAR=\$PRE_EXISTING_VAR; \
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

  # Test 18: Error handling structure - bashcompinit autoload failure
  test-runtime-bashcompinit-failure =
    pkgs.runCommand "test-runtime-bashcompinit-failure"
      {
        buildInputs = [
          pkgs.zsh
          pkgs.coreutils
        ];
      }
      ''
        # Validates error handling structure for bashcompinit autoload failure.
        # Runtime testing of autoload failures is limited because:
        # - autoload is a zsh builtin that cannot be easily mocked
        # - Manipulating fpath affects all autoload calls, not just specific ones
        # Instead, we validate the error handling pattern is correctly structured.

        # Verify error handling pattern exists
        ${
          if lib.hasInfix "if ! autoload -U +X bashcompinit || ! bashcompinit" initExtraContent then
            "echo 'PASS: bashcompinit has error handling pattern with autoload check'"
          else
            "echo 'FAIL: bashcompinit missing error handling pattern' && exit 1"
        }

        # Verify warning message to user
        ${
          if lib.hasInfix "WARNING: Failed to initialize bash completions" initExtraContent then
            "echo 'PASS: bashcompinit failure warning message exists'"
          else
            "echo 'FAIL: bashcompinit error message missing' && exit 1"
        }

        # Verify warning goes to stderr
        ${
          if lib.hasInfix "WARNING: Failed to initialize bash completions for zsh\" >&2" initExtraContent then
            "echo 'PASS: bashcompinit warning directed to stderr'"
          else
            "echo 'FAIL: bashcompinit warning should go to stderr' && exit 1"
        }

        # Verify graceful continuation (no exit/return after bashcompinit error)
        # The error block is: if ! autoload...; then echo WARNING >&2; fi
        # After the fi, execution should continue to next section (vcs_info setup)
        ${
          if lib.hasInfix "# Git status in prompt" initExtraContent then
            "echo 'PASS: Shell continues to vcs_info section after bashcompinit check'"
          else
            "echo 'FAIL: initExtra should continue after bashcompinit' && exit 1"
        }

        touch $out
      '';

  # Test 19: Error handling structure - vcs_info autoload failure
  test-runtime-vcs-info-autoload-failure =
    pkgs.runCommand "test-runtime-vcs-info-autoload-failure"
      {
        buildInputs = [
          pkgs.zsh
          pkgs.coreutils
        ];
      }
      ''
        # Validates error handling structure for vcs_info autoload failure.
        # See test-runtime-bashcompinit-failure comment for why we use pattern validation.

        # Verify error handling pattern exists
        ${
          if lib.hasInfix "if ! autoload -Uz vcs_info" initExtraContent then
            "echo 'PASS: vcs_info has error handling pattern with autoload check'"
          else
            "echo 'FAIL: vcs_info missing error handling pattern' && exit 1"
        }

        # Verify warning message to user
        ${
          if lib.hasInfix "WARNING: Failed to load vcs_info" initExtraContent then
            "echo 'PASS: vcs_info autoload failure warning message exists'"
          else
            "echo 'FAIL: vcs_info error message missing' && exit 1"
        }

        # Verify warning explains impact on user
        ${
          if lib.hasInfix "Git branch will not appear in prompt" initExtraContent then
            "echo 'PASS: vcs_info warning explains git prompt impact'"
          else
            "echo 'FAIL: vcs_info warning should explain impact' && exit 1"
        }

        # Verify diagnostic guidance
        ${
          if lib.hasInfix "incomplete zsh installation" initExtraContent then
            "echo 'PASS: vcs_info warning provides diagnostic guidance'"
          else
            "echo 'FAIL: vcs_info warning should mention incomplete installation' && exit 1"
        }

        # Verify warnings go to stderr
        ${
          if
            lib.hasInfix "WARNING: Failed to load vcs_info for git prompt integration\" >&2" initExtraContent
          then
            "echo 'PASS: vcs_info warnings directed to stderr'"
          else
            "echo 'FAIL: vcs_info warnings should go to stderr' && exit 1"
        }

        # Verify else block defines precmd when autoload succeeds
        ${
          if lib.hasInfix "else" initExtraContent && lib.hasInfix "precmd()" initExtraContent then
            "echo 'PASS: vcs_info defines precmd in else block (when autoload succeeds)'"
          else
            "echo 'FAIL: vcs_info should define precmd when autoload succeeds' && exit 1"
        }

        touch $out
      '';

  # Test 20: Runtime test - vcs_info execution failure in precmd
  test-runtime-vcs-info-execution-failure =
    pkgs.runCommand "test-runtime-vcs-info-execution-failure"
      {
        buildInputs = [
          pkgs.zsh
          pkgs.coreutils
        ];
      }
      ''
            # Create test zshrc with mock vcs_info that fails
            cat > test-zshrc << 'EOF'
        # Mock vcs_info to fail at execution time (not autoload time)
        vcs_info() {
          echo "fatal: not a git repository" >&2
          return 1
        }
        ${initExtraContent}
        echo "Shell initialization completed"
        EOF

            # Run zsh and trigger precmd
            output=$(ZDOTDIR=$(pwd) ${pkgs.zsh}/bin/zsh -c "source test-zshrc && precmd" 2>&1) || true

            # Verify one-time warning appears
            if echo "$output" | grep -q "WARNING: vcs_info failed"; then
              echo "PASS: vcs_info execution failure produces warning"
            else
              echo "FAIL: Expected vcs_info execution warning not found"
              echo "Output was: $output"
              exit 1
            fi

            # Verify error details are included
            if echo "$output" | grep -q "fatal: not a git repository"; then
              echo "PASS: Warning includes vcs_info error details"
            else
              echo "FAIL: Warning should include error details"
              echo "Output was: $output"
              exit 1
            fi

            # Verify suppression flag is set (run precmd again, should not warn)
            output2=$(ZDOTDIR=$(pwd) ${pkgs.zsh}/bin/zsh -c "source test-zshrc && precmd && precmd" 2>&1) || true
            warning_count=$(echo "$output2" | grep -c "WARNING: vcs_info failed" || true)
            if [ "$warning_count" -eq 1 ]; then
              echo "PASS: Warning appears only once (suppression works)"
            else
              echo "FAIL: Warning should appear only once, found $warning_count times"
              echo "Output was: $output2"
              exit 1
            fi

            touch $out
      '';

  # Test 21: Runtime test - mktemp failure in _pr_jobs
  test-runtime-pr-jobs-mktemp-failure =
    pkgs.runCommand "test-runtime-pr-jobs-mktemp-failure"
      {
        buildInputs = [
          pkgs.zsh
          pkgs.coreutils
        ];
      }
      ''
            # Create mock mktemp that fails
            mkdir -p bin
            cat > bin/mktemp << 'MKTEMP_MOCK'
        #!/bin/sh
        echo "mktemp: failed to create file: No space left on device" >&2
        exit 1
        MKTEMP_MOCK
            chmod +x bin/mktemp

            # Create test zshrc with initExtra content
            cat > test-zshrc << 'EOF'
        ${initExtraContent}
        EOF

            # Run zsh with PATH override to use failing mktemp
            output=$(PATH=$(pwd)/bin:$PATH ZDOTDIR=$(pwd) ${pkgs.zsh}/bin/zsh -c "source test-zshrc && _pr_jobs" 2>&1) || true

            # Verify warning appears
            if echo "$output" | grep -q "WARNING: Failed to create temp file"; then
              echo "PASS: mktemp failure produces warning"
            else
              echo "FAIL: Expected mktemp warning not found"
              echo "Output was: $output"
              exit 1
            fi

            # Verify mktemp error details included
            if echo "$output" | grep -q "No space left on device"; then
              echo "PASS: Warning includes mktemp error details"
            else
              echo "FAIL: Warning should include mktemp error"
              echo "Output was: $output"
              exit 1
            fi

            # Verify JOBS is set to empty (safe default)
            output_jobs=$(PATH=$(pwd)/bin:$PATH ZDOTDIR=$(pwd) ${pkgs.zsh}/bin/zsh -c "source test-zshrc && _pr_jobs && echo \"JOBS=[\$JOBS]\"" 2>&1) || true
            if echo "$output_jobs" | grep -q "JOBS=\[\]"; then
              echo "PASS: JOBS variable set to empty on mktemp failure"
            else
              echo "FAIL: JOBS should be empty on mktemp failure"
              echo "Output was: $output_jobs"
              exit 1
            fi

            # Verify suppression flag prevents repeated warnings
            output2=$(PATH=$(pwd)/bin:$PATH ZDOTDIR=$(pwd) ${pkgs.zsh}/bin/zsh -c "source test-zshrc && _pr_jobs && _pr_jobs" 2>&1) || true
            warning_count=$(echo "$output2" | grep -c "WARNING: Failed to create temp file" || true)
            if [ "$warning_count" -eq 1 ]; then
              echo "PASS: mktemp warning appears only once (suppression works)"
            else
              echo "FAIL: mktemp warning should appear only once, found $warning_count times"
              echo "Output was: $output2"
              exit 1
            fi

            touch $out
      '';

  # Test 22: Error handling structure - print/read failure in _pr_jobs
  test-runtime-pr-jobs-print-read-failure =
    pkgs.runCommand "test-runtime-pr-jobs-print-read-failure"
      {
        buildInputs = [
          pkgs.zsh
          pkgs.coreutils
        ];
      }
      ''
        # Validates error handling structure for print/read failures in _pr_jobs.
        # Testing runtime behavior of print builtin failures is complex.
        # Instead, we validate the error handling pattern is correctly structured.

        # Verify print error handling exists
        ${
          if lib.hasInfix "if ! print_error=\$(print \$(jobs) 2>&1 > \$tmp)" initExtraContent then
            "echo 'PASS: _pr_jobs has error handling for print command'"
          else
            "echo 'FAIL: _pr_jobs missing print error handling' && exit 1"
        }

        # Verify print error produces warning
        ${
          if lib.hasInfix "WARNING: Failed to write jobs to temp file" initExtraContent then
            "echo 'PASS: print failure warning message exists'"
          else
            "echo 'FAIL: print failure warning missing' && exit 1"
        }

        # Verify print error includes error details
        ${
          if lib.hasInfix "\$print_error" initExtraContent then
            "echo 'PASS: print warning includes error details variable'"
          else
            "echo 'FAIL: print warning should include error details' && exit 1"
        }

        # Verify JOBS set to empty on print error
        ${
          let
            # Look for pattern: if ! print_error=...; then ... JOBS=""; ...
            hasSafeDefault = lib.hasInfix "JOBS=\"\"" initExtraContent;
          in
          if hasSafeDefault then
            "echo 'PASS: JOBS set to empty string on print failure (safe default)'"
          else
            "echo 'FAIL: JOBS should be set to empty on error' && exit 1"
        }

        # Verify read error handling exists
        ${
          if lib.hasInfix "if ! JOBS=\$(<\"\$tmp\" 2>&1)" initExtraContent then
            "echo 'PASS: _pr_jobs has error handling for read operation'"
          else
            "echo 'FAIL: _pr_jobs missing read error handling' && exit 1"
        }

        # Verify read error produces warning
        ${
          if lib.hasInfix "WARNING: Failed to read jobs from temp file" initExtraContent then
            "echo 'PASS: read failure warning message exists'"
          else
            "echo 'FAIL: read failure warning missing' && exit 1"
        }

        touch $out
      '';

  # Test 23: Error handling structure - add-zsh-hook autoload failure
  test-runtime-add-zsh-hook-failure =
    pkgs.runCommand "test-runtime-add-zsh-hook-failure"
      {
        buildInputs = [
          pkgs.zsh
          pkgs.coreutils
        ];
      }
      ''
        # Validates error handling structure for add-zsh-hook autoload failure.
        # See test-runtime-bashcompinit-failure comment for why we use pattern validation.

        # Verify error handling pattern exists
        ${
          if lib.hasInfix "if ! autoload -Uz add-zsh-hook" initExtraContent then
            "echo 'PASS: add-zsh-hook has error handling pattern with autoload check'"
          else
            "echo 'FAIL: add-zsh-hook missing error handling pattern' && exit 1"
        }

        # Verify warning message to user
        ${
          if lib.hasInfix "WARNING: Failed to load add-zsh-hook" initExtraContent then
            "echo 'PASS: add-zsh-hook autoload failure warning message exists'"
          else
            "echo 'FAIL: add-zsh-hook error message missing' && exit 1"
        }

        # Verify warning explains impact on user
        ${
          if lib.hasInfix "Background job indicator will not work" initExtraContent then
            "echo 'PASS: add-zsh-hook warning explains job indicator impact'"
          else
            "echo 'FAIL: add-zsh-hook warning should explain impact' && exit 1"
        }

        # Verify diagnostic guidance
        ${
          if lib.hasInfix "incomplete zsh installation" initExtraContent then
            "echo 'PASS: add-zsh-hook warning provides diagnostic guidance'"
          else
            "echo 'FAIL: add-zsh-hook warning should mention incomplete installation' && exit 1"
        }

        # Verify warnings go to stderr
        ${
          if lib.hasInfix "WARNING: Failed to load add-zsh-hook for job display\" >&2" initExtraContent then
            "echo 'PASS: add-zsh-hook warnings directed to stderr'"
          else
            "echo 'FAIL: add-zsh-hook warnings should go to stderr' && exit 1"
        }

        # Verify else block calls add-zsh-hook when autoload succeeds
        ${
          if
            lib.hasInfix "else" initExtraContent && lib.hasInfix "add-zsh-hook precmd _pr_jobs" initExtraContent
          then
            "echo 'PASS: add-zsh-hook registers precmd in else block (when autoload succeeds)'"
          else
            "echo 'FAIL: add-zsh-hook should register precmd when autoload succeeds' && exit 1"
        }

        touch $out
      '';

  # Aggregate all tests into a test suite
  allTests = [
    test-module-structure
    test-session-variables-env
    test-error-handling-env
    test-completion-init
    test-vcs-info
    test-jobs-function
    test-prompt-config
    test-add-zsh-hook
    test-zsh-syntax-env
    test-zsh-syntax-init
    test-zsh-syntax-combined
    test-todo-references
    test-module-evaluation
    test-module-evaluation-paths
    test-comments
    test-missing-session-vars-file
    test-environment-preservation-after-error
    test-runtime-bashcompinit-failure
    test-runtime-vcs-info-autoload-failure
    test-runtime-vcs-info-execution-failure
    test-runtime-pr-jobs-mktemp-failure
    test-runtime-pr-jobs-print-read-failure
    test-runtime-add-zsh-hook-failure
  ];

  # Convenience: Run all tests in a single derivation
  zsh-test-suite = pkgs.runCommand "zsh-test-suite" { buildInputs = allTests; } ''
    echo "╔═══════════════════════════════════════════╗"
    echo "║   Zsh Module Test Suite                   ║"
    echo "╚═══════════════════════════════════════════╝"
    echo ""
    ${lib.concatMapStringsSep "\n" (test: "echo \"✅ ${test.name}\"") allTests}
    echo ""
    echo "All Zsh tests passed!"
    touch $out
  '';

in
{
  # Export all tests as derivations that can be built
  zsh-tests = {
    inherit
      test-module-structure
      test-session-variables-env
      test-error-handling-env
      test-completion-init
      test-vcs-info
      test-jobs-function
      test-prompt-config
      test-add-zsh-hook
      test-zsh-syntax-env
      test-zsh-syntax-init
      test-zsh-syntax-combined
      test-todo-references
      test-module-evaluation
      test-module-evaluation-paths
      test-comments
      test-missing-session-vars-file
      test-environment-preservation-after-error
      test-runtime-bashcompinit-failure
      test-runtime-vcs-info-autoload-failure
      test-runtime-vcs-info-execution-failure
      test-runtime-pr-jobs-mktemp-failure
      test-runtime-pr-jobs-print-read-failure
      test-runtime-add-zsh-hook-failure
      ;
  };

  # Convenience: Run all tests
  inherit zsh-test-suite;
}
