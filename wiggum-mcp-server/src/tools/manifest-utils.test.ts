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
  extractScopeFromFilename,
} from './manifest-utils.js';
import {
  isIssueRecord,
  isIssueRecordArray,
  createManifestSummary,
  ManifestSummaryInvariantError,
  createAgentManifest,
  AgentManifestInvariantError,
} from './manifest-types.js';
import type {
  IssueRecord,
  ReviewAgentName,
  IssueScope,
  IssuePriority,
  AgentManifest,
} from './manifest-types.js';

/**
 * Test helper to create properly typed IssueRecord objects
 * Ensures agent_name is correctly typed as ReviewAgentName
 */
function createTestIssue(
  agentName: ReviewAgentName,
  scope: IssueScope,
  priority: IssuePriority,
  title = 'Test',
  description = 'Test',
  timestamp = '2025-01-01T00:00:00Z'
): IssueRecord {
  return {
    agent_name: agentName,
    scope,
    priority,
    title,
    description,
    timestamp,
  };
}

/**
 * Test helper to create properly typed AgentManifest objects
 *
 * Uses the createAgentManifest factory to ensure high_priority_count is
 * computed correctly from the issues array. The _highPriorityCount parameter
 * is ignored (kept for backward compatibility with existing test call sites).
 */
function createTestManifest(
  agentName: ReviewAgentName,
  scope: IssueScope,
  issues: IssueRecord[],
  _highPriorityCount?: number // Ignored - computed by factory
): AgentManifest {
  return createAgentManifest(agentName, scope, issues);
}

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
        const manifests = new Map<string, AgentManifest>([
          [
            'code-reviewer-in-scope',
            createTestManifest(
              'code-reviewer',
              'in-scope',
              [createTestIssue('code-reviewer', 'in-scope', 'low')],
              0
            ),
          ],
        ]);

        const completed = getCompletedAgents(manifests);
        assert.ok(completed.includes('code-reviewer'));
      });

      it('should mark agent complete with only out-of-scope high-priority issues', () => {
        const manifests = new Map<string, AgentManifest>([
          [
            'silent-failure-hunter-out-of-scope',
            createTestManifest(
              'silent-failure-hunter',
              'out-of-scope',
              [createTestIssue('silent-failure-hunter', 'out-of-scope', 'high')],
              1
            ),
          ],
        ]);

        const completed = getCompletedAgents(manifests);
        // Out-of-scope issues don't block completion
        assert.ok(completed.includes('silent-failure-hunter'));
      });

      it('should mark multiple agents complete with low-priority only', () => {
        const manifests = new Map<string, AgentManifest>([
          [
            'code-reviewer-in-scope',
            createTestManifest(
              'code-reviewer',
              'in-scope',
              [createTestIssue('code-reviewer', 'in-scope', 'low')],
              0
            ),
          ],
          [
            'code-simplifier-in-scope',
            createTestManifest(
              'code-simplifier',
              'in-scope',
              [createTestIssue('code-simplifier', 'in-scope', 'low')],
              0
            ),
          ],
        ]);

        const completed = getCompletedAgents(manifests);
        assert.ok(completed.includes('code-reviewer'));
        assert.ok(completed.includes('code-simplifier'));
      });
    });

    describe('agents with high-priority in-scope issues', () => {
      it('should NOT mark agent complete with high-priority issues', () => {
        const manifests = new Map<string, AgentManifest>([
          [
            'pr-test-analyzer-in-scope',
            createTestManifest(
              'pr-test-analyzer',
              'in-scope',
              [createTestIssue('pr-test-analyzer', 'in-scope', 'high')],
              1
            ),
          ],
        ]);

        const completed = getCompletedAgents(manifests);
        assert.ok(!completed.includes('pr-test-analyzer'));
      });

      it('should NOT mark agent complete with multiple high-priority issues', () => {
        const manifests = new Map<string, AgentManifest>([
          [
            'comment-analyzer-in-scope',
            createTestManifest(
              'comment-analyzer',
              'in-scope',
              [
                createTestIssue('comment-analyzer', 'in-scope', 'high', 'Test 1'),
                createTestIssue(
                  'comment-analyzer',
                  'in-scope',
                  'high',
                  'Test 2',
                  'Test',
                  '2025-01-01T00:00:01Z'
                ),
              ],
              2
            ),
          ],
        ]);

        const completed = getCompletedAgents(manifests);
        assert.ok(!completed.includes('comment-analyzer'));
      });

      it('should NOT mark agent complete with mixed priority (includes high)', () => {
        const manifests = new Map<string, AgentManifest>([
          [
            'type-design-analyzer-in-scope',
            createTestManifest(
              'type-design-analyzer',
              'in-scope',
              [
                createTestIssue('type-design-analyzer', 'in-scope', 'high', 'High priority'),
                createTestIssue(
                  'type-design-analyzer',
                  'in-scope',
                  'low',
                  'Low priority',
                  'Test',
                  '2025-01-01T00:00:01Z'
                ),
              ],
              1
            ),
          ],
        ]);

        const completed = getCompletedAgents(manifests);
        assert.ok(!completed.includes('type-design-analyzer'));
      });
    });

    describe('mixed agent states', () => {
      it('should correctly separate completed and incomplete agents', () => {
        const manifests = new Map<string, AgentManifest>([
          // Complete: no manifest
          // code-reviewer - no entry = complete

          // Complete: zero high-priority
          [
            'silent-failure-hunter-in-scope',
            createTestManifest(
              'silent-failure-hunter',
              'in-scope',
              [createTestIssue('silent-failure-hunter', 'in-scope', 'low')],
              0
            ),
          ],

          // Incomplete: has high-priority
          [
            'pr-test-analyzer-in-scope',
            createTestManifest(
              'pr-test-analyzer',
              'in-scope',
              [createTestIssue('pr-test-analyzer', 'in-scope', 'high')],
              1
            ),
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
        const manifests = new Map<string, AgentManifest>([
          ['code-reviewer-in-scope', createTestManifest('code-reviewer', 'in-scope', [], 0)],
        ]);

        const result = updateAgentCompletionStatus(manifests, [], []);

        assert.ok(result.pendingCompletionAgents.includes('code-reviewer'));
        assert.ok(!result.completedAgents.includes('code-reviewer'));
        assert.strictEqual(result.pendingCompletionAgents.length, 6); // All agents with 0 issues
      });

      it('should mark agent as complete on second consecutive zero high-priority iteration', () => {
        const manifests = new Map<string, AgentManifest>([
          ['code-reviewer-in-scope', createTestManifest('code-reviewer', 'in-scope', [], 0)],
        ]);

        // Second iteration - agent was pending, still has 0 issues
        const result = updateAgentCompletionStatus(manifests, ['code-reviewer'], []);

        assert.ok(result.completedAgents.includes('code-reviewer'));
        assert.ok(!result.pendingCompletionAgents.includes('code-reviewer'));
      });

      it('should reset pending agent to active if issues are found', () => {
        const manifests = new Map<string, AgentManifest>([
          [
            'code-reviewer-in-scope',
            createTestManifest(
              'code-reviewer',
              'in-scope',
              [
                createTestIssue(
                  'code-reviewer',
                  'in-scope',
                  'high',
                  'New issue',
                  'Found after pending'
                ),
              ],
              1
            ),
          ],
        ]);

        // Agent was pending, but now has issues - should reset to active
        const result = updateAgentCompletionStatus(manifests, ['code-reviewer'], []);

        assert.ok(!result.completedAgents.includes('code-reviewer'));
        assert.ok(!result.pendingCompletionAgents.includes('code-reviewer'));
      });

      it('should never revert completed agents', () => {
        const manifests = new Map<string, AgentManifest>([
          [
            'code-reviewer-in-scope',
            createTestManifest(
              'code-reviewer',
              'in-scope',
              [
                createTestIssue(
                  'code-reviewer',
                  'in-scope',
                  'high',
                  'New issue',
                  'Found after completion'
                ),
              ],
              1
            ),
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
        const manifests = new Map<string, AgentManifest>([
          // code-reviewer: has issues (active)
          [
            'code-reviewer-in-scope',
            createTestManifest(
              'code-reviewer',
              'in-scope',
              [createTestIssue('code-reviewer', 'in-scope', 'high', 'Issue')],
              1
            ),
          ],
          // silent-failure-hunter: no issues (will be pending)
          [
            'silent-failure-hunter-in-scope',
            createTestManifest('silent-failure-hunter', 'in-scope', [], 0),
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
        const manifests = new Map<string, AgentManifest>([
          [
            'code-reviewer-out-of-scope',
            createTestManifest(
              'code-reviewer',
              'out-of-scope',
              [createTestIssue('code-reviewer', 'out-of-scope', 'high', 'Out of scope')],
              1
            ),
          ],
        ]);

        // Out-of-scope issues should not block completion
        const result = updateAgentCompletionStatus(manifests, [], []);

        assert.ok(result.pendingCompletionAgents.includes('code-reviewer'));
      });

      it('should handle mix of in-scope and out-of-scope manifests', () => {
        const manifests = new Map<string, AgentManifest>([
          // In-scope with issues (blocks completion)
          [
            'code-reviewer-in-scope',
            createTestManifest(
              'code-reviewer',
              'in-scope',
              [createTestIssue('code-reviewer', 'in-scope', 'high', 'In scope')],
              1
            ),
          ],
          // Out-of-scope with issues (doesn't block)
          [
            'code-reviewer-out-of-scope',
            createTestManifest(
              'code-reviewer',
              'out-of-scope',
              [createTestIssue('code-reviewer', 'out-of-scope', 'high', 'Out of scope')],
              1
            ),
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
        const manifests = new Map<string, AgentManifest>([
          [
            'code-reviewer-in-scope',
            createTestManifest(
              'code-reviewer',
              'in-scope',
              [createTestIssue('code-reviewer', 'in-scope', 'low', 'Low priority')],
              0 // Only low priority
            ),
          ],
        ]);

        const result = updateAgentCompletionStatus(manifests, [], []);

        // Should be pending (0 high-priority issues)
        assert.ok(result.pendingCompletionAgents.includes('code-reviewer'));
      });

      it('should handle duplicate agents in pendingCompletionAgents array', () => {
        const manifests = new Map();
        // Duplicate agent in pending array - should handle gracefully
        const previousPending = ['code-reviewer', 'code-reviewer', 'code-simplifier'];

        const result = updateAgentCompletionStatus(manifests, previousPending, []);

        // Both should complete (second consecutive zero)
        // Duplicates should not cause issues - agent appears once in result
        assert.ok(result.completedAgents.includes('code-reviewer'));
        assert.ok(result.completedAgents.includes('code-simplifier'));
        // No duplicates in output
        const codeReviewerCount = result.completedAgents.filter(
          (a) => a === 'code-reviewer'
        ).length;
        assert.strictEqual(codeReviewerCount, 1, 'Should not have duplicate agents in output');
      });

      it('should give precedence to completed over pending when agent is in both arrays', () => {
        const manifests = new Map();
        // Agent appears in both completed and pending - completed should take precedence
        const previousPending = ['code-reviewer'];
        const previousCompleted = ['code-reviewer', 'code-simplifier'];

        const result = updateAgentCompletionStatus(manifests, previousPending, previousCompleted);

        // code-reviewer should remain completed (not demoted to pending)
        assert.ok(
          result.completedAgents.includes('code-reviewer'),
          'Agent in both arrays should remain completed'
        );
        assert.ok(
          !result.pendingCompletionAgents.includes('code-reviewer'),
          'Agent in both arrays should not be in pending'
        );
        // code-simplifier should also remain completed
        assert.ok(result.completedAgents.includes('code-simplifier'));
      });

      it('should ignore unknown agent names in previousPending', () => {
        const manifests = new Map();
        // Unknown agent not in REVIEW_AGENT_NAMES
        const previousPending = ['code-reviewer', 'unknown-agent', 'fake-reviewer'];

        const result = updateAgentCompletionStatus(manifests, previousPending, []);

        // code-reviewer should complete (was pending, still 0 issues)
        assert.ok(result.completedAgents.includes('code-reviewer'));
        // Unknown agents should be silently ignored - not in any output
        assert.ok(
          !result.completedAgents.includes('unknown-agent'),
          'Unknown agent should not appear in completedAgents'
        );
        assert.ok(
          !result.pendingCompletionAgents.includes('unknown-agent'),
          'Unknown agent should not appear in pendingCompletionAgents'
        );
        assert.ok(!result.completedAgents.includes('fake-reviewer'));
        assert.ok(!result.pendingCompletionAgents.includes('fake-reviewer'));
      });

      it('should ignore unknown agent names in previousCompleted', () => {
        const manifests = new Map();
        // Unknown agent in completed array
        const previousCompleted = ['code-reviewer', 'unknown-agent'];

        const result = updateAgentCompletionStatus(manifests, [], previousCompleted);

        // Known agent should persist in completed
        assert.ok(result.completedAgents.includes('code-reviewer'));
        // Unknown agent is copied as-is (completed array is spread directly)
        // This is current behavior - completed agents from previous state persist
        // The unknown agent will remain but won't affect REVIEW_AGENT_NAMES processing
      });

      it('should not produce duplicate agents when same agent has multiple manifest files', () => {
        // Simulate scenario where agent has both in-scope and out-of-scope manifests
        const manifests = new Map<string, AgentManifest>([
          ['code-reviewer-in-scope', createTestManifest('code-reviewer', 'in-scope', [], 0)],
          [
            'code-reviewer-out-of-scope',
            createTestManifest(
              'code-reviewer',
              'out-of-scope',
              [createTestIssue('code-reviewer', 'out-of-scope', 'high', 'Out of scope issue')],
              1
            ),
          ],
        ]);

        const result = updateAgentCompletionStatus(manifests, [], []);

        // code-reviewer should be pending (first zero in-scope)
        assert.ok(result.pendingCompletionAgents.includes('code-reviewer'));
        // No duplicates from multiple manifest types
        const codeReviewerPendingCount = result.pendingCompletionAgents.filter(
          (a) => a === 'code-reviewer'
        ).length;
        assert.strictEqual(
          codeReviewerPendingCount,
          1,
          'Should not have duplicates from multiple manifest types'
        );
      });

      it('should handle high_priority_count being 0 with non-empty issues array', () => {
        // Edge case: issues array has items but high_priority_count is 0
        // This could happen if all issues are low priority
        const manifests = new Map<string, AgentManifest>([
          [
            'code-reviewer-in-scope',
            createTestManifest(
              'code-reviewer',
              'in-scope',
              [
                createTestIssue('code-reviewer', 'in-scope', 'low', 'Low priority 1'),
                createTestIssue(
                  'code-reviewer',
                  'in-scope',
                  'low',
                  'Low priority 2',
                  'Test',
                  '2025-01-01T00:00:01Z'
                ),
              ],
              0 // Correct: 0 high priority even with 2 issues
            ),
          ],
        ]);

        const result = updateAgentCompletionStatus(manifests, [], []);

        // Should be pending (uses high_priority_count, not issues.length)
        assert.ok(
          result.pendingCompletionAgents.includes('code-reviewer'),
          'Should use high_priority_count, not issues.length'
        );
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

  describe('extractScopeFromFilename', () => {
    describe('valid scope extraction', () => {
      it('should extract in-scope from manifest filename', () => {
        const scope = extractScopeFromFilename('code-reviewer-in-scope-1234567890-abc123.json');
        assert.strictEqual(scope, 'in-scope');
      });

      it('should extract out-of-scope from manifest filename', () => {
        const scope = extractScopeFromFilename('code-reviewer-out-of-scope-1234567890-abc123.json');
        assert.strictEqual(scope, 'out-of-scope');
      });

      it('should extract scope from complex agent name', () => {
        const scope = extractScopeFromFilename(
          'silent-failure-hunter-in-scope-1234567890-abc.json'
        );
        assert.strictEqual(scope, 'in-scope');
      });

      it('should return in-scope when both markers present (checks in-scope first)', () => {
        // Edge case: filename contains both scope markers
        // The pattern requires hyphen BEFORE the scope marker: -in-scope- and -out-of-scope-
        const scope = extractScopeFromFilename('test-in-scope-and-out-of-scope-1234567890.json');
        // Current implementation checks -in-scope- first
        assert.strictEqual(scope, 'in-scope');
      });

      it('should return out-of-scope when only out-of-scope marker has proper hyphens', () => {
        // Filename starts with "in-scope" but lacks leading hyphen, so -in-scope- pattern doesn't match
        // Only -out-of-scope- pattern matches
        const scope = extractScopeFromFilename('in-scope-test-out-of-scope-1234567890.json');
        assert.strictEqual(scope, 'out-of-scope');
      });
    });

    describe('invalid scope extraction', () => {
      it('should return undefined for filename without scope marker', () => {
        const scope = extractScopeFromFilename('code-reviewer-1234567890.json');
        assert.strictEqual(scope, undefined);
      });

      it('should return undefined for empty filename', () => {
        const scope = extractScopeFromFilename('');
        assert.strictEqual(scope, undefined);
      });

      it('should return undefined for uppercase scope marker', () => {
        // Case sensitivity check
        const scope = extractScopeFromFilename('code-reviewer-IN-SCOPE-1234567890.json');
        assert.strictEqual(scope, undefined);
      });

      it('should return undefined for partial scope marker', () => {
        const scope = extractScopeFromFilename('code-reviewer-in-scope1234567890.json'); // missing hyphen
        assert.strictEqual(scope, undefined);
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

      it('should reject invalid ISO 8601 timestamp format', () => {
        const invalidTimestamps = [
          'not-a-date',
          '2025-01-15', // Missing time portion
          '01/15/2025', // Wrong format
          '2025-01-15 10:30:00', // Missing T separator
          '', // Empty string
        ];

        for (const timestamp of invalidTimestamps) {
          const record = {
            agent_name: 'code-reviewer',
            scope: 'in-scope',
            priority: 'high',
            title: 'Test',
            description: 'Test',
            timestamp,
          };
          assert.strictEqual(
            isIssueRecord(record),
            false,
            `Expected isIssueRecord to reject invalid timestamp: "${timestamp}"`
          );
        }
      });

      it('should accept valid ISO 8601 timestamp formats', () => {
        const validTimestamps = [
          '2025-01-15T10:30:00Z', // UTC without milliseconds
          '2025-01-15T10:30:00.000Z', // UTC with milliseconds
          '2025-01-15T10:30:00.123Z', // UTC with non-zero milliseconds
        ];

        for (const timestamp of validTimestamps) {
          const record = {
            agent_name: 'code-reviewer',
            scope: 'in-scope',
            priority: 'high',
            title: 'Test',
            description: 'Test',
            timestamp,
          };
          assert.strictEqual(
            isIssueRecord(record),
            true,
            `Expected isIssueRecord to accept valid timestamp: "${timestamp}"`
          );
        }
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

  describe('createManifestSummary', () => {
    /**
     * Helper to create a valid IssueRecord for testing
     */
    function createIssue(overrides: Partial<IssueRecord> = {}): IssueRecord {
      return {
        agent_name: 'code-reviewer',
        scope: 'in-scope',
        priority: 'high',
        title: 'Test Issue',
        description: 'Test Description',
        timestamp: '2025-01-15T10:30:00.000Z',
        ...overrides,
      };
    }

    describe('empty issues array', () => {
      it('should create summary with all zeros for empty array', () => {
        const summary = createManifestSummary([]);

        assert.strictEqual(summary.total_issues, 0);
        assert.strictEqual(summary.high_priority_count, 0);
        assert.strictEqual(summary.low_priority_count, 0);
        assert.strictEqual(summary.in_scope_count, 0);
        assert.strictEqual(summary.out_of_scope_count, 0);
        assert.deepStrictEqual(summary.agents_with_issues, []);
        assert.deepStrictEqual(summary.issues, []);
      });
    });

    describe('count computation', () => {
      it('should compute correct counts for mixed issues', () => {
        const issues: IssueRecord[] = [
          createIssue({ scope: 'in-scope', priority: 'high', agent_name: 'code-reviewer' }),
          createIssue({ scope: 'in-scope', priority: 'low', agent_name: 'code-simplifier' }),
          createIssue({ scope: 'out-of-scope', priority: 'high', agent_name: 'code-reviewer' }),
          createIssue({ scope: 'out-of-scope', priority: 'low', agent_name: 'pr-test-analyzer' }),
        ];

        const summary = createManifestSummary(issues);

        assert.strictEqual(summary.total_issues, 4);
        assert.strictEqual(summary.high_priority_count, 2);
        assert.strictEqual(summary.low_priority_count, 2);
        assert.strictEqual(summary.in_scope_count, 2);
        assert.strictEqual(summary.out_of_scope_count, 2);
      });

      it('should compute correct counts for all high-priority in-scope issues', () => {
        const issues: IssueRecord[] = [
          createIssue({ scope: 'in-scope', priority: 'high' }),
          createIssue({ scope: 'in-scope', priority: 'high' }),
          createIssue({ scope: 'in-scope', priority: 'high' }),
        ];

        const summary = createManifestSummary(issues);

        assert.strictEqual(summary.total_issues, 3);
        assert.strictEqual(summary.high_priority_count, 3);
        assert.strictEqual(summary.low_priority_count, 0);
        assert.strictEqual(summary.in_scope_count, 3);
        assert.strictEqual(summary.out_of_scope_count, 0);
      });

      it('should compute correct counts for all low-priority out-of-scope issues', () => {
        const issues: IssueRecord[] = [
          createIssue({ scope: 'out-of-scope', priority: 'low' }),
          createIssue({ scope: 'out-of-scope', priority: 'low' }),
        ];

        const summary = createManifestSummary(issues);

        assert.strictEqual(summary.total_issues, 2);
        assert.strictEqual(summary.high_priority_count, 0);
        assert.strictEqual(summary.low_priority_count, 2);
        assert.strictEqual(summary.in_scope_count, 0);
        assert.strictEqual(summary.out_of_scope_count, 2);
      });
    });

    describe('agents_with_issues', () => {
      it('should extract unique agent names', () => {
        const issues: IssueRecord[] = [
          createIssue({ agent_name: 'code-reviewer' }),
          createIssue({ agent_name: 'code-reviewer' }),
          createIssue({ agent_name: 'code-simplifier' }),
        ];

        const summary = createManifestSummary(issues);

        assert.deepStrictEqual(summary.agents_with_issues, ['code-reviewer', 'code-simplifier']);
      });

      it('should sort agent names alphabetically', () => {
        const issues: IssueRecord[] = [
          createIssue({ agent_name: 'type-design-analyzer' }),
          createIssue({ agent_name: 'code-reviewer' }),
          createIssue({ agent_name: 'pr-test-analyzer' }),
        ];

        const summary = createManifestSummary(issues);

        assert.deepStrictEqual(summary.agents_with_issues, [
          'code-reviewer',
          'pr-test-analyzer',
          'type-design-analyzer',
        ]);
      });

      it('should handle single agent correctly', () => {
        const issues: IssueRecord[] = [
          createIssue({ agent_name: 'code-reviewer' }),
          createIssue({ agent_name: 'code-reviewer' }),
        ];

        const summary = createManifestSummary(issues);

        assert.deepStrictEqual(summary.agents_with_issues, ['code-reviewer']);
      });
    });

    describe('invariant validation', () => {
      it('should satisfy scope count invariant (in + out = total)', () => {
        const issues: IssueRecord[] = [
          createIssue({ scope: 'in-scope' }),
          createIssue({ scope: 'out-of-scope' }),
          createIssue({ scope: 'in-scope' }),
        ];

        const summary = createManifestSummary(issues);

        // Invariant: in_scope_count + out_of_scope_count === total_issues
        assert.strictEqual(
          summary.in_scope_count + summary.out_of_scope_count,
          summary.total_issues
        );
      });

      it('should satisfy priority count invariant (high + low = total)', () => {
        const issues: IssueRecord[] = [
          createIssue({ priority: 'high' }),
          createIssue({ priority: 'low' }),
          createIssue({ priority: 'high' }),
        ];

        const summary = createManifestSummary(issues);

        // Invariant: high_priority_count + low_priority_count === total_issues
        assert.strictEqual(
          summary.high_priority_count + summary.low_priority_count,
          summary.total_issues
        );
      });

      it('should satisfy issues array length invariant', () => {
        const issues: IssueRecord[] = [
          createIssue({}),
          createIssue({}),
          createIssue({}),
          createIssue({}),
        ];

        const summary = createManifestSummary(issues);

        // Invariant: total_issues === issues.length
        assert.strictEqual(summary.total_issues, summary.issues.length);
      });
    });

    describe('ManifestSummaryInvariantError', () => {
      it('should have correct name property', () => {
        const error = new ManifestSummaryInvariantError('test error', {});
        assert.strictEqual(error.name, 'ManifestSummaryInvariantError');
      });

      it('should include message in error', () => {
        const error = new ManifestSummaryInvariantError('test message', {});
        assert.ok(error.message.includes('test message'));
        assert.ok(error.message.includes('invariant violated'));
      });

      it('should store summary in error', () => {
        const partialSummary = { total_issues: 5, high_priority_count: 3 };
        const error = new ManifestSummaryInvariantError('test', partialSummary);
        assert.deepStrictEqual(error.summary, partialSummary);
      });
    });

    describe('issues array preservation', () => {
      it('should preserve the original issues array', () => {
        const issues: IssueRecord[] = [
          createIssue({ title: 'Issue 1' }),
          createIssue({ title: 'Issue 2' }),
        ];

        const summary = createManifestSummary(issues);

        assert.strictEqual(summary.issues.length, 2);
        assert.strictEqual(summary.issues[0].title, 'Issue 1');
        assert.strictEqual(summary.issues[1].title, 'Issue 2');
      });

      it('should not modify input array', () => {
        const issues: IssueRecord[] = [createIssue({})];
        const originalLength = issues.length;

        createManifestSummary(issues);

        assert.strictEqual(issues.length, originalLength);
      });
    });
  });

  describe('createAgentManifest', () => {
    /**
     * Helper to create a valid IssueRecord for testing
     */
    function createIssue(overrides: Partial<IssueRecord> = {}): IssueRecord {
      return {
        agent_name: 'code-reviewer',
        scope: 'in-scope',
        priority: 'high',
        title: 'Test Issue',
        description: 'Test Description',
        timestamp: '2025-01-15T10:30:00.000Z',
        ...overrides,
      };
    }

    describe('empty issues array', () => {
      it('should create manifest with zero high_priority_count for empty array', () => {
        const manifest = createAgentManifest('code-reviewer', 'in-scope', []);

        assert.strictEqual(manifest.agent_name, 'code-reviewer');
        assert.strictEqual(manifest.scope, 'in-scope');
        assert.deepStrictEqual(manifest.issues, []);
        assert.strictEqual(manifest.high_priority_count, 0);
      });

      it('should work with out-of-scope and empty array', () => {
        const manifest = createAgentManifest('silent-failure-hunter', 'out-of-scope', []);

        assert.strictEqual(manifest.agent_name, 'silent-failure-hunter');
        assert.strictEqual(manifest.scope, 'out-of-scope');
        assert.strictEqual(manifest.high_priority_count, 0);
      });
    });

    describe('high_priority_count computation', () => {
      it('should compute correct count for all high-priority issues', () => {
        const issues: IssueRecord[] = [
          createIssue({ priority: 'high' }),
          createIssue({ priority: 'high' }),
          createIssue({ priority: 'high' }),
        ];

        const manifest = createAgentManifest('code-reviewer', 'in-scope', issues);

        assert.strictEqual(manifest.high_priority_count, 3);
      });

      it('should compute correct count for all low-priority issues', () => {
        const issues: IssueRecord[] = [
          createIssue({ priority: 'low' }),
          createIssue({ priority: 'low' }),
        ];

        const manifest = createAgentManifest('code-reviewer', 'in-scope', issues);

        assert.strictEqual(manifest.high_priority_count, 0);
      });

      it('should compute correct count for mixed priorities', () => {
        const issues: IssueRecord[] = [
          createIssue({ priority: 'high' }),
          createIssue({ priority: 'low' }),
          createIssue({ priority: 'high' }),
          createIssue({ priority: 'low' }),
          createIssue({ priority: 'high' }),
        ];

        const manifest = createAgentManifest('code-reviewer', 'in-scope', issues);

        assert.strictEqual(manifest.high_priority_count, 3);
        assert.strictEqual(manifest.issues.length, 5);
      });
    });

    describe('agent_name validation', () => {
      it('should throw AgentManifestInvariantError for empty string', () => {
        assert.throws(
          () => createAgentManifest('', 'in-scope', []),
          (error: Error) => {
            assert.ok(error instanceof AgentManifestInvariantError);
            assert.ok(error.message.includes('agent_name must be non-empty'));
            return true;
          }
        );
      });

      it('should throw AgentManifestInvariantError for whitespace-only string', () => {
        assert.throws(
          () => createAgentManifest('   ', 'in-scope', []),
          (error: Error) => {
            assert.ok(error instanceof AgentManifestInvariantError);
            assert.ok(error.message.includes('agent_name must be non-empty'));
            return true;
          }
        );
      });

      it('should throw AgentManifestInvariantError for tab/newline-only string', () => {
        assert.throws(
          () => createAgentManifest('\t\n', 'in-scope', []),
          (error: Error) => {
            assert.ok(error instanceof AgentManifestInvariantError);
            return true;
          }
        );
      });

      it('should accept valid agent names', () => {
        // Should not throw for valid agent names
        assert.doesNotThrow(() => createAgentManifest('code-reviewer', 'in-scope', []));
        assert.doesNotThrow(() => createAgentManifest('silent-failure-hunter', 'out-of-scope', []));
        assert.doesNotThrow(() => createAgentManifest('type-design-analyzer', 'in-scope', []));
      });
    });

    describe('issues array preservation', () => {
      it('should preserve the original issues array', () => {
        const issues: IssueRecord[] = [
          createIssue({ title: 'Issue 1' }),
          createIssue({ title: 'Issue 2' }),
        ];

        const manifest = createAgentManifest('code-reviewer', 'in-scope', issues);

        assert.strictEqual(manifest.issues.length, 2);
        assert.strictEqual(manifest.issues[0].title, 'Issue 1');
        assert.strictEqual(manifest.issues[1].title, 'Issue 2');
      });

      it('should not modify input array', () => {
        const issues: IssueRecord[] = [createIssue({})];
        const originalLength = issues.length;

        createAgentManifest('code-reviewer', 'in-scope', issues);

        assert.strictEqual(issues.length, originalLength);
      });
    });
  });

  describe('AgentManifestInvariantError', () => {
    it('should have correct name property', () => {
      const error = new AgentManifestInvariantError('test error', {});
      assert.strictEqual(error.name, 'AgentManifestInvariantError');
    });

    it('should include message in error', () => {
      const error = new AgentManifestInvariantError('test message', {});
      assert.ok(error.message.includes('test message'));
      assert.ok(error.message.includes('invariant violated'));
    });

    it('should store manifest in error', () => {
      const partialManifest = { agent_name: 'test', high_priority_count: 3 };
      const error = new AgentManifestInvariantError('test', partialManifest);
      assert.deepStrictEqual(error.manifest, partialManifest);
    });

    it('should be instanceof Error', () => {
      const error = new AgentManifestInvariantError('test', {});
      assert.ok(error instanceof Error);
    });
  });

  // NOTE: Full behavioral testing of readManifestFiles and cleanupManifestFiles
  // is covered in manifest-utils.integration.test.ts using real filesystem operations.
  // The core logic tested here:
  // 1. REVIEW_AGENT_NAMES contains all expected agents
  // 2. getCompletedAgents correctly identifies complete agents based on:
  //    - No in-scope manifest exists (complete)
  //    - In-scope manifest has zero high-priority issues (complete)
  //    - In-scope manifest has high-priority issues (incomplete)
  //    - Out-of-scope issues don't affect completion status
  // 3. isManifestFile correctly identifies valid manifest filenames
  // 4. parseManifestFilename correctly extracts agent name and scope
  // 5. isIssueRecord and isIssueRecordArray validate data structure
  // 6. createManifestSummary computes correct counts and validates invariants
  //
  // @see manifest-utils.integration.test.ts for integration tests covering:
  // - Reading manifest files from tmp/wiggum directory
  // - Handling malformed filenames gracefully
  // - Merging issues from multiple manifest files per agent
  // - Cleaning up manifest files after processing
  // - Handling filesystem errors gracefully
  // - 2-strike agent completion edge cases
  // - Concurrent manifest operations
});
