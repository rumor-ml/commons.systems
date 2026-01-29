# Claude Code CLI Configuration
#
# Installs Claude Code from the community flake (sadjow/claude-code-nix)
# which provides hourly updates for the latest releases.
#
# Claude Code is Anthropic's official CLI for AI-assisted development.
# After activation, the 'claude' command will be available system-wide.
#
# This module deploys Claude Code and its settings. Sandbox dependencies
# (socat, bubblewrap) are declared in flake.nix. The settings.json has
# sandbox enabled with auto-allowed commands for git, gh, gcloud, nix,
# go mod tidy, and pnpm.

{ pkgs, ... }:

{
  home.packages = [ pkgs.claude-code ];

  # TODO(#1608): claude-code.nix overwrites user settings.json without warning or backup
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
