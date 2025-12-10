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
    // Use stdio: 'pipe' to suppress "Killed" message that causes exit code 137
    execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null || true`, {
      stdio: 'pipe',
    });
    console.log(`✓ Cleaned up processes on port ${port}`);
  } catch (error) {
    // Non-critical - process may not exist
    console.log(`ℹ No processes found on port ${port}`);
  }
}

export default globalTeardown;
