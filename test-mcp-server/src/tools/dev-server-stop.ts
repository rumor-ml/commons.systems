/**
 * dev_server_stop tool - Stop development server
 */

import type { ToolResult } from '../types.js';
import { execScript } from '../utils/exec.js';
import { getWorktreeRoot } from '../utils/paths.js';
import { createErrorResult, ValidationError } from '../utils/errors.js';
import { DEFAULT_INFRA_TIMEOUT, MAX_INFRA_TIMEOUT } from '../constants.js';
import path from 'path';

export interface DevServerStopArgs {
  with_emulators?: boolean;
  timeout_seconds?: number;
}

/**
 * Format dev server stop result
 */
function formatStopResult(stdout: string, withEmulators: boolean): string {
  const lines: string[] = [];

  // Check if server was running
  const wasRunning = !stdout.includes('No dev server PID file found');
  const stopped = stdout.includes('Successfully stopped');

  if (wasRunning && stopped) {
    lines.push('Dev server stopped successfully');
  } else if (!wasRunning) {
    lines.push('No dev server was running');
  } else {
    lines.push('Dev server stop completed');
  }

  if (withEmulators) {
    lines.push('Firebase emulators also stopped');
  }

  // Include any warnings from the output
  const outputLines = stdout.split('\n');
  const warnings = outputLines.filter(line => line.includes('WARNING') || line.includes('⚠️'));
  if (warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    warnings.forEach(warning => {
      lines.push(`  ${warning.trim()}`);
    });
  }

  return lines.join('\n');
}

/**
 * Execute the dev_server_stop tool
 */
export async function devServerStop(
  args: DevServerStopArgs
): Promise<ToolResult> {
  try {
    // Validate arguments
    const timeout = args.timeout_seconds || DEFAULT_INFRA_TIMEOUT;
    if (timeout > MAX_INFRA_TIMEOUT) {
      throw new ValidationError(
        `Timeout ${timeout}s exceeds maximum ${MAX_INFRA_TIMEOUT}s`
      );
    }

    const withEmulators = args.with_emulators ?? false; // Default to false

    // Get script path
    const root = await getWorktreeRoot();
    const scriptPath = path.join(
      root,
      'infrastructure',
      'scripts',
      'stop-dev-server.sh'
    );

    // Build script arguments
    const scriptArgs: string[] = [];
    if (withEmulators) {
      scriptArgs.push('--with-emulators');
    }

    // Execute the stop script
    const result = await execScript(scriptPath, scriptArgs, {
      timeout: timeout * 1000, // Convert to milliseconds
      cwd: root,
    });

    // Format output
    const formatted = formatStopResult(result.stdout, withEmulators);

    // Extract metadata from output
    const wasRunning = !result.stdout.includes('No dev server PID file found');
    const stopped = result.stdout.includes('Successfully stopped');

    return {
      content: [
        {
          type: 'text',
          text: formatted,
        },
      ],
      _meta: {
        was_running: wasRunning,
        stopped_successfully: stopped,
        emulators_stopped: withEmulators,
      },
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
