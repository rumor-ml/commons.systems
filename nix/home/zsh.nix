# Zsh Shell Configuration
#
# Enables Home Manager's zsh integration, which automatically manages
# .zshrc and .zshenv to source Home Manager's session variables
# and environment setup.
#
# This ensures that all Home Manager-managed environment variables
# (like TZ for timezone) are properly loaded in new shell sessions.

{ config, pkgs, ... }:

{
  programs.zsh = {
    enable = true;

    # Source session variables in zshenv (loaded for all zsh shells)
    # This ensures TZ and other Home Manager variables are always available
    envExtra = ''
      # Source Home Manager session variables
      if [ -f "$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh" ]; then
        . "$HOME/.nix-profile/etc/profile.d/hm-session-vars.sh"
      fi
    '';

    # Preserve existing configuration from the current .zshrc
    initExtra = ''
      autoload -U +X bashcompinit && bashcompinit

      # direnv hook (only if direnv is installed)
      if command -v direnv &> /dev/null; then
        eval "$(direnv hook zsh)"
      fi

      # Git status in prompt
      # https://git-scm.com/book/en/v2/Appendix-A%3A-Git-in-Other-Environments-Git-in-Zsh
      autoload -Uz vcs_info
      precmd() { vcs_info }

      _pr_jobs() {
        # https://superuser.com/questions/1735201/zsh-script-not-printing-output-of-jobs-command
        tmp=$(mktemp)
        print $(jobs) > $tmp
        JOBS=$(< $tmp)
        rm $tmp
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
