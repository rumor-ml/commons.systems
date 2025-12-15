/**
 * dev_server_status tool - Check development server status
 */

import type { ToolResult } from '../types.js';
import { execScript } from '../utils/exec.js';
import { getWorktreeRoot } from '../utils/paths.js';
import { createErrorResult } from '../utils/errors.js';
import path from 'path';

export interface DevServerStatusArgs {
  // No arguments needed - status script checks current worktree
}

interface DevServerStatusInfo {
  running: boolean;
  module?: string;
  url?: string;
  port?: number;
  pid?: number;
  healthy?: boolean;
  emulators?: {
    running: boolean;
    pid?: number;
    services?: {
      auth?: { port: number; healthy: boolean };
      firestore?: { port: number; healthy: boolean };
      storage?: { port: number; healthy: boolean };
      ui?: { port: number; healthy: boolean };
    };
  };
}

/**
 * Parse dev server status from script output
 */
function parseDevServerStatus(stdout: string): DevServerStatusInfo {
  const lines = stdout.split('\n');
  const info: DevServerStatusInfo = {
    running: false,
  };

  // Check if dev server is running
  const runningLine = lines.find((line) => line.includes('Dev Server:'));
  if (runningLine) {
    info.running = runningLine.includes('RUNNING');
  }

  if (info.running) {
    // Parse dev server details
    for (const line of lines) {
      const moduleMatch = line.match(/Module:\s*(.+)/);
      if (moduleMatch) {
        info.module = moduleMatch[1].trim();
      }

      const urlMatch = line.match(/URL:\s*(http:\/\/localhost:(\d+))/);
      if (urlMatch) {
        info.url = urlMatch[1];
        info.port = parseInt(urlMatch[2], 10);
      }

      const pidMatch = line.match(/PID:\s*(\d+)/);
      if (pidMatch) {
        info.pid = parseInt(pidMatch[1], 10);
      }

      // Check health status
      if (line.includes('Listening on port')) {
        info.healthy = true;
      } else if (line.includes('not accessible')) {
        info.healthy = false;
      }
    }
  }

  // Check emulator status
  info.emulators = {
    running: false,
  };

  const emulatorLine = lines.find((line) => line.includes('Emulators:'));
  if (emulatorLine && emulatorLine.includes('RUNNING')) {
    info.emulators.running = true;

    // Parse emulator PID
    const emulatorPidMatch = stdout.match(/Emulators:.*?PID:\s*(\d+)/s);
    if (emulatorPidMatch) {
      info.emulators.pid = parseInt(emulatorPidMatch[1], 10);
    }

    // Parse emulator services
    info.emulators.services = {};

    for (const line of lines) {
      // Auth
      const authMatch = line.match(/✓\s*Auth:\s*localhost:(\d+)/);
      if (authMatch) {
        info.emulators.services.auth = {
          port: parseInt(authMatch[1], 10),
          healthy: true,
        };
      }
      const authFailMatch = line.match(/✗\s*Auth:\s*localhost:(\d+)/);
      if (authFailMatch) {
        info.emulators.services.auth = {
          port: parseInt(authFailMatch[1], 10),
          healthy: false,
        };
      }

      // Firestore
      const firestoreMatch = line.match(/✓\s*Firestore:\s*localhost:(\d+)/);
      if (firestoreMatch) {
        info.emulators.services.firestore = {
          port: parseInt(firestoreMatch[1], 10),
          healthy: true,
        };
      }
      const firestoreFailMatch = line.match(/✗\s*Firestore:\s*localhost:(\d+)/);
      if (firestoreFailMatch) {
        info.emulators.services.firestore = {
          port: parseInt(firestoreFailMatch[1], 10),
          healthy: false,
        };
      }

      // Storage
      const storageMatch = line.match(/✓\s*Storage:\s*localhost:(\d+)/);
      if (storageMatch) {
        info.emulators.services.storage = {
          port: parseInt(storageMatch[1], 10),
          healthy: true,
        };
      }
      const storageFailMatch = line.match(/✗\s*Storage:\s*localhost:(\d+)/);
      if (storageFailMatch) {
        info.emulators.services.storage = {
          port: parseInt(storageFailMatch[1], 10),
          healthy: false,
        };
      }

      // UI
      const uiMatch = line.match(/✓\s*UI:\s*http:\/\/localhost:(\d+)/);
      if (uiMatch) {
        info.emulators.services.ui = {
          port: parseInt(uiMatch[1], 10),
          healthy: true,
        };
      }
      const uiFailMatch = line.match(/✗\s*UI:\s*http:\/\/localhost:(\d+)/);
      if (uiFailMatch) {
        info.emulators.services.ui = {
          port: parseInt(uiFailMatch[1], 10),
          healthy: false,
        };
      }
    }
  }

  return info;
}

