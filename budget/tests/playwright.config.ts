import { createPlaywrightConfig } from '../../playwright.base.config';

// TODO(#1966): Consolidate test directory structure: move tests back to app directories
export default createPlaywrightConfig({
  mode: 'hosting-emulator',
  siteName: 'budget',
  port: parseInt(process.env.HOSTING_PORT || '5003'), // Per-worktree port from allocate-test-ports.sh (fallback: 5003 for local dev)
  deployedUrl: 'https://budget.web.app',
  // No webServerCommand - emulators started externally by run-e2e-tests.sh
  // Hosting emulator serves the built static files
});
