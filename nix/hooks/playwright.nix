{ pkgs }:

''
  # Playwright browser configuration for NixOS
  # Use NixOS-patched browsers instead of downloading generic Linux binaries
  export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}"
  export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
  export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true
''