/**
 * Format dev server status result
 */
function formatStatusResult(info: DevServerStatusInfo): string {
  const lines: string[] = [];

  // Dev server status
  if (info.running) {
    lines.push('Dev Server: RUNNING');
    if (info.module) {
      lines.push(`  Module: ${info.module}`);
    }
    if (info.url) {
      lines.push(`  URL: ${info.url}`);
    }
    if (info.port) {
      lines.push(`  Port: ${info.port}`);
    }
    if (info.pid) {
      lines.push(`  PID: ${info.pid}`);
    }
    if (info.healthy !== undefined) {
      lines.push(`  Status: ${info.healthy ? 'Healthy' : 'Unhealthy'}`);
    }
  } else {
    lines.push('Dev Server: NOT RUNNING');
  }

  // Emulator status
  lines.push('');
  if (info.emulators?.running) {
    lines.push('Firebase Emulators: RUNNING');
    if (info.emulators.pid) {
      lines.push(`  PID: ${info.emulators.pid}`);
    }

    if (info.emulators.services) {
      lines.push('  Services:');

      if (info.emulators.services.auth) {
        const status = info.emulators.services.auth.healthy ? 'Healthy' : 'Unhealthy';
        lines.push(`    Auth (${info.emulators.services.auth.port}): ${status}`);
      }

      if (info.emulators.services.firestore) {
        const status = info.emulators.services.firestore.healthy ? 'Healthy' : 'Unhealthy';
        lines.push(`    Firestore (${info.emulators.services.firestore.port}): ${status}`);
      }

      if (info.emulators.services.storage) {
        const status = info.emulators.services.storage.healthy ? 'Healthy' : 'Unhealthy';
        lines.push(`    Storage (${info.emulators.services.storage.port}): ${status}`);
      }

      if (info.emulators.services.ui) {
        const status = info.emulators.services.ui.healthy ? 'Healthy' : 'Unhealthy';
        lines.push(`    UI (${info.emulators.services.ui.port}): ${status}`);
      }
    }
  } else {
    lines.push('Firebase Emulators: NOT RUNNING');
  }

  return lines.join('\n');
}

/**
 * Execute the dev_server_status tool
 */
export async function devServerStatus(_args: DevServerStatusArgs): Promise<ToolResult> {
  try {
    // Get script path
    const root = await getWorktreeRoot();
    const scriptPath = path.join(root, 'infrastructure', 'scripts', 'dev-server-status.sh');

    // Execute the status script
    const result = await execScript(scriptPath, [], {
      timeout: 10000, // 10 second timeout for status check
      cwd: root,
    });

    // Parse status information from output
    const info = parseDevServerStatus(result.stdout);

    // Format output
    const formatted = formatStatusResult(info);

    return {
      content: [
        {
          type: 'text',
          text: formatted,
        },
      ],
      _meta: {
        dev_server: {
          running: info.running,
          module: info.module,
          url: info.url,
          port: info.port,
          pid: info.pid,
          healthy: info.healthy,
        },
        emulators: info.emulators,
      },
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
