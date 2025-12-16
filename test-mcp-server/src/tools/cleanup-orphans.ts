/**
 * cleanup_orphans tool - Clean up orphaned Firebase emulator processes and stale PID files
 */

import type { ToolResult } from '../types.js';
import { createErrorResult, InfrastructureError, ValidationError } from '../utils/errors.js';
import { CleanupOrphansArgsSchema, safeValidateArgs } from '../schemas.js';
import { execaCommand } from 'execa';
import fs from 'fs/promises';
import path from 'path';

/**
 * Classify filesystem errors by severity
 *
 * @param errorCode - Node.js error code (ENOENT, EACCES, etc.)
 * @returns 'expected' | 'warning' | 'critical'
 */
function classifyFilesystemError(errorCode: string): 'expected' | 'warning' | 'critical' {
  // Expected errors - normal operation, don't log
  if (errorCode === 'ENOENT') return 'expected';

  // Critical errors - system failure, may want to abort
  // EACCES: Permission denied
  // EPERM: Operation not permitted
  // EROFS: Read-only filesystem
  // EIO: I/O error (disk failure)
  // EMFILE: Too many open files (process limit)
  // ENFILE: Too many open files (system limit)
  if (['EACCES', 'EPERM', 'EROFS', 'EIO', 'EMFILE', 'ENFILE'].includes(errorCode)) {
    return 'critical';
  }

  // Everything else is a warning
  return 'warning';
}

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
async function findStalePidFiles(
  diagnosticErrors: CleanupResults['diagnosticErrors']
): Promise<StalePidFile[]> {
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
        const processStatus = await isProcessRunning(pid);

        if (!processStatus.running) {
          stalePidFiles.push({
            path: pidFilePath,
            pid,
            worktree: worktreeDir,
          });
        }
      } catch (error) {
        // Other errors are unexpected and should be surfaced
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorCode = error && typeof error === 'object' && 'code' in error
          ? String((error as any).code)
          : 'unknown';
        const severity = classifyFilesystemError(errorCode);

        // Only log non-expected errors
        if (severity !== 'expected') {
          console.error(
            `[cleanup-orphans] ${severity === 'critical' ? 'CRITICAL' : 'Warning'} error (${errorCode}) reading PID file ${pidFilePath}: ${errorMessage}`,
            {
              pidFile: pidFilePath,
              worktree: worktreeDir,
              error: errorMessage,
              errorCode,
              severity,
            }
          );

          diagnosticErrors.push({
            type: 'pid-scan',
            target: pidFilePath,
            error: `${errorCode}: ${errorMessage}`,
            severity,
            errorCode,
          });
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
async function findEscapedProcesses(
  diagnosticErrors: CleanupResults['diagnosticErrors']
): Promise<EscapedProcess[]> {
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
      const hasPidFile = await hasCorrespondingPidFile(pid, diagnosticErrors);

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
async function isProcessRunning(pid: number): Promise<{ running: boolean; error?: string }> {
  try {
    const result = await execaCommand(`ps -p ${pid}`, {
      shell: true,
      reject: false,
    });

    if (result.exitCode === 0) {
      return { running: true };
    } else if (result.exitCode === 1) {
      // Process not found
      return { running: false };
    } else {
      // Unexpected exit code (permission error, etc.)
      return {
        running: false,
        error: `ps command failed with exit code ${result.exitCode}: ${result.stderr}`,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // ESRCH means process doesn't exist - this is definitive
    if (errorMessage.includes('ESRCH')) {
      return { running: false };
    }

    // Other errors are ambiguous - we don't know if process is running
    console.error(`[cleanup-orphans] Cannot determine if process ${pid} is running: ${errorMessage}`);
    return {
      running: false, // Conservative: assume not running
      error: errorMessage,
    };
  }
}

/**
 * Check if a PID has a corresponding PID file in /tmp/claude directory
 */
async function hasCorrespondingPidFile(
  pid: number,
  diagnosticErrors: CleanupResults['diagnosticErrors']
): Promise<boolean> {
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
        // ENOENT is expected - PID file may not exist
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          continue; // Expected, skip silently
        }

        // Other errors are unexpected and should be surfaced
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorCode = error && typeof error === 'object' && 'code' in error ? error.code : 'unknown';

        console.error(
          `[cleanup-orphans] Unexpected error (${errorCode}) reading PID file ${pidFilePath}: ${errorMessage}`,
          {
            pidFile: pidFilePath,
            worktree: worktreeDir,
            error: errorMessage,
            errorCode,
          }
        );

        diagnosticErrors.push({
          type: 'pid-scan',
          target: pidFilePath,
          error: `${errorCode}: ${errorMessage}`,
        });
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
      diagnosticErrors.push({
        type: 'pid-scan',
        target: claudeTmpDir,
        error: error.message,
      });
    }
    return false;
  }

  return false;
}

/**
 * Clean up a stale PID file and associated files
 */
async function cleanupStalePidFile(
  stalePidFile: StalePidFile,
  diagnosticErrors: CleanupResults['diagnosticErrors']
): Promise<void> {
  const worktreeDir = path.dirname(stalePidFile.path);

  // Remove PID file
  await fs.unlink(stalePidFile.path);

  // Remove associated log file
  const logFile = path.join(worktreeDir, 'firebase-emulators.log');
  try {
    await fs.unlink(logFile);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[cleanup-orphans] Failed to remove log file ${logFile}: ${errorMessage}`);
      diagnosticErrors.push({
        type: 'log-file-removal',
        target: logFile,
        error: errorMessage,
      });
    }
  }

  // Remove temporary Firebase config
  const firebaseJson = path.join(worktreeDir, 'firebase.json');
  try {
    await fs.unlink(firebaseJson);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[cleanup-orphans] Failed to remove firebase.json ${firebaseJson}: ${errorMessage}`);
      diagnosticErrors.push({
        type: 'config-removal',
        target: firebaseJson,
        error: errorMessage,
      });
    }
  }
}

