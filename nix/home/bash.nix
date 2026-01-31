# Bash Shell Configuration
#
# Enables Home Manager's bash integration, which manages ~/.bashrc by creating
# a symlink to a Nix store file. This generated file sources Home Manager's
# initialization scripts during shell startup.
#
# Manual edits to ~/.bashrc will be overwritten by the symlink on next activation.
# Instead, add configuration via 'initExtra' option, which gets included in the
# generated .bashrc. Direct .bashrc edits will persist until next 'home-manager switch'.
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
    #
    # To check if you're in a login shell: Login shells have $0 starting with '-' (e.g., '-bash').
    # Run 'echo $0' to verify. If you see 'bash' without '-', it's non-login.
    # Why this matters: If session vars aren't loading, check if you're in a login shell that doesn't source .bashrc.
    #
    # Shared logic defined in lib/shell-helpers.nix
    initExtra = shellHelpers.sessionVarsSourcingScript;

    # See Home Manager bash module documentation for available options
  };
}
