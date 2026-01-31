# Bash Shell Configuration
#
# Enables Home Manager's bash integration, which manages bash configuration
# by adding its own initialization scripts that are sourced during shell
# startup. Manual edits to .bashrc will still work, but Home Manager-specific
# configuration should be added via the 'initExtra' option.
#
# This ensures that all Home Manager-managed environment variables
# (like TZ for timezone) are properly loaded in new shell sessions.

{ lib, ... }:

let
  shellHelpers = import ./lib/shell-helpers.nix { inherit lib; };
in
{
  programs.bash = {
    enable = true;

    # Source session variables in interactive non-login shells (via .bashrc)
    # This is critical for WSL where new terminal tabs start as non-login interactive shells.
    # Note: Login shells won't load this unless they explicitly source .bashrc.
    # To check shell type: Login shells have $0 starting with '-', run 'echo $0' to verify.
    # Shared logic defined in lib/shell-helpers.nix
    initExtra = shellHelpers.sessionVarsSourcingScript;

    # See Home Manager bash module documentation for available options
  };
}
