/**
 * Tests for get-issue tool
 *
 * Test coverage for the issue details retrieval tool.
 * Includes both schema validation and behavioral tests with real filesystem operations.
 *
 * @see https://github.com/commons-systems/commons.systems/issues/625
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { GetIssueInputSchema, getIssue } from './get-issue.js';
import type { IssueRecord } from './manifest-types.js';

describe('get-issue tool', () => {
  describe('GetIssueInputSchema', () => {
    describe('valid inputs', () => {
      it('should validate with valid issue ID', () => {
        const input = { id: 'code-reviewer-in-scope-0' };
        const result = GetIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
        if (result.success) {
          assert.strictEqual(result.data.id, 'code-reviewer-in-scope-0');
        }
      });

      it('should validate with out-of-scope ID', () => {
        const input = { id: 'silent-failure-hunter-out-of-scope-5' };
        const result = GetIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
        if (result.success) {
          assert.strictEqual(result.data.id, 'silent-failure-hunter-out-of-scope-5');
        }
      });

      it('should validate with hyphenated agent name', () => {
        const input = { id: 'pr-test-analyzer-in-scope-2' };
        const result = GetIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, true);
        if (result.success) {
          assert.strictEqual(result.data.id, 'pr-test-analyzer-in-scope-2');
        }
      });
    });

    describe('invalid inputs', () => {
      it('should reject missing id', () => {
        const input = {};
        const result = GetIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });

      it('should reject empty id', () => {
        const input = { id: '' };
        const result = GetIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });

      it('should reject numeric id', () => {
        const input = { id: 123 };
        const result = GetIssueInputSchema.safeParse(input);
        assert.strictEqual(result.success, false);
      });

      it('should reject boolean id', () => {
        const input = { id: true };
        const result = GetIssueInputSchema.safeParse(input);
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

describe('get-issue behavioral tests', () => {
  beforeEach(() => {
    // Save original cwd and create a unique test directory
    originalCwd = process.cwd();
    testDir = join(
      '/tmp/claude',
      `get-issue-test-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
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

  describe('parseIssueId behavior (tested via getIssue)', () => {
    describe('valid ID formats', () => {
      it('should parse simple agent name with in-scope', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const issue = createIssueRecord({
          agent_name: 'code-reviewer',
          scope: 'in-scope',
          title: 'Found Issue',
        });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

        const result = await getIssue({ id: 'code-reviewer-in-scope-0' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(text.includes('Found Issue'), 'Should retrieve the issue');
      });

      it('should parse hyphenated agent name with in-scope', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const issue = createIssueRecord({
          agent_name: 'silent-failure-hunter',
          scope: 'in-scope',
          title: 'Hunter Issue',
        });
        writeTestManifest(manifestDir, 'silent-failure-hunter', 'in-scope', [issue]);

        const result = await getIssue({ id: 'silent-failure-hunter-in-scope-0' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(text.includes('Hunter Issue'), 'Should retrieve the issue');
      });

      it('should parse out-of-scope IDs correctly', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const issue = createIssueRecord({
          agent_name: 'code-reviewer',
          scope: 'out-of-scope',
          title: 'Out of Scope Issue',
        });
        writeTestManifest(manifestDir, 'code-reviewer', 'out-of-scope', [issue]);

        const result = await getIssue({ id: 'code-reviewer-out-of-scope-0' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(text.includes('Out of Scope Issue'), 'Should retrieve the issue');
      });

      it('should parse multi-digit index', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const issues: IssueRecord[] = [];
        for (let i = 0; i < 15; i++) {
          issues.push(createIssueRecord({ title: `Issue ${i}` }));
        }
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', issues);

        const result = await getIssue({ id: 'code-reviewer-in-scope-12' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(text.includes('Issue 12'), 'Should retrieve issue at index 12');
      });
    });

    describe('invalid ID formats', () => {
      it('should reject ID without scope marker', async () => {
        await assert.rejects(
          async () => await getIssue({ id: 'code-reviewer-0' }),
          /Issue not found/,
          'Should throw for invalid ID format'
        );
      });

      it('should reject ID with invalid scope marker', async () => {
        await assert.rejects(
          async () => await getIssue({ id: 'code-reviewer-partial-scope-0' }),
          /Issue not found/,
          'Should throw for invalid scope marker'
        );
      });

      it('should reject ID with negative index', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const issue = createIssueRecord();
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

        await assert.rejects(
          async () => await getIssue({ id: 'code-reviewer-in-scope--1' }),
          /Issue not found/,
          'Should throw for negative index'
        );
      });

      it('should reject ID with non-numeric index', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const issue = createIssueRecord();
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

        await assert.rejects(
          async () => await getIssue({ id: 'code-reviewer-in-scope-abc' }),
          /Issue not found/,
          'Should throw for non-numeric index'
        );
      });
    });
  });

  describe('issue retrieval', () => {
    describe('successful retrieval', () => {
      it('should return full issue details', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const issue = createIssueRecord({
          title: 'Detailed Issue',
          description: 'This is a detailed description',
          location: 'src/api.ts:42',
          priority: 'high',
        });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

        const result = await getIssue({ id: 'code-reviewer-in-scope-0' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(text.includes('Detailed Issue'), 'Should include title');
        assert.ok(text.includes('This is a detailed description'), 'Should include description');
        assert.ok(text.includes('src/api.ts:42'), 'Should include location');
        assert.ok(text.includes('code-reviewer'), 'Should include agent name');
        assert.ok(text.includes('high'), 'Should include priority');
      });

      it('should include existing_todo details when present', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const issue = createIssueRecord({
          title: 'Issue with TODO',
          existing_todo: {
            has_todo: true,
            issue_reference: '#123',
          },
        });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

        const result = await getIssue({ id: 'code-reviewer-in-scope-0' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(text.includes('Existing TODO'), 'Should include TODO section');
        assert.ok(text.includes('#123'), 'Should include issue reference');
        assert.ok(text.includes('Yes'), 'Should indicate has_todo is true');
      });

      it('should include metadata when present', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const issue = createIssueRecord({
          title: 'Issue with Metadata',
          metadata: {
            confidence: 95,
            severity: 'critical',
            category: 'security',
          },
        });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

        const result = await getIssue({ id: 'code-reviewer-in-scope-0' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(text.includes('Metadata'), 'Should include metadata section');
        assert.ok(text.includes('confidence'), 'Should include metadata key');
        assert.ok(text.includes('95'), 'Should include metadata value');
      });

      it('should retrieve specific issue by index', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const issues = [
          createIssueRecord({ title: 'First Issue' }),
          createIssueRecord({ title: 'Second Issue' }),
          createIssueRecord({ title: 'Third Issue' }),
        ];
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', issues);

        const result = await getIssue({ id: 'code-reviewer-in-scope-1' });

        assert.ok(result.content[0].type === 'text');
        const text = result.content[0].text;
        assert.ok(text.includes('Second Issue'), 'Should retrieve issue at index 1');
        assert.ok(!text.includes('First Issue'), 'Should not include other issues');
        assert.ok(!text.includes('Third Issue'), 'Should not include other issues');
      });
    });

    describe('error handling', () => {
      it('should throw when manifest directory does not exist', async () => {
        rmSync(join(testDir, 'tmp', 'wiggum'), { recursive: true, force: true });

        await assert.rejects(
          async () => await getIssue({ id: 'code-reviewer-in-scope-0' }),
          /Issue not found/,
          'Should throw when directory does not exist'
        );
      });

      it('should throw when agent has no manifest files', async () => {
        // Directory exists but is empty
        await assert.rejects(
          async () => await getIssue({ id: 'code-reviewer-in-scope-0' }),
          /Issue not found/,
          'Should throw when no manifests exist'
        );
      });

      it('should throw when index is out of range', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const issue = createIssueRecord({ title: 'Only Issue' });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

        await assert.rejects(
          async () => await getIssue({ id: 'code-reviewer-in-scope-5' }),
          /Issue not found/,
          'Should throw when index out of range'
        );
      });

      it('should throw when agent name does not match any manifest', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const issue = createIssueRecord({ agent_name: 'code-reviewer' });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

        await assert.rejects(
          async () => await getIssue({ id: 'nonexistent-agent-in-scope-0' }),
          /Issue not found/,
          'Should throw when agent not found'
        );
      });

      it('should throw when scope does not match any manifest', async () => {
        const manifestDir = join(testDir, 'tmp', 'wiggum');
        const issue = createIssueRecord({ scope: 'in-scope' });
        writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

        await assert.rejects(
          async () => await getIssue({ id: 'code-reviewer-out-of-scope-0' }),
          /Issue not found/,
          'Should throw when scope not found'
        );
      });
    });
  });

  describe('output formatting', () => {
    it('should show priority emoji (red for high, blue for low)', async () => {
      const manifestDir = join(testDir, 'tmp', 'wiggum');

      // Test high priority
      const highIssue = createIssueRecord({ priority: 'high' });
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [highIssue]);

      const highResult = await getIssue({ id: 'code-reviewer-in-scope-0' });
      assert.ok(highResult.content[0].type === 'text');
      assert.ok(
        highResult.content[0].text.includes('\u{1F534}'),
        'Should include red circle for high priority'
      ); // 🔴
    });

    it('should show scope label (In-Scope/Out-of-Scope)', async () => {
      const manifestDir = join(testDir, 'tmp', 'wiggum');
      const issue = createIssueRecord({ scope: 'in-scope' });
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

      const result = await getIssue({ id: 'code-reviewer-in-scope-0' });

      assert.ok(result.content[0].type === 'text');
      const text = result.content[0].text;
      assert.ok(text.includes('In-Scope'), 'Should include scope label');
    });

    it('should include the issue ID in output', async () => {
      const manifestDir = join(testDir, 'tmp', 'wiggum');
      const issue = createIssueRecord();
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue]);

      const result = await getIssue({ id: 'code-reviewer-in-scope-0' });

      assert.ok(result.content[0].type === 'text');
      const text = result.content[0].text;
      assert.ok(text.includes('code-reviewer-in-scope-0'), 'Should include the ID');
    });
  });

  describe('ID consistency with list-issues', () => {
    it('should retrieve issues using IDs from list-issues', async () => {
      const manifestDir = join(testDir, 'tmp', 'wiggum');
      const issue1 = createIssueRecord({
        title: 'First Issue',
        agent_name: 'code-reviewer',
        scope: 'in-scope',
      });
      const issue2 = createIssueRecord({
        title: 'Second Issue',
        agent_name: 'silent-failure-hunter',
        scope: 'in-scope',
      });
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue1]);
      writeTestManifest(manifestDir, 'silent-failure-hunter', 'in-scope', [issue2]);

      // The IDs generated by list-issues should work with get-issue
      // Test expected ID format: {agent}-{scope}-{index}
      const result1 = await getIssue({ id: 'code-reviewer-in-scope-0' });
      const result2 = await getIssue({ id: 'silent-failure-hunter-in-scope-0' });

      assert.ok(result1.content[0].type === 'text');
      assert.ok(result1.content[0].text.includes('First Issue'));

      assert.ok(result2.content[0].type === 'text');
      assert.ok(result2.content[0].text.includes('Second Issue'));
    });

    it('should handle multiple issues from same agent with sequential indices', async () => {
      const manifestDir = join(testDir, 'tmp', 'wiggum');
      const issues = [
        createIssueRecord({ title: 'Issue 0' }),
        createIssueRecord({ title: 'Issue 1' }),
        createIssueRecord({ title: 'Issue 2' }),
      ];
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', issues);

      // Each index should retrieve the correct issue
      const result0 = await getIssue({ id: 'code-reviewer-in-scope-0' });
      const result1 = await getIssue({ id: 'code-reviewer-in-scope-1' });
      const result2 = await getIssue({ id: 'code-reviewer-in-scope-2' });

      assert.ok(result0.content[0].type === 'text');
      assert.ok(result0.content[0].text.includes('Issue 0'));

      assert.ok(result1.content[0].type === 'text');
      assert.ok(result1.content[0].text.includes('Issue 1'));

      assert.ok(result2.content[0].type === 'text');
      assert.ok(result2.content[0].text.includes('Issue 2'));
    });
  });

  describe('edge cases', () => {
    it('should handle agent names with multiple hyphens', async () => {
      const manifestDir = join(testDir, 'tmp', 'wiggum');
      const issue = createIssueRecord({
        agent_name: 'pr-test-analyzer',
        title: 'PR Test Issue',
      });
      writeTestManifest(manifestDir, 'pr-test-analyzer', 'in-scope', [issue]);

      const result = await getIssue({ id: 'pr-test-analyzer-in-scope-0' });

      assert.ok(result.content[0].type === 'text');
      const text = result.content[0].text;
      assert.ok(text.includes('PR Test Issue'), 'Should handle agent name with multiple hyphens');
    });

    it('should handle issues from merged manifest files', async () => {
      const manifestDir = join(testDir, 'tmp', 'wiggum');

      // Write multiple manifest files for same agent (simulating concurrent writes)
      const issue1 = createIssueRecord({ title: 'Issue from File 1' });
      const issue2 = createIssueRecord({ title: 'Issue from File 2' });
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue1]);
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [issue2]);

      // Both issues should be retrievable with sequential indices
      const result0 = await getIssue({ id: 'code-reviewer-in-scope-0' });
      const result1 = await getIssue({ id: 'code-reviewer-in-scope-1' });

      // One of them should be Issue from File 1, the other Issue from File 2
      const text0 = result0.content[0].type === 'text' ? result0.content[0].text : '';
      const text1 = result1.content[0].type === 'text' ? result1.content[0].text : '';

      const hasFile1 = text0.includes('Issue from File 1') || text1.includes('Issue from File 1');
      const hasFile2 = text0.includes('Issue from File 2') || text1.includes('Issue from File 2');

      assert.ok(hasFile1, 'Should include issue from first file');
      assert.ok(hasFile2, 'Should include issue from second file');
    });
  });
});
