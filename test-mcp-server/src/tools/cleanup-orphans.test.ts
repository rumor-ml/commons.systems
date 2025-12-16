/**
 * Integration tests for cleanup-orphans tool
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, access } from 'fs/promises';
import path from 'path';
import { cleanupOrphans } from './cleanup-orphans.js';

describe('Cleanup Orphans - Stale PID Files', () => {
  let testDir: string;
  let testDirs: string[] = [];

  beforeEach(async () => {
    testDir = await mkdtemp(path.join('/tmp/claude', 'cleanup-test-'));
    testDirs = [];
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    for (const dir of testDirs) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('should detect stale PID file when process not running', async () => {
    // Create PID file with non-existent PID directly in testDir (2 levels deep)
    await writeFile(path.join(testDir, 'firebase-emulators.pid'), '99999');

    const result = await cleanupOrphans({ dry_run: true, force: true });

    assert.ok(result._meta, 'Result should have _meta');
    const meta = result._meta as any;
    assert.ok(meta.stale_pid_files_found > 0, 'Should find at least one stale PID file');
  });

  it('should remove stale PID file in non-dry-run mode', async () => {
    const pidFile = path.join(testDir, 'firebase-emulators.pid');
    await writeFile(pidFile, '99999');

    await cleanupOrphans({ dry_run: false, force: true });

    // PID file should be removed
    await assert.rejects(
      async () => {
        await access(pidFile);
      },
      { code: 'ENOENT' },
      'PID file should not exist after cleanup'
    );
  });

  it('should handle multiple stale PID files', async () => {
    // Create two separate temp directories (like production)
    const worktree1 = await mkdtemp(path.join('/tmp/claude', 'cleanup-test-'));
    const worktree2 = await mkdtemp(path.join('/tmp/claude', 'cleanup-test-'));
    testDirs.push(worktree1, worktree2);

    await writeFile(path.join(worktree1, 'firebase-emulators.pid'), '99999');
    await writeFile(path.join(worktree2, 'firebase-emulators.pid'), '99998');

    const result = await cleanupOrphans({ dry_run: true, force: true });

    assert.ok(result._meta, 'Result should have _meta');
    const meta = result._meta as any;
    assert.strictEqual(meta.stale_pid_files_found, 2, 'Should find exactly 2 stale PID files');
  });

  it('should handle empty directory gracefully', async () => {
    const result = await cleanupOrphans({ dry_run: true, force: true });

    assert.ok(result._meta, 'Result should have _meta');
    const meta = result._meta as any;
    assert.strictEqual(meta.stale_pid_files_found, 0, 'Should find no stale PID files');
    assert.strictEqual(meta.escaped_processes_found, 0, 'Should find no escaped processes');
  });

  it('should clean up associated files (log, firebase.json)', async () => {
    const pidFile = path.join(testDir, 'firebase-emulators.pid');
    const logFile = path.join(testDir, 'firebase-emulators.log');
    const firebaseJson = path.join(testDir, 'firebase.json');

    await writeFile(pidFile, '99999');
    await writeFile(logFile, 'log content');
    await writeFile(firebaseJson, '{}');

    await cleanupOrphans({ dry_run: false, force: true });

    // All files should be removed
    await assert.rejects(async () => await access(pidFile), { code: 'ENOENT' });
    await assert.rejects(async () => await access(logFile), { code: 'ENOENT' });
    await assert.rejects(async () => await access(firebaseJson), { code: 'ENOENT' });
  });
});
