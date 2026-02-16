# GitHub CLI Configuration
#
# Installs the GitHub CLI (gh) for managing GitHub repositories, pull requests,
# issues, and workflows from the command line.
#
# After activation, the 'gh' command will be available system-wide.
#
# GitHub CLI provides:
# - Repository management (clone, create, fork)
# - Pull request operations (create, review, merge)
# - Issue tracking (create, list, view)
# - GitHub Actions workflow management
# - API access via 'gh api'
#
# Authentication:
#   First time: gh auth login
#   Status: gh auth status
#
# Learn more: https://cli.github.com/

{ pkgs, ... }:

{
  home.packages = [ pkgs.gh ];
}
