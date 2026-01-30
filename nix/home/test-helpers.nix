# Test Helpers
#
# Shared utilities for testing Home Manager modules.
# This module provides common extraction and validation functions
# to reduce code duplication across test files.

{ pkgs, lib, ... }:

{
  # Extract a Nix string literal attribute from module source code.
  #
  # This function parses module source to extract the content of a
  # string literal attribute (e.g., initExtra, envExtra) by looking
  # for the pattern `attributeName = ''` and collecting lines until
  # the first closing `''` (escaped quotes `''''` are skipped).
  #
  # Note: This assumes standard Nix multiline string format where the
  # closing delimiter appears on its own line.
  #
  # Parameters:
  #   - source: The module source code as a string
  #   - attributeName: The attribute to extract (e.g., "initExtra")
  #
  # Returns:
  #   A string containing the extracted content (without the delimiters)
  #
  # Example:
  #   extractNixStringLiteral bashSource "initExtra"
  #   => "# Content from initExtra\necho 'hello'"
  extractNixStringLiteral =
    source: attributeName:
    let
      lines = lib.splitString "\n" source;
      # Pattern to match: attributeName = ''
      startPattern = "${attributeName} = ''";

      # State machine using tagged union (attrset with _type field)
      # States: initial (searching for start pattern) -> collecting (accumulating lines) -> stopped (found end)
      # This approach prevents bugs like: attempting to add content before finding start pattern,
      # or continuing to collect after finding the end delimiter.
      # The explicit state in _type makes transitions clear and self-documenting.
      initialState = { _type = "initial"; };

      result =
        lib.foldl'
          (
            state: line:
            # State: initial - looking for start pattern
            if state._type == "initial" && lib.hasInfix startPattern line then
              { _type = "collecting"; content = [ ]; }

            # State: collecting - check for closing delimiter or collect line
            # Stop collecting when we hit closing delimiter ''
            # (but not '''' which is Nix's way to escape '' inside multiline strings)
            # Note: Assumes closing delimiter '' appears on its own line (standard Nix multiline format).
            # Edge case: Single-line literals like `foo = ''bar'';` will be misparsed because the parser
            # detects the closing '' on the same line and stops collecting content, returning empty result.
            # This is by design - the function targets standard Nix multiline string formatting where
            # the closing delimiter appears on its own line. Always use multiline format for parsed attributes.
            # Empty multiline strings (opening '' immediately followed by closing '' on next line) will
            # correctly return an empty string.
            else if state._type == "collecting" && lib.hasInfix "''" line && !lib.hasInfix "''''" line then
              { _type = "stopped"; content = state.content; }

            # State: collecting - append line to content
            else if state._type == "collecting" then
              { _type = "collecting"; content = state.content ++ [ line ]; }

            # State: stopped or initial - no transitions, preserve state
            else
              state
          )
          initialState
          lines;
    in
    # Extract content from final state (stopped state has content, others default to empty)
    lib.concatStringsSep "\n" (result.content or [ ]);

  # Validate shell syntax using a shell interpreter.
  #
  # This function creates a derivation that validates shell code syntax
  # by running the shell's syntax check mode (e.g., `bash -n`, `zsh -n`).
  # If validation fails, it outputs detailed error information including
  # the error message, the generated config, and the file path.
  #
  # Parameters:
  #   - shellPkg: The shell package to use for validation (e.g., pkgs.bash, pkgs.zsh)
  #   - shellName: Human-readable name of the shell (e.g., "Bash", "Zsh")
  #   - code: The shell code to validate
  #
  # Returns:
  #   A derivation that validates the syntax and succeeds only if syntax is valid
  #
  # Example:
  #   validateShellSyntax pkgs.bash "Bash" "echo 'hello'"
  #   validateShellSyntax pkgs.zsh "Zsh" "autoload -Uz vcs_info"
  validateShellSyntax =
    shellPkg: shellName: code:
    let
      shellFile = pkgs.writeText "${lib.toLower shellName}-test.sh" code;
      # Assumes shell binary name is lowercase shellName (e.g., "Bash" -> "bash", "Zsh" -> "zsh")
      # This works for common shells (bash, zsh, dash, sh) but may fail for shells with
      # different naming conventions. If adding a new shell, verify the binary name matches
      # the lowercase shell name, or modify this function to accept explicit binary path.
      shellBin = lib.toLower shellName;
    in
    pkgs.runCommand "validate-${lib.toLower shellName}-syntax" { buildInputs = [ shellPkg ]; } ''
      # Validate syntax and capture error output
      if ! shell_error=$(${shellBin} -n '${shellFile}' 2>&1); then
        echo "${shellName} syntax validation failed:"
        echo "----------------------------------------"
        echo "$shell_error"
        echo "----------------------------------------"
        echo ""
        echo "Generated ${lib.toLower shellName} config:"
        cat '${shellFile}'
        echo ""
        echo "Full config at: ${shellFile}"
        exit 1
      fi
      echo "PASS: ${shellName} syntax is valid"
      touch $out
    '';
}
