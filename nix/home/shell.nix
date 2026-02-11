# Shell Configuration for Home Manager
#
# This module configures bash and zsh shells.
# Home Manager will create .bashrc and .zshrc files automatically.

{ pkgs, ... }:

{
  # Bash configuration
  programs.bash = {
    enable = true;
  };

  # Zsh configuration
  programs.zsh = {
    enable = true;

    # Basic zsh options
    enableCompletion = true;
    autosuggestion.enable = true;
    syntaxHighlighting.enable = true;

    # History settings
    history = {
      size = 10000;
      save = 10000;
      path = "$HOME/.zsh_history";
      ignoreDups = true;
      share = true;
    };
  };
}
