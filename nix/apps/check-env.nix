{ pkgs }:

pkgs.writeShellScriptBin "check-env" ''
  echo "╔═══════════════════════════════════════════════════════════╗"
  echo "║     Environment Health Check                              ║"
  echo "╚═══════════════════════════════════════════════════════════╝"
  echo ""

  EXIT_CODE=0

  # Check node_modules
  if [ -d "node_modules" ]; then
    echo "✅ node_modules exists"
  else
    echo "❌ node_modules missing"
    echo "   Fix: Run 'pnpm install'"
    EXIT_CODE=1
  fi

  # Check Playwright browsers
  PLAYWRIGHT_BROWSERS_PATH="''${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
  PLAYWRIGHT_CHROMIUM_DIR=$(find "$PLAYWRIGHT_BROWSERS_PATH" -maxdepth 1 -type d -name "chromium-*" 2>/dev/null | head -1)
  if [ -n "$PLAYWRIGHT_CHROMIUM_DIR" ]; then
    echo "✅ Playwright browsers installed"
  else
    echo "⚠️  Playwright browsers not installed"
    echo "   Fix: Run 'npx playwright install chromium'"
  fi

  # Check tmux-tui availability
  if command -v tmux-tui >/dev/null 2>&1; then
    echo "✅ tmux-tui available"
  else
    echo "❌ tmux-tui not available"
    echo "   Fix: Ensure you're in a nix develop shell"
    EXIT_CODE=1
  fi

  # Check socat availability (required for sandbox)
  if command -v socat >/dev/null 2>&1; then
    echo "✅ socat available (sandbox dependency)"
  else
    echo "❌ socat not available"
    echo "   Fix: Ensure you're in a nix develop shell with socat package"
    EXIT_CODE=1
  fi

  # Check bubblewrap availability (required for sandbox on Linux/WSL2)
  if command -v bwrap >/dev/null 2>&1; then
    echo "✅ bubblewrap available (sandbox dependency)"
  else
    echo "❌ bubblewrap not available"
    echo "   Fix: Ensure you're in a nix develop shell with bubblewrap package"
    EXIT_CODE=1
  fi

  # Check gh-workflow-mcp-server
  if [ -f "gh-workflow-mcp-server/dist/index.js" ]; then
    echo "✅ gh-workflow-mcp-server built"
  else
    echo "⚠️  gh-workflow-mcp-server not built"
    echo "   Fix: Run 'cd gh-workflow-mcp-server && npm run build'"
  fi

  # Check GOPATH
  if [ -n "$GOPATH" ]; then
    echo "✅ GOPATH configured ($GOPATH)"
  else
    echo "❌ GOPATH not set"
    echo "   Fix: Ensure you're in a nix develop shell"
    EXIT_CODE=1
  fi

  echo ""
  if [ $EXIT_CODE -eq 0 ]; then
    echo "🎉 Environment is healthy!"
  else
    echo "⚠️  Some issues detected. See fixes above."
  fi

  exit $EXIT_CODE
''
