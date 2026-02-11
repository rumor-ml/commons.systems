# Zsh Shell Configuration
#
# Enables Home Manager's zsh integration, which manages .zshrc and .zshenv
# by creating symlinks to Nix store files that source Home Manager's configuration.
#
# Key differences:
#   - .zshenv: Sourced by ALL zsh shells (login, non-login, interactive, scripts)
#   - .zshrc: Sourced only by interactive shells (terminal sessions)
#
# Session variables go in .zshenv (via envExtra) to ensure availability everywhere.
# Interactive features go in .zshrc (via initExtra) to avoid affecting scripts.
#
# This ensures that all Home Manager-managed environment variables
# (like TZ for timezone) are properly loaded in new shell sessions.

{ lib, ... }:

let
  shellHelpers = import ./lib/shell-helpers.nix { inherit lib; };
in
{
  programs.zsh = {
    enable = true;

    # Source session variables in zshenv (loaded for all zsh shells)
    # This ensures TZ and other Home Manager variables are always available
    # Shared logic defined in lib/shell-helpers.nix
    envExtra = shellHelpers.sessionVarsSourcingScript;

    # Custom zsh initialization (added to Home Manager-managed .zshrc)
    # Home Manager creates its own .zshrc that sources this content during shell startup
    initExtra = ''
      # TODO(#1637): Zsh completion initialization failure only logs warning without fallback
      if ! autoload -U +X bashcompinit || ! bashcompinit; then
        echo "WARNING: Failed to initialize bash completions for zsh" >&2
      fi

      # Git status in prompt
      # https://git-scm.com/book/en/v2/Appendix-A%3A-Git-in-Other-Environments-Git-in-Zsh
      # TODO(#1639): Zsh vcs_info autoload failure warning provides no error details
      if ! autoload -Uz vcs_info; then
        echo "WARNING: Failed to load vcs_info for git prompt integration" >&2
        echo "  Git branch will not appear in prompt" >&2
        echo "  This may indicate an incomplete zsh installation" >&2
      else
        # TODO(#1636): Warning suppression prevents visibility into repeated failures
        precmd() {
          # Capture stderr to provide diagnostic information
          if ! vcs_info_error=$(vcs_info 2>&1); then
            # Only warn once per session to avoid spam
            if [[ -z "$_VCS_INFO_WARNED" ]]; then
              echo "WARNING: vcs_info failed - git prompt integration disabled" >&2
              echo "  Error: $vcs_info_error" >&2
              echo "  Check git installation and repository health" >&2
              export _VCS_INFO_WARNED=1
            fi
          fi
        }
      fi

      _pr_jobs() {
        # https://superuser.com/questions/1735201/zsh-script-not-printing-output-of-jobs-command
        # TODO(#1670): Multiple error paths in zsh _pr_jobs use one-time warnings that hide recurring failures
        if tmp=$(mktemp 2>&1); then
          # Use separate error variable to capture stderr properly
          if ! print_error=$(print $(jobs) 2>&1 > $tmp); then
            echo "WARNING: Failed to write jobs to temp file: $print_error" >&2
            JOBS=""
          else
            if ! JOBS=$(<"$tmp" 2>&1); then
              echo "WARNING: Failed to read jobs from temp file" >&2
              JOBS=""
            fi
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
          # Show warning only once per session (same pattern as _PR_JOBS_RM_WARNED above)
          if [[ -z "$_PR_JOBS_MKTEMP_WARNED" ]]; then
            echo "WARNING: Failed to create temp file for job display" >&2
            echo "  mktemp error: $tmp" >&2
            echo "  Check /tmp directory permissions and disk space" >&2
            export _PR_JOBS_MKTEMP_WARNED=1
          fi
          JOBS=""
        fi
      }
      # TODO(#1641): Capture and display actual autoload error for better debugging
      if ! autoload -Uz add-zsh-hook; then
        echo "WARNING: Failed to load add-zsh-hook for job display" >&2
        echo "  Background job indicator will not work" >&2
        echo "  This may indicate an incomplete zsh installation" >&2
      else
        add-zsh-hook precmd _pr_jobs
      fi

      setopt PROMPT_SUBST
      HR='''''${(r:$COLUMNS::_:)}'''
      WORKING_PATH='%1d/'
      JOB_SYMBOL='%(1j.%{$c[blue]$c_bold$c_dim%}%{$c_reset%}.)'
      PROMPT="$HR\$JOBS''${VENV_BASE:+(\$VENV_BASE)} $JOB_SYMBOL $WORKING_PATH ''${vcs_info_msg_0_} %% "
      zstyle ':vcs_info:git:*' formats '%b'
    '';
  };
}
