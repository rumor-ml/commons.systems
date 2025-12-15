/**
 * cleanup_worktree tool - Clean up all test infrastructure for a specific worktree
 */

import type { ToolResult } from '../types.js';
import { createErrorResult, ValidationError, InfrastructureError } from '../utils/errors.js';
import { getWorktreeRoot } from '../utils/paths.js';
import { execaCommand } from 'execa';
import fs from 'fs/promises';
import path from 'path';

export interface CleanupWorktreeArgs {
  worktree_path?: string;
}

interface CleanupResult {
  worktreeName: string;
  worktreeRoot: string;
  worktreeHash: string;
  tmpDir: string;
  emulatorStopped: boolean;
  emulatorPid?: number;
  tmpDirRemoved: boolean;
  tmpDirContents: string[];
  legacyConfigRemoved: boolean;
}

/**
 * Calculate the worktree hash (same logic as allocate-test-ports.sh)
 */
async function calculateWorktreeHash(worktreeRoot: string): Promise<string> {
  try {
    // Use cksum to calculate hash (same as shell script)
    const result = await execaCommand(`echo -n "${worktreeRoot}" | cksum`, {
      shell: true,
    });

    const hash = result.stdout.trim().split(/\s+/)[0];
    return hash;
  } catch (error) {
    throw new InfrastructureError(
      `Failed to calculate worktree hash: ${error instanceof Error ? error.message : String(error)}`
    );
  }
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
  } catch {
    return false;
  }
}

/**
 * Stop emulator process
 */
async function stopEmulator(pid: number): Promise<boolean> {
  try {
    // Try graceful shutdown first
    await execaCommand(`kill ${pid}`, {
      shell: true,
      reject: false,
    });

    // Wait for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 2000));

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
  } catch {
    return false;
  }
}

/**
 * List contents of a directory
 */
async function listDirectory(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.map((entry) => {
      const type = entry.isDirectory() ? 'dir' : 'file';
      return `${entry.name} (${type})`;
    });
  } catch {
    return [];
  }
}

/**
 * Remove directory recursively
 */
async function removeDirectory(dirPath: string): Promise<boolean> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute the cleanup_worktree tool
 */
