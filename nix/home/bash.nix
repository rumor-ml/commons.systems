# Bash Shell Configuration
#
# Enables Home Manager's bash integration, which automatically manages
# .bashrc and .bash_profile to source Home Manager's session variables
# and environment setup.
#
# This ensures that all Home Manager-managed environment variables
# (like TZ for timezone) are properly loaded in new shell sessions.

{ config, pkgs, ... }:

{
  programs.bash = {
    enable = true;

    # Source session variables in all interactive shells (not just login shells)
    # This is critical for WSL where new terminal tabs start as non-login shells
    initExtra = ''
      # Source Home Manager session variables if not already loaded
      if [ -f "$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh" ]; then
        . "$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh"
      fi
    '';

    # Additional bash configuration can be added here as needed
    # For example:
    # enableCompletion = true;
    # historyControl = [ "ignoredups" "ignorespace" ];
  };
}
