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
      ;
  };

  # Convenience: Run all tests
  inherit zsh-test-suite;
}
