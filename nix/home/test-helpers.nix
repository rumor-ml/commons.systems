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
  # TODO(#1640): extractNixStringLiteral accumulator state has weak invariants
  extractNixStringLiteral =
    source: attributeName:
    let
      lines = lib.splitString "\n" source;
      # Pattern to match: attributeName = ''
      startPattern = "${attributeName} = ''";
      result =
        lib.foldl'
          (
            acc: line:
            # Stop collecting when we hit closing delimiter ''
            # (but not '''' which is Nix's way to escape '' inside multiline strings)
            if acc.found && lib.hasInfix "''" line && acc.collecting && !lib.hasInfix "''''" line then
              acc // { collecting = false; }
            # Collect lines when we're inside the string literal
            else if acc.found && acc.collecting then
              acc // { content = acc.content ++ [ line ]; }
            # Start collecting when we find the opening pattern
            else if lib.hasInfix startPattern line then
              acc
              // {
                found = true;
                collecting = true;
              }
            else
              acc
          )
          {
            found = false;
            collecting = false;
            content = [ ];
          }
          lines;
    in
    lib.concatStringsSep "\n" result.content;

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
      # Use lowercase shell name as the binary name (works for bash, zsh)
      # Note: assumes shell binary name matches lowercase shell name
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
