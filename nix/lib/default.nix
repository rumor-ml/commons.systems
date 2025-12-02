# Utility functions for Nix configuration
{ pkgs, lib }:

{
  # Helper to create shell hook snippets
  # Usage: mkShellHook "echo hello"
  mkShellHook = content: content;

  # Helper to concatenate multiple shell hooks
  # Usage: concatHooks [ hook1 hook2 hook3 ]
  concatHooks = hooks: lib.concatStringsSep "\n\n" hooks;

  # Helper for path setup
  # Usage: prependPath "/some/path"
  prependPath = path: ''
    export PATH="${path}:$PATH"
  '';

  # Helper for environment variable setup
  # Usage: setEnv "VAR_NAME" "value"
  setEnv = name: value: ''
    export ${name}="${value}"
  '';
}
