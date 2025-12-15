/**
 * dev_server_start tool - Start development server for a module
 */

import type { ToolResult } from '../types.js';
import { execScript } from '../utils/exec.js';
import { getWorktreeRoot } from '../utils/paths.js';
import { createErrorResult, ValidationError } from '../utils/errors.js';
import { DEFAULT_INFRA_TIMEOUT, MAX_INFRA_TIMEOUT } from '../constants.js';
import { parseEmulatorPorts, parsePort } from '../utils/port-parsing.js';
import path from 'path';

export interface DevServerStartArgs {
  module?: string;
  with_emulators?: boolean;
  timeout_seconds?: number;
}

interface DevServerInfo {
  module: string;
  url: string;
  port: number;
  pid: number;
  log_file: string;
  emulators?: {
    auth: number;
    firestore: number;
    storage: number;
    ui: number;
  };
}

/**
 * Parse dev server information from script output
 */
function parseDevServerInfo(stdout: string): DevServerInfo | null {
  const lines = stdout.split('\n');
  const info: Partial<DevServerInfo> = {};

  for (const line of lines) {
    // Parse "Module: printsync"
    const moduleMatch = line.match(/Module:\s*(.+)/);
    if (moduleMatch) {
      info.module = moduleMatch[1].trim();
    }

    // Parse "URL: http://localhost:3000"
    const urlMatch = line.match(/URL:\s*(http:\/\/localhost:(\d+))/);
    if (urlMatch) {
      info.url = urlMatch[1];
      info.port = parsePort(urlMatch, 2);
    }

    // Parse "PID: 12345"
    const pidMatch = line.match(/PID:\s*(\d+)/);
    if (pidMatch) {
      info.pid = parsePort(pidMatch);
    }

    // Parse "Log: /path/to/log"
    const logMatch = line.match(/Log:\s*(.+)/);
    if (logMatch) {
      info.log_file = logMatch[1].trim();
    }
  }

  // Parse emulator information if present
  const emulators = parseEmulatorPorts(lines);

  // Add emulator info if all required ports were found
  if (emulators.auth && emulators.firestore && emulators.storage && emulators.ui) {
    info.emulators = emulators as DevServerInfo['emulators'];
  }

  // Verify required fields are present
  if (info.module && info.url && info.port && info.pid && info.log_file) {
    return info as DevServerInfo;
  }

  return null;
}

/**
 * Format dev server startup result
 */
function formatStartupResult(info: DevServerInfo, alreadyRunning: boolean): string {
  const lines: string[] = [];

  if (alreadyRunning) {
    lines.push(`Dev server already running for module: ${info.module}`);
  } else {
    lines.push(`Dev server started successfully for module: ${info.module}`);
  }
  lines.push('');

  lines.push('Server Information:');
  lines.push(`  URL: ${info.url}`);
  lines.push(`  Port: ${info.port}`);
  lines.push(`  PID: ${info.pid}`);
  lines.push(`  Log: ${info.log_file}`);

  if (info.emulators) {
    lines.push('');
    lines.push('Firebase Emulators:');
    lines.push(`  Auth: localhost:${info.emulators.auth}`);
    lines.push(`  Firestore: localhost:${info.emulators.firestore}`);
    lines.push(`  Storage: localhost:${info.emulators.storage}`);
    lines.push(`  UI: http://localhost:${info.emulators.ui}`);
  }

  return lines.join('\n');
}

/**
 * Execute the dev_server_start tool
 */
export async function devServerStart(args: DevServerStartArgs): Promise<ToolResult> {
  try {
    // Validate arguments
    if (!args.module || args.module.trim() === '') {
      throw new ValidationError('Module name is required');
    }

    const timeout = args.timeout_seconds || DEFAULT_INFRA_TIMEOUT;
    if (timeout > MAX_INFRA_TIMEOUT) {
      throw new ValidationError(`Timeout ${timeout}s exceeds maximum ${MAX_INFRA_TIMEOUT}s`);
    }

    const withEmulators = args.with_emulators ?? true; // Default to true

    // Get script path
    const root = await getWorktreeRoot();
    const scriptPath = path.join(root, 'infrastructure', 'scripts', 'start-dev-server.sh');

    // Build script arguments
    const scriptArgs = [args.module];
    if (withEmulators) {
      scriptArgs.push('--with-emulators');
    }

    // Execute the start script
    const result = await execScript(scriptPath, scriptArgs, {
      timeout: timeout * 1000, // Convert to milliseconds
      cwd: root,
    });

    // Parse server information from output
    const info = parseDevServerInfo(result.stdout);
    if (!info) {
      throw new Error('Failed to parse dev server information from script output');
    }

    // Check if server was already running
    const alreadyRunning = result.stdout.includes('already running');

    // Format output
    const formatted = formatStartupResult(info, alreadyRunning);

    return {
      content: [
        {
          type: 'text',
          text: formatted,
        },
      ],
      _meta: {
        module: info.module,
        url: info.url,
        port: info.port,
        pid: info.pid,
        log_file: info.log_file,
        already_running: alreadyRunning,
        emulators: info.emulators,
      },
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
