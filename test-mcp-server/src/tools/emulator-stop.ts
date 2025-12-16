/**
 * emulator_stop tool - Stop Firebase emulators
 */

import type { ToolResult } from '../types.js';
import { execScript } from '../utils/exec.js';
import { getWorktreeRoot } from '../utils/paths.js';
import { createErrorResult, ValidationError } from '../utils/errors.js';
import { EmulatorStopArgsSchema, safeValidateArgs } from '../schemas.js';
import path from 'path';
import fs from 'fs/promises';

export interface EmulatorStopArgs {
  timeout_seconds?: number;
}

/**
 * Check if emulator PID file exists
 */
async function getPidFilePath(): Promise<string> {
  const root = await getWorktreeRoot();

  // Read WORKTREE_TMP_DIR from allocate-test-ports.sh
  // The PID file is at ${WORKTREE_TMP_DIR}/firebase-emulators.pid
  // We need to calculate the same hash the script uses
  const { execaCommand } = await import('execa');

  // Get the hash by running allocate-test-ports.sh
  const scriptPath = path.join(root, 'infrastructure', 'scripts', 'allocate-test-ports.sh');

  try {
    const result = await execaCommand(`source "${scriptPath}" && echo "$WORKTREE_TMP_DIR"`, {
      shell: '/bin/bash',
      cwd: root,
    });

    const tmpDir = result.stdout.split('\n').pop()?.trim();
    if (!tmpDir) {
      throw new Error('Failed to get WORKTREE_TMP_DIR from allocate-test-ports.sh');
    }

    return path.join(tmpDir, 'firebase-emulators.pid');
  } catch (error) {
    throw new Error(
      `Failed to determine PID file location: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Parse stop script output to determine what was stopped
 */
function parseStopResult(stdout: string): {
  stopped: boolean;
  pidFound: boolean;
  processKilled: boolean;
} {
  const pidFound = !stdout.includes('No emulator PID file found');
  const processKilled = stdout.includes('Successfully stopped emulator process');
  const processNotFound = stdout.includes('not found (may have already stopped)');
  const stopped = processKilled || processNotFound;

  return {
    stopped,
    pidFound,
    processKilled,
  };
}

/**
 * Format emulator stop result
 */
function formatStopResult(result: {
  stopped: boolean;
  pidFound: boolean;
  processKilled: boolean;
}): string {
  const lines: string[] = [];

  if (!result.pidFound) {
    lines.push('No emulators running');
    lines.push('Emulators may not have been started or were started manually');
  } else if (result.processKilled) {
    lines.push('Firebase emulators stopped successfully');
    lines.push('All emulator processes terminated and cleaned up');
  } else if (result.stopped) {
    lines.push('Firebase emulators already stopped');
    lines.push('Process was not running (may have crashed or been killed externally)');
  } else {
    lines.push('Failed to stop emulators');
  }

  return lines.join('\n');
}

/**
 * Execute the emulator_stop tool
 */
export async function emulatorStop(args: EmulatorStopArgs): Promise<ToolResult> {
  try {
    // Validate arguments with Zod schema
    const validation = safeValidateArgs(EmulatorStopArgsSchema, args);
    if (!validation.success) {
      throw new ValidationError(validation.error);
    }
    const validatedArgs = validation.data;

    // Get script path
    const root = await getWorktreeRoot();
    const scriptPath = path.join(root, 'infrastructure', 'scripts', 'stop-emulators.sh');

    // Execute the stop script
    const result = await execScript(scriptPath, [], {
      timeout: validatedArgs.timeout_seconds * 1000, // Convert to milliseconds
      cwd: root,
    });

    // Parse result
    const stopResult = parseStopResult(result.stdout);

    // Verify PID file has been cleaned up
    let pidFileRemoved = false;
    try {
      const pidFilePath = await getPidFilePath();
      try {
        await fs.access(pidFilePath);
        pidFileRemoved = false;
      } catch {
        pidFileRemoved = true;
      }
    } catch {
      // If we can't determine PID file path, assume it's cleaned up
      pidFileRemoved = true;
    }

    // Format output
    const formatted = formatStopResult(stopResult);

    return {
      content: [
        {
          type: 'text',
          text: formatted,
        },
      ],
      _meta: {
        stopped: stopResult.stopped,
        pid_file_found: stopResult.pidFound,
        process_killed: stopResult.processKilled,
        pid_file_removed: pidFileRemoved,
      },
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
