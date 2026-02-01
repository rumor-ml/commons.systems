# Bash Shell Configuration
#
# Enables Home Manager's bash integration, which manages ~/.bashrc by creating
# a symlink to a Nix store file. This generated file sources Home Manager's
# initialization scripts during shell startup.
#
# Manual edits to ~/.bashrc are not possible because it is a symlink to a read-only file in the Nix store.
# If you delete the symlink and create a regular file, your changes will be lost on the next
# 'home-manager switch' activation when the symlink is recreated.
# To add custom configuration, use the 'initExtra' option which gets included in the
# generated .bashrc content and persists across activations.
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

    # Source session variables in interactive non-login shells (via .bashrc).
    # WSL starts new terminal tabs as non-login interactive shells, so this ensures
    # environment variables are available in new tabs.
    #
    # Note: Login shells won't load this unless they explicitly source .bashrc.
    # To check if bash is a login shell:
    #   - Reliable: Run 'shopt -q login_shell && echo "login" || echo "non-login"'
    #   - Heuristic: Run 'echo $0'. Login shells typically show '-bash', non-login show 'bash'
    #     (leading dash convention may vary by system)
    #
    # Shared logic defined in lib/shell-helpers.nix
    initExtra = shellHelpers.sessionVarsSourcingScript;

    # See Home Manager bash module documentation for available options
  };
}
