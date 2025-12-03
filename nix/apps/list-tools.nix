{ pkgs }:

pkgs.writeShellScriptBin "list-tools" ''
  echo "╔═══════════════════════════════════════════════════════════╗"
  echo "║     Development Environment Tools                         ║"
  echo "╚═══════════════════════════════════════════════════════════╝"
  echo ""

  echo "📦 Core Tools"
  echo "  git: $(git --version 2>/dev/null | cut -d' ' -f3 || echo 'installed')"
  echo "  gh: $(gh --version 2>/dev/null | head -1 | cut -d' ' -f3 || echo 'installed')"
  echo "  jq: $(jq --version 2>/dev/null | cut -d'-' -f2 || echo 'installed')"
  echo ""

  echo "📦 Node.js Ecosystem"
  echo "  node: $(node --version 2>/dev/null | cut -c2- || echo 'installed')"
  echo "  pnpm: $(pnpm --version 2>/dev/null || echo 'installed')"
  echo "  firebase: $(firebase --version 2>/dev/null || echo 'installed')"
  echo ""

  echo "📦 Go Toolchain"
  echo "  go: $(go version 2>/dev/null | cut -d' ' -f3 | cut -c3- || echo 'installed')"
  echo "  gopls: $(gopls version 2>/dev/null | head -1 | awk '{print $2}' || echo 'installed')"
  echo "  air: $(air -v 2>/dev/null | head -1 | awk '{print $3}' || echo 'installed')"
  echo "  templ: $(templ version 2>/dev/null | grep 'templ version' | awk '{print $3}' || echo 'installed')"
  echo ""

  echo "📦 Development Tools"
  echo "  tmux-tui: $(tmux-tui --version 2>/dev/null || echo 'installed')"
  echo "  gh-workflow-mcp: $([ -f gh-workflow-mcp-server/dist/index.js ] && echo 'built' || echo 'not built')"
  echo ""

  echo "📦 Cloud & Infrastructure"
  echo "  gcloud: $(gcloud version 2>/dev/null | head -1 | awk '{print $4}' || echo 'installed')"
  echo "  terraform: $(terraform version 2>/dev/null | head -1 | cut -d' ' -f2 | cut -c2- || echo 'installed')"
  echo ""
''
