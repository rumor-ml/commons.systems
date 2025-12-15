/**
 * Path resolution utilities
 */

import { execaCommand } from 'execa';
import path from 'path';
import { SCRIPTS_DIR } from '../constants.js';

/**
 * Get the git worktree root directory
 *
 * @returns Promise resolving to absolute path of worktree root
 */
export async function getWorktreeRoot(): Promise<string> {
  const result = await execaCommand('git rev-parse --show-toplevel', {
    shell: true,
  });
  return result.stdout.trim();
}

/**
 * Get the full path to a script in infrastructure/scripts/
 *
 * @param scriptName - Name of the script file (e.g., 'test-run.sh')
 * @returns Promise resolving to absolute path of the script
 */
export async function getScriptPath(scriptName: string): Promise<string> {
  const root = await getWorktreeRoot();
  return path.join(root, SCRIPTS_DIR, scriptName);
}

/**
 * Get the current working directory (for reference)
 *
 * @returns Current working directory
 */
export function getCwd(): string {
  return process.cwd();
}
