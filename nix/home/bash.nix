# Bash Shell Configuration
#
# Enables Home Manager's bash integration, which manages .bashrc and
# .bash_profile by regenerating them to include Home Manager's session
# variables and environment setup. Note: Home Manager generates these files
# and manages them via symlinks in the Nix store. Any manual edits to these
# files will be ignored - use the 'initExtra' option instead to add custom
# configuration.
#
# This ensures that all Home Manager-managed environment variables
# (like TZ for timezone) are properly loaded in new shell sessions.

{ ... }:

{
  programs.bash = {
    enable = true;

    # Source session variables in interactive shells (both login and non-login interactive shells)
    # This is critical for WSL where new terminal tabs start as non-login interactive shells
    # TODO(#1610): Duplicated session variables sourcing logic in bash.nix and zsh.nix
    initExtra = ''
      # Source Home Manager session variables if not already loaded
      if [ -f "$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh" ]; then
        if ! . "$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh"; then
          echo "WARNING: Failed to source Home Manager session variables" >&2
          echo "  File: $HOME/.nix-profile/etc/profile.d/hm-session-vars.sh" >&2
          echo "  This may affect environment variables like TZ (timezone)" >&2
        fi
      fi
    '';

    # TODO(#1522): Incomplete comment about bash completion in bash.nix
    # Additional bash configuration can be added here as needed
    # For example:
    # enableCompletion = true;
    # historyControl = [ "ignoredups" "ignorespace" ];
  };
}
