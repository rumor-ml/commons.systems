# Modular Tool Organization
#
# This file organizes development tools into logical categories that can be
# composed to create different development shells with varying tool sets.
#
# Why this approach?
# - Clarity: Easy to find and understand tool categories
# - Maintainability: Adding/removing tools is straightforward
# - Composability: Different shells can mix and match categories
# - Documentation: Categories serve as inline documentation
#
# How to add a tool:
# 1. Determine the appropriate category (core, cloud, nodejs, golang, devtools)
# 2. Add the package to that category's list
# 3. If the tool doesn't fit existing categories, consider creating a new one
#
# Example - Adding ripgrep to core tools:
#   core = with pkgs; [
#     bash
#     coreutils
#     ripgrep  # Add here
#   ];
#
# Why split by category?
# - Makes it easy to create specialized shells (e.g., frontend-only, backend-only)
# - Allows CI to use a minimal subset of tools for faster builds
# - Documents which tools serve which purpose
#
{ pkgs }:

let
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
    nodejs # Currently using default version, can pin to nodejs_20
    pnpm
    # firebase-tools removed: causes segfault in Nix evaluator
    #
    # Platform: Primarily observed on macOS (darwin), may affect other platforms
    # Issue: Nix evaluator crashes with segmentation fault when firebase-tools
    #        is included in package sets via callPackage pattern
    # Related: Same underlying issue as nix/shells/default.nix callPackage problem
    #
    # Workaround: Install via pnpm instead: pnpm add -g firebase-tools
    # This provides the same functionality without triggering Nix evaluator issues
    #
    # References:
    # - Segfault fix commit: 72d9d78
  ];

  # Go toolchain and tools
  golang = with pkgs; [
    go # Currently using default version, can pin to go_1_24
    gopls # Go language server
    gotools # Additional Go utilities
    air # Live reload for Go
    templ # Go template tool
  ];

  # Development utilities
  devtools = with pkgs; [
    tmux
  ];
in
{
  inherit
    core
    cloud
    nodejs
    golang
    devtools
    ;

  # Composite sets for different use cases
  # All tools - for the universal development shell
  all = core ++ cloud ++ nodejs ++ golang ++ devtools;

  # CI subset - minimal tools needed for CI/CD
  # Note: CI currently doesn't need Node.js tools since it uses setup-node action
  ci = core ++ cloud ++ golang ++ devtools;
}
