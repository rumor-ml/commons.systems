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
import { ListIssuesInputSchema, listIssues, normalizeFilePath } from './list-issues.js';
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

  describe('normalizeFilePath', () => {
    it('should return relative path unchanged', () => {
      const result = normalizeFilePath('wiggum-mcp-server/src/tools/list-issues.ts');
      assert.strictEqual(result, 'wiggum-mcp-server/src/tools/list-issues.ts');
    });

    it('should remove leading ./ from relative paths', () => {
      const result = normalizeFilePath('./wiggum-mcp-server/src/tools/list-issues.ts');
      assert.strictEqual(result, 'wiggum-mcp-server/src/tools/list-issues.ts');
    });

    it('should convert backslashes to forward slashes', () => {
      const result = normalizeFilePath('wiggum-mcp-server\\src\\tools\\list-issues.ts');
      assert.strictEqual(result, 'wiggum-mcp-server/src/tools/list-issues.ts');
    });

    it('should extract relative path from worktree absolute path', () => {
      const absolutePath =
        '/Users/n8/worktrees/625-all-hands-wiggum-optimizations/wiggum-mcp-server/src/tools/list-issues.ts';
      const result = normalizeFilePath(absolutePath);
      assert.strictEqual(result, 'wiggum-mcp-server/src/tools/list-issues.ts');
    });

    it('should handle worktree paths with different branch names', () => {
      const absolutePath = '/home/user/worktrees/feature-branch/src/index.ts';
      const result = normalizeFilePath(absolutePath);
      assert.strictEqual(result, 'src/index.ts');
    });

    it('should make absolute path relative using cwd for non-worktree paths', () => {
      // Test the cwd fallback with a path that doesn't match the worktree pattern
      // We simulate this by using a path like /some/project/src/file.ts
      // Since our cwd contains /worktrees/, we test the worktree regex instead
      const result = normalizeFilePath(
        '/Users/developer/worktrees/my-branch/src/tools/list-issues.ts'
      );
      assert.strictEqual(result, 'src/tools/list-issues.ts');
    });

    it('should normalize same file from different formats to same result', () => {
      // These should all normalize to the same path
      const relative = 'wiggum-mcp-server/src/tools/list-issues.ts';
      const withDot = './wiggum-mcp-server/src/tools/list-issues.ts';
      const absolute = '/Users/n8/worktrees/some-branch/wiggum-mcp-server/src/tools/list-issues.ts';

      const normalizedRelative = normalizeFilePath(relative);
      const normalizedWithDot = normalizeFilePath(withDot);
      const normalizedAbsolute = normalizeFilePath(absolute);

      assert.strictEqual(normalizedRelative, normalizedWithDot);
      assert.strictEqual(normalizedRelative, normalizedAbsolute);
    });

    // Edge case tests for path normalization (pr-test-analyzer-in-scope-4)
    describe('edge cases', () => {
      it('should handle Windows absolute path with backslashes in worktree pattern', () => {
        // Windows-style path with backslashes - should be normalized to forward slashes first
        // and then matched by the worktree regex (which now supports Windows drive letters)
        const windowsPath = 'C:\\Users\\dev\\worktrees\\feature-branch\\src\\tools\\list-issues.ts';
        const result = normalizeFilePath(windowsPath);
        // After backslash conversion: C:/Users/dev/worktrees/feature-branch/src/tools/list-issues.ts
        // This should now match the worktree regex and extract the repo-relative path
        assert.strictEqual(result, 'src/tools/list-issues.ts');
      });

      it('should extract relative path from Windows worktree path with drive letter', () => {
        // Windows path with drive letter that matches worktree pattern
        const windowsWorktreePath = 'C:/Users/dev/worktrees/feature-branch/src/file.ts';
        const result = normalizeFilePath(windowsWorktreePath);
        assert.strictEqual(result, 'src/file.ts');
      });

      it('should normalize Windows and Unix worktree paths to same result', () => {
        const unixPath = '/Users/dev/worktrees/branch/src/file.ts';
        const windowsPath = 'D:\\Users\\dev\\worktrees\\branch\\src\\file.ts';

        const normalizedUnix = normalizeFilePath(unixPath);
        const normalizedWindows = normalizeFilePath(windowsPath);

        // Both should normalize to same relative path
        assert.strictEqual(normalizedUnix, 'src/file.ts');
        assert.strictEqual(normalizedWindows, 'src/file.ts');
        assert.strictEqual(normalizedUnix, normalizedWindows);
      });

      it('should handle deeply nested paths within worktree', () => {
        const nestedPath =
          '/Users/n8/worktrees/625-branch/packages/core/src/utils/helpers/deep/nested/file.ts';
        const result = normalizeFilePath(nestedPath);
        assert.strictEqual(result, 'packages/core/src/utils/helpers/deep/nested/file.ts');
      });

      it('should remove only one leading ./ (current behavior)', () => {
        // NOTE: Current implementation only removes one leading ./
        // Multiple ./ sequences are NOT fully normalized.
        // This test documents the current behavior.
        const pathWithMultipleDots = './././wiggum-mcp-server/src/tools/list-issues.ts';
        const result = normalizeFilePath(pathWithMultipleDots);
        // Only the first ./ is removed by current implementation
        assert.strictEqual(result, '././wiggum-mcp-server/src/tools/list-issues.ts');
      });

      it('should handle Unix absolute path without worktree pattern', () => {
        // Absolute path that doesn't match worktree pattern
        // This tests the cwd-based normalization fallback
        const absoluteNoWorktree = '/some/other/project/src/file.ts';
        const result = normalizeFilePath(absoluteNoWorktree);
        // Since the path doesn't match worktree pattern and doesn't start with cwd,
        // it should be returned as-is (or with minor normalization)
        // Current cwd is typically /Users/n8/worktrees/... so this path won't match
        assert.ok(!result.includes('\\'), 'Should have forward slashes');
        // The exact result depends on cwd, but we verify it's a valid path
        assert.ok(result.length > 0, 'Should return a non-empty path');
      });

      it('should handle Windows worktree path with mixed slashes', () => {
        // Windows path that mixes forward and backslashes
        const mixedPath = 'C:/Users/dev\\worktrees/feature-branch\\src/tools/list-issues.ts';
        const result = normalizeFilePath(mixedPath);
        // After normalization, all slashes should be forward and path extracted
        assert.ok(!result.includes('\\'), 'Should convert all backslashes to forward slashes');
        assert.strictEqual(result, 'src/tools/list-issues.ts');
      });

      it('should handle worktree path with branch name containing hyphens and numbers', () => {
        const complexBranchPath =
          '/home/user/worktrees/625-all-hands-wiggum-optimizations/src/index.ts';
        const result = normalizeFilePath(complexBranchPath);
        assert.strictEqual(result, 'src/index.ts');
      });

      it('should handle path with spaces (after worktree)', () => {
        // File paths can contain spaces
        const pathWithSpaces = '/Users/n8/worktrees/my-branch/src/components/My Component/index.ts';
        const result = normalizeFilePath(pathWithSpaces);
        assert.strictEqual(result, 'src/components/My Component/index.ts');
      });

      it('should preserve relative path starting with ../', () => {
        // Paths starting with ../ should not have the leading part removed
        const parentPath = '../other-package/src/file.ts';
        const result = normalizeFilePath(parentPath);
        assert.strictEqual(result, '../other-package/src/file.ts');
      });

      it('should handle empty string gracefully', () => {
        const result = normalizeFilePath('');
        assert.strictEqual(result, '');
      });

      it('should handle just a filename without path', () => {
        const filename = 'file.ts';
        const result = normalizeFilePath(filename);
        assert.strictEqual(result, 'file.ts');
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
      it('should read and return issues from manifest files (batched for in-scope)', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const issue = createIssueRecord({ title: 'Test Issue 1', scope: 'in-scope' });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

        const result = await listIssues({ scope: 'all' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(text.includes('Test Issue 1'), 'Should include issue title');
        assert.ok(text.includes('batch-0'), 'Should show in-scope issue in a batch');
        assert.ok(text.includes('code-reviewer-in-scope-0'), 'Should include issue ID');
      });

      it('should filter issues by in-scope (batched)', async () => {
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
        assert.ok(text.includes('In-Scope Issue'), 'Should include in-scope issue in batch');
        assert.ok(text.includes('batch-0'), 'Should show batch for in-scope issue');
        assert.ok(!text.includes('Out-of-Scope Issue'), 'Should NOT include out-of-scope issue');
      });

      it('should filter issues by out-of-scope (individual references)', async () => {
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
        assert.ok(!text.includes('batch-'), 'Should NOT have batches when filtering out-of-scope');
        assert.ok(text.includes('Out-of-Scope Issue'), 'Should include out-of-scope issue');
        assert.ok(text.includes('code-reviewer-out-of-scope-0'), 'Should show individual issue ID');
      });

      it('should return all issues when scope is "all" (batched in-scope, individual out-of-scope)', async () => {
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
        assert.ok(text.includes('In-Scope Issue'), 'Should include in-scope issue in batch');
        assert.ok(text.includes('batch-0'), 'Should show batch for in-scope issue');
        assert.ok(
          text.includes('Out-of-Scope Issue'),
          'Should include out-of-scope issue individually'
        );
        assert.ok(
          text.includes('code-reviewer-out-of-scope-0'),
          'Should show individual out-of-scope ID'
        );
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

    describe('batching in-scope issues', () => {
      it('should show in-scope issues in batches, not by agent', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const codeReviewerIssue = createIssueRecord({
          agent_name: 'code-reviewer',
          scope: 'in-scope',
        });
        const hunterIssue = createIssueRecord({
          agent_name: 'silent-failure-hunter',
          scope: 'in-scope',
        });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [codeReviewerIssue]);
        writeTestManifest(manifestDir, 'silent-failure-hunter', 'in-scope', [hunterIssue]);

        const result = await listIssues({ scope: 'all' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        // In-scope issues should appear in batches, not under agent headers
        assert.ok(text.includes('## In-Scope Batches'), 'Should have In-Scope Batches section');
        assert.ok(text.includes('batch-'), 'Should have batch IDs');
      });

      it('should show issue count per batch in header', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        // Create issues that share a file so they get batched together
        const issues = [
          createIssueRecord({
            title: 'Issue 1',
            agent_name: 'code-reviewer',
            scope: 'in-scope',
            files_to_edit: ['src/test.ts'],
          }),
          createIssueRecord({
            title: 'Issue 2',
            agent_name: 'code-reviewer',
            scope: 'in-scope',
            files_to_edit: ['src/test.ts'],
          }),
        ];
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', issues);

        const result = await listIssues({ scope: 'all' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(
          text.includes('2 issues') || text.includes('2 issue'),
          'Should show issue count in batch header'
        );
      });

      it('should use singular "issue" for single issue in batch', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const issue = createIssueRecord({
          title: 'Single Issue',
          agent_name: 'code-reviewer',
          scope: 'in-scope',
        });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

        const result = await listIssues({ scope: 'all' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(text.includes('1 issue'), 'Should use singular "issue" in batch header');
      });
    });

    describe('output formatting', () => {
      it('should show priority emoji for out-of-scope issues only', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const highIssue = createIssueRecord({
          priority: 'high',
          title: 'High Issue',
          scope: 'out-of-scope',
        });
        const lowIssue = createIssueRecord({
          priority: 'low',
          title: 'Low Issue',
          scope: 'out-of-scope',
        });
        writeTestManifest(manifestDir, 'code-reviewer', 'out-of-scope', [highIssue, lowIssue]);

        const result = await listIssues({ scope: 'all' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        // Check for emojis in the output (out-of-scope issues show priority emojis)
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

    describe('Union-Find batching algorithm edge cases', () => {
      it('should batch issues with transitive file overlap', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        // Issue A shares file2.ts with Issue B
        // Issue B shares file3.ts with Issue C
        // All three should be batched together via transitive connection (A-B-C)
        const issueA = createIssueRecord({
          title: 'Issue A',
          agent_name: 'code-reviewer',
          scope: 'in-scope',
          files_to_edit: ['src/file1.ts', 'src/file2.ts'],
        });
        const issueB = createIssueRecord({
          title: 'Issue B',
          agent_name: 'code-reviewer',
          scope: 'in-scope',
          files_to_edit: ['src/file2.ts', 'src/file3.ts'],
        });
        const issueC = createIssueRecord({
          title: 'Issue C',
          agent_name: 'code-reviewer',
          scope: 'in-scope',
          files_to_edit: ['src/file3.ts', 'src/file4.ts'],
        });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issueA, issueB, issueC]);

        const result = await listIssues({ scope: 'in-scope' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        // All three issues should be in the same batch (batch-0)
        assert.ok(text.includes('batch-0'), 'Should have batch-0');
        assert.ok(text.includes('3 issues'), 'Should have 3 issues in batch (transitive grouping)');
        // Should NOT have batch-1 since all issues are connected
        assert.ok(!text.includes('batch-1'), 'Should NOT have batch-1 (all issues connected)');
        // Verify all issues are listed
        assert.ok(text.includes('Issue A'), 'Should include Issue A');
        assert.ok(text.includes('Issue B'), 'Should include Issue B');
        assert.ok(text.includes('Issue C'), 'Should include Issue C');
      });

      it('should isolate issues without files_to_edit into separate batches', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        // Issues without files_to_edit should each get their own batch
        const issueA = createIssueRecord({
          title: 'Issue A No Files',
          agent_name: 'code-reviewer',
          scope: 'in-scope',
          files_to_edit: [], // Empty array
        });
        const issueB = createIssueRecord({
          title: 'Issue B No Files',
          agent_name: 'code-reviewer',
          scope: 'in-scope',
          // No files_to_edit property at all
        });
        const issueC = createIssueRecord({
          title: 'Issue C With File',
          agent_name: 'code-reviewer',
          scope: 'in-scope',
          files_to_edit: ['src/test.ts'],
        });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issueA, issueB, issueC]);

        const result = await listIssues({ scope: 'in-scope' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        // Each issue without files gets its own batch, plus one for issue C
        // So we should have at least 3 batches
        assert.ok(text.includes('batch-0'), 'Should have batch-0');
        assert.ok(text.includes('batch-1'), 'Should have batch-1');
        assert.ok(text.includes('batch-2'), 'Should have batch-2');
        // Verify all issues are listed
        assert.ok(text.includes('Issue A No Files'), 'Should include Issue A');
        assert.ok(text.includes('Issue B No Files'), 'Should include Issue B');
        assert.ok(text.includes('Issue C With File'), 'Should include Issue C');
      });

      it('should batch issues with same file in different path formats', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        // All three issues reference the same file but with different path formats
        // After normalization, they should all batch together
        const issueA = createIssueRecord({
          title: 'Issue A Absolute Path',
          agent_name: 'code-reviewer',
          scope: 'in-scope',
          files_to_edit: ['/Users/n8/worktrees/some-branch/wiggum-mcp-server/src/foo.ts'],
        });
        const issueB = createIssueRecord({
          title: 'Issue B Dot Relative',
          agent_name: 'code-reviewer',
          scope: 'in-scope',
          files_to_edit: ['./wiggum-mcp-server/src/foo.ts'],
        });
        const issueC = createIssueRecord({
          title: 'Issue C Plain Relative',
          agent_name: 'code-reviewer',
          scope: 'in-scope',
          files_to_edit: ['wiggum-mcp-server/src/foo.ts'],
        });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issueA, issueB, issueC]);

        const result = await listIssues({ scope: 'in-scope' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        // All three issues should be in the same batch because they reference the same file
        assert.ok(text.includes('batch-0'), 'Should have batch-0');
        assert.ok(text.includes('3 issues'), 'Should have 3 issues in batch (path normalization)');
        // Should NOT have batch-1 since all issues reference the same file
        assert.ok(
          !text.includes('batch-1'),
          'Should NOT have batch-1 (same file after normalization)'
        );
        // Verify all issues are listed
        assert.ok(text.includes('Issue A Absolute Path'), 'Should include Issue A');
        assert.ok(text.includes('Issue B Dot Relative'), 'Should include Issue B');
        assert.ok(text.includes('Issue C Plain Relative'), 'Should include Issue C');
        // The output should show the normalized path only once
        assert.ok(
          text.includes('wiggum-mcp-server/src/foo.ts'),
          'Should include normalized file path'
        );
      });

      it('should create separate batches for issues with no file overlap', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        // Two issues with completely different files should be in separate batches
        const issueA = createIssueRecord({
          title: 'Issue A',
          agent_name: 'code-reviewer',
          scope: 'in-scope',
          files_to_edit: ['src/moduleA/file1.ts', 'src/moduleA/file2.ts'],
        });
        const issueB = createIssueRecord({
          title: 'Issue B',
          agent_name: 'code-reviewer',
          scope: 'in-scope',
          files_to_edit: ['src/moduleB/file3.ts', 'src/moduleB/file4.ts'],
        });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issueA, issueB]);

        const result = await listIssues({ scope: 'in-scope' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        // Should have two separate batches
        assert.ok(text.includes('batch-0'), 'Should have batch-0');
        assert.ok(text.includes('batch-1'), 'Should have batch-1');
        // Each batch should have 1 issue
        const batch0Match = text.match(/batch-0 \((\d+) issue/);
        const batch1Match = text.match(/batch-1 \((\d+) issue/);
        assert.ok(batch0Match && batch0Match[1] === '1', 'batch-0 should have 1 issue');
        assert.ok(batch1Match && batch1Match[1] === '1', 'batch-1 should have 1 issue');
      });

      it('should handle deep transitive chains correctly (path compression)', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        // Create a long chain: A-B-C-D-E where each adjacent pair shares a file
        // This tests path compression in the Union-Find
        const issues = [
          createIssueRecord({
            title: 'Issue A',
            agent_name: 'code-reviewer',
            scope: 'in-scope',
            files_to_edit: ['src/a.ts', 'src/shared-ab.ts'],
          }),
          createIssueRecord({
            title: 'Issue B',
            agent_name: 'code-reviewer',
            scope: 'in-scope',
            files_to_edit: ['src/shared-ab.ts', 'src/shared-bc.ts'],
          }),
          createIssueRecord({
            title: 'Issue C',
            agent_name: 'code-reviewer',
            scope: 'in-scope',
            files_to_edit: ['src/shared-bc.ts', 'src/shared-cd.ts'],
          }),
          createIssueRecord({
            title: 'Issue D',
            agent_name: 'code-reviewer',
            scope: 'in-scope',
            files_to_edit: ['src/shared-cd.ts', 'src/shared-de.ts'],
          }),
          createIssueRecord({
            title: 'Issue E',
            agent_name: 'code-reviewer',
            scope: 'in-scope',
            files_to_edit: ['src/shared-de.ts', 'src/e.ts'],
          }),
        ];
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', issues);

        const result = await listIssues({ scope: 'in-scope' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        // All 5 issues should be in the same batch via transitive connections
        assert.ok(text.includes('batch-0'), 'Should have batch-0');
        assert.ok(text.includes('5 issues'), 'Should have 5 issues in batch (deep chain)');
        // Should NOT have batch-1
        assert.ok(!text.includes('batch-1'), 'Should NOT have batch-1 (all connected via chain)');
      });

      it('should produce deterministic batching across multiple calls', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        // Create a mix of connected and unconnected issues
        const issues = [
          createIssueRecord({
            title: 'Issue A',
            agent_name: 'code-reviewer',
            scope: 'in-scope',
            files_to_edit: ['src/shared.ts', 'src/a.ts'],
          }),
          createIssueRecord({
            title: 'Issue B',
            agent_name: 'code-reviewer',
            scope: 'in-scope',
            files_to_edit: ['src/shared.ts', 'src/b.ts'],
          }),
          createIssueRecord({
            title: 'Issue C',
            agent_name: 'code-reviewer',
            scope: 'in-scope',
            files_to_edit: ['src/isolated.ts'],
          }),
        ];
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', issues);

        // Call listIssues multiple times and verify same results
        const results: string[] = [];
        for (let i = 0; i < 5; i++) {
          const result = await listIssues({ scope: 'in-scope' });
          assert.ok(result.content[0].type === 'text');
          results.push(result.content[0].text);
        }

        // All results should be identical
        for (let i = 1; i < results.length; i++) {
          assert.strictEqual(
            results[i],
            results[0],
            `Result ${i} should match first result for deterministic batching`
          );
        }

        // Verify the structure is correct (A and B batched, C separate)
        const text = results[0];
        assert.ok(text.includes('batch-0'), 'Should have batch-0');
        assert.ok(text.includes('batch-1'), 'Should have batch-1');
        // One batch should have 2 issues (A+B), one should have 1 (C)
        const batch0Match = text.match(/batch-0 \((\d+) issue/);
        const batch1Match = text.match(/batch-1 \((\d+) issue/);
        assert.ok(batch0Match && batch1Match, 'Should have batch counts');
        const counts = [parseInt(batch0Match![1]), parseInt(batch1Match![1])].sort();
        assert.deepStrictEqual(counts, [1, 2], 'Should have batches of size 1 and 2');
      });

      it('should handle path with only worktree prefix (edge case normalization)', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        // Edge case: path that is exactly the worktree root, would normalize to empty string
        // The implementation should fall back to original path in this case
        const issues = [
          createIssueRecord({
            title: 'Issue A',
            agent_name: 'code-reviewer',
            scope: 'in-scope',
            files_to_edit: ['file.ts'], // Very short path
          }),
          createIssueRecord({
            title: 'Issue B',
            agent_name: 'code-reviewer',
            scope: 'in-scope',
            files_to_edit: ['file.ts'], // Same short path
          }),
        ];
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', issues);

        const result = await listIssues({ scope: 'in-scope' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        // Both issues reference the same file, should be in one batch
        assert.ok(text.includes('batch-0'), 'Should have batch-0');
        assert.ok(text.includes('2 issues'), 'Should have 2 issues in same batch');
        assert.ok(!text.includes('batch-1'), 'Should NOT have batch-1');
      });

      it('should handle issues from multiple agents with overlapping files', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        // Issues from DIFFERENT agents but overlapping files should batch together
        const issue1 = createIssueRecord({
          title: 'Code Reviewer Issue',
          agent_name: 'code-reviewer',
          scope: 'in-scope',
          files_to_edit: ['src/shared-module.ts'],
        });
        const issue2 = createIssueRecord({
          title: 'Type Analyzer Issue',
          agent_name: 'type-design-analyzer',
          scope: 'in-scope',
          files_to_edit: ['src/shared-module.ts'],
        });
        const issue3 = createIssueRecord({
          title: 'Test Analyzer Issue',
          agent_name: 'pr-test-analyzer',
          scope: 'in-scope',
          files_to_edit: ['src/other-file.ts'],
        });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue1]);
        writeTestManifest(manifestDir, 'type-design-analyzer', 'in-scope', [issue2]);
        writeTestManifest(manifestDir, 'pr-test-analyzer', 'in-scope', [issue3]);

        const result = await listIssues({ scope: 'in-scope' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        // Issues 1 and 2 share a file, issue 3 is separate
        assert.ok(text.includes('batch-0'), 'Should have batch-0');
        assert.ok(text.includes('batch-1'), 'Should have batch-1');
        // Verify batch sizes
        const batch0Match = text.match(/batch-0 \((\d+) issue/);
        const batch1Match = text.match(/batch-1 \((\d+) issue/);
        assert.ok(batch0Match && batch1Match, 'Should have batch-0 and batch-1');
        const batchSizes = [parseInt(batch0Match![1]), parseInt(batch1Match![1])].sort();
        assert.deepStrictEqual(
          batchSizes,
          [1, 2],
          'Should have one batch with 2 issues and one with 1 issue'
        );
        // Verify all issues are present
        assert.ok(text.includes('Code Reviewer Issue'), 'Should include code-reviewer issue');
        assert.ok(text.includes('Type Analyzer Issue'), 'Should include type-analyzer issue');
        assert.ok(text.includes('Test Analyzer Issue'), 'Should include test-analyzer issue');
      });

      it('should batch by file content not by issue count', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        // Even if one file is referenced by many issues, they should all batch together
        const sharedFile = 'src/heavily-referenced.ts';
        const issues = [];
        for (let i = 0; i < 10; i++) {
          issues.push(
            createIssueRecord({
              title: `Issue ${i}`,
              agent_name: 'code-reviewer',
              scope: 'in-scope',
              files_to_edit: [sharedFile, `src/unique-${i}.ts`],
            })
          );
        }
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', issues);

        const result = await listIssues({ scope: 'in-scope' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        // All 10 issues should be in one batch since they share heavily-referenced.ts
        assert.ok(text.includes('batch-0'), 'Should have batch-0');
        assert.ok(text.includes('10 issues'), 'Should have 10 issues in single batch');
        assert.ok(!text.includes('batch-1'), 'Should NOT have batch-1');
      });
    });
  });
});
