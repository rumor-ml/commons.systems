/**
 * cleanup_orphans tool - Clean up orphaned Firebase emulator processes and stale PID files
 */

import type { ToolResult } from '../types.js';
import { createErrorResult, InfrastructureError } from '../utils/errors.js';
import { execaCommand } from 'execa';
import fs from 'fs/promises';
import path from 'path';

export interface CleanupOrphansArgs {
  dry_run?: boolean;
  force?: boolean;
}

interface StalePidFile {
  path: string;
  pid: number;
  worktree: string;
}

interface EscapedProcess {
  pid: number;
  cmdline: string;
}

/**
 * Scan for stale PID files in /tmp/claude/ subdirectories
 */
async function findStalePidFiles(): Promise<StalePidFile[]> {
  const stalePidFiles: StalePidFile[] = [];
  const claudeTmpDir = '/tmp/claude';

  try {
    await fs.access(claudeTmpDir);
  } catch {
    // /tmp/claude doesn't exist, no stale PID files
    return [];
  }

  try {
    const worktreeDirs = await fs.readdir(claudeTmpDir);

    for (const worktreeDir of worktreeDirs) {
      const worktreePath = path.join(claudeTmpDir, worktreeDir);
      const stats = await fs.stat(worktreePath);

      if (!stats.isDirectory()) continue;

      const pidFilePath = path.join(worktreePath, 'firebase-emulators.pid');

      try {
        const pidContent = await fs.readFile(pidFilePath, 'utf-8');
        const pid = parseInt(pidContent.trim(), 10);

        if (isNaN(pid)) continue;

        // Check if process is still running
        const isRunning = await isProcessRunning(pid);

        if (!isRunning) {
          stalePidFiles.push({
            path: pidFilePath,
            pid,
            worktree: worktreeDir,
          });
        }
      } catch (error) {
        // Expected: file doesn't exist. Log unexpected errors.
        if (error instanceof Error && !error.message.includes('ENOENT')) {
          console.error(
            `[cleanup-orphans] Unexpected error reading PID file ${pidFilePath}: ${error.message}`,
            {
              pidFile: pidFilePath,
              worktree: worktreeDir,
              error: error.message,
            }
          );
        }
        continue;
      }
    }
  } catch (error) {
    throw new InfrastructureError(
      `Failed to scan for stale PID files: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return stalePidFiles;
}

/**
 * Find Firebase emulator processes without corresponding PID files
 */
async function findEscapedProcesses(): Promise<EscapedProcess[]> {
  const escapedProcesses: EscapedProcess[] = [];

  try {
    // Find all Firebase emulator processes
    const result = await execaCommand('pgrep -f "firebase emulators:start"', {
      shell: true,
      reject: false,
    });

    if (result.exitCode !== 0 || !result.stdout.trim()) {
      // No processes found
      return [];
    }

    const pids = result.stdout
      .trim()
      .split('\n')
      .map((p) => parseInt(p, 10))
      .filter((p) => !isNaN(p));

    // For each PID, check if it has a corresponding PID file
    for (const pid of pids) {
      const hasPidFile = await hasCorrespondingPidFile(pid);

      if (!hasPidFile) {
        // Get command line for this process
        const cmdlineResult = await execaCommand(`ps -p ${pid} -o command=`, {
          shell: true,
          reject: false,
        });

        const cmdline = cmdlineResult.exitCode === 0 ? cmdlineResult.stdout.trim() : 'unknown';

        escapedProcesses.push({ pid, cmdline });
      }
    }
  } catch (error) {
    throw new InfrastructureError(
      `Failed to find escaped processes: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return escapedProcesses;
}

/**
 * Check if a process is running
 */
async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    const result = await execaCommand(`ps -p ${pid}`, {
      shell: true,
      reject: false,
    });
    return result.exitCode === 0;
  } catch (error) {
    // Log unexpected errors (permission issues, etc.)
    if (error instanceof Error && error.message && !error.message.includes('ESRCH')) {
      console.error(`[cleanup-orphans] Failed to check process ${pid}: ${error.message}`, {
        pid,
        error: error.message,
      });
    }
    return false;
  }
}

/**
 * Check if a PID has a corresponding PID file in /tmp/claude directory
 */
async function hasCorrespondingPidFile(pid: number): Promise<boolean> {
  const claudeTmpDir = '/tmp/claude';

  try {
    await fs.access(claudeTmpDir);
  } catch {
    return false;
  }

  try {
    const worktreeDirs = await fs.readdir(claudeTmpDir);

    for (const worktreeDir of worktreeDirs) {
      const pidFilePath = path.join(claudeTmpDir, worktreeDir, 'firebase-emulators.pid');

      try {
        const pidContent = await fs.readFile(pidFilePath, 'utf-8');
        const trackedPid = parseInt(pidContent.trim(), 10);

        if (trackedPid === pid) {
          return true;
        }
      } catch (error) {
        // Expected: file doesn't exist. Log unexpected errors.
        if (error instanceof Error && !error.message.includes('ENOENT')) {
          console.error(
            `[cleanup-orphans] Unexpected error reading PID file ${pidFilePath}: ${error.message}`,
            {
              pidFile: pidFilePath,
              worktree: worktreeDir,
              error: error.message,
            }
          );
        }
        continue;
      }
    }
  } catch (error) {
    // Expected: directory doesn't exist. Log unexpected errors.
    if (error instanceof Error && !error.message.includes('ENOENT')) {
      console.error(
        `[cleanup-orphans] Unexpected error scanning ${claudeTmpDir}: ${error.message}`,
        {
          directory: claudeTmpDir,
          error: error.message,
        }
      );
    }
    return false;
  }

  return false;
}

