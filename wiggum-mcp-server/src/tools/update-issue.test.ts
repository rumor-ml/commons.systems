/**
 * Tests for update-issue tool
 *
 * Test coverage for the issue update tool that modifies manifest files.
 * Includes both schema validation and behavioral tests with real filesystem operations.
 *
 * @see https://github.com/commons-systems/commons.systems/issues/625
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from 'fs';
import { join } from 'path';
import { UpdateIssueInputSchema, updateIssue, getWriteErrorGuidance } from './update-issue.js';
import type { IssueRecord } from './manifest-types.js';
import { FilesystemError } from '../utils/errors.js';

/**
 * Helper to detect if running on WSL (Windows Subsystem for Linux)
 * WSL has known limitations with chmod permissions on NTFS filesystems
 */
function isWSL(): boolean {
  try {
    return (
      existsSync('/proc/version') &&
      readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft')
    );
  } catch {
    // Expected on non-Linux systems where /proc/version doesn't exist
    return false;
  }
}

describe('update-issue tool', () => {
  describe('UpdateIssueInputSchema', () => {
    describe('valid inputs', () => {
      it('should validate with valid issue ID and not_fixed true', () => {
        const input = { id: 'code-reviewer-in-scope-0', not_fixed: true };
        const result = UpdateIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
        if (result.success) {
          assert.strictEqual(result.data.id, 'code-reviewer-in-scope-0');
          assert.strictEqual(result.data.not_fixed, true);
        }
      });

      it('should validate with valid issue ID and not_fixed false', () => {
        const input = { id: 'silent-failure-hunter-out-of-scope-5', not_fixed: false };
        const result = UpdateIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
        if (result.success) {
          assert.strictEqual(result.data.id, 'silent-failure-hunter-out-of-scope-5');
          assert.strictEqual(result.data.not_fixed, false);
        }
      });

      it('should validate with hyphenated agent name', () => {
        const input = { id: 'pr-test-analyzer-in-scope-2', not_fixed: true };
        const result = UpdateIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
        if (result.success) {
          assert.strictEqual(result.data.id, 'pr-test-analyzer-in-scope-2');
        }
      });
    });

    describe('invalid inputs', () => {
      it('should reject missing id', () => {
        const input = { not_fixed: true };
        const result = UpdateIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });

      it('should reject empty id', () => {
        const input = { id: '', not_fixed: true };
        const result = UpdateIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });

      it('should reject missing not_fixed', () => {
        const input = { id: 'code-reviewer-in-scope-0' };
        const result = UpdateIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });

      it('should reject non-boolean not_fixed', () => {
        const input = { id: 'code-reviewer-in-scope-0', not_fixed: 'true' };
        const result = UpdateIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });

      it('should reject numeric id', () => {
        const input = { id: 123, not_fixed: true };
        const result = UpdateIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });
    });
  });
});

// Store original cwd and restore after tests
let originalCwd: string;
let testDir: string;

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
 * Write a manifest file directly for testing
 */
function writeTestManifest(
  dir: string,
  agentName: string,
  scope: 'in-scope' | 'out-of-scope',
  issues: IssueRecord[]
): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  const filename = `${agentName}-${scope}-${timestamp}-${random}.json`;
  const filepath = join(dir, filename);
  writeFileSync(filepath, JSON.stringify(issues, null, 2), 'utf-8');
  return filepath;
}

