# Claude Code CLI Configuration
#
# Installs Claude Code from the community flake (sadjow/claude-code-nix)
# which provides hourly updates for the latest releases.
#
# Claude Code is Anthropic's official CLI for AI-assisted development.
# After activation, the 'claude' command will be available system-wide.

{ pkgs, ... }:

{
  home.packages = [ pkgs.claude-code ];
}