/**
 * Clean up a stale PID file and associated files
 */
async function cleanupStalePidFile(stalePidFile: StalePidFile): Promise<void> {
  const worktreeDir = path.dirname(stalePidFile.path);

  // Remove PID file
  await fs.unlink(stalePidFile.path);

  // Remove associated log file
  const logFile = path.join(worktreeDir, 'firebase-emulators.log');
  try {
    await fs.unlink(logFile);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
      console.error(
        `[cleanup-orphans] Unexpected error removing log file ${logFile}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Remove temporary Firebase config
  const firebaseJson = path.join(worktreeDir, 'firebase.json');
  try {
    await fs.unlink(firebaseJson);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
      console.error(
        `[cleanup-orphans] Unexpected error removing firebase.json ${firebaseJson}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * Kill an escaped process
 */
async function killProcess(pid: number): Promise<boolean> {
  try {
    await execaCommand(`kill ${pid}`, {
      shell: true,
      reject: false,
    });

    // Wait a moment for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check if still running
    const stillRunning = await isProcessRunning(pid);

    if (stillRunning) {
      // Force kill
      await execaCommand(`kill -9 ${pid}`, {
        shell: true,
        reject: false,
      });
    }

    return true;
  } catch (error) {
    // Expected: process doesn't exist. Log unexpected errors.
    if (error instanceof Error && !error.message.includes('ESRCH')) {
      console.error(`[cleanup-orphans] Failed to kill process ${pid}: ${error.message}`, {
        pid,
        error: error.message,
      });
    }
    return false;
  }
}

/**
 * Format cleanup results
 */
function formatCleanupResult(
  stalePidFiles: StalePidFile[],
  escapedProcesses: EscapedProcess[],
  dryRun: boolean,
  cleaned: {
    stalePidFilesRemoved: number;
    processesKilled: number;
  }
): string {
  const lines: string[] = [];

  if (stalePidFiles.length === 0 && escapedProcesses.length === 0) {
    lines.push('No orphaned emulator processes or stale PID files found');
    return lines.join('\n');
  }

  lines.push('Orphan Cleanup Summary');
  lines.push('======================');
  lines.push('');

  // Stale PID files
  if (stalePidFiles.length > 0) {
    lines.push(`Stale PID files found: ${stalePidFiles.length}`);
    for (const stalePidFile of stalePidFiles) {
      lines.push(
        `  - ${stalePidFile.path} (PID ${stalePidFile.pid}, worktree: ${stalePidFile.worktree})`
      );
    }
    lines.push('');

    if (dryRun) {
      lines.push('[DRY RUN] Would remove these PID files and associated logs');
    } else {
      lines.push(`Removed ${cleaned.stalePidFilesRemoved} stale PID files`);
    }
    lines.push('');
  }

  // Escaped processes
  if (escapedProcesses.length > 0) {
    lines.push(`Escaped processes found: ${escapedProcesses.length}`);
    for (const proc of escapedProcesses) {
      lines.push(`  - PID ${proc.pid}: ${proc.cmdline}`);
    }
    lines.push('');

    if (dryRun) {
      lines.push('[DRY RUN] Would kill these processes');
    } else {
      lines.push(`Killed ${cleaned.processesKilled} escaped processes`);
    }
    lines.push('');
  }

  if (dryRun) {
    lines.push('Run with dry_run=false to perform cleanup');
  } else {
    lines.push('Cleanup complete');
  }

  return lines.join('\n');
}

/**
 * Execute the cleanup_orphans tool
 */
export async function cleanupOrphans(args: CleanupOrphansArgs): Promise<ToolResult> {
  try {
    const dryRun = args.dry_run ?? false;
    const force = args.force ?? true; // Default to true for MCP (non-interactive)

    // Scan for orphans
    const stalePidFiles = await findStalePidFiles();
    const escapedProcesses = await findEscapedProcesses();

    const cleaned = {
      stalePidFilesRemoved: 0,
      processesKilled: 0,
    };

    // Clean up if not in dry run mode
    if (!dryRun && force) {
      // Clean up stale PID files
      for (const stalePidFile of stalePidFiles) {
        try {
          await cleanupStalePidFile(stalePidFile);
          cleaned.stalePidFilesRemoved++;
        } catch (error) {
          // Continue on error, will be reflected in the count
          console.error(
            `Failed to clean up ${stalePidFile.path}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // Kill escaped processes
      for (const proc of escapedProcesses) {
        try {
          const success = await killProcess(proc.pid);
          if (success) {
            cleaned.processesKilled++;
          }
        } catch (error) {
          // Continue on error
          console.error(
            `Failed to kill process ${proc.pid}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }

    const formatted = formatCleanupResult(stalePidFiles, escapedProcesses, dryRun, cleaned);

    return {
      content: [
        {
          type: 'text',
          text: formatted,
        },
      ],
      _meta: {
        stale_pid_files_found: stalePidFiles.length,
        escaped_processes_found: escapedProcesses.length,
        stale_pid_files_removed: cleaned.stalePidFilesRemoved,
        processes_killed: cleaned.processesKilled,
        dry_run: dryRun,
      },
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
