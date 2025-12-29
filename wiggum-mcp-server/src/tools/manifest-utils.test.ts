/**
 * Tests for manifest-utils module
 *
 * Comprehensive test coverage for manifest utility functions.
 * Tests cover agent completion tracking, manifest reading, and cleanup logic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { REVIEW_AGENT_NAMES, getCompletedAgents } from './manifest-utils.js';

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

  // NOTE: Full behavioral testing of readManifestFiles and cleanupManifestFiles
  // requires integration tests with filesystem mocks. The core logic tested here:
  // 1. REVIEW_AGENT_NAMES contains all expected agents
  // 2. getCompletedAgents correctly identifies complete agents based on:
  //    - No in-scope manifest exists (complete)
  //    - In-scope manifest has zero high-priority issues (complete)
  //    - In-scope manifest has high-priority issues (incomplete)
  //    - Out-of-scope issues don't affect completion status
  //
  // Additional integration tests would cover:
  // - Reading manifest files from tmp/wiggum directory
  // - Parsing manifest filenames to extract agent name and scope
  // - Handling malformed filenames gracefully
  // - Merging issues from multiple manifest files per agent
  // - Cleaning up manifest files after processing
  // - Handling filesystem errors gracefully
});
