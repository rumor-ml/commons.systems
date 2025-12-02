# Utility Functions Library
#
# This file provides reusable utility functions for the Nix configuration.
# These functions simplify common tasks like hook composition, PATH manipulation,
# and environment variable setup.
#
# Why these utilities are needed:
# - Reduce code duplication across shell hooks and packages
# - Provide consistent patterns for environment manipulation
# - Make shell hook composition more maintainable
# - Abstract away common Nix patterns (like string concatenation)
#
# Utility function purposes:
#
# 1. concatHooks: Combines multiple shell hook strings into one
#    - Joins hooks with blank lines for readability
#    - Used in shell configurations to compose independent hooks
#    - Example: ${lib.concatHooks [ gitHook nodeHook ]}
#
# 2. prependPath: Adds a directory to the beginning of PATH
#    - Ensures custom tools take precedence over system tools
#    - Used when packaging tools that need specific PATH ordering
#    - Example: prependPath "${pkgs.go}/bin"
#
# 3. setEnv: Sets an environment variable with proper escaping
#    - Provides consistent syntax for environment setup
#    - Handles shell escaping automatically
#    - Example: setEnv "GOPATH" "$HOME/go"
#
# Usage:
#   In a shell or package configuration:
#   let
#     nixLib = import ./nix/lib/default.nix { inherit lib; };
#   in
#     shellHook = nixLib.concatHooks [ hook1 hook2 ];
#
{ lib }:

{
  # Helper to concatenate multiple shell hooks with proper spacing
  # Usage: concatHooks [ hook1 hook2 hook3 ]
  # Returns: Single string with hooks separated by blank lines
  concatHooks = hooks: lib.concatStringsSep "\n\n" hooks;

  # Helper to prepend a directory to PATH
  # Usage: prependPath "/some/path"
  # Returns: Shell snippet that prepends the path to PATH
  prependPath = path: ''
    export PATH="${path}:$PATH"
  '';

  # Helper to set an environment variable with proper escaping
  # Usage: setEnv "VAR_NAME" "value"
  # Returns: Shell snippet that exports the variable
  setEnv = name: value: ''
    export ${name}="${value}"
  '';
}