export async function cleanupWorktree(args: CleanupWorktreeArgs): Promise<ToolResult> {
  try {
    // Get worktree path (use provided or default to current)
    const worktreeRoot = args.worktree_path
      ? path.resolve(args.worktree_path)
      : await getWorktreeRoot();

    // Validate that the path exists
    try {
      await fs.access(worktreeRoot);
    } catch {
      throw new ValidationError(`Directory does not exist: ${worktreeRoot}`);
    }

    // Validate that it's a git repository
    try {
      const result = await execaCommand('git rev-parse --git-dir', {
        cwd: worktreeRoot,
        shell: true,
        reject: false,
      });

      if (result.exitCode !== 0) {
        throw new ValidationError(`Not a git repository: ${worktreeRoot}`);
      }
    } catch {
      throw new ValidationError(`Not a git repository: ${worktreeRoot}`);
    }

    // Additional safety: validate path is within expected worktrees directory or is repo root
    const normalizedPath = path.normalize(worktreeRoot);

    try {
      const repoRootResult = await execaCommand('git rev-parse --show-toplevel', {
        cwd: worktreeRoot,
        shell: true,
      });
      const repoRoot = repoRootResult.stdout.trim();

      const isRepoRoot = normalizedPath === repoRoot;
      const isWorktree = normalizedPath.includes('/worktrees/');

      if (!isRepoRoot && !isWorktree) {
        throw new ValidationError(
          `Path validation failed: ${worktreeRoot} is not the repository root ` +
          `and does not appear to be in a worktrees directory. ` +
          `This is a safety check to prevent accidental deletion.`
        );
      }
    } catch (error) {
      // If it's already a ValidationError, re-throw it
      if (error instanceof ValidationError) {
        throw error;
      }
      // Otherwise, git command failed
      throw new ValidationError(`Failed to validate repository structure: ${error}`);
    }

    const worktreeName = path.basename(worktreeRoot);
    const worktreeHash = await calculateWorktreeHash(worktreeRoot);
    const tmpDir = `/tmp/claude/${worktreeHash}`;

    const result: CleanupResult = {
      worktreeName,
      worktreeRoot,
      worktreeHash,
      tmpDir,
      emulatorStopped: false,
      tmpDirRemoved: false,
      tmpDirContents: [],
      legacyConfigRemoved: false,
    };

    // Check for running emulators
    const pidFilePath = path.join(tmpDir, 'firebase-emulators.pid');

    try {
      const pidContent = await fs.readFile(pidFilePath, 'utf-8');
      const emulatorPid = parseInt(pidContent.trim(), 10);

      if (!isNaN(emulatorPid)) {
        result.emulatorPid = emulatorPid;

        const isRunning = await isProcessRunning(emulatorPid);

        if (isRunning) {
          // Stop the emulator
          const stopped = await stopEmulator(emulatorPid);
          result.emulatorStopped = stopped;
        } else {
          // Process not running (stale PID file)
          result.emulatorStopped = true; // Consider it "stopped"
        }
      }
    } catch {
      // No PID file or can't read it - emulators not running
      result.emulatorStopped = true; // Nothing to stop
    }

    // List and remove temp directory
    try {
      await fs.access(tmpDir);
      result.tmpDirContents = await listDirectory(tmpDir);
      result.tmpDirRemoved = await removeDirectory(tmpDir);
    } catch {
      // Temp directory doesn't exist
      result.tmpDirRemoved = true; // Nothing to remove
    }

    // Clean up legacy Firebase config
    const legacyFirebaseJson = path.join(worktreeRoot, `.firebase-${worktreeHash}.json`);

    try {
      await fs.unlink(legacyFirebaseJson);
      result.legacyConfigRemoved = true;
    } catch {
      // Legacy config doesn't exist or can't be removed
      result.legacyConfigRemoved = false;
    }

    // Format output
    const formatted = formatCleanupResult(result);

    return {
      content: [
        {
          type: 'text',
          text: formatted,
        },
      ],
      _meta: {
        worktree_name: result.worktreeName,
        worktree_root: result.worktreeRoot,
        worktree_hash: result.worktreeHash,
        tmp_dir: result.tmpDir,
        emulator_stopped: result.emulatorStopped,
        emulator_pid: result.emulatorPid,
        tmp_dir_removed: result.tmpDirRemoved,
        legacy_config_removed: result.legacyConfigRemoved,
      },
    };
  } catch (error) {
    return createErrorResult(error);
  }
}

/**
 * Format cleanup result
 */
function formatCleanupResult(result: CleanupResult): string {
  const lines: string[] = [];

  lines.push('Worktree Cleanup Summary');
  lines.push('========================');
  lines.push('');
  lines.push(`Worktree: ${result.worktreeName}`);
  lines.push(`Path: ${result.worktreeRoot}`);
  lines.push(`Hash: ${result.worktreeHash}`);
  lines.push(`Temp directory: ${result.tmpDir}`);
  lines.push('');

  // Emulator status
  if (result.emulatorPid) {
    if (result.emulatorStopped) {
      lines.push(`✓ Stopped Firebase emulator (PID: ${result.emulatorPid})`);
    } else {
      lines.push(`⚠️  Failed to stop Firebase emulator (PID: ${result.emulatorPid})`);
    }
  } else {
    lines.push('No emulator PID file found - emulators not running');
  }
  lines.push('');

  // Temp directory
  if (result.tmpDirContents.length > 0) {
    lines.push('Temp directory contents:');
    for (const item of result.tmpDirContents) {
      lines.push(`  - ${item}`);
    }
    lines.push('');
  }

  if (result.tmpDirRemoved) {
    lines.push('✓ Removed temp directory');
  } else {
    lines.push('⚠️  Failed to remove temp directory or it did not exist');
  }
  lines.push('');

  // Legacy config
  if (result.legacyConfigRemoved) {
    lines.push('✓ Removed legacy Firebase config');
  }

  lines.push('');
  lines.push('========================');
  lines.push(`✓ Cleanup complete for worktree: ${result.worktreeName}`);
  lines.push('========================');

  return lines.join('\n');
}
