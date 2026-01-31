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
  # TODO(#1699): Add strict mode or logging for extraction failures
  # TODO(#1710): Add state constructor functions with validation
  extractNixStringLiteral =
    source: attributeName:
    let
      lines = lib.splitString "\n" source;
      # Pattern to match: attributeName = ''
      startPattern = "${attributeName} = ''";

      # Track parser state using _type field with three states:
      #   - "initial": Scanning lines, looking for the start pattern (attributeName = '')
      #   - "collecting": Found start, accumulating content lines
      #   - "stopped": Found closing delimiter (''), extraction complete
      # Using explicit states prevents continuing to scan after extraction is done.
      initialState = {
        _type = "initial";
      };

      result = lib.foldl' (
        state: line:
        # State: initial - looking for start pattern
        if state._type == "initial" && lib.hasInfix startPattern line then
          {
            _type = "collecting";
            content = [ ];
          }

        # State: collecting - check for closing delimiter or collect line
        # Stop collecting when we hit closing delimiter ''
        # (but not '''' which is Nix's way to escape '' inside multiline strings)
        else if state._type == "collecting" && lib.hasInfix "''" line && !lib.hasInfix "''''" line then
          {
            _type = "stopped";
            content = state.content;
          }

        # State: collecting - append line to content
        else if state._type == "collecting" then
          {
            _type = "collecting";
            content = state.content ++ [ line ];
          }

        # State: stopped or initial - no transitions, preserve state
        else
          state
      ) initialState lines;
    in
    # Extract content from final state
    #   - 'stopped' state: extraction succeeded, return accumulated content
    #   - 'collecting'/'initial' states: extraction failed, return empty (silently ignores malformed input)
    # TODO(#1699): Add strict mode to error on malformed input instead of returning empty
    lib.concatStringsSep "\n" (result.content or [ ]);

  # Validate shell syntax using a shell interpreter.
  #
  # This function creates a derivation that validates shell code syntax
  # by running the shell's syntax check mode (e.g., `bash -n`, `zsh -n`).
  # If validation fails, it outputs detailed error information including
  # the error message, the generated config, and the file path.
  #
  # TODO(#1672): extractNixStringLiteral silently returns empty string on malformed input
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
      # TODO(#1686): Make shell binary name and validation flag explicit parameters
      # Currently infers binary name by lowercasing shellName ("Bash" -> "bash").
      # This is validated at build time (derivation checks binary exists), but explicit
      # parameters would make the API clearer and reduce coupling to naming convention.
      # Tested shells: bash, zsh, dash, sh (any shell supporting -n syntax check flag)
      shellBin = lib.toLower shellName;
      shellBinPath = "${shellPkg}/bin/${shellBin}";
    in
    pkgs.runCommand "validate-${lib.toLower shellName}-syntax" { buildInputs = [ shellPkg ]; } ''
      # Validate that shell binary exists (enforces naming assumption)
      if ! command -v ${shellBin} >/dev/null 2>&1; then
        echo "ERROR: Shell binary '${shellBin}' not found in PATH"
        echo "This indicates shellName '${shellName}' does not match the shell binary name when lowercased."
        echo "Supported shells: bash, zsh, dash, sh"
        echo "Available binaries in ${shellPkg}/bin:"
        ls -1 ${shellPkg}/bin/ || echo "(failed to list binaries)"
        exit 1
      fi

      # Validate syntax and capture error output
      # TODO(#1701): Improve error reporting by showing context around syntax errors
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
