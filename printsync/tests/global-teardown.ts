import { execSync } from 'child_process';

/**
 * Global teardown for Playwright tests
 * Cleans up any running processes on allocated port
 *
 * NOTE: Uses execSync with shell commands (lsof, xargs, kill) because we need
 * shell features like pipes and redirection. This is safe because:
 * - The port is parsed as an integer (no injection possible)
 * - All commands are hardcoded strings
 * - No user input is involved
 */
async function globalTeardown() {
  console.log('Cleaning up test processes...');

  const port = parseInt(process.env.TEST_PORT || '8080', 10);

  try {
    // Kill any process using the test port
    execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null || true`, {
      stdio: 'inherit',
    });
    console.log(`✓ Killed processes on port ${port}`);
  } catch (error) {
    // Non-critical - process may not exist
    console.log(`ℹ No processes found on port ${port}`);
  }
}

export default globalTeardown;
