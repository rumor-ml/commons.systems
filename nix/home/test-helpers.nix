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
  # closing delimiter ('') appears alone on its own line, not after other content.
  #
  # Example of supported format:
  #   initExtra = ''
  #     echo 'hello'
  #   '';
  #
  # Example of unsupported format (will fail to extract):
  #   initExtra = ''
  #     echo 'hello' '';
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
  extractNixStringLiteral =
    source: attributeName:
    let
      lines = lib.splitString "\n" source;
      # Pattern to match: attributeName = ''
      startPattern = "${attributeName} = ''";

      # Valid state types for the parser state machine
      validStateTypes = [
        "initial"
        "collecting"
        "stopped"
      ];

      # State constructor functions with validation to enforce invariants
      # Note: Use these constructors to create states (enforces validation).
      # Accessors (getStateType, etc.) are provided for consistency but internal
      # implementation may use direct field access for performance.
      # External code should prefer accessors to maintain encapsulation.
      mkInitialState =
        assert lib.assertMsg true "mkInitialState: no parameters required";
        {
          _type = "initial";
        };

      mkCollectingState =
        content:
        let
          state = {
            _type = "collecting";
            inherit content;
          };
        in
        assert lib.assertMsg (lib.isList content) "mkCollectingState: content must be a list";
        assert lib.assertMsg (lib.elem state._type validStateTypes) "Invalid state type: ${state._type}";
        state;

      mkStoppedState =
        content:
        let
          state = {
            _type = "stopped";
            inherit content;
          };
        in
        assert lib.assertMsg (lib.isList content) "mkStoppedState: content must be a list";
        assert lib.assertMsg (lib.elem state._type validStateTypes) "Invalid state type: ${state._type}";
        state;

      # Validation function to check state invariants at usage boundaries
      # This provides defense-in-depth against invalid state creation outside constructors
      validateState =
        state:
        let
          hasValidType = lib.elem (state._type or null) validStateTypes;
          contentValid =
            if state._type == "initial" then !(state ? content) else lib.isList (state.content or null);
        in
        assert lib.assertMsg hasValidType "Invalid state type: ${state._type or "<missing>"}";
        assert lib.assertMsg contentValid "State ${state._type} must have list content";
        state;

      # Accessor functions to hide internal structure and improve encapsulation
      # These validate state invariants before accessing fields
      getStateType = state: (validateState state)._type;
      getStateContent = state: (validateState state).content or [ ];
      isCollecting = state: (validateState state)._type == "collecting";
      isStopped = state: (validateState state)._type == "stopped";

      # Parser states: initial (scanning) → collecting (accumulating) → stopped (done)
      initialState = mkInitialState;

      result = lib.foldl' (
        state: line:
        let
          stateType = getStateType state;
          stateContent = getStateContent state;
        in
        # State: initial - looking for start pattern
        if stateType == "initial" && lib.hasInfix startPattern line then
          mkCollectingState [ ]

        # State: collecting - check for closing delimiter or collect line
        # Stop collecting when we hit a line containing '' (closing delimiter)
        # UNLESS the line also contains '''' (escaped quotes within the string)
        # This handles: lines with only '' (stop), lines with only '''' (continue),
        # lines with both (continue - not a standalone closing delimiter)
        else if isCollecting state && lib.hasInfix "''" line && !lib.hasInfix "''''" line then
          mkStoppedState stateContent

        # State: collecting - append line to content
        else if isCollecting state then
          mkCollectingState (stateContent ++ [ line ])

        # State: stopped or initial - no transitions, preserve state
        else
          state
      ) initialState lines;
    in
    # Note: Returns empty string if extraction failed (attribute not found,
    # closing delimiter missing, or format mismatch). For required attributes,
    # callers should validate non-empty result to catch typos or format changes.
    # See TODO(#1699) about adding strict mode.
    lib.concatStringsSep "\n" (getStateContent result);

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
      # Currently infers binary name by lowercasing shellName
      shellBin = lib.toLower shellName;
      shellBinPath = "${shellPkg}/bin/${shellBin}";
    in
    pkgs.runCommand "validate-${lib.toLower shellName}-syntax" { buildInputs = [ shellPkg ]; } ''
      # Validate that shell binary exists
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
