{ }:

''
  # Git worktree configuration
  # Enables worktreeConfig extension to prevent core.bare from affecting worktrees
  # See: https://git-scm.com/docs/git-worktree#_configuration_file
  # Related bug: https://lore.kernel.org/git/3b549770eb9133fc78739ecc4eaba274e138076f.1640015844.git.gitgitgadget@gmail.com/T/

  if git rev-parse --git-dir &>/dev/null; then
    GIT_COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null)

    # Enable worktreeConfig extension if not already enabled
    if [ "$(git config --get extensions.worktreeConfig 2>/dev/null)" != "true" ]; then
      git config extensions.worktreeConfig true
      echo "git-worktree: Enabled extensions.worktreeConfig"
    fi

    # Ensure core.bare is false in the main repo config
    if [ "$(git config --get core.bare 2>/dev/null)" = "true" ]; then
      git config core.bare false
      echo "git-worktree: Fixed core.bare=true (set to false)"
    fi
  fi
''
