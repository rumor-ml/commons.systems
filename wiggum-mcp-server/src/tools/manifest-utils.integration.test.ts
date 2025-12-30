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
    });

    /**
     * Critical error handling tests for readManifestFile
     *
     * These tests verify the error handling strategy documented in manifest-utils.ts:
     * - ENOENT (file not found): Returns empty array - agent may not have run yet
     * - All other errors: Throws FilesystemError to prevent silent data loss
     *
     * WHY THIS MATTERS:
     * The function throws on errors (except ENOENT) because returning an empty array
     * would cause callers to incorrectly believe the agent found zero issues, leading to:
     * - Agents being incorrectly marked as complete
     * - Review findings being silently lost
     * - Workflow proceeding without critical feedback
     *
     * If these error paths regress (e.g., catch block returns [] instead of throwing),
     * an agent's entire review output could be lost. The completion logic would see []
     * and mark the agent as complete with zero issues.
     *
     * @see manifest-utils.ts lines 220-250 for error handling documentation
     */
    describe('error handling', () => {
      describe('JSON parse errors (SyntaxError)', () => {
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

        it('should throw FilesystemError for truncated JSON (partial write)', () => {
          const manifestDir = join(testDir, 'tmp', 'wiggum');
          mkdirSync(manifestDir, { recursive: true });
          const filepath = join(manifestDir, 'code-reviewer-in-scope-123456789-truncated.json');
          // Simulate partial write - JSON cut off mid-property
          writeFileSync(
            filepath,
            '[{"agent_name":"code-reviewer","scope":"in-scope","pri',
            'utf-8'
          );

          assert.throws(
            () => readManifestFile(filepath),
            (err: Error) => {
              assert.ok(err instanceof FilesystemError, 'Should throw FilesystemError');
              assert.ok(
                err.message.includes('malformed JSON'),
                'Error should mention malformed JSON for truncated content'
              );
              return true;
            }
          );
        });
      });

      describe('array validation failures', () => {
        it('should throw FilesystemError for non-array JSON (object)', () => {
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

        it('should throw FilesystemError for non-array JSON (string)', () => {
          const manifestDir = join(testDir, 'tmp', 'wiggum');
          mkdirSync(manifestDir, { recursive: true });
          const filepath = join(manifestDir, 'code-reviewer-in-scope-123456789-string.json');
          writeFileSync(filepath, JSON.stringify('just a string'), 'utf-8');

          assert.throws(
            () => readManifestFile(filepath),
            (err: Error) => {
              assert.ok(err instanceof FilesystemError, 'Should throw FilesystemError');
              assert.ok(err.message.includes('corrupted'), 'Error should mention corruption');
              return true;
            }
          );
        });

        it('should throw FilesystemError for non-array JSON (null)', () => {
          const manifestDir = join(testDir, 'tmp', 'wiggum');
          mkdirSync(manifestDir, { recursive: true });
          const filepath = join(manifestDir, 'code-reviewer-in-scope-123456789-null.json');
          writeFileSync(filepath, 'null', 'utf-8');

          assert.throws(
            () => readManifestFile(filepath),
            (err: Error) => {
              assert.ok(err instanceof FilesystemError, 'Should throw FilesystemError');
              assert.ok(err.message.includes('corrupted'), 'Error should mention corruption');
              return true;
            }
          );
        });
      });

      describe('schema validation failures (isIssueRecordArray)', () => {
        it('should throw FilesystemError for invalid issue records (missing required fields)', () => {
          const manifestDir = join(testDir, 'tmp', 'wiggum');
          mkdirSync(manifestDir, { recursive: true });
          const filepath = join(manifestDir, 'code-reviewer-in-scope-123456789-abc123.json');
          // Valid JSON array but invalid IssueRecord structure - missing required fields
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

        it('should throw FilesystemError for issue with invalid scope value', () => {
          const manifestDir = join(testDir, 'tmp', 'wiggum');
          mkdirSync(manifestDir, { recursive: true });
          const filepath = join(manifestDir, 'code-reviewer-in-scope-123456789-badscope.json');
          // Valid structure but invalid scope value
          writeFileSync(
            filepath,
            JSON.stringify([
              {
                agent_name: 'code-reviewer',
                scope: 'invalid-scope', // Not 'in-scope' or 'out-of-scope'
                priority: 'high',
                title: 'Test',
                description: 'Test',
                timestamp: '2025-01-01T00:00:00Z',
              },
            ]),
            'utf-8'
          );

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

        it('should throw FilesystemError for issue with invalid priority value', () => {
          const manifestDir = join(testDir, 'tmp', 'wiggum');
          mkdirSync(manifestDir, { recursive: true });
          const filepath = join(manifestDir, 'code-reviewer-in-scope-123456789-badpri.json');
          // Valid structure but invalid priority value
          writeFileSync(
            filepath,
            JSON.stringify([
              {
                agent_name: 'code-reviewer',
                scope: 'in-scope',
                priority: 'medium', // Not 'high' or 'low'
                title: 'Test',
                description: 'Test',
                timestamp: '2025-01-01T00:00:00Z',
              },
            ]),
            'utf-8'
          );

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
      });

      describe('ENOENT handling (file not found)', () => {
        it('should return empty array for non-existent file (ENOENT)', () => {
          const filepath = join(testDir, 'tmp', 'wiggum', 'nonexistent-file.json');

          const result = readManifestFile(filepath);

          // ENOENT is acceptable - agent may not have completed yet
          assert.deepStrictEqual(result, []);
        });

        it('should return empty array when parent directory does not exist', () => {
          const filepath = join(testDir, 'nonexistent-dir', 'wiggum', 'file.json');

          const result = readManifestFile(filepath);

          // ENOENT is acceptable even for missing parent directories
          assert.deepStrictEqual(result, []);
        });
      });

      // Note: EACCES/EROFS permission tests are platform-dependent and require
      // special setup (chmod, running as non-root). They are intentionally not
      // included in the standard test suite to avoid flaky tests in CI.
      // The error handling code path for permissions is simple (throw FilesystemError)
      // and is validated by code review rather than automated tests.
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

  describe('2-strike logic with filesystem errors', () => {
    /**
     * These tests verify that readManifestFiles properly handles corrupted manifests
     * and doesn't cause incorrect agent completion status.
     *
     * When manifest reads fail during agent completion tracking:
     * - Corrupted files should be skipped (logged as warning)
     * - Valid files from other agents should still be processed
     * - Agent completion status should reflect available data
     *
     * @see pr-test-analyzer-in-scope-3 for the issue that prompted these tests
     */

    it('should skip corrupted manifest file and process valid ones', () => {
      const manifestDir = getManifestDir();
      mkdirSync(manifestDir, { recursive: true });

      // Valid manifest for code-reviewer
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [
        createIssueRecord({ agent_name: 'code-reviewer', priority: 'high' }),
      ]);

      // Corrupted manifest for silent-failure-hunter (invalid JSON)
      const corruptPath = join(
        manifestDir,
        'silent-failure-hunter-in-scope-123456789-corrupt.json'
      );
      writeFileSync(corruptPath, '{ corrupted json', 'utf-8');

      // Valid manifest for code-simplifier
      writeTestManifest(manifestDir, 'code-simplifier', 'in-scope', [
        createIssueRecord({ agent_name: 'code-simplifier', priority: 'low' }),
      ]);

      // Should not throw - corrupted file is skipped
      const result = readManifestFiles();

      // Should have 2 valid manifests (code-reviewer and code-simplifier)
      assert.strictEqual(result.size, 2);
      assert.ok(result.has('code-reviewer-in-scope'));
      assert.ok(result.has('code-simplifier-in-scope'));
      // Corrupted manifest for silent-failure-hunter is skipped
      assert.ok(!result.has('silent-failure-hunter-in-scope'));
    });

    it('should skip manifest with non-array JSON and process valid ones', () => {
      const manifestDir = getManifestDir();
      mkdirSync(manifestDir, { recursive: true });

      // Valid manifest
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [
        createIssueRecord({ agent_name: 'code-reviewer' }),
      ]);

      // Invalid manifest (object instead of array)
      const invalidPath = join(manifestDir, 'code-simplifier-in-scope-123456789-invalid.json');
      writeFileSync(invalidPath, JSON.stringify({ not: 'an array' }), 'utf-8');

      const result = readManifestFiles();

      // Should only have the valid manifest
      assert.strictEqual(result.size, 1);
      assert.ok(result.has('code-reviewer-in-scope'));
    });

    it('should skip manifest with invalid IssueRecord schema and process valid ones', () => {
      const manifestDir = getManifestDir();
      mkdirSync(manifestDir, { recursive: true });

      // Valid manifest
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [
        createIssueRecord({ agent_name: 'code-reviewer' }),
      ]);

      // Invalid manifest (array but wrong schema)
      const invalidPath = join(manifestDir, 'pr-test-analyzer-in-scope-123456789-invalid.json');
      writeFileSync(invalidPath, JSON.stringify([{ missing: 'required fields' }]), 'utf-8');

      const result = readManifestFiles();

      // Should only have the valid manifest
      assert.strictEqual(result.size, 1);
      assert.ok(result.has('code-reviewer-in-scope'));
    });

    it('should correctly compute high_priority_count despite some corrupted files', () => {
      const manifestDir = getManifestDir();
      mkdirSync(manifestDir, { recursive: true });

      // Valid manifest with 2 high-priority issues
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [
        createIssueRecord({ agent_name: 'code-reviewer', priority: 'high', title: 'Issue 1' }),
        createIssueRecord({ agent_name: 'code-reviewer', priority: 'high', title: 'Issue 2' }),
        createIssueRecord({ agent_name: 'code-reviewer', priority: 'low', title: 'Issue 3' }),
      ]);

      // Corrupted manifest (would have had high-priority issues if readable)
      const corruptPath = join(
        manifestDir,
        'silent-failure-hunter-in-scope-123456789-corrupt.json'
      );
      writeFileSync(corruptPath, '{ corrupted', 'utf-8');

      const result = readManifestFiles();

      const manifest = result.get('code-reviewer-in-scope');
      assert.ok(manifest);
      // high_priority_count should be computed from valid issues only
      assert.strictEqual(manifest.high_priority_count, 2);
      assert.strictEqual(manifest.issues.length, 3);
    });

    it('should throw FilesystemError when all manifests are corrupted', () => {
      const manifestDir = getManifestDir();
      mkdirSync(manifestDir, { recursive: true });

      // All corrupted manifests
      writeFileSync(
        join(manifestDir, 'code-reviewer-in-scope-123456789-corrupt1.json'),
        '{ bad json 1',
        'utf-8'
      );
      writeFileSync(
        join(manifestDir, 'silent-failure-hunter-in-scope-123456789-corrupt2.json'),
        '{ bad json 2',
        'utf-8'
      );

      // Should throw FilesystemError when complete data loss is detected
      assert.throws(
        () => readManifestFiles(),
        (error: Error) => {
          return (
            error.name === 'FilesystemError' &&
            error.message.includes('Failed to read any manifest files')
          );
        }
      );
    });

    it('should throw FilesystemError for mixed valid and invalid issue records within same file', () => {
      const manifestDir = getManifestDir();
      mkdirSync(manifestDir, { recursive: true });

      // File with valid array structure but invalid IssueRecord fields
      // The entire file should be rejected since schema validation fails
      const mixedPath = join(manifestDir, 'code-reviewer-in-scope-123456789-mixed.json');
      writeFileSync(
        mixedPath,
        JSON.stringify([
          createIssueRecord({ agent_name: 'code-reviewer' }), // Valid
          { invalid: 'record', missing: 'fields' }, // Invalid
        ]),
        'utf-8'
      );

      // When the only file is invalid, it throws FilesystemError for complete data loss
      assert.throws(
        () => readManifestFiles(),
        (error: Error) => {
          return (
            error.name === 'FilesystemError' &&
            error.message.includes('Failed to read any manifest files')
          );
        }
      );
    });

    it('should process multiple files for same agent even if one is corrupted', () => {
      const manifestDir = getManifestDir();
      mkdirSync(manifestDir, { recursive: true });

      // First valid manifest file for code-reviewer
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [
        createIssueRecord({ agent_name: 'code-reviewer', title: 'Issue 1' }),
      ]);

      // Second corrupted manifest file for same agent
      const corruptPath = join(manifestDir, 'code-reviewer-in-scope-999999999-corrupt.json');
      writeFileSync(corruptPath, '{ broken', 'utf-8');

      // Third valid manifest file for code-reviewer
      const thirdPath = join(manifestDir, 'code-reviewer-in-scope-888888888-valid.json');
      writeFileSync(
        thirdPath,
        JSON.stringify([createIssueRecord({ agent_name: 'code-reviewer', title: 'Issue 2' })]),
        'utf-8'
      );

      const result = readManifestFiles();

      // Should have merged issues from valid files only
      const manifest = result.get('code-reviewer-in-scope');
      assert.ok(manifest);
      // Should have 2 issues from the two valid files (corrupted file skipped)
      assert.strictEqual(manifest.issues.length, 2);
      const titles = manifest.issues.map((i) => i.title);
      assert.ok(titles.includes('Issue 1'));
      assert.ok(titles.includes('Issue 2'));
    });
  });

  describe('partial write recovery tests', () => {
    /**
     * These tests verify error handling for partial write scenarios
     * that can occur when the process crashes or is killed mid-write.
     *
     * @see pr-test-analyzer-in-scope-2 for the issue that prompted these tests
     */

    it('should throw FilesystemError with recovery guidance for partial JSON write', () => {
      const manifestDir = getManifestDir();
      mkdirSync(manifestDir, { recursive: true });
      const filepath = join(manifestDir, 'code-reviewer-in-scope-123456789-partial.json');

      // Simulate partial write (missing closing bracket)
      writeFileSync(
        filepath,
        '[{"agent_name":"code-reviewer","scope":"in-scope","priority":"high","title":"Test"',
        'utf-8'
      );

      assert.throws(
        () => readManifestFile(filepath),
        (err: Error) => {
          assert.ok(err instanceof FilesystemError, 'Should throw FilesystemError');
          assert.ok(
            err.message.includes('malformed JSON'),
            `Expected 'malformed JSON' in message, got: ${err.message}`
          );
          return true;
        }
      );
    });

    it('should throw FilesystemError for truncated array', () => {
      const manifestDir = getManifestDir();
      mkdirSync(manifestDir, { recursive: true });
      const filepath = join(manifestDir, 'code-reviewer-in-scope-123456789-truncated.json');

      // Simulate truncated array (incomplete second element)
      writeFileSync(
        filepath,
        '[{"agent_name":"code-reviewer","scope":"in-scope","priority":"high","title":"Issue 1","description":"Desc","timestamp":"2025-01-01T00:00:00Z"},{"agent_name"',
        'utf-8'
      );

      assert.throws(
        () => readManifestFile(filepath),
        (err: Error) => {
          assert.ok(err instanceof FilesystemError, 'Should throw FilesystemError');
          return true;
        }
      );
    });

    it('should continue processing other agents when one has corrupted manifest', () => {
      const manifestDir = getManifestDir();
      mkdirSync(manifestDir, { recursive: true });

      // Valid manifest for code-reviewer
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [
        createIssueRecord({ agent_name: 'code-reviewer', priority: 'high' }),
      ]);

      // Corrupted manifest for code-simplifier (partial write)
      const corruptPath = join(manifestDir, 'code-simplifier-in-scope-123456789-partial.json');
      writeFileSync(corruptPath, '[ { "agent_name": "code-simplifier", "scope":', 'utf-8');

      // Valid manifest for silent-failure-hunter
      writeTestManifest(manifestDir, 'silent-failure-hunter', 'in-scope', [
        createIssueRecord({ agent_name: 'silent-failure-hunter', priority: 'low' }),
      ]);

      // Should skip corrupted file and process others
      const result = readManifestFiles();

      // Should have 2 manifests (corrupted code-simplifier is skipped)
      assert.strictEqual(result.size, 2);
      assert.ok(result.has('code-reviewer-in-scope'));
      assert.ok(result.has('silent-failure-hunter-in-scope'));
      assert.ok(!result.has('code-simplifier-in-scope'));
    });

    it('should throw FilesystemError for empty JSON file', () => {
      const manifestDir = getManifestDir();
      mkdirSync(manifestDir, { recursive: true });
      const filepath = join(manifestDir, 'code-reviewer-in-scope-123456789-empty.json');

      // Empty file (write was interrupted before any data)
      writeFileSync(filepath, '', 'utf-8');

      assert.throws(
        () => readManifestFile(filepath),
        (err: Error) => {
          assert.ok(err instanceof FilesystemError, 'Should throw FilesystemError');
          return true;
        }
      );
    });
  });
});
