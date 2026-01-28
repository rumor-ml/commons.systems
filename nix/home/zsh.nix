# Zsh Shell Configuration
#
# Enables Home Manager's zsh integration, which manages .zshrc and .zshenv
# by creating symlinks to Nix store files that source Home Manager's configuration.
#
# This ensures that all Home Manager-managed environment variables
# (like TZ for timezone) are properly loaded in new shell sessions.

{ ... }:

{
  programs.zsh = {
    enable = true;

    # Source session variables in zshenv (loaded for all zsh shells)
    # This ensures TZ and other Home Manager variables are always available
    # TODO(#1610): Duplicated session variables sourcing logic in bash.nix and zsh.nix
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

    # Custom zsh configuration (replaces .zshrc content when Home Manager is enabled)
    initExtra = ''
      if ! autoload -U +X bashcompinit || ! bashcompinit; then
        echo "WARNING: Failed to initialize bash completions for zsh" >&2
      fi

      # Git status in prompt
      # https://git-scm.com/book/en/v2/Appendix-A%3A-Git-in-Other-Environments-Git-in-Zsh
      # TODO(#1616): Consider adding error handling for autoload commands in zsh.nix
      autoload -Uz vcs_info
      precmd() { vcs_info }

      _pr_jobs() {
        # https://superuser.com/questions/1735201/zsh-script-not-printing-output-of-jobs-command
        if tmp=$(mktemp 2>&1); then
          # Use separate error variable to capture stderr properly
          if ! print_error=$(print $(jobs) 2>&1 > $tmp); then
            echo "WARNING: Failed to write jobs to temp file: $print_error" >&2
          fi
          if ! JOBS=$(<"$tmp" 2>&1); then
            echo "WARNING: Failed to read jobs from temp file" >&2
            JOBS=""
          fi
          if ! rm "$tmp" 2>/dev/null; then
            # Only warn once per session to avoid spam
            if [[ -z "$_PR_JOBS_RM_WARNED" ]]; then
              echo "WARNING: Failed to remove temp file: $tmp" >&2
              echo "  Check /tmp permissions and disk space" >&2
              export _PR_JOBS_RM_WARNED=1
            fi
          fi
        else
          # Show warning on first mktemp failure to alert user of broken job display
          if [[ -z "$_PR_JOBS_MKTEMP_WARNED" ]]; then
            echo "WARNING: Failed to create temp file for job display" >&2
            echo "  mktemp error: $tmp" >&2
            echo "  Check /tmp directory permissions and disk space" >&2
            export _PR_JOBS_MKTEMP_WARNED=1
          fi
          JOBS=""
        fi
      }
      # TODO(#1617): Consider adding error handling for add-zsh-hook in zsh.nix
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
