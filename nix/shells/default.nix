{ pkgs, packageSets, tmux-tui, gh-workflow-mcp-server, lib }:

let
  # Import all hooks
  goEnvHook = pkgs.callPackage ../hooks/go-env.nix { };
  pnpmHook = pkgs.callPackage ../hooks/pnpm.nix { };
  playwrightHook = pkgs.callPackage ../hooks/playwright.nix { };
  ghWorkflowMcpHook = pkgs.callPackage ../hooks/gh-workflow-mcp-server.nix { };
  tmuxTuiHook = pkgs.callPackage ../hooks/tmux-tui.nix { };

in pkgs.mkShell {
  buildInputs = packageSets.all ++ [ tmux-tui ];

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
    echo "  • List all tools: nix run .#list-tools"
    echo "  • Check environment: nix run .#check-env"
    echo ""
  '';

  NIXPKGS_ALLOW_UNFREE = "1";
}
