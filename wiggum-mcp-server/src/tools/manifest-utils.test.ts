/**
 * Tests for manifest-utils module
 *
 * Comprehensive test coverage for manifest utility functions.
 * Tests cover agent completion tracking, manifest reading, and cleanup logic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  REVIEW_AGENT_NAMES,
  getCompletedAgents,
  updateAgentCompletionStatus,
  isManifestFile,
  parseManifestFilename,
  getManifestDir,
} from './manifest-utils.js';
import { isIssueRecord, isIssueRecordArray } from './manifest-types.js';

describe('manifest-utils', () => {
  describe('REVIEW_AGENT_NAMES', () => {
    it('should contain all 6 review agent names', () => {
      assert.strictEqual(REVIEW_AGENT_NAMES.length, 6);
    });

    it('should contain code-reviewer', () => {
      assert.ok(REVIEW_AGENT_NAMES.includes('code-reviewer'));
    });

    it('should contain silent-failure-hunter', () => {
      assert.ok(REVIEW_AGENT_NAMES.includes('silent-failure-hunter'));
    });

    it('should contain code-simplifier', () => {
      assert.ok(REVIEW_AGENT_NAMES.includes('code-simplifier'));
    });

    it('should contain comment-analyzer', () => {
      assert.ok(REVIEW_AGENT_NAMES.includes('comment-analyzer'));
    });

    it('should contain pr-test-analyzer', () => {
      assert.ok(REVIEW_AGENT_NAMES.includes('pr-test-analyzer'));
    });

    it('should contain type-design-analyzer', () => {
      assert.ok(REVIEW_AGENT_NAMES.includes('type-design-analyzer'));
    });

    it('should be readonly (immutable)', () => {
      // TypeScript enforces readonly at compile time
      // At runtime, we can verify it's an array
      assert.ok(Array.isArray(REVIEW_AGENT_NAMES));
    });
  });

  describe('getCompletedAgents', () => {
    describe('empty manifests map', () => {
      it('should mark all agents complete when no manifests exist', () => {
        const manifests = new Map();
        const completed = getCompletedAgents(manifests);

        // All agents should be complete (no work to do)
        assert.strictEqual(completed.length, 6);
        assert.ok(completed.includes('code-reviewer'));
        assert.ok(completed.includes('silent-failure-hunter'));
        assert.ok(completed.includes('code-simplifier'));
        assert.ok(completed.includes('comment-analyzer'));
        assert.ok(completed.includes('pr-test-analyzer'));
        assert.ok(completed.includes('type-design-analyzer'));
      });
    });

    describe('agents with zero high-priority in-scope issues', () => {
      it('should mark agent complete with zero high-priority issues', () => {
        const manifests = new Map([
          [
            'code-reviewer-in-scope',
            {
              agent_name: 'code-reviewer',
              scope: 'in-scope' as const,
              issues: [
                {
                  agent_name: 'code-reviewer',
                  scope: 'in-scope' as const,
                  priority: 'low' as const,
                  title: 'Test',
                  description: 'Test',
                  timestamp: '2025-01-01T00:00:00Z',
                },
              ],
              high_priority_count: 0,
            },
          ],
        ]);

        const completed = getCompletedAgents(manifests);
        assert.ok(completed.includes('code-reviewer'));
      });

      it('should mark agent complete with only out-of-scope high-priority issues', () => {
        const manifests = new Map([
          [
            'silent-failure-hunter-out-of-scope',
            {
              agent_name: 'silent-failure-hunter',
              scope: 'out-of-scope' as const,
              issues: [
                {
                  agent_name: 'silent-failure-hunter',
                  scope: 'out-of-scope' as const,
                  priority: 'high' as const,
                  title: 'Test',
                  description: 'Test',
                  timestamp: '2025-01-01T00:00:00Z',
                },
              ],
              high_priority_count: 1,
            },
          ],
        ]);

        const completed = getCompletedAgents(manifests);
        // Out-of-scope issues don't block completion
        assert.ok(completed.includes('silent-failure-hunter'));
      });

      it('should mark multiple agents complete with low-priority only', () => {
        const manifests = new Map([
          [
            'code-reviewer-in-scope',
            {
              agent_name: 'code-reviewer',
              scope: 'in-scope' as const,
              issues: [
                {
                  agent_name: 'code-reviewer',
                  scope: 'in-scope' as const,
                  priority: 'low' as const,
                  title: 'Test',
                  description: 'Test',
                  timestamp: '2025-01-01T00:00:00Z',
                },
              ],
              high_priority_count: 0,
            },
          ],
          [
            'code-simplifier-in-scope',
            {
              agent_name: 'code-simplifier',
              scope: 'in-scope' as const,
              issues: [
                {
                  agent_name: 'code-simplifier',
                  scope: 'in-scope' as const,
                  priority: 'low' as const,
                  title: 'Test',
                  description: 'Test',
                  timestamp: '2025-01-01T00:00:00Z',
                },
              ],
              high_priority_count: 0,
            },
          ],
        ]);

        const completed = getCompletedAgents(manifests);
        assert.ok(completed.includes('code-reviewer'));
        assert.ok(completed.includes('code-simplifier'));
      });
    });

    describe('agents with high-priority in-scope issues', () => {
      it('should NOT mark agent complete with high-priority issues', () => {
        const manifests = new Map([
          [
            'pr-test-analyzer-in-scope',
            {
              agent_name: 'pr-test-analyzer',
              scope: 'in-scope' as const,
              issues: [
                {
                  agent_name: 'pr-test-analyzer',
                  scope: 'in-scope' as const,
                  priority: 'high' as const,
                  title: 'Test',
                  description: 'Test',
                  timestamp: '2025-01-01T00:00:00Z',
                },
              ],
              high_priority_count: 1,
            },
          ],
        ]);

        const completed = getCompletedAgents(manifests);
        assert.ok(!completed.includes('pr-test-analyzer'));
      });

      it('should NOT mark agent complete with multiple high-priority issues', () => {
        const manifests = new Map([
          [
            'comment-analyzer-in-scope',
            {
              agent_name: 'comment-analyzer',
              scope: 'in-scope' as const,
              issues: [
                {
                  agent_name: 'comment-analyzer',
                  scope: 'in-scope' as const,
                  priority: 'high' as const,
                  title: 'Test 1',
                  description: 'Test',
                  timestamp: '2025-01-01T00:00:00Z',
                },
                {
                  agent_name: 'comment-analyzer',
                  scope: 'in-scope' as const,
                  priority: 'high' as const,
                  title: 'Test 2',
                  description: 'Test',
                  timestamp: '2025-01-01T00:00:01Z',
                },
              ],
              high_priority_count: 2,
            },
          ],
        ]);

        const completed = getCompletedAgents(manifests);
        assert.ok(!completed.includes('comment-analyzer'));
      });

      it('should NOT mark agent complete with mixed priority (includes high)', () => {
        const manifests = new Map([
          [
            'type-design-analyzer-in-scope',
            {
              agent_name: 'type-design-analyzer',
              scope: 'in-scope' as const,
              issues: [
                {
                  agent_name: 'type-design-analyzer',
                  scope: 'in-scope' as const,
                  priority: 'high' as const,
                  title: 'High priority',
                  description: 'Test',
                  timestamp: '2025-01-01T00:00:00Z',
                },
                {
                  agent_name: 'type-design-analyzer',
                  scope: 'in-scope' as const,
                  priority: 'low' as const,
                  title: 'Low priority',
                  description: 'Test',
                  timestamp: '2025-01-01T00:00:01Z',
                },
              ],
              high_priority_count: 1,
            },
          ],
        ]);

        const completed = getCompletedAgents(manifests);
        assert.ok(!completed.includes('type-design-analyzer'));
      });
    });

    describe('mixed agent states', () => {
      it('should correctly separate completed and incomplete agents', () => {
        const manifests = new Map([
          // Complete: no manifest
          // code-reviewer - no entry = complete

          // Complete: zero high-priority
          [
            'silent-failure-hunter-in-scope',
            {
              agent_name: 'silent-failure-hunter',
              scope: 'in-scope' as const,
              issues: [
                {
                  agent_name: 'silent-failure-hunter',
                  scope: 'in-scope' as const,
                  priority: 'low' as const,
                  title: 'Test',
                  description: 'Test',
                  timestamp: '2025-01-01T00:00:00Z',
                },
              ],
              high_priority_count: 0,
            },
          ],

          // Incomplete: has high-priority
          [
            'pr-test-analyzer-in-scope',
            {
              agent_name: 'pr-test-analyzer',
              scope: 'in-scope' as const,
              issues: [
                {
                  agent_name: 'pr-test-analyzer',
                  scope: 'in-scope' as const,
                  priority: 'high' as const,
                  title: 'Test',
                  description: 'Test',
                  timestamp: '2025-01-01T00:00:00Z',
                },
              ],
              high_priority_count: 1,
            },
          ],
        ]);

        const completed = getCompletedAgents(manifests);

        // Complete agents
        assert.ok(completed.includes('code-reviewer'));
        assert.ok(completed.includes('silent-failure-hunter'));
        assert.ok(completed.includes('code-simplifier'));
        assert.ok(completed.includes('comment-analyzer'));
        assert.ok(completed.includes('type-design-analyzer'));

        // Incomplete agents
        assert.ok(!completed.includes('pr-test-analyzer'));

        // Total count
        assert.strictEqual(completed.length, 5);
      });
    });
  });

  describe('updateAgentCompletionStatus', () => {
    describe('2-strike verification logic', () => {
      it('should mark agent as pending on first zero high-priority iteration', () => {
        const manifests = new Map([
          [
            'code-reviewer-in-scope',
            {
              agent_name: 'code-reviewer',
              scope: 'in-scope' as const,
              issues: [],
              high_priority_count: 0,
            },
          ],
        ]);

        const result = updateAgentCompletionStatus(manifests, [], []);

        assert.ok(result.pendingCompletionAgents.includes('code-reviewer'));
        assert.ok(!result.completedAgents.includes('code-reviewer'));
        assert.strictEqual(result.pendingCompletionAgents.length, 6); // All agents with 0 issues
      });

      it('should mark agent as complete on second consecutive zero high-priority iteration', () => {
        const manifests = new Map([
          [
            'code-reviewer-in-scope',
            {
              agent_name: 'code-reviewer',
              scope: 'in-scope' as const,
              issues: [],
              high_priority_count: 0,
            },
          ],
        ]);

        // Second iteration - agent was pending, still has 0 issues
        const result = updateAgentCompletionStatus(manifests, ['code-reviewer'], []);

        assert.ok(result.completedAgents.includes('code-reviewer'));
        assert.ok(!result.pendingCompletionAgents.includes('code-reviewer'));
      });

      it('should reset pending agent to active if issues are found', () => {
        const manifests = new Map([
          [
            'code-reviewer-in-scope',
            {
              agent_name: 'code-reviewer',
              scope: 'in-scope' as const,
              issues: [
                {
                  agent_name: 'code-reviewer',
                  scope: 'in-scope' as const,
                  priority: 'high' as const,
                  title: 'New issue',
                  description: 'Found after pending',
                  timestamp: '2025-01-01T00:00:00Z',
                },
              ],
              high_priority_count: 1,
            },
          ],
        ]);

        // Agent was pending, but now has issues - should reset to active
        const result = updateAgentCompletionStatus(manifests, ['code-reviewer'], []);

        assert.ok(!result.completedAgents.includes('code-reviewer'));
        assert.ok(!result.pendingCompletionAgents.includes('code-reviewer'));
      });

      it('should never revert completed agents', () => {
        const manifests = new Map([
          [
            'code-reviewer-in-scope',
            {
              agent_name: 'code-reviewer',
              scope: 'in-scope' as const,
              issues: [
                {
                  agent_name: 'code-reviewer',
                  scope: 'in-scope' as const,
                  priority: 'high' as const,
                  title: 'New issue',
                  description: 'Found after completion',
                  timestamp: '2025-01-01T00:00:00Z',
                },
              ],
              high_priority_count: 1,
            },
          ],
        ]);

        // Agent was completed - should stay completed even with new issues
        const result = updateAgentCompletionStatus(manifests, [], ['code-reviewer']);

        assert.ok(result.completedAgents.includes('code-reviewer'));
        assert.ok(!result.pendingCompletionAgents.includes('code-reviewer'));
      });
    });

    describe('multiple agents with different states', () => {
      it('should handle mixed agent states correctly', () => {
        const manifests = new Map([
          // code-reviewer: has issues (active)
          [
            'code-reviewer-in-scope',
            {
              agent_name: 'code-reviewer',
              scope: 'in-scope' as const,
              issues: [
                {
                  agent_name: 'code-reviewer',
                  scope: 'in-scope' as const,
                  priority: 'high' as const,
                  title: 'Issue',
                  description: 'Test',
                  timestamp: '2025-01-01T00:00:00Z',
                },
              ],
              high_priority_count: 1,
            },
          ],
          // silent-failure-hunter: no issues (will be pending)
          [
            'silent-failure-hunter-in-scope',
            {
              agent_name: 'silent-failure-hunter',
              scope: 'in-scope' as const,
              issues: [],
              high_priority_count: 0,
            },
          ],
          // code-simplifier: no manifest (will be pending)
        ]);

        const result = updateAgentCompletionStatus(
          manifests,
          ['comment-analyzer'], // was pending
          ['pr-test-analyzer'] // was completed
        );

        // Active agent (has issues)
        assert.ok(!result.completedAgents.includes('code-reviewer'));
        assert.ok(!result.pendingCompletionAgents.includes('code-reviewer'));

        // New pending agents (first 0)
        assert.ok(result.pendingCompletionAgents.includes('silent-failure-hunter'));
        assert.ok(result.pendingCompletionAgents.includes('code-simplifier'));

        // Pending -> Complete (second 0)
        assert.ok(result.completedAgents.includes('comment-analyzer'));
        assert.ok(!result.pendingCompletionAgents.includes('comment-analyzer'));

        // Already completed (persists)
        assert.ok(result.completedAgents.includes('pr-test-analyzer'));
        assert.ok(!result.pendingCompletionAgents.includes('pr-test-analyzer'));
      });

      it('should handle all agents pending', () => {
        const manifests = new Map(); // No manifests = all agents have 0 issues

        const result = updateAgentCompletionStatus(manifests, [], []);

        // All 6 agents should be pending
        assert.strictEqual(result.pendingCompletionAgents.length, 6);
        assert.strictEqual(result.completedAgents.length, 0);
      });

      it('should handle all agents completing together', () => {
        const manifests = new Map(); // No manifests = all agents still have 0 issues

        // All were pending, now all should complete
        const result = updateAgentCompletionStatus(
          manifests,
          [...REVIEW_AGENT_NAMES], // all pending
          []
        );

        // All 6 agents should be completed
        assert.strictEqual(result.completedAgents.length, 6);
        assert.strictEqual(result.pendingCompletionAgents.length, 0);
      });
    });

    describe('out-of-scope issues behavior', () => {
      it('should ignore out-of-scope high-priority issues for completion', () => {
        const manifests = new Map([
          [
            'code-reviewer-out-of-scope',
            {
              agent_name: 'code-reviewer',
              scope: 'out-of-scope' as const,
              issues: [
                {
                  agent_name: 'code-reviewer',
                  scope: 'out-of-scope' as const,
                  priority: 'high' as const,
                  title: 'Out of scope',
                  description: 'Test',
                  timestamp: '2025-01-01T00:00:00Z',
                },
              ],
              high_priority_count: 1,
            },
          ],
        ]);

        // Out-of-scope issues should not block completion
        const result = updateAgentCompletionStatus(manifests, [], []);

        assert.ok(result.pendingCompletionAgents.includes('code-reviewer'));
      });

      it('should handle mix of in-scope and out-of-scope manifests', () => {
        const manifests = new Map([
          // In-scope with issues (blocks completion)
          [
            'code-reviewer-in-scope',
            {
              agent_name: 'code-reviewer',
              scope: 'in-scope' as const,
              issues: [
                {
                  agent_name: 'code-reviewer',
                  scope: 'in-scope' as const,
                  priority: 'high' as const,
                  title: 'In scope',
                  description: 'Test',
                  timestamp: '2025-01-01T00:00:00Z',
                },
              ],
              high_priority_count: 1,
            },
          ],
          // Out-of-scope with issues (doesn't block)
          [
            'code-reviewer-out-of-scope',
            {
              agent_name: 'code-reviewer',
              scope: 'out-of-scope' as const,
              issues: [
                {
                  agent_name: 'code-reviewer',
                  scope: 'out-of-scope' as const,
                  priority: 'high' as const,
                  title: 'Out of scope',
                  description: 'Test',
                  timestamp: '2025-01-01T00:00:00Z',
                },
              ],
              high_priority_count: 1,
            },
          ],
        ]);

        const result = updateAgentCompletionStatus(manifests, [], []);

        // In-scope issues block completion
        assert.ok(!result.completedAgents.includes('code-reviewer'));
        assert.ok(!result.pendingCompletionAgents.includes('code-reviewer'));
      });
    });

    describe('edge cases', () => {
      it('should handle empty previous states', () => {
        const manifests = new Map();
        const result = updateAgentCompletionStatus(manifests, [], []);

        // Should work without errors
        assert.ok(Array.isArray(result.completedAgents));
        assert.ok(Array.isArray(result.pendingCompletionAgents));
      });

      it('should preserve previously completed agents order', () => {
        const manifests = new Map();
        const previousCompleted = ['code-reviewer', 'code-simplifier'];

        const result = updateAgentCompletionStatus(manifests, [], previousCompleted);

        // Previously completed agents should appear first in same order
        assert.strictEqual(result.completedAgents[0], 'code-reviewer');
        assert.strictEqual(result.completedAgents[1], 'code-simplifier');
      });

      it('should handle agent with only low-priority in-scope issues', () => {
        const manifests = new Map([
          [
            'code-reviewer-in-scope',
            {
              agent_name: 'code-reviewer',
              scope: 'in-scope' as const,
              issues: [
                {
                  agent_name: 'code-reviewer',
                  scope: 'in-scope' as const,
                  priority: 'low' as const,
                  title: 'Low priority',
                  description: 'Test',
                  timestamp: '2025-01-01T00:00:00Z',
                },
              ],
              high_priority_count: 0, // Only low priority
            },
          ],
        ]);

        const result = updateAgentCompletionStatus(manifests, [], []);

        // Should be pending (0 high-priority issues)
        assert.ok(result.pendingCompletionAgents.includes('code-reviewer'));
      });
    });
  });

  describe('isManifestFile', () => {
    describe('valid manifest filenames', () => {
      it('should accept in-scope manifest file', () => {
        assert.strictEqual(isManifestFile('code-reviewer-in-scope-1234567890-abc123.json'), true);
      });

      it('should accept out-of-scope manifest file', () => {
        assert.strictEqual(
          isManifestFile('code-reviewer-out-of-scope-1234567890-abc123.json'),
          true
        );
      });

      it('should accept manifest with simple agent name', () => {
        assert.strictEqual(isManifestFile('reviewer-in-scope-1234.json'), true);
      });

      it('should accept manifest with complex agent name', () => {
        assert.strictEqual(
          isManifestFile('silent-failure-hunter-in-scope-1234567890-deadbeef.json'),
          true
        );
      });
    });

    describe('invalid manifest filenames', () => {
      it('should reject non-JSON file with in-scope marker', () => {
        // This test verifies the operator precedence fix
        // Without proper parentheses, this would incorrectly match
        assert.strictEqual(isManifestFile('code-reviewer-in-scope-1234567890.bak'), false);
      });

      it('should reject non-JSON file with out-of-scope marker', () => {
        // Critical test: verifies .json is required for BOTH scope patterns
        assert.strictEqual(isManifestFile('code-reviewer-out-of-scope-1234567890.bak'), false);
      });

      it('should reject .txt file with scope marker', () => {
        assert.strictEqual(isManifestFile('code-reviewer-in-scope-1234567890.txt'), false);
      });

      it('should reject .log file with scope marker', () => {
        assert.strictEqual(isManifestFile('debug-out-of-scope-log.log'), false);
      });

      it('should reject JSON file without scope marker', () => {
        assert.strictEqual(isManifestFile('code-reviewer-1234567890.json'), false);
      });

      it('should reject random JSON file', () => {
        assert.strictEqual(isManifestFile('random-file.json'), false);
      });

      it('should reject empty filename', () => {
        assert.strictEqual(isManifestFile(''), false);
      });

      it('should reject just .json extension', () => {
        assert.strictEqual(isManifestFile('.json'), false);
      });
    });

    describe('edge cases', () => {
      it('should handle filename with multiple scope markers', () => {
        // Should match because it contains a scope marker and ends with .json
        assert.strictEqual(isManifestFile('in-scope-test-out-of-scope-1234567890.json'), true);
      });

      it('should handle uppercase in filename (no match)', () => {
        // Our pattern is case-sensitive
        assert.strictEqual(isManifestFile('code-reviewer-IN-SCOPE-1234567890.json'), false);
      });
    });
  });

  describe('parseManifestFilename', () => {
    describe('valid filenames', () => {
      it('should parse in-scope manifest filename', () => {
        const result = parseManifestFilename('code-reviewer-in-scope-1234567890-abc123.json');
        assert.deepStrictEqual(result, {
          agentName: 'code-reviewer',
          scope: 'in-scope',
        });
      });

      it('should parse out-of-scope manifest filename', () => {
        const result = parseManifestFilename('code-reviewer-out-of-scope-1234567890-abc123.json');
        assert.deepStrictEqual(result, {
          agentName: 'code-reviewer',
          scope: 'out-of-scope',
        });
      });

      it('should parse complex agent name', () => {
        const result = parseManifestFilename(
          'silent-failure-hunter-in-scope-1234567890-deadbeef.json'
        );
        assert.deepStrictEqual(result, {
          agentName: 'silent-failure-hunter',
          scope: 'in-scope',
        });
      });

      it('should parse simple agent name', () => {
        const result = parseManifestFilename('reviewer-out-of-scope-1234.json');
        assert.deepStrictEqual(result, {
          agentName: 'reviewer',
          scope: 'out-of-scope',
        });
      });
    });

    describe('invalid filenames', () => {
      it('should return null for filename without scope marker', () => {
        const result = parseManifestFilename('code-reviewer-1234567890.json');
        assert.strictEqual(result, null);
      });

      it('should return null for empty filename', () => {
        const result = parseManifestFilename('');
        assert.strictEqual(result, null);
      });

      it('should return null for filename with only scope marker', () => {
        const result = parseManifestFilename('-in-scope-1234567890.json');
        assert.strictEqual(result, null);
      });
    });
  });

  describe('getManifestDir', () => {
    it('should return path ending with tmp/wiggum', () => {
      const dir = getManifestDir();
      assert.ok(dir.endsWith('tmp/wiggum') || dir.endsWith('tmp\\wiggum'));
    });

    it('should return absolute path', () => {
      const dir = getManifestDir();
      // Should start with / on Unix or drive letter on Windows
      assert.ok(dir.startsWith('/') || /^[A-Za-z]:/.test(dir));
    });
  });

  describe('isIssueRecord', () => {
    describe('valid issue records', () => {
      it('should accept minimal valid issue record', () => {
        const record = {
          agent_name: 'code-reviewer',
          scope: 'in-scope',
          priority: 'high',
          title: 'Test Issue',
          description: 'Test Description',
          timestamp: '2025-01-15T10:30:00.000Z',
        };
        assert.strictEqual(isIssueRecord(record), true);
      });

      it('should accept issue record with all optional fields', () => {
        const record = {
          agent_name: 'code-reviewer',
          scope: 'out-of-scope',
          priority: 'low',
          title: 'Test Issue',
          description: 'Test Description',
          location: 'src/file.ts:42',
          existing_todo: {
            has_todo: true,
            issue_reference: '#123',
          },
          metadata: { severity: 'critical', confidence: 95 },
          timestamp: '2025-01-15T10:30:00.000Z',
        };
        assert.strictEqual(isIssueRecord(record), true);
      });
    });

    describe('invalid issue records', () => {
      it('should reject null', () => {
        assert.strictEqual(isIssueRecord(null), false);
      });

      it('should reject undefined', () => {
        assert.strictEqual(isIssueRecord(undefined), false);
      });

      it('should reject primitive values', () => {
        assert.strictEqual(isIssueRecord('string'), false);
        assert.strictEqual(isIssueRecord(123), false);
        assert.strictEqual(isIssueRecord(true), false);
      });

      it('should reject empty object', () => {
        assert.strictEqual(isIssueRecord({}), false);
      });

      it('should reject missing agent_name', () => {
        const record = {
          scope: 'in-scope',
          priority: 'high',
          title: 'Test',
          description: 'Test',
          timestamp: '2025-01-15T10:30:00.000Z',
        };
        assert.strictEqual(isIssueRecord(record), false);
      });

      it('should reject empty agent_name', () => {
        const record = {
          agent_name: '',
          scope: 'in-scope',
          priority: 'high',
          title: 'Test',
          description: 'Test',
          timestamp: '2025-01-15T10:30:00.000Z',
        };
        assert.strictEqual(isIssueRecord(record), false);
      });

      it('should reject invalid scope', () => {
        const record = {
          agent_name: 'code-reviewer',
          scope: 'invalid-scope',
          priority: 'high',
          title: 'Test',
          description: 'Test',
          timestamp: '2025-01-15T10:30:00.000Z',
        };
        assert.strictEqual(isIssueRecord(record), false);
      });

      it('should reject invalid priority', () => {
        const record = {
          agent_name: 'code-reviewer',
          scope: 'in-scope',
          priority: 'medium',
          title: 'Test',
          description: 'Test',
          timestamp: '2025-01-15T10:30:00.000Z',
        };
        assert.strictEqual(isIssueRecord(record), false);
      });

      it('should reject non-string location', () => {
        const record = {
          agent_name: 'code-reviewer',
          scope: 'in-scope',
          priority: 'high',
          title: 'Test',
          description: 'Test',
          location: 123,
          timestamp: '2025-01-15T10:30:00.000Z',
        };
        assert.strictEqual(isIssueRecord(record), false);
      });

      it('should reject non-object metadata', () => {
        const record = {
          agent_name: 'code-reviewer',
          scope: 'in-scope',
          priority: 'high',
          title: 'Test',
          description: 'Test',
          metadata: 'not an object',
          timestamp: '2025-01-15T10:30:00.000Z',
        };
        assert.strictEqual(isIssueRecord(record), false);
      });
    });
  });

  describe('isIssueRecordArray', () => {
    it('should accept empty array', () => {
      assert.strictEqual(isIssueRecordArray([]), true);
    });

    it('should accept array of valid issue records', () => {
      const records = [
        {
          agent_name: 'code-reviewer',
          scope: 'in-scope',
          priority: 'high',
          title: 'Issue 1',
          description: 'Description 1',
          timestamp: '2025-01-15T10:30:00.000Z',
        },
        {
          agent_name: 'code-simplifier',
          scope: 'out-of-scope',
          priority: 'low',
          title: 'Issue 2',
          description: 'Description 2',
          timestamp: '2025-01-15T10:31:00.000Z',
        },
      ];
      assert.strictEqual(isIssueRecordArray(records), true);
    });

    it('should reject non-array', () => {
      assert.strictEqual(isIssueRecordArray({}), false);
      assert.strictEqual(isIssueRecordArray('string'), false);
      assert.strictEqual(isIssueRecordArray(null), false);
    });

    it('should reject array with invalid record', () => {
      const records = [
        {
          agent_name: 'code-reviewer',
          scope: 'in-scope',
          priority: 'high',
          title: 'Issue 1',
          description: 'Description 1',
          timestamp: '2025-01-15T10:30:00.000Z',
        },
        {
          // Missing required fields
          agent_name: 'code-simplifier',
        },
      ];
      assert.strictEqual(isIssueRecordArray(records), false);
    });
  });

  // NOTE: Full behavioral testing of readManifestFiles and cleanupManifestFiles
  // requires integration tests with filesystem mocks. The core logic tested here:
  // 1. REVIEW_AGENT_NAMES contains all expected agents
  // 2. getCompletedAgents correctly identifies complete agents based on:
  //    - No in-scope manifest exists (complete)
  //    - In-scope manifest has zero high-priority issues (complete)
  //    - In-scope manifest has high-priority issues (incomplete)
  //    - Out-of-scope issues don't affect completion status
  // 3. isManifestFile correctly identifies valid manifest filenames
  // 4. parseManifestFilename correctly extracts agent name and scope
  // 5. isIssueRecord and isIssueRecordArray validate data structure
  //
  // Additional integration tests would cover:
  // - Reading manifest files from tmp/wiggum directory
  // - Handling malformed filenames gracefully
  // - Merging issues from multiple manifest files per agent
  // - Cleaning up manifest files after processing
  // - Handling filesystem errors gracefully
});
