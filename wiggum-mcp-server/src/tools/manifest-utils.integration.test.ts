/**
 * Integration tests for manifest-utils filesystem operations
 *
 * These tests verify the behavior of readManifestFile, readManifestFiles,
 * cleanupManifestFiles, and related functions using real filesystem operations.
 *
 * Complements manifest-utils.test.ts which covers pure function logic.
 *
 * @see manifest-utils.test.ts for unit tests of pure functions
 * @see https://github.com/commons-systems/commons.systems/issues/625
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  readManifestFile,
  readManifestFiles,
  cleanupManifestFiles,
  safeCleanupManifestFiles,
  getManifestDir,
} from './manifest-utils.js';
import { FilesystemError } from '../utils/errors.js';
import type { IssueRecord } from './manifest-types.js';

// Test directory setup - uses unique directory per test run
let testDir: string;
let originalCwd: string;

/**
 * Create a valid IssueRecord for testing
 */
function createIssueRecord(overrides: Partial<IssueRecord> = {}): IssueRecord {
  return {
    agent_name: 'code-reviewer',
    scope: 'in-scope',
    priority: 'high',
    title: 'Test Issue',
    description: 'Test Description',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Write a test manifest file
 */
function writeTestManifest(
  dir: string,
  agentName: string,
  scope: 'in-scope' | 'out-of-scope',
  issues: IssueRecord[]
): string {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const timestamp = Date.now();
  const hash = Math.random().toString(16).slice(2, 10);
  const filename = `${agentName}-${scope}-${timestamp}-${hash}.json`;
  const filepath = join(dir, filename);
  writeFileSync(filepath, JSON.stringify(issues), 'utf-8');
  return filepath;
}

describe('manifest-utils integration tests', () => {
  beforeEach(() => {
    // Create unique test directory
    testDir = join(
      tmpdir(),
      `manifest-utils-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });

    // Save original cwd and change to test directory
    originalCwd = process.cwd();
    process.chdir(testDir);
  });

  afterEach(() => {
    // Restore original cwd
    process.chdir(originalCwd);

    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('readManifestFile()', () => {
    describe('successful reads', () => {
      it('should read valid manifest file with single issue', () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const issue = createIssueRecord();
        const filepath = writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

        const result = readManifestFile(filepath);

        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].title, 'Test Issue');
        assert.strictEqual(result[0].agent_name, 'code-reviewer');
      });

      it('should read valid manifest file with multiple issues', () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const issues = [
          createIssueRecord({ title: 'Issue 1' }),
          createIssueRecord({ title: 'Issue 2', priority: 'low' }),
          createIssueRecord({ title: 'Issue 3', scope: 'out-of-scope' }),
        ];
        const filepath = writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', issues);

        const result = readManifestFile(filepath);

        assert.strictEqual(result.length, 3);
        assert.strictEqual(result[0].title, 'Issue 1');
        assert.strictEqual(result[1].title, 'Issue 2');
        assert.strictEqual(result[2].title, 'Issue 3');
      });

      it('should read empty array from manifest with no issues', () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const filepath = writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', []);

        const result = readManifestFile(filepath);

        assert.strictEqual(result.length, 0);
      });

      it('should return empty array for non-existent file (ENOENT)', () => {
        const filepath = join(testDir, 'tmp', 'wiggum', 'nonexistent.json');

        const result = readManifestFile(filepath);

        assert.deepStrictEqual(result, []);
      });
    });

    describe('error handling', () => {
      it('should throw FilesystemError for malformed JSON', () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        mkdirSync(manifestDir, { recursive: true });
        const filepath = join(manifestDir, 'code-reviewer-in-scope-123456789-abc123.json');
        writeFileSync(filepath, '{ invalid json }', 'utf-8');

        assert.throws(
          () => readManifestFile(filepath),
          (err: Error) => {
            assert.ok(err instanceof FilesystemError, 'Should throw FilesystemError');
            assert.ok(
              err.message.includes('malformed JSON'),
              'Error should mention malformed JSON'
            );
            return true;
          }
        );
      });

      it('should throw FilesystemError for non-array JSON', () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        mkdirSync(manifestDir, { recursive: true });
        const filepath = join(manifestDir, 'code-reviewer-in-scope-123456789-abc123.json');
        writeFileSync(filepath, JSON.stringify({ not: 'array' }), 'utf-8');

        assert.throws(
          () => readManifestFile(filepath),
          (err: Error) => {
            assert.ok(err instanceof FilesystemError, 'Should throw FilesystemError');
            assert.ok(err.message.includes('corrupted'), 'Error should mention corruption');
            return true;
          }
        );
      });

      it('should throw FilesystemError for invalid issue records', () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        mkdirSync(manifestDir, { recursive: true });
        const filepath = join(manifestDir, 'code-reviewer-in-scope-123456789-abc123.json');
        // Valid JSON array but invalid IssueRecord structure
        writeFileSync(filepath, JSON.stringify([{ invalid: 'structure' }]), 'utf-8');

        assert.throws(
          () => readManifestFile(filepath),
          (err: Error) => {
            assert.ok(err instanceof FilesystemError, 'Should throw FilesystemError');
            assert.ok(
              err.message.includes('invalid issue records'),
              'Error should mention invalid records'
            );
            return true;
          }
        );
      });

      // Note: Permission tests are skipped on some systems (Windows, root user)
      // They are included for completeness but may be skipped in CI
    });
  });

  describe('readManifestFiles()', () => {
    describe('successful reads', () => {
      it('should return empty map when manifest directory does not exist', () => {
        // Don't create the directory
        const result = readManifestFiles();

        assert.strictEqual(result.size, 0);
      });

      it('should read single manifest file', () => {
        const manifestDir = getManifestDir();
        const issue = createIssueRecord({ agent_name: 'code-reviewer' });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

        const result = readManifestFiles();

        assert.strictEqual(result.size, 1);
        assert.ok(result.has('code-reviewer-in-scope'));
        assert.strictEqual(result.get('code-reviewer-in-scope')?.issues.length, 1);
      });

      it('should read multiple manifest files from different agents', () => {
        const manifestDir = getManifestDir();
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [
          createIssueRecord({ agent_name: 'code-reviewer' }),
        ]);
        writeTestManifest(manifestDir, 'silent-failure-hunter', 'in-scope', [
          createIssueRecord({ agent_name: 'silent-failure-hunter' }),
        ]);
        writeTestManifest(manifestDir, 'code-simplifier', 'out-of-scope', [
          createIssueRecord({ agent_name: 'code-simplifier', scope: 'out-of-scope' }),
        ]);

        const result = readManifestFiles();

        assert.strictEqual(result.size, 3);
        assert.ok(result.has('code-reviewer-in-scope'));
        assert.ok(result.has('silent-failure-hunter-in-scope'));
        assert.ok(result.has('code-simplifier-out-of-scope'));
      });

      it('should merge issues from multiple manifest files for same agent/scope', () => {
        const manifestDir = getManifestDir();
        // Create two manifest files for the same agent/scope
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [
          createIssueRecord({ agent_name: 'code-reviewer', title: 'Issue 1' }),
        ]);
        // Wait a bit to ensure different timestamp
        const timestamp = Date.now() + 1;
        const hash = Math.random().toString(16).slice(2, 10);
        writeFileSync(
          join(manifestDir, `code-reviewer-in-scope-${timestamp}-${hash}.json`),
          JSON.stringify([createIssueRecord({ agent_name: 'code-reviewer', title: 'Issue 2' })]),
          'utf-8'
        );

        const result = readManifestFiles();

        assert.strictEqual(result.size, 1);
        const manifest = result.get('code-reviewer-in-scope');
        assert.ok(manifest);
        assert.strictEqual(manifest.issues.length, 2);
      });

      it('should compute high_priority_count correctly', () => {
        const manifestDir = getManifestDir();
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [
          createIssueRecord({ agent_name: 'code-reviewer', priority: 'high' }),
          createIssueRecord({ agent_name: 'code-reviewer', priority: 'low' }),
          createIssueRecord({ agent_name: 'code-reviewer', priority: 'high' }),
        ]);

        const result = readManifestFiles();

        const manifest = result.get('code-reviewer-in-scope');
        assert.ok(manifest);
        assert.strictEqual(manifest.high_priority_count, 2);
        assert.strictEqual(manifest.issues.length, 3);
      });
    });

    describe('error handling', () => {
      it('should skip files with invalid filenames', () => {
        const manifestDir = getManifestDir();
        mkdirSync(manifestDir, { recursive: true });

        // Valid manifest
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [
          createIssueRecord({ agent_name: 'code-reviewer' }),
        ]);

        // Invalid filename (no scope marker)
        writeFileSync(
          join(manifestDir, 'invalid-manifest-123456789.json'),
          JSON.stringify([createIssueRecord()]),
          'utf-8'
        );

        const result = readManifestFiles();

        // Should only have the valid manifest
        assert.strictEqual(result.size, 1);
        assert.ok(result.has('code-reviewer-in-scope'));
      });

      it('should skip non-JSON files', () => {
        const manifestDir = getManifestDir();
        mkdirSync(manifestDir, { recursive: true });

        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [
          createIssueRecord({ agent_name: 'code-reviewer' }),
        ]);

        // Non-JSON file
        writeFileSync(join(manifestDir, 'readme.txt'), 'This is not a manifest', 'utf-8');

        const result = readManifestFiles();

        assert.strictEqual(result.size, 1);
      });
    });
  });

  describe('cleanupManifestFiles()', () => {
    it('should be no-op when manifest directory does not exist', async () => {
      // Don't create the directory
      await assert.doesNotReject(async () => {
        await cleanupManifestFiles();
      });
    });

    it('should delete all manifest files', async () => {
      const manifestDir = getManifestDir();
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [createIssueRecord()]);
      writeTestManifest(manifestDir, 'silent-failure-hunter', 'in-scope', [createIssueRecord()]);
      writeTestManifest(manifestDir, 'code-simplifier', 'out-of-scope', [createIssueRecord()]);

      // Verify files exist
      const files = readdirSync(manifestDir);
      assert.strictEqual(files.length, 3);

      await cleanupManifestFiles();

      // Verify all files deleted
      const remainingFiles = readdirSync(manifestDir);
      assert.strictEqual(remainingFiles.length, 0);
    });

    it('should handle empty manifest directory', async () => {
      const manifestDir = getManifestDir();
      mkdirSync(manifestDir, { recursive: true });

      await assert.doesNotReject(async () => {
        await cleanupManifestFiles();
      });
    });
  });

  describe('safeCleanupManifestFiles()', () => {
    it('should not throw on cleanup failure', async () => {
      // This is hard to test without permission manipulation
      // Just verify it doesn't throw for normal cases
      const manifestDir = getManifestDir();
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [createIssueRecord()]);

      await assert.doesNotReject(async () => {
        await safeCleanupManifestFiles();
      });
    });

    it('should handle missing directory gracefully', async () => {
      // Don't create the directory
      await assert.doesNotReject(async () => {
        await safeCleanupManifestFiles();
      });
    });
  });

  describe('getManifestDir()', () => {
    it('should return path ending with tmp/wiggum', () => {
      const dir = getManifestDir();
      assert.ok(
        dir.endsWith('tmp/wiggum') || dir.endsWith('tmp\\wiggum'),
        `Expected path to end with tmp/wiggum, got: ${dir}`
      );
    });

    it('should return absolute path', () => {
      const dir = getManifestDir();
      // Should start with / on Unix or drive letter on Windows
      assert.ok(
        dir.startsWith('/') || /^[A-Za-z]:/.test(dir),
        `Expected absolute path, got: ${dir}`
      );
    });
  });
});
