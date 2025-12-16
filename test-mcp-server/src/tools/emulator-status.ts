/**
 * emulator_status tool - Check Firebase emulator status
 */

import type { ToolResult, EmulatorStatus } from '../types.js';
import { createPort } from '@commons/types/branded';
import { getWorktreeRoot } from '../utils/paths.js';
import { createErrorResult } from '../utils/errors.js';
import { execaCommand } from 'execa';
import path from 'path';
import fs from 'fs/promises';

export interface EmulatorStatusArgs {
  // No arguments required
}

interface ServiceStatus {
  name: string;
  port: number;
  host: string;
  running: boolean;
}

/**
 * Get worktree-specific temp directory path
 */
async function getWorktreeTmpDir(): Promise<string> {
  const root = await getWorktreeRoot();
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

    return tmpDir;
  } catch (error) {
    throw new Error(
      `Failed to determine temp directory: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get port allocations from environment
 */
async function getPortAllocations(): Promise<{
  auth: number;
  firestore: number;
  storage: number;
  ui: number;
}> {
  const root = await getWorktreeRoot();
  const scriptPath = path.join(root, 'infrastructure', 'scripts', 'allocate-test-ports.sh');

  try {
    const result = await execaCommand(
      `source "${scriptPath}" && echo "$FIREBASE_AUTH_PORT,$FIREBASE_FIRESTORE_PORT,$FIREBASE_STORAGE_PORT,$FIREBASE_UI_PORT"`,
      {
        shell: '/bin/bash',
        cwd: root,
      }
    );

    const lastLine = result.stdout.split('\n').pop()?.trim();
    if (!lastLine) {
      throw new Error('Failed to get port allocations');
    }

    const [auth, firestore, storage, ui] = lastLine.split(',').map(Number);

    if (!auth || !firestore || !storage || !ui) {
      throw new Error('Invalid port allocation response');
    }

    return { auth, firestore, storage, ui };
  } catch (error) {
    throw new Error(
      `Failed to get port allocations: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Check if emulator process is running
 */
async function isEmulatorProcessRunning(): Promise<{
  running: boolean;
  pid?: number;
}> {
  try {
    const tmpDir = await getWorktreeTmpDir();
    const pidFilePath = path.join(tmpDir, 'firebase-emulators.pid');

    // Check if PID file exists
    try {
      const pidContent = await fs.readFile(pidFilePath, 'utf-8');
      const pid = parseInt(pidContent.trim(), 10);

      if (isNaN(pid)) {
        return { running: false };
      }

      // Check if process with this PID is actually running
      try {
        // On Unix systems, sending signal 0 checks if process exists
        process.kill(pid, 0);
        return { running: true, pid };
      } catch (error) {
        // Log unexpected errors (permission issues, etc.)
        if (error instanceof Error && error.message && !error.message.includes('ESRCH')) {
          console.error(`Failed to check process ${pid}:`, error.message);
        }
        // Process doesn't exist
        return { running: false, pid };
      }
    } catch {
      // PID file doesn't exist
      return { running: false };
    }
  } catch {
    return { running: false };
  }
}

/**
 * Check if a port is listening
 */
async function isPortListening(port: number): Promise<boolean> {
  try {
    const result = await execaCommand(`nc -z localhost ${port}`, {
      shell: true,
      reject: false,
      timeout: 2000,
    });
    return result.exitCode === 0;
  } catch (error) {
    if (error instanceof Error && !error.message.includes('ECONNREFUSED')) {
      console.error(`Port check failed for ${port}:`, error.message);
    }
    return false;
  }
}

/**
 * Check health of all emulator services
 */
async function checkServicesHealth(ports: {
  auth: number;
  firestore: number;
  storage: number;
  ui: number;
}): Promise<ServiceStatus[]> {
  const services: ServiceStatus[] = [
    {
      name: 'auth',
      port: ports.auth,
      host: 'localhost',
      running: false,
    },
    {
      name: 'firestore',
      port: ports.firestore,
      host: 'localhost',
      running: false,
    },
    {
      name: 'storage',
      port: ports.storage,
      host: 'localhost',
      running: false,
    },
    {
      name: 'ui',
      port: ports.ui,
      host: 'localhost',
      running: false,
    },
  ];

  // Check each service concurrently
  await Promise.all(
    services.map(async (service) => {
      service.running = await isPortListening(service.port);
    })
  );

  return services;
}

/**
 * Format emulator status for display
 */
function formatStatus(
  processRunning: boolean,
  pid: number | undefined,
  services: ServiceStatus[]
): string {
  const lines: string[] = [];

  if (!processRunning) {
    lines.push('Firebase emulators: NOT RUNNING');
    lines.push('');
    lines.push('No emulator process found for this worktree.');
    lines.push('Start emulators with: infrastructure/scripts/start-emulators.sh');
    return lines.join('\n');
  }

  lines.push('Firebase emulators: RUNNING');
  if (pid) {
    lines.push(`Process ID: ${pid}`);
  }
  lines.push('');

  const runningServices = services.filter((s) => s.running);
  const stoppedServices = services.filter((s) => !s.running);

  if (runningServices.length > 0) {
    lines.push('Active Services:');
    runningServices.forEach((service) => {
      const url =
        service.name === 'ui'
          ? `http://${service.host}:${service.port}`
          : `${service.host}:${service.port}`;
      lines.push(`  ${service.name}: ${url}`);
    });
  }

  if (stoppedServices.length > 0) {
    lines.push('');
    lines.push('Inactive Services:');
    stoppedServices.forEach((service) => {
      lines.push(`  ${service.name}: ${service.host}:${service.port} (not responding)`);
    });
  }

  return lines.join('\n');
}

/**
 * Execute the emulator_status tool
 */
export async function emulatorStatus(_args: EmulatorStatusArgs): Promise<ToolResult> {
  try {
    // Check if emulator process is running
    const processStatus = await isEmulatorProcessRunning();

    // Get port allocations
    const ports = await getPortAllocations();

    // Check health of each service
    const services = await checkServicesHealth(ports);

    // Format output
    const formatted = formatStatus(processStatus.running, processStatus.pid, services);

    // Build EmulatorStatus result (discriminated union)
    const status: EmulatorStatus = processStatus.running
      ? {
          running: true,
          services: services.map((s) => ({
            name: s.name,
            port: createPort(s.port),
            host: s.host,
          })),
        }
      : { running: false };

    return {
      content: [
        {
          type: 'text',
          text: formatted,
        },
      ],
      _meta: {
        status,
        process_running: processStatus.running,
        pid: processStatus.pid,
        services,
        all_services_healthy: processStatus.running && services.every((s) => s.running),
      },
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
