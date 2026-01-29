# Bash Shell Configuration
#
# Enables Home Manager's bash integration, which manages bash configuration
# by adding its own initialization scripts that are sourced during shell
# startup. Manual edits to .bashrc will still work, but Home Manager-specific
# configuration should be added via the 'initExtra' option.
#
# This ensures that all Home Manager-managed environment variables
# (like TZ for timezone) are properly loaded in new shell sessions.

{ ... }:

{
  programs.bash = {
    enable = true;

    # Source session variables in interactive non-login shells (via .bashrc)
    # This is critical for WSL where new terminal tabs start as non-login interactive shells.
    # Note: Login shells won't load this unless they explicitly source .bashrc.
    # TODO(#1610): Duplicated session variables sourcing logic in bash.nix and zsh.nix
    # TODO(#1638): Bash and Zsh session variable sourcing continues after failure with only warning
    initExtra = ''
      # Source Home Manager session variables if not already loaded
      if [ -f "$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh" ]; then
        if ! source_error=$(. "$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh" 2>&1); then
          echo "WARNING: Failed to source Home Manager session variables" >&2
          echo "  File: $HOME/.nix-profile/etc/profile.d/hm-session-vars.sh" >&2
          echo "  Error: $source_error" >&2
          echo "  This may affect environment variables like TZ (timezone)" >&2
        fi
      fi
    '';

    # Additional Home Manager bash options can be added here as needed:
    # enableCompletion = true;  # Enable programmable completion (tab completion)
    # historyControl = [ "ignoredups" "ignorespace" ];  # History filtering
    # See Home Manager manual for complete list of available options
  };
}
