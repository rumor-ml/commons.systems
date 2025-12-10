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
  // Playwright automatically cleans up web server processes
  // No manual cleanup needed - attempting to force-kill can cause exit code 137
  console.log('✓ Test teardown complete (Playwright handles cleanup)');
}

export default globalTeardown;
