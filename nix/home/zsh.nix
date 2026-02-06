# Zsh Shell Configuration
#
# Enables Home Manager's zsh integration, which manages .zshrc and .zshenv
# by regenerating them to include Home Manager's session variables and
# environment setup.
#
# This ensures that all Home Manager-managed environment variables
# (like TZ for timezone) are properly loaded in new shell sessions.

{ ... }:

{
  programs.zsh = {
    enable = true;

    # Source session variables in zshenv (loaded for all zsh shells)
    # This ensures TZ and other Home Manager variables are always available
    envExtra = ''
      # Source Home Manager session variables
      if [ -f "$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh" ]; then
        if ! . "$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh"; then
          echo "WARNING: Failed to source Home Manager session variables" >&2
          echo "  File: $HOME/.nix-profile/etc/profile.d/hm-session-vars.sh" >&2
          echo "  This may affect environment variables like TZ (timezone)" >&2
        fi
      fi
    '';

    # TODO(#1520): Misleading comment about preserving existing configuration in zsh.nix
    # Preserve existing configuration from the current .zshrc
    initExtra = ''
      if ! autoload -U +X bashcompinit || ! bashcompinit; then
        echo "WARNING: Failed to initialize bash completions for zsh" >&2
      fi

      # Git status in prompt
      # https://git-scm.com/book/en/v2/Appendix-A%3A-Git-in-Other-Environments-Git-in-Zsh
      autoload -Uz vcs_info
      precmd() { vcs_info }

      _pr_jobs() {
        # https://superuser.com/questions/1735201/zsh-script-not-printing-output-of-jobs-command
        if tmp=$(mktemp 2>/dev/null); then
          print $(jobs) > $tmp 2>/dev/null
          JOBS=$(< $tmp)
          rm -f $tmp
        else
          # Fallback: set JOBS to empty if mktemp fails
          JOBS=""
        fi
      }
      autoload -Uz add-zsh-hook
      add-zsh-hook precmd _pr_jobs

      setopt PROMPT_SUBST
      HR='''''${(r:$COLUMNS::_:)}'''
      WORKING_PATH='%1d/'
      JOB_SYMBOL='%(1j.%{$c[blue]$c_bold$c_dim%}%{$c_reset%}.)'
      PROMPT="$HR\$JOBS''${VENV_BASE:+(\$VENV_BASE)} $JOB_SYMBOL $WORKING_PATH ''${vcs_info_msg_0_} %% "
      zstyle ':vcs_info:git:*' formats '%b'
    '';
  };
}