/**
 * Kill an escaped process
 */
async function killProcess(pid: number): Promise<{ success: boolean; error?: string }> {
  try {
    const killResult = await execaCommand(`kill ${pid}`, {
      shell: true,
      reject: false,
    });

    if (killResult.exitCode !== 0) {
      return {
        success: false,
        error: `kill command failed (exit ${killResult.exitCode}): ${killResult.stderr || 'No error message'}`,
      };
    }

    // Wait for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check if still running
    const processStatus = await isProcessRunning(pid);

    if (processStatus.running) {
      // Force kill
      const forceResult = await execaCommand(`kill -9 ${pid}`, {
        shell: true,
        reject: false,
      });

      if (forceResult.exitCode !== 0) {
        return {
          success: false,
          error: `kill -9 command failed (exit ${forceResult.exitCode}): ${forceResult.stderr || 'No error message'}`,
        };
      }
    }

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // ESRCH means process doesn't exist - this is success
    if (errorMessage.includes('ESRCH')) {
      return { success: true };
    }

    console.error(`[cleanup-orphans] Failed to kill process ${pid}: ${errorMessage}`, {
      pid,
      error: errorMessage,
    });
    return { success: false, error: errorMessage };
  }
}

/**
 * Format cleanup results
 */
interface CleanupResults {
  stalePidFilesRemoved: number;
  stalePidFilesFailed: number;
  processesKilled: number;
  processesKillFailed: number;
  diagnosticErrors: Array<{
    type: 'pid-removal' | 'process-kill' | 'pid-scan' | 'log-file-removal' | 'config-removal';
    target: string | number;
    error: string;
    severity?: 'warning' | 'critical';
    errorCode?: string;
  }>;
  criticalErrorCount: number;
}

function formatCleanupResult(
  stalePidFiles: StalePidFile[],
  escapedProcesses: EscapedProcess[],
  dryRun: boolean,
  cleaned: CleanupResults
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

    // Add diagnostic summary if there were any failures
    if (cleaned.diagnosticErrors.length > 0) {
      lines.push('');
      lines.push('Diagnostic Warnings');
      lines.push('===================');
      lines.push(`${cleaned.diagnosticErrors.length} operation(s) failed during cleanup:`);
      for (const error of cleaned.diagnosticErrors) {
        const typeLabel =
          error.type === 'pid-removal'
            ? 'PID file removal'
            : error.type === 'process-kill'
              ? 'Process kill'
              : 'PID scan';
        lines.push(`  - ${typeLabel} failed for ${error.target}: ${error.error}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Execute the cleanup_orphans tool
 */
export async function cleanupOrphans(args: CleanupOrphansArgs): Promise<ToolResult> {
  try {
    // Validate arguments with Zod schema
    const validation = safeValidateArgs(CleanupOrphansArgsSchema, args);
    if (!validation.success) {
      throw new ValidationError(validation.error);
    }
    const validatedArgs = validation.data;

    const dryRun = validatedArgs.dry_run;
    const force = validatedArgs.force;

    const cleaned: CleanupResults = {
      stalePidFilesRemoved: 0,
      stalePidFilesFailed: 0,
      processesKilled: 0,
      processesKillFailed: 0,
      diagnosticErrors: [],
      criticalErrorCount: 0,
    };

    // Scan for orphans (pass diagnosticErrors to track scan errors)
    const stalePidFiles = await findStalePidFiles(cleaned.diagnosticErrors);
    const escapedProcesses = await findEscapedProcesses(cleaned.diagnosticErrors);

    // Clean up if not in dry run mode
    if (!dryRun && force) {
      // Clean up stale PID files
      for (const stalePidFile of stalePidFiles) {
        try {
          await cleanupStalePidFile(stalePidFile, cleaned.diagnosticErrors);
          cleaned.stalePidFilesRemoved++;
        } catch (error) {
          // Track failure for diagnostics
          cleaned.stalePidFilesFailed++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          cleaned.diagnosticErrors.push({
            type: 'pid-removal',
            target: stalePidFile.path,
            error: errorMessage,
          });
          console.error(`Failed to clean up ${stalePidFile.path}: ${errorMessage}`);
        }
      }

      // Kill escaped processes
      for (const proc of escapedProcesses) {
        const killResult = await killProcess(proc.pid);
        if (killResult.success) {
          cleaned.processesKilled++;
        } else {
          cleaned.processesKillFailed++;
          cleaned.diagnosticErrors.push({
            type: 'process-kill',
            target: proc.pid,
            error: killResult.error || 'Unknown error',
          });
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
        stale_pid_files_failed: cleaned.stalePidFilesFailed,
        processes_killed: cleaned.processesKilled,
        processes_kill_failed: cleaned.processesKillFailed,
        dry_run: dryRun,
        ...(cleaned.diagnosticErrors.length > 0 && {
          diagnostic_errors: cleaned.diagnosticErrors,
        }),
      },
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
