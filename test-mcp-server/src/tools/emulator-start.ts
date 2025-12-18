/**
 * emulator_start tool - Start Firebase emulators
 */

import type { ToolResult } from '../types.js';
import { execScript } from '../utils/exec.js';
import { getWorktreeRoot } from '../utils/paths.js';
import {
  createErrorResult,
  ValidationError,
  ScriptExecutionError,
  TestOutputParseError,
  InfrastructureError,
} from '../utils/errors.js';
import { parseEmulatorPorts } from '../utils/port-parsing.js';
import { EmulatorStartArgsSchema, safeValidateArgs } from '../schemas.js';
import { execaCommand } from 'execa';
import path from 'path';

export interface EmulatorStartArgs {
  services?: ('auth' | 'firestore' | 'storage')[];
  timeout_seconds?: number;
}

interface EmulatorPorts {
  auth: number;
  firestore: number;
  storage: number;
  ui: number;
}

/**
 * Sanitize and truncate output to prevent leaking secrets
 */
function sanitizeAndTruncateOutput(output: string, maxLength = 500): string {
  // Remove potential secrets
  const sanitized = output
    .replace(/[A-Za-z0-9+/]{40,}={0,2}/g, '[REDACTED]')
    .replace(/sk_[a-zA-Z0-9]{32,}/g, '[REDACTED_API_KEY]');

  if (sanitized.length <= maxLength) return sanitized;
  return sanitized.substring(0, maxLength) + '... (truncated)';
}

/**
 * Parse port information from script output
 */
function parsePorts(stdout: string): EmulatorPorts | null {
  const lines = stdout.split('\n');
  const ports = parseEmulatorPorts(lines);

  // Verify all required ports were found
  if (ports.auth && ports.firestore && ports.storage && ports.ui) {
    return ports as EmulatorPorts;
  }

  return null;
}

/**
 * Check if a specific emulator service is running
 */
async function isServiceRunning(port: number): Promise<{ running: boolean; error?: string }> {
  try {
    const result = await execaCommand(`nc -z localhost ${port}`, {
      shell: true,
      reject: false,
      timeout: 2000,
    });

    if (result.exitCode === 0) {
      return { running: true };
    }

    return {
      running: false,
      error: `Connection failed (exit ${result.exitCode}): ${result.stderr || 'Port not responding'}`,
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'timedOut' in error && error.timedOut) {
      return { running: false, error: 'Connection timeout (2s)' };
    }
    return {
      running: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Format emulator startup result
 */
function formatStartupResult(ports: EmulatorPorts, alreadyRunning: boolean): string {
  const lines: string[] = [];

  if (alreadyRunning) {
    lines.push('Firebase emulators already running (reusing existing instance)');
  } else {
    lines.push('Firebase emulators started successfully');
  }
  lines.push('');

  lines.push('Emulator URLs:');
  lines.push(`  Auth: http://localhost:${ports.auth}`);
  lines.push(`  Firestore: http://localhost:${ports.firestore}`);
  lines.push(`  Storage: http://localhost:${ports.storage}`);
  lines.push(`  UI: http://localhost:${ports.ui}`);
  lines.push('');

  lines.push('Environment variables:');
  lines.push(`  FIREBASE_AUTH_EMULATOR_HOST=localhost:${ports.auth}`);
  lines.push(`  FIRESTORE_EMULATOR_HOST=localhost:${ports.firestore}`);
  lines.push(`  STORAGE_EMULATOR_HOST=localhost:${ports.storage}`);

  return lines.join('\n');
}

/**
 * Execute the emulator_start tool
 */
export async function emulatorStart(args: EmulatorStartArgs): Promise<ToolResult> {
  try {
    // Validate arguments with Zod schema
    const validation = safeValidateArgs(EmulatorStartArgsSchema, args);
    if (!validation.success) {
      throw new ValidationError(validation.error);
    }
    const validatedArgs = validation.data;

    // Note: The start-emulators.sh script doesn't support selective service starting
    // It always starts auth, firestore, and storage. The services parameter is
    // included in the schema for future extensibility but currently not used.

    // Get script path
    const root = await getWorktreeRoot();
    const scriptPath = path.join(root, 'infrastructure', 'scripts', 'start-emulators.sh');

    // Execute the start script
    let result;
    try {
      result = await execScript(scriptPath, [], {
        timeout: validatedArgs.timeout_seconds * 1000, // Convert to milliseconds
        cwd: root,
      });
    } catch (error) {
      if (error instanceof Error) {
        throw new ScriptExecutionError(
          `Failed to execute start-emulators.sh: ${error.message}\n\n` +
            `Script: ${scriptPath}\n` +
            `Working directory: ${root}\n\n` +
            `Troubleshooting:\n` +
            `  - Verify Firebase tools are installed: firebase --version\n` +
            `  - Check script is executable: ls -l ${scriptPath}\n` +
            `  - Run manually to see full output: ${scriptPath}`,
          (error as any).exitCode,
          (error as any).stderr
        );
      }
      throw error;
    }

    // Parse port information from output
    let ports;
    try {
      ports = parsePorts(result.stdout);
      if (!ports) {
        throw new Error('parsePorts returned null');
      }
    } catch (error) {
      const parseError = error instanceof Error ? error : new Error(String(error));
      const outputPreview = sanitizeAndTruncateOutput(result.stdout);

      throw new TestOutputParseError(
        `Failed to parse emulator port information from script output.\n\n` +
          `Expected format: Lines containing "Auth Emulator: http://localhost:PORT"\n\n` +
          `Actual output:\n${outputPreview}\n\n` +
          `Parse error: ${parseError.message}`,
        result.stdout,
        parseError
      );
    }

    // Check if emulators were already running (script exit 0 with "already running" message)
    // Use more robust pattern matching
    const alreadyRunning =
      /already\s+(running|active|started)/i.test(result.stdout) ||
      /reusing\s+existing/i.test(result.stdout);

    // Verify all services are actually running
    const servicesHealth = await Promise.all([
      isServiceRunning(ports.auth),
      isServiceRunning(ports.firestore),
      isServiceRunning(ports.storage),
    ]);

    const allRunning = servicesHealth.every((result) => result.running);
    if (!allRunning) {
      const failureDetails = [];
      if (!servicesHealth[0].running) {
        failureDetails.push(`  - auth (port ${ports.auth}): ${servicesHealth[0].error}`);
      }
      if (!servicesHealth[1].running) {
        failureDetails.push(`  - firestore (port ${ports.firestore}): ${servicesHealth[1].error}`);
      }
      if (!servicesHealth[2].running) {
        failureDetails.push(`  - storage (port ${ports.storage}): ${servicesHealth[2].error}`);
      }

      throw new InfrastructureError(
        `Emulators started but health check failed:\n${failureDetails.join('\n')}\n\n` +
          `Troubleshooting:\n` +
          `  - Check if ports are already in use: lsof -i -P | grep LISTEN\n` +
          `  - Check emulator logs in /tmp/claude/\n` +
          `  - Verify Firebase tools are properly installed`
      );
    }

    // Format output
    const formatted = formatStartupResult(ports, alreadyRunning);

    return {
      content: [
        {
          type: 'text',
          text: formatted,
        },
      ],
      _meta: {
        ports,
        already_running: alreadyRunning,
        services: {
          auth: { port: ports.auth, healthy: servicesHealth[0] },
          firestore: { port: ports.firestore, healthy: servicesHealth[1] },
          storage: { port: ports.storage, healthy: servicesHealth[2] },
        },
      },
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
