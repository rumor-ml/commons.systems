/**
 * get_port_allocation tool - Get current port allocations for test infrastructure
 */

import type { ToolResult, PortAllocation } from '../types.js';
import { execScript } from '../utils/exec.js';
import { getWorktreeRoot } from '../utils/paths.js';
import { createErrorResult } from '../utils/errors.js';
import { execaCommand } from 'execa';
import path from 'path';

export interface GetPortAllocationArgs {
  service?: string;
}

/**
 * Parse port allocation from script output
 */
function parsePortAllocation(stdout: string): PortAllocation[] {
  const allocations: PortAllocation[] = [];
  const lines = stdout.split('\n');

  // Parse output like:
  // export FIREBASE_AUTH_PORT="10000"
  // export FIREBASE_FIRESTORE_PORT="11000"
  // etc.

  const portRegex = /export\s+(\w+)="?(\d+)"?/;

  for (const line of lines) {
    const match = line.match(portRegex);
    if (match) {
      const varName = match[1];
      const port = parseInt(match[2], 10);

      // Map environment variable names to service names
      const serviceMap: Record<string, string> = {
        FIREBASE_AUTH_PORT: 'firebase-auth',
        FIREBASE_FIRESTORE_PORT: 'firestore',
        FIREBASE_STORAGE_PORT: 'storage',
        FIREBASE_UI_PORT: 'firebase-ui',
        TEST_PORT: 'app-server',
        PORT: 'go-app',
      };

      const serviceName = serviceMap[varName];
      if (serviceName) {
        allocations.push({
          service: serviceName,
          port,
          in_use: false, // Will check this next
        });
      }
    }
  }

  return allocations;
}

/**
 * Check if a port is currently in use
 */
async function isPortInUse(port: number): Promise<boolean> {
  try {
    const result = await execaCommand(`lsof -ti :${port}`, {
      shell: true,
      reject: false,
    });

    return result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Format port allocation information
 */
function formatPortAllocation(allocations: PortAllocation[]): string {
  const lines: string[] = [];

  lines.push('Port Allocation:');
  lines.push('');

  // Group by status
  const inUse = allocations.filter((a) => a.in_use);
  const available = allocations.filter((a) => !a.in_use);

  if (inUse.length > 0) {
    lines.push('In Use:');
    inUse.forEach((alloc) => {
      lines.push(`  ${alloc.service}: ${alloc.port} (IN USE)`);
    });
    lines.push('');
  }

  if (available.length > 0) {
    lines.push('Available:');
    available.forEach((alloc) => {
      lines.push(`  ${alloc.service}: ${alloc.port}`);
    });
  }

  return lines.join('\n');
}

/**
 * Execute the get_port_allocation tool
 */
export async function getPortAllocation(
  args: GetPortAllocationArgs
): Promise<ToolResult> {
  try {
    // Get script path
    const root = await getWorktreeRoot();
    const scriptPath = path.join(
      root,
      'infrastructure',
      'scripts',
      'allocate-test-ports.sh'
    );

    // Execute the port allocation script
    const result = await execScript(scriptPath, [], {
      cwd: root,
      timeout: 10000, // 10 seconds
    });

    // Parse the output to extract port allocations
    let allocations = parsePortAllocation(result.stdout);

    // Check which ports are actually in use
    await Promise.all(
      allocations.map(async (alloc) => {
        alloc.in_use = await isPortInUse(alloc.port);
      })
    );

    // Filter by service if specified
    if (args.service) {
      allocations = allocations.filter((a) => a.service === args.service);
    }

    // Format output
    const formatted = formatPortAllocation(allocations);

    return {
      content: [
        {
          type: 'text',
          text: formatted,
        },
      ],
      _meta: {
        allocations,
        total_ports: allocations.length,
        in_use_count: allocations.filter((a) => a.in_use).length,
      },
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
