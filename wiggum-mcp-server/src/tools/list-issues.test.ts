/**
 * Tests for list-issues tool
 *
 * Test coverage for the issue listing tool that returns minimal references.
 * Includes both schema validation and behavioral tests with real filesystem operations.
 *
 * @see https://github.com/commons-systems/commons.systems/issues/625
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { ListIssuesInputSchema, listIssues } from './list-issues.js';
import type { IssueRecord } from './manifest-types.js';
import { FilesystemError } from '../utils/errors.js';

describe('list-issues tool', () => {
  describe('ListIssuesInputSchema', () => {
    describe('valid inputs', () => {
      it('should validate with scope="in-scope"', () => {
        const input = { scope: 'in-scope' as const };
        const result = ListIssuesInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
        if (result.success) {
          assert.strictEqual(result.data.scope, 'in-scope');
        }
      });

      it('should validate with scope="out-of-scope"', () => {
        const input = { scope: 'out-of-scope' as const };
        const result = ListIssuesInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
        if (result.success) {
          assert.strictEqual(result.data.scope, 'out-of-scope');
        }
      });

      it('should validate with scope="all"', () => {
        const input = { scope: 'all' as const };
        const result = ListIssuesInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
        if (result.success) {
          assert.strictEqual(result.data.scope, 'all');
        }
      });

      it('should default scope to "all" when omitted', () => {
        const input = {};
        const result = ListIssuesInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
        if (result.success) {
          assert.strictEqual(result.data.scope, 'all');
        }
      });
    });

    describe('invalid inputs', () => {
      it('should reject invalid scope value', () => {
        const input = { scope: 'invalid-scope' };
        const result = ListIssuesInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });

      it('should reject numeric scope', () => {
        const input = { scope: 123 };
        const result = ListIssuesInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });

      it('should reject boolean scope', () => {
        const input = { scope: true };
        const result = ListIssuesInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });
    });
  });

  // NOTE: Schema validation tests above. Behavioral tests below.
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

describe('list-issues behavioral tests', () => {
  beforeEach(() => {
    // Save original cwd and create a unique test directory
    originalCwd = process.cwd();
    testDir = join(
      '/tmp/claude',
      `list-issues-test-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
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

  describe('listIssues function', () => {
    describe('empty directory handling', () => {
      it('should return empty list when manifest directory does not exist', async () => {
        // Remove the manifest directory
        rmSync(join(testDir, 'tmp', 'wiggum'), { recursive: true, force: true });

        const result = await listIssues({ scope: 'all' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(text.includes('No issues found'), 'Should indicate no issues found');
      });

      it('should return empty list when manifest directory is empty', async () => {
        // Directory exists but has no files (created in beforeEach)
        const result = await listIssues({ scope: 'all' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(text.includes('No issues found'), 'Should indicate no issues found');
      });
    });

    describe('manifest file reading and filtering', () => {
      it('should read and return issues from manifest files', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const issue = createIssueRecord({ title: 'Test Issue 1' });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

        const result = await listIssues({ scope: 'all' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(text.includes('Test Issue 1'), 'Should include issue title');
        assert.ok(text.includes('code-reviewer'), 'Should include agent name');
      });

      it('should filter issues by in-scope', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const inScopeIssue = createIssueRecord({
          title: 'In-Scope Issue',
          scope: 'in-scope',
        });
        const outOfScopeIssue = createIssueRecord({
          title: 'Out-of-Scope Issue',
          scope: 'out-of-scope',
        });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [inScopeIssue]);
        writeTestManifest(manifestDir, 'code-reviewer', 'out-of-scope', [outOfScopeIssue]);

        const result = await listIssues({ scope: 'in-scope' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(text.includes('In-Scope Issue'), 'Should include in-scope issue');
        assert.ok(!text.includes('Out-of-Scope Issue'), 'Should NOT include out-of-scope issue');
      });

      it('should filter issues by out-of-scope', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const inScopeIssue = createIssueRecord({
          title: 'In-Scope Issue',
          scope: 'in-scope',
        });
        const outOfScopeIssue = createIssueRecord({
          title: 'Out-of-Scope Issue',
          scope: 'out-of-scope',
        });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [inScopeIssue]);
        writeTestManifest(manifestDir, 'code-reviewer', 'out-of-scope', [outOfScopeIssue]);

        const result = await listIssues({ scope: 'out-of-scope' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(!text.includes('In-Scope Issue'), 'Should NOT include in-scope issue');
        assert.ok(text.includes('Out-of-Scope Issue'), 'Should include out-of-scope issue');
      });

      it('should return all issues when scope is "all"', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const inScopeIssue = createIssueRecord({
          title: 'In-Scope Issue',
          scope: 'in-scope',
        });
        const outOfScopeIssue = createIssueRecord({
          title: 'Out-of-Scope Issue',
          scope: 'out-of-scope',
        });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [inScopeIssue]);
        writeTestManifest(manifestDir, 'code-reviewer', 'out-of-scope', [outOfScopeIssue]);

        const result = await listIssues({ scope: 'all' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(text.includes('In-Scope Issue'), 'Should include in-scope issue');
        assert.ok(text.includes('Out-of-Scope Issue'), 'Should include out-of-scope issue');
      });
    });

    describe('issue ID generation', () => {
      it('should generate IDs in format {agent-name}-{scope}-{index}', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const issue = createIssueRecord({ agent_name: 'code-reviewer', scope: 'in-scope' });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

        const result = await listIssues({ scope: 'all' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        // ID should be in format: code-reviewer-in-scope-0
        assert.ok(text.includes('code-reviewer-in-scope-0'), 'Should contain ID in correct format');
      });

      it('should generate unique sequential indices for multiple issues from same agent', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const issue1 = createIssueRecord({ title: 'Issue 1', agent_name: 'code-reviewer' });
        const issue2 = createIssueRecord({ title: 'Issue 2', agent_name: 'code-reviewer' });
        const issue3 = createIssueRecord({ title: 'Issue 3', agent_name: 'code-reviewer' });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue1, issue2, issue3]);

        const result = await listIssues({ scope: 'all' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(text.includes('code-reviewer-in-scope-0'), 'Should have index 0');
        assert.ok(text.includes('code-reviewer-in-scope-1'), 'Should have index 1');
        assert.ok(text.includes('code-reviewer-in-scope-2'), 'Should have index 2');
      });

      it('should generate separate ID sequences for different agents', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const codeReviewerIssue = createIssueRecord({
          title: 'CR Issue',
          agent_name: 'code-reviewer',
        });
        const hunterIssue = createIssueRecord({
          title: 'Hunter Issue',
          agent_name: 'silent-failure-hunter',
        });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [codeReviewerIssue]);
        writeTestManifest(manifestDir, 'silent-failure-hunter', 'in-scope', [hunterIssue]);

        const result = await listIssues({ scope: 'all' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(text.includes('code-reviewer-in-scope-0'), 'code-reviewer should have index 0');
        assert.ok(
          text.includes('silent-failure-hunter-in-scope-0'),
          'silent-failure-hunter should have index 0'
        );
      });

      it('should generate separate ID sequences for different scopes', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const inScopeIssue = createIssueRecord({
          title: 'In-Scope Issue',
          scope: 'in-scope',
        });
        const outOfScopeIssue = createIssueRecord({
          title: 'Out-of-Scope Issue',
          scope: 'out-of-scope',
        });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [inScopeIssue]);
        writeTestManifest(manifestDir, 'code-reviewer', 'out-of-scope', [outOfScopeIssue]);

        const result = await listIssues({ scope: 'all' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        // Each scope should have its own index starting at 0
        assert.ok(text.includes('code-reviewer-in-scope-0'), 'in-scope should have index 0');
        assert.ok(
          text.includes('code-reviewer-out-of-scope-0'),
          'out-of-scope should have index 0'
        );
      });
    });

    describe('count calculation', () => {
      it('should calculate correct in_scope count', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const inScope1 = createIssueRecord({ scope: 'in-scope', title: 'In 1' });
        const inScope2 = createIssueRecord({ scope: 'in-scope', title: 'In 2' });
        const outOfScope = createIssueRecord({ scope: 'out-of-scope', title: 'Out 1' });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [inScope1, inScope2]);
        writeTestManifest(manifestDir, 'code-reviewer', 'out-of-scope', [outOfScope]);

        const result = await listIssues({ scope: 'all' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(text.includes('**In-Scope:** 2'), 'Should show 2 in-scope issues');
        assert.ok(text.includes('**Out-of-Scope:** 1'), 'Should show 1 out-of-scope issue');
      });

      it('should calculate correct high/low priority counts', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const highPriority1 = createIssueRecord({ priority: 'high', title: 'High 1' });
        const highPriority2 = createIssueRecord({ priority: 'high', title: 'High 2' });
        const lowPriority = createIssueRecord({ priority: 'low', title: 'Low 1' });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [
          highPriority1,
          highPriority2,
          lowPriority,
        ]);

        const result = await listIssues({ scope: 'all' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(text.includes('**High Priority:** 2'), 'Should show 2 high priority issues');
        assert.ok(text.includes('**Low Priority:** 1'), 'Should show 1 low priority issue');
      });

      it('should calculate total count correctly', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const issues = [
          createIssueRecord({ title: 'Issue 1' }),
          createIssueRecord({ title: 'Issue 2' }),
          createIssueRecord({ title: 'Issue 3' }),
        ];
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', issues);

        const result = await listIssues({ scope: 'all' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(text.includes('**Total:** 3'), 'Should show 3 total issues');
      });
    });

    describe('grouping issues by agent', () => {
      it('should group issues under agent headers', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const codeReviewerIssue = createIssueRecord({ agent_name: 'code-reviewer' });
        const hunterIssue = createIssueRecord({ agent_name: 'silent-failure-hunter' });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [codeReviewerIssue]);
        writeTestManifest(manifestDir, 'silent-failure-hunter', 'in-scope', [hunterIssue]);

        const result = await listIssues({ scope: 'all' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        // Agent headers should appear
        assert.ok(text.includes('### code-reviewer'), 'Should have code-reviewer header');
        assert.ok(
          text.includes('### silent-failure-hunter'),
          'Should have silent-failure-hunter header'
        );
      });

      it('should show issue count per agent in header', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const issues = [
          createIssueRecord({ title: 'Issue 1', agent_name: 'code-reviewer' }),
          createIssueRecord({ title: 'Issue 2', agent_name: 'code-reviewer' }),
        ];
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', issues);

        const result = await listIssues({ scope: 'all' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(text.includes('code-reviewer (2 issues)'), 'Should show issue count in header');
      });

      it('should use singular "issue" for single issue', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const issue = createIssueRecord({ title: 'Single Issue', agent_name: 'code-reviewer' });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

        const result = await listIssues({ scope: 'all' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(text.includes('code-reviewer (1 issue)'), 'Should use singular "issue"');
      });
    });

    describe('output formatting', () => {
      it('should show priority emoji (red for high, blue for low)', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const highIssue = createIssueRecord({ priority: 'high', title: 'High Issue' });
        const lowIssue = createIssueRecord({ priority: 'low', title: 'Low Issue' });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [highIssue, lowIssue]);

        const result = await listIssues({ scope: 'all' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        // Check for emojis in the output
        assert.ok(text.includes('\u{1F534}'), 'Should include red circle for high priority'); // 🔴
        assert.ok(text.includes('\u{1F535}'), 'Should include blue circle for low priority'); // 🔵
      });

      it('should include scope label (In-Scope/Out-of-Scope)', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const inScopeIssue = createIssueRecord({ scope: 'in-scope' });
        const outOfScopeIssue = createIssueRecord({ scope: 'out-of-scope' });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [inScopeIssue]);
        writeTestManifest(manifestDir, 'code-reviewer', 'out-of-scope', [outOfScopeIssue]);

        const result = await listIssues({ scope: 'all' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(text.includes('In-Scope'), 'Should include In-Scope label');
        assert.ok(text.includes('Out-of-Scope'), 'Should include Out-of-Scope label');
      });
    });

    describe('malformed manifest file handling', () => {
      it('should throw FilesystemError for malformed JSON files to prevent silent data loss', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');

        // Write a valid manifest
        const validIssue = createIssueRecord({ title: 'Valid Issue' });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [validIssue]);

        // Write a malformed manifest - this should cause listIssues to throw
        writeFileSync(
          join(manifestDir, 'code-reviewer-in-scope-1234567890-corrupt.json'),
          'not valid json',
          'utf-8'
        );

        // listIssues should throw FilesystemError to prevent silent data loss
        // Previously this would silently skip corrupted files, potentially
        // missing critical review findings
        await assert.rejects(
          async () => await listIssues({ scope: 'all' }),
          (err: Error) => {
            assert.ok(err instanceof FilesystemError, 'Should throw FilesystemError');
            assert.ok(
              err.message.includes('malformed JSON'),
              'Error message should mention malformed JSON'
            );
            return true;
          }
        );
      });

      it('should throw FilesystemError for manifest files with invalid issue structure', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');

        // Write a valid manifest
        const validIssue = createIssueRecord({ title: 'Valid Issue' });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [validIssue]);

        // Write a manifest with invalid structure (valid JSON, invalid IssueRecord)
        writeFileSync(
          join(manifestDir, 'code-reviewer-in-scope-1234567891-invalid.json'),
          JSON.stringify([{ invalid: 'structure' }]),
          'utf-8'
        );

        // listIssues should throw FilesystemError to prevent silent data loss
        await assert.rejects(
          async () => await listIssues({ scope: 'all' }),
          (err: Error) => {
            assert.ok(err instanceof FilesystemError, 'Should throw FilesystemError');
            assert.ok(
              err.message.includes('invalid issue records'),
              'Error message should mention invalid records'
            );
            return true;
          }
        );
      });
    });

    describe('merging issues from multiple manifest files', () => {
      it('should merge issues from multiple manifest files for same agent/scope', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');

        // Write multiple manifest files for same agent (simulating concurrent writes)
        const issue1 = createIssueRecord({ title: 'Issue from File 1' });
        const issue2 = createIssueRecord({ title: 'Issue from File 2' });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue1]);
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue2]);

        const result = await listIssues({ scope: 'all' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(text.includes('Issue from File 1'), 'Should include issue from first file');
        assert.ok(text.includes('Issue from File 2'), 'Should include issue from second file');
        assert.ok(text.includes('**Total:** 2'), 'Should count both issues');
      });
    });
  });
});
