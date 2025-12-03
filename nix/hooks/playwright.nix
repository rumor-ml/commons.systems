{ }:

''
  # Playwright browser configuration
  export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
  export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true

  # Install Playwright browsers if needed (after pnpm install has made npx available)
  PLAYWRIGHT_CHROMIUM_DIR=$(find "$PLAYWRIGHT_BROWSERS_PATH" -maxdepth 1 -type d -name "chromium-*" 2>/dev/null | head -1)
  if [ -z "$PLAYWRIGHT_CHROMIUM_DIR" ]; then
    echo "Installing Playwright browsers..."
    npx playwright install chromium
  fi
''
