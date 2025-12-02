# Tool organization by category
# This file defines package sets that can be composed for different shells
{ pkgs }:

{
  # Core development tools - essential utilities
  core = with pkgs; [
    bash
    coreutils
    git
    gh
    jq
    curl
  ];

  # Cloud & Infrastructure tools
  cloud = with pkgs; [
    google-cloud-sdk
    terraform
  ];

  # Node.js ecosystem
  nodejs = with pkgs; [
    nodejs      # Currently using default version, can pin to nodejs_20
    pnpm
    firebase-tools  # For Firebase Emulator Suite
  ];

  # Go toolchain and tools
  golang = with pkgs; [
    go          # Currently using default version, can pin to go_1_24
    gopls       # Go language server
    gotools     # Additional Go utilities
    air         # Live reload for Go
    templ       # Go template tool
  ];

  # Development utilities
  devtools = with pkgs; [
    tmux
  ];

  # Composite sets for different use cases
  # All tools - for the universal development shell
  all =
    let
      sets = {
        inherit (pkgs.callPackage ./package-sets.nix {}) core cloud nodejs golang devtools;
      };
    in
      sets.core ++ sets.cloud ++ sets.nodejs ++ sets.golang ++ sets.devtools;

  # CI subset - minimal tools needed for CI/CD
  # Note: CI currently doesn't need Node.js tools since it uses setup-node action
  ci =
    let
      sets = {
        inherit (pkgs.callPackage ./package-sets.nix {}) core cloud golang devtools;
      };
    in
      sets.core ++ sets.cloud ++ sets.golang ++ sets.devtools;
}
