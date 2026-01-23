# Claude Code CLI Configuration
#
# Installs Claude Code from the community flake (sadjow/claude-code-nix)
# which provides hourly updates for the latest releases.
#
# Claude Code is Anthropic's official CLI for AI-assisted development.
# After activation, the 'claude' command will be available system-wide.
#
# This module also deploys a default settings.json with sandbox enabled
# and auto-allowed commands for git, gh, gcloud, nix, go mod tidy, and pnpm.

{ pkgs, ... }:

{
  home.packages = [ pkgs.claude-code ];

  # Deploy default configuration with sandbox enabled
  xdg.configFile."claude/settings.json" = {
    text = builtins.toJSON {
      sandbox = {
        enabled = true;
        autoAllowBashIfSandboxed = true;
        excludedCommands = [
          "git"
          "gh"
          "gcloud"
          "nix"
          "go mod tidy"
          "pnpm"
        ];
      };
    };
  };
}