describe('update-issue behavioral tests', () => {
  beforeEach(() => {
    // Save original cwd and create a unique test directory
    originalCwd = process.cwd();
    testDir = join(
      '/tmp/claude',
      `update-issue-test-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
    );
    mkdirSync(join(testDir, 'tmp', 'wiggum'), { recursive: true });
    process.chdir(testDir);
  });

  afterEach(() => {
    // Restore cwd and cleanup test directory
    process.chdir(originalCwd);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('successful updates', () => {
    it('should update not_fixed to true', async () => {
      const manifestDir = join(testDir, 'tmp', 'wiggum');
      const issue = createIssueRecord({
        agent_name: 'code-reviewer',
        scope: 'in-scope',
        title: 'Test Issue',
      });
      const filepath = writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

      const result = await updateIssue({
        id: 'code-reviewer-in-scope-0',
        not_fixed: true,
      });

      assert.ok(result.content[0].type === 'text');
      const text = result.content[0].text;
      assert.ok(text.includes('Updated issue'), 'Should confirm update');
      assert.ok(text.includes('not_fixed'), 'Should mention not_fixed field');

      // Verify the file was actually updated
      const updatedContent = readFileSync(filepath, 'utf-8');
      const updatedIssues = JSON.parse(updatedContent);
      assert.strictEqual(updatedIssues[0].not_fixed, true);
    });

    it('should update not_fixed to false', async () => {
      const manifestDir = join(testDir, 'tmp', 'wiggum');
      const issue = createIssueRecord({
        agent_name: 'code-reviewer',
        scope: 'in-scope',
        not_fixed: true, // Start with true
      });
      const filepath = writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

      const result = await updateIssue({
        id: 'code-reviewer-in-scope-0',
        not_fixed: false,
      });

      assert.ok(!result.isError);

      // Verify the file was actually updated
      const updatedContent = readFileSync(filepath, 'utf-8');
      const updatedIssues = JSON.parse(updatedContent);
      assert.strictEqual(updatedIssues[0].not_fixed, false);
    });

    it('should handle hyphenated agent names', async () => {
      const manifestDir = join(testDir, 'tmp', 'wiggum');
      const issue = createIssueRecord({
        agent_name: 'silent-failure-hunter',
        scope: 'in-scope',
        title: 'Hunter Issue',
      });
      const filepath = writeTestManifest(manifestDir, 'silent-failure-hunter', 'in-scope', [issue]);

      const result = await updateIssue({
        id: 'silent-failure-hunter-in-scope-0',
        not_fixed: true,
      });

      assert.ok(!result.isError);

      // Verify the file was actually updated
      const updatedContent = readFileSync(filepath, 'utf-8');
      const updatedIssues = JSON.parse(updatedContent);
      assert.strictEqual(updatedIssues[0].not_fixed, true);
    });

    it('should update specific issue by index', async () => {
      const manifestDir = join(testDir, 'tmp', 'wiggum');
      const issues = [
        createIssueRecord({ title: 'First Issue' }),
        createIssueRecord({ title: 'Second Issue' }),
        createIssueRecord({ title: 'Third Issue' }),
      ];
      const filepath = writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', issues);

      // Update the second issue (index 1)
      const result = await updateIssue({
        id: 'code-reviewer-in-scope-1',
        not_fixed: true,
      });

      assert.ok(!result.isError);

      // Verify only the second issue was updated
      const updatedContent = readFileSync(filepath, 'utf-8');
      const updatedIssues = JSON.parse(updatedContent);
      assert.strictEqual(updatedIssues[0].not_fixed, undefined);
      assert.strictEqual(updatedIssues[1].not_fixed, true);
      assert.strictEqual(updatedIssues[2].not_fixed, undefined);
    });

    it('should handle out-of-scope issues', async () => {
      const manifestDir = join(testDir, 'tmp', 'wiggum');
      const issue = createIssueRecord({
        agent_name: 'code-reviewer',
        scope: 'out-of-scope',
        title: 'Out of Scope Issue',
      });
      const filepath = writeTestManifest(manifestDir, 'code-reviewer', 'out-of-scope', [issue]);

      const result = await updateIssue({
        id: 'code-reviewer-out-of-scope-0',
        not_fixed: true,
      });

      assert.ok(!result.isError);

      // Verify the file was actually updated
      const updatedContent = readFileSync(filepath, 'utf-8');
      const updatedIssues = JSON.parse(updatedContent);
      assert.strictEqual(updatedIssues[0].not_fixed, true);
    });
  });

  describe('error handling', () => {
    it('should throw when manifest directory does not exist', async () => {
      rmSync(join(testDir, 'tmp', 'wiggum'), { recursive: true, force: true });

      await assert.rejects(
        async () =>
          await updateIssue({
            id: 'code-reviewer-in-scope-0',
            not_fixed: true,
          }),
        /Manifest directory does not exist/,
        'Should throw when directory does not exist'
      );
    });

    it('should throw when issue ID format is invalid', async () => {
      const manifestDir = join(testDir, 'tmp', 'wiggum');
      mkdirSync(manifestDir, { recursive: true });

      await assert.rejects(
        async () =>
          await updateIssue({
            id: 'invalid-id-format',
            not_fixed: true,
          }),
        /Invalid issue ID format/,
        'Should throw for invalid ID format'
      );
    });

    it('should throw when agent has no manifest files', async () => {
      // Directory exists but is empty
      await assert.rejects(
        async () =>
          await updateIssue({
            id: 'code-reviewer-in-scope-0',
            not_fixed: true,
          }),
        /No manifest files found/,
        'Should throw when no manifests exist'
      );
    });

    it('should throw when index is out of range', async () => {
      const manifestDir = join(testDir, 'tmp', 'wiggum');
      const issue = createIssueRecord({ title: 'Only Issue' });
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

      await assert.rejects(
        async () =>
          await updateIssue({
            id: 'code-reviewer-in-scope-5',
            not_fixed: true,
          }),
        /Issue not found/,
        'Should throw when index out of range'
      );
    });

    it('should throw when agent name does not match any manifest', async () => {
      const manifestDir = join(testDir, 'tmp', 'wiggum');
      const issue = createIssueRecord({ agent_name: 'code-reviewer' });
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

      await assert.rejects(
        async () =>
          await updateIssue({
            id: 'nonexistent-agent-in-scope-0',
            not_fixed: true,
          }),
        /No manifest files found/,
        'Should throw when agent not found'
      );
    });

    it('should throw when scope does not match any manifest', async () => {
      const manifestDir = join(testDir, 'tmp', 'wiggum');
      const issue = createIssueRecord({ scope: 'in-scope' });
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

      await assert.rejects(
        async () =>
          await updateIssue({
            id: 'code-reviewer-out-of-scope-0',
            not_fixed: true,
          }),
        /No manifest files found/,
        'Should throw when scope not found'
      );
    });
  });

  describe('edge cases', () => {
    it('should handle issues from multiple manifest files', async () => {
      const manifestDir = join(testDir, 'tmp', 'wiggum');

      // Write multiple manifest files for same agent (simulating concurrent writes)
      const issue1 = createIssueRecord({ title: 'Issue from File 1' });
      const issue2 = createIssueRecord({ title: 'Issue from File 2' });
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue1]);
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue2]);

      // Update issue at index 1 (from second file)
      const result = await updateIssue({
        id: 'code-reviewer-in-scope-1',
        not_fixed: true,
      });

      assert.ok(!result.isError);
      assert.ok(result.content[0].type === 'text');
    });

    it('should handle agent names with multiple hyphens', async () => {
      const manifestDir = join(testDir, 'tmp', 'wiggum');
      const issue = createIssueRecord({
        agent_name: 'pr-test-analyzer',
        title: 'PR Test Issue',
      });
      writeTestManifest(manifestDir, 'pr-test-analyzer', 'in-scope', [issue]);

      const result = await updateIssue({
        id: 'pr-test-analyzer-in-scope-0',
        not_fixed: true,
      });

      assert.ok(!result.isError);
    });

    it('should preserve other issue fields when updating', async () => {
      const manifestDir = join(testDir, 'tmp', 'wiggum');
      const issue = createIssueRecord({
        title: 'Test Issue',
        description: 'Test Description',
        location: 'src/file.ts:42',
        existing_todo: {
          has_todo: true,
          issue_reference: '#123',
        },
        metadata: { confidence: 95 },
      });
      const filepath = writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

      await updateIssue({
        id: 'code-reviewer-in-scope-0',
        not_fixed: true,
      });

      // Verify all other fields are preserved
      const updatedContent = readFileSync(filepath, 'utf-8');
      const updatedIssues = JSON.parse(updatedContent);
      assert.strictEqual(updatedIssues[0].title, 'Test Issue');
      assert.strictEqual(updatedIssues[0].description, 'Test Description');
      assert.strictEqual(updatedIssues[0].location, 'src/file.ts:42');
      assert.strictEqual(updatedIssues[0].existing_todo.has_todo, true);
      assert.strictEqual(updatedIssues[0].existing_todo.issue_reference, '#123');
      assert.strictEqual(updatedIssues[0].metadata.confidence, 95);
      assert.strictEqual(updatedIssues[0].not_fixed, true);
    });

    it('should handle idempotent updates (already true -> true)', async () => {
      const manifestDir = join(testDir, 'tmp', 'wiggum');
      const issue = createIssueRecord({
        not_fixed: true, // Already true
      });
      const filepath = writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

      const result = await updateIssue({
        id: 'code-reviewer-in-scope-0',
        not_fixed: true, // Set to same value
      });

      assert.ok(!result.isError);

      // Verify no-op update succeeded
      const updatedContent = readFileSync(filepath, 'utf-8');
      const updatedIssues = JSON.parse(updatedContent);
      assert.strictEqual(updatedIssues[0].not_fixed, true);
    });

    it('should handle sequential updates false -> true -> false', async () => {
      const manifestDir = join(testDir, 'tmp', 'wiggum');
      const issue = createIssueRecord({ not_fixed: false });
      const filepath = writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

      // First update: false -> true
      await updateIssue({ id: 'code-reviewer-in-scope-0', not_fixed: true });

      // Verify first update
      let updatedContent = readFileSync(filepath, 'utf-8');
      let updatedIssues = JSON.parse(updatedContent);
      assert.strictEqual(updatedIssues[0].not_fixed, true);

      // Second update: true -> false
      const result = await updateIssue({ id: 'code-reviewer-in-scope-0', not_fixed: false });

      assert.ok(!result.isError);

      // Verify second update
      updatedContent = readFileSync(filepath, 'utf-8');
      updatedIssues = JSON.parse(updatedContent);
      assert.strictEqual(updatedIssues[0].not_fixed, false);
    });

    it('should handle idempotent updates (already false -> false)', async () => {
      const manifestDir = join(testDir, 'tmp', 'wiggum');
      const issue = createIssueRecord({
        not_fixed: false, // Already false
      });
      const filepath = writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

      const result = await updateIssue({
        id: 'code-reviewer-in-scope-0',
        not_fixed: false, // Set to same value
      });

      assert.ok(!result.isError);

      // Verify no-op update succeeded
      const updatedContent = readFileSync(filepath, 'utf-8');
      const updatedIssues = JSON.parse(updatedContent);
      assert.strictEqual(updatedIssues[0].not_fixed, false);
    });
  });

  describe('getWriteErrorGuidance', () => {
    it('should return disk full message for ENOSPC', () => {
      const guidance = getWriteErrorGuidance('ENOSPC', '/path/to/file');
      assert.ok(guidance.includes('Disk is full'));
      assert.ok(guidance.includes('df -h'));
    });

    it('should return permission denied message for EACCES', () => {
      const guidance = getWriteErrorGuidance('EACCES', '/path/to/file');
      assert.ok(guidance.includes('Permission denied'));
      assert.ok(guidance.includes('ls -la'));
      assert.ok(guidance.includes('/path/to/file'));
    });

    it('should return read-only message for EROFS', () => {
      const guidance = getWriteErrorGuidance('EROFS', '/path/to/file');
      assert.ok(guidance.includes('read-only'));
    });

    it('should return generic message for unknown error codes', () => {
      const guidance = getWriteErrorGuidance('UNKNOWN', '/path/to/file');
      assert.ok(guidance.includes('Check filesystem'));
    });

    it('should return generic message for undefined error code', () => {
      const guidance = getWriteErrorGuidance(undefined, '/path/to/file');
      assert.ok(guidance.includes('Check filesystem'));
    });
  });

  describe('write error handling', () => {
    it('should throw FilesystemError when write fails due to file permissions', async (t) => {
      // Skip on macOS - file permission tests are unreliable on macOS with SIP
      if (process.platform === 'darwin') {
        t.skip('macOS file permission tests are unreliable');
        return;
      }

      const manifestDir = join(testDir, 'tmp', 'wiggum');
      const issue = createIssueRecord({ title: 'Test Issue' });
      const filepath = writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

      try {
        // Make file read-only AFTER it's written (so read succeeds but write fails)
        chmodSync(filepath, 0o444);

        await assert.rejects(
          async () =>
            await updateIssue({
              id: 'code-reviewer-in-scope-0',
              not_fixed: true,
            }),
          (error: Error) => {
            assert.ok(error instanceof FilesystemError, 'Should be FilesystemError');
            assert.ok(
              error.message.includes('Failed to write'),
              `Expected 'Failed to write' in message, got: ${error.message}`
            );
            assert.ok(
              error.message.includes('Original data is intact'),
              `Expected 'Original data is intact' in message, got: ${error.message}`
            );
            // Should include actionable guidance from getWriteErrorGuidance
            assert.ok(
              error.message.includes('Permission denied') || error.message.includes('ls -la'),
              `Expected permission guidance in message, got: ${error.message}`
            );
            return true;
          }
        );
      } finally {
        // Restore permissions for cleanup
        chmodSync(filepath, 0o644);
      }
    });

    it('should throw FilesystemError when directory becomes read-only before write', async (t) => {
      // Skip on macOS - directory read-only permissions don't prevent writing to existing files
      // On macOS, only creating/deleting files is blocked by directory permissions
      // Skip on WSL2 - WSL2 has different permission handling than native Linux
      // TODO(#1508): Test skip comment could be more specific about WSL2 permission behavior
      if (process.platform === 'darwin') {
        t.skip('macOS directory permissions do not prevent writing to existing files');
        return;
      }

      // Skip on WSL - chmod permissions don't work reliably on NTFS filesystems
      if (isWSL()) {
        t.skip('WSL chmod permissions do not work reliably on NTFS filesystems');
        return;
      }

      const manifestDir = join(testDir, 'tmp', 'wiggum');
      const issue = createIssueRecord({ title: 'Test Issue' });
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

      try {
        // Make directory read-only (prevents file updates on Linux, not macOS or WSL)
        chmodSync(manifestDir, 0o555);

        await assert.rejects(
          async () =>
            await updateIssue({
              id: 'code-reviewer-in-scope-0',
              not_fixed: true,
            }),
          (error: Error) => {
            assert.ok(error instanceof FilesystemError, 'Should be FilesystemError');
            assert.ok(
              error.message.includes('Failed to write'),
              `Expected 'Failed to write' in message, got: ${error.message}`
            );
            return true;
          }
        );
      } finally {
        // Restore permissions for cleanup
        chmodSync(manifestDir, 0o755);
      }
    });
  });

  describe('read error handling', () => {
    it('should throw FilesystemError for corrupted JSON manifest', async () => {
      const manifestDir = join(testDir, 'tmp', 'wiggum');
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 10);
      const filename = `code-reviewer-in-scope-${timestamp}-${random}.json`;
      const filepath = join(manifestDir, filename);

      // Write malformed JSON
      writeFileSync(filepath, '{ invalid json content', 'utf-8');

      await assert.rejects(
        async () =>
          await updateIssue({
            id: 'code-reviewer-in-scope-0',
            not_fixed: true,
          }),
        (error: Error) => {
          assert.ok(error instanceof FilesystemError, 'Should be FilesystemError');
          // updateIssue throws FilesystemError with 'Failed to read manifest file' when parsing fails
          assert.ok(
            error.message.includes('Failed to read manifest file'),
            `Expected error message to include 'Failed to read manifest file', got: ${error.message}`
          );
          return true;
        }
      );
    });

    it('should throw FilesystemError when manifest file is unreadable', async () => {
      const manifestDir = join(testDir, 'tmp', 'wiggum');
      const issue = createIssueRecord({ title: 'Test Issue' });
      const filepath = writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

      // Remove read permissions (may not work if running as root)
      try {
        chmodSync(filepath, 0o000);

        await assert.rejects(
          async () =>
            await updateIssue({
              id: 'code-reviewer-in-scope-0',
              not_fixed: true,
            }),
          (error: Error) => {
            // Should throw FilesystemError or indicate permission issue
            assert.ok(
              error instanceof FilesystemError || error.message.includes('EACCES'),
              'Should be FilesystemError or permission error'
            );
            return true;
          }
        );
      } finally {
        // Restore permissions for cleanup
        chmodSync(filepath, 0o644);
      }
    });
  });
});
