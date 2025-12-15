/**
 * emulator_start tool - Start Firebase emulators
 */

import type { ToolResult } from '../types.js';
import { execScript } from '../utils/exec.js';
import { getWorktreeRoot } from '../utils/paths.js';
import { createErrorResult, ValidationError } from '../utils/errors.js';
import { DEFAULT_INFRA_TIMEOUT, MAX_INFRA_TIMEOUT } from '../constants.js';
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
 * Parse port information from script output
 */
function parsePorts(stdout: string): EmulatorPorts | null {
  const lines = stdout.split('\n');
  const ports: Partial<EmulatorPorts> = {};

  for (const line of lines) {
    // Parse lines like: "  Auth: localhost:10000"
    const authMatch = line.match(/Auth:\s*localhost:(\d+)/);
    if (authMatch) {
      ports.auth = parseInt(authMatch[1], 10);
    }

    const firestoreMatch = line.match(/Firestore:\s*localhost:(\d+)/);
    if (firestoreMatch) {
      ports.firestore = parseInt(firestoreMatch[1], 10);
    }

    const storageMatch = line.match(/Storage:\s*localhost:(\d+)/);
    if (storageMatch) {
      ports.storage = parseInt(storageMatch[1], 10);
    }

    const uiMatch = line.match(/UI:\s*http:\/\/localhost:(\d+)/);
    if (uiMatch) {
      ports.ui = parseInt(uiMatch[1], 10);
    }
  }

  // Verify all ports were found
  if (ports.auth && ports.firestore && ports.storage && ports.ui) {
    return ports as EmulatorPorts;
  }

  return null;
}

/**
 * Check if a specific emulator service is running
 */
async function isServiceRunning(port: number): Promise<boolean> {
  try {
    const result = await execaCommand(`nc -z localhost ${port}`, {
      shell: true,
      reject: false,
      timeout: 2000,
    });
    return result.exitCode === 0;
  } catch {
    return false;
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
    // Validate arguments
    const timeout = args.timeout_seconds || DEFAULT_INFRA_TIMEOUT;
    if (timeout > MAX_INFRA_TIMEOUT) {
      throw new ValidationError(`Timeout ${timeout}s exceeds maximum ${MAX_INFRA_TIMEOUT}s`);
    }

    // Note: The start-emulators.sh script doesn't support selective service starting
    // It always starts auth, firestore, and storage. The services parameter is
    // included in the schema for future extensibility but currently not used.
    if (args.services && args.services.length > 0) {
      const validServices = ['auth', 'firestore', 'storage'];
      const invalidServices = args.services.filter((s) => !validServices.includes(s));
      if (invalidServices.length > 0) {
        throw new ValidationError(
          `Invalid services: ${invalidServices.join(', ')}. Valid services are: ${validServices.join(', ')}`
        );
      }
    }

    // Get script path
    const root = await getWorktreeRoot();
    const scriptPath = path.join(root, 'infrastructure', 'scripts', 'start-emulators.sh');

    // Execute the start script
    const result = await execScript(scriptPath, [], {
      timeout: timeout * 1000, // Convert to milliseconds
      cwd: root,
    });

    // Parse port information from output
    const ports = parsePorts(result.stdout);
    if (!ports) {
      throw new Error('Failed to parse emulator port information from script output');
    }

    // Check if emulators were already running (script exit 0 with "already running" message)
    const alreadyRunning = result.stdout.includes('already running');

    // Verify all services are actually running
    const servicesHealth = await Promise.all([
      isServiceRunning(ports.auth),
      isServiceRunning(ports.firestore),
      isServiceRunning(ports.storage),
    ]);

    const allRunning = servicesHealth.every((healthy) => healthy);
    if (!allRunning) {
      const failedServices = [];
      if (!servicesHealth[0]) failedServices.push('auth');
      if (!servicesHealth[1]) failedServices.push('firestore');
      if (!servicesHealth[2]) failedServices.push('storage');

      throw new Error(
        `Emulators started but health check failed for: ${failedServices.join(', ')}`
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
