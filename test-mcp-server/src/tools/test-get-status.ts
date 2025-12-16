/**
 * test_get_status tool - Get current test execution status
 */

import type { ToolResult } from '../types.js';
import { execaCommand } from 'execa';
import { getWorktreeRoot } from '../utils/paths.js';
import { createErrorResult, ValidationError } from '../utils/errors.js';
import { TestGetStatusArgsSchema, safeValidateArgs } from '../schemas.js';
import path from 'path';
import fs from 'fs/promises';

export interface TestGetStatusArgs {
  module?: string;
}

interface TestProcessInfo {
  pid: number;
  module?: string;
  command: string;
}

interface RecentTestResult {
  module: string;
  timestamp: Date;
  status: 'passed' | 'failed';
  duration_ms?: number;
}

/**
 * Find running test processes
 */
async function findTestProcesses(): Promise<TestProcessInfo[]> {
  try {
    // Look for running test processes (npm test, go test, playwright, etc.)
    const result = await execaCommand(
      'ps aux | grep -E "(npm test|go test|playwright|vitest)" | grep -v grep',
      {
        shell: true,
        reject: false,
      }
    );

    if (!result.stdout) {
      return [];
    }

    const processes: TestProcessInfo[] = [];
    const lines = result.stdout.split('\n');

    for (const line of lines) {
      // Parse ps output: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
      const parts = line.trim().split(/\s+/);
      if (parts.length < 11) continue;

      const pid = parseInt(parts[1], 10);
      const command = parts.slice(10).join(' ');

      processes.push({
        pid,
        command,
      });
    }

    return processes;
  } catch (error) {
    return [];
  }
}

/**
 * Get recent test results from test-results directory
 */
async function getRecentTestResults(root: string): Promise<RecentTestResult[]> {
  try {
    const resultsDir = path.join(root, 'test-results');
    const entries = await fs.readdir(resultsDir, { withFileTypes: true });

    const results: RecentTestResult[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Check for result.json or similar
        const resultPath = path.join(resultsDir, entry.name, 'result.json');
        try {
          const stat = await fs.stat(resultPath);
          const content = await fs.readFile(resultPath, 'utf-8');
          const data = JSON.parse(content);

          results.push({
            module: entry.name,
            timestamp: stat.mtime,
            status: data.status || 'passed',
            duration_ms: data.duration_ms,
          });
        } catch {
          // Ignore directories without result.json
        }
      }
    }

    // Sort by timestamp descending
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return results;
  } catch {
    return [];
  }
}

/**
 * Format status information
 */
function formatStatus(processes: TestProcessInfo[], recentResults: RecentTestResult[]): string {
  const lines: string[] = [];

  lines.push('Test Execution Status:');
  lines.push('');

  // Running tests
  if (processes.length > 0) {
    lines.push(`Running Tests (${processes.length}):`);
    processes.forEach((proc) => {
      lines.push(`  PID ${proc.pid}: ${proc.command}`);
    });
    lines.push('');
  } else {
    lines.push('No tests currently running');
    lines.push('');
  }

  // Recent results
  if (recentResults.length > 0) {
    lines.push('Recent Test Results:');
    recentResults.slice(0, 10).forEach((result) => {
      const status = result.status === 'passed' ? '✓' : '✗';
      const duration = result.duration_ms ? ` (${(result.duration_ms / 1000).toFixed(1)}s)` : '';
      const age = new Date().getTime() - result.timestamp.getTime();
      const ageStr = formatAge(age);

      lines.push(`  ${status} ${result.module} - ${result.status}${duration} (${ageStr} ago)`);
    });

    if (recentResults.length > 10) {
      lines.push(`  ... and ${recentResults.length - 10} more`);
    }
  } else {
    lines.push('No recent test results found');
  }

  return lines.join('\n');
}

/**
 * Format age in milliseconds to human-readable string
 */
function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/**
 * Execute the test_get_status tool
 */
export async function testGetStatus(args: TestGetStatusArgs): Promise<ToolResult> {
  try {
    // Validate arguments with Zod schema
    const validation = safeValidateArgs(TestGetStatusArgsSchema, args);
    if (!validation.success) {
      throw new ValidationError(validation.error);
    }
    const validatedArgs = validation.data;

    const root = await getWorktreeRoot();

    // Find running processes
    const processes = await findTestProcesses();

    // Get recent results
    let recentResults = await getRecentTestResults(root);

    // Filter by module if specified
    if (validatedArgs.module) {
      recentResults = recentResults.filter((r) => r.module === validatedArgs.module);
    }

    // Format output
    const formatted = formatStatus(processes, recentResults);

    return {
      content: [
        {
          type: 'text',
          text: formatted,
        },
      ],
      _meta: {
        running_count: processes.length,
        running_processes: processes,
        recent_results: recentResults.slice(0, 10),
      },
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
