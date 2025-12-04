# =============================================================================
# ⚠️  NOTICE: This file is currently not used in flake.nix
# =============================================================================
#
# STATUS: Reference implementation (orphaned due to segfault workaround)
#
# This shell configuration represents the intended modular architecture for
# development environments. However, due to a Nix evaluator segfault when using
# callPackage (discovered in commit 72d9d78), flake.nix currently uses an
# inlined package list instead of this file.
#
# Current Implementation:
# - flake.nix lines 73-86: commonPackages variable with inlined package list
# - flake.nix lines 116-137: devShell using commonPackages + custom tools
# - This file: Reference for intended modular architecture
#
# Why This File is Kept:
# - Documents sophisticated hook composition system
# - Represents desired architecture once Nix fixes segfault
# - Provides examples for future shell customization
# - Maintains organizational knowledge
#
# How to Restore (when segfault is fixed):
# 1. Verify: pkgs.callPackage ./nix/shells/default.nix { ... } doesn't crash
# 2. Update flake.nix to use callPackage instead of inlined commonPackages
# 3. Test thoroughly with: nix develop, nix flake check, CI workflow
# 4. Remove this notice if restoration is successful
#
# =============================================================================
#
# Main Development Shell Configuration
#
# This shell provides a complete, reproducible development environment for the
# Commons.Systems monorepo with all necessary tools and automatic initialization.
#
# Purpose:
# - Provide a consistent development environment across all machines
# - Automatically initialize project dependencies (Go modules, pnpm, Playwright)
# - Set up custom tooling (tmux-tui, gh-workflow-mcp-server)
# - Display helpful information on shell entry
#
# Hook Composition:
# Hooks run in a specific order to ensure proper initialization:
# 1. goEnvHook        - Initialize Go environment (GOPATH, modules)
# 2. pnpmHook         - Install Node.js dependencies with pnpm
# 3. playwrightHook   - Set up Playwright browser binaries
# 4. ghWorkflowMcpHook - Configure GitHub workflow MCP server
# 5. tmuxTuiHook      - Register tmux-tui for session management
#
# Why order matters:
# - Go and pnpm hooks can run early (they're independent)
# - Playwright depends on Node.js being set up (must run after pnpm)
# - Tool registration hooks (gh-workflow-mcp, tmux-tui) run last
#
# How to add a new hook:
# 1. Create a new hook file in ../hooks/
# 2. Import it in the let block: myHook = pkgs.callPackage ../hooks/my-hook.nix { };
# 3. Add it to shellHook in the appropriate order: ${myHook}
# 4. Consider dependencies (does it need Go? Node? Git?)
#
# Example - Adding a database initialization hook:
#   let
#     ...
#     databaseHook = pkgs.callPackage ../hooks/database.nix { };
#   in
#   shellHook = ''
#     ${goEnvHook}
#     ${pnpmHook}
#     ${databaseHook}  # Add after pnpm if it needs Node tools
#     ...
#   '';
#
{ pkgs, packageSets, tmux-tui, gh-workflow-mcp-server, iac }:

let
  # Import all hooks
  goEnvHook = pkgs.callPackage ../hooks/go-env.nix { };
  pnpmHook = pkgs.callPackage ../hooks/pnpm.nix { };
  playwrightHook = pkgs.callPackage ../hooks/playwright.nix { };
  ghWorkflowMcpHook = pkgs.callPackage ../hooks/gh-workflow-mcp-server.nix { };
  tmuxTuiHook = pkgs.callPackage ../hooks/tmux-tui.nix { };

in pkgs.mkShell {
  buildInputs = packageSets.all ++ [ tmux-tui gh-workflow-mcp-server iac ];

  # Shell initialization script that runs when entering 'nix develop'
  # Hooks execute in the order specified below
  shellHook = ''
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║     Commons.Systems Development Environment              ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo ""

    ${goEnvHook}
    ${pnpmHook}

    # Make infrastructure scripts executable
    if [ -f infrastructure/scripts/setup-workload-identity.sh ]; then
      chmod +x infrastructure/scripts/*.sh
    fi

    ${playwrightHook}
    ${ghWorkflowMcpHook}
    ${tmuxTuiHook}

    echo ""
    echo "Quick start:"
    echo "  • Run dev server: pnpm dev"
    echo "  • Run tests: pnpm test"
    echo "  • Add packages: pnpm add <pkg>"
    echo "  • Setup infrastructure: iac"
    echo "  • List all tools: nix run .#list-tools"
    echo "  • Check environment: nix run .#check-env"
    echo ""
  '';

  NIXPKGS_ALLOW_UNFREE = "1";
}
