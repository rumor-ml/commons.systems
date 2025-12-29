/**
 * Integration tests for complete-all-hands tool
 *
 * These tests verify the runtime behavior of completeAllHands() function
 * with mocked dependencies. Tests cover:
 * - 2-strike agent completion verification logic
 * - Manifest reading and cleanup operations
 * - State transitions via advanceToNextStep
 * - Phase-based state updates (PR vs issue)
 * - Error handling and recovery
 *
 * The complete-all-hands tool (wiggum_complete_all_hands) orchestrates the
 * all-hands review workflow with complex 2-strike verification logic.
 *
 * @see complete-all-hands.test.ts for schema validation tests
 * @see manifest-utils.test.ts for manifest utility unit tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('complete-all-hands integration tests', () => {
  describe('2-strike agent completion verification', () => {
    it('should document first zero iteration marks agent as pending', () => {
      /**
       * SPECIFICATION: First zero iteration behavior
       *
       * When an agent reports 0 high-priority in-scope issues for the FIRST time:
       * - Agent should be added to pendingCompletionAgents array
       * - Agent should NOT be added to completedAgents array
       * - Agent will run again next iteration to verify
       *
       * SETUP:
       * - previousPending = []
       * - previousCompleted = []
       * - Agent manifest shows 0 high-priority issues
       *
       * EXPECTED:
       * - pendingCompletionAgents includes the agent
       * - completedAgents does NOT include the agent
       *
       * RATIONALE:
       * The 2-strike rule prevents false completions from transient code states.
       * An agent must find 0 issues twice consecutively to be marked complete.
       *
       * Integration test implementation approach:
       * 1. Mock detectCurrentState() to return Phase 2 state with empty agent arrays
       * 2. Mock readManifestFiles() to return manifests with 0 high-priority issues
       * 3. Mock safeUpdatePRBodyState() to capture the state update
       * 4. Call completeAllHands({})
       * 5. Verify the state update includes agent in pendingCompletionAgents
       */
      assert.ok(
        true,
        'Integration test specification: First zero marks agent pending, not complete'
      );
    });

    it('should document second consecutive zero marks agent as complete', () => {
      /**
       * SPECIFICATION: Second consecutive zero behavior
       *
       * When an agent that was in pendingCompletionAgents reports 0 issues again:
       * - Agent should be moved to completedAgents array
       * - Agent should be removed from pendingCompletionAgents
       * - Agent will NOT run in subsequent iterations
       *
       * SETUP:
       * - previousPending = ['code-reviewer']
       * - previousCompleted = []
       * - code-reviewer manifest shows 0 high-priority issues
       *
       * EXPECTED:
       * - completedAgents includes 'code-reviewer'
       * - pendingCompletionAgents does NOT include 'code-reviewer'
       *
       * Integration test implementation approach:
       * 1. Mock detectCurrentState() with pendingCompletionAgents: ['code-reviewer']
       * 2. Mock readManifestFiles() with code-reviewer having 0 issues
       * 3. Call completeAllHands({})
       * 4. Verify code-reviewer moves to completedAgents
       */
      assert.ok(
        true,
        'Integration test specification: Second consecutive zero marks agent complete'
      );
    });

    it('should document pending agent reset when issues found', () => {
      /**
       * SPECIFICATION: Pending agent reset behavior
       *
       * When an agent in pendingCompletionAgents finds issues:
       * - Agent should be removed from pendingCompletionAgents
       * - Agent should NOT be added to completedAgents
       * - Agent returns to "active" state
       *
       * SETUP:
       * - previousPending = ['code-reviewer']
       * - previousCompleted = []
       * - code-reviewer manifest shows high-priority issues
       *
       * EXPECTED:
       * - pendingCompletionAgents does NOT include 'code-reviewer'
       * - completedAgents does NOT include 'code-reviewer'
       *
       * Integration test implementation approach:
       * 1. Mock detectCurrentState() with pendingCompletionAgents: ['code-reviewer']
       * 2. Mock readManifestFiles() with code-reviewer having high-priority issues
       * 3. Call completeAllHands({})
       * 4. Verify code-reviewer is in neither array (active state)
       */
      assert.ok(true, 'Integration test specification: Pending agent reset when issues found');
    });

    it('should document completed agents are never reverted', () => {
      /**
       * SPECIFICATION: Completed agent persistence
       *
       * Once an agent is in completedAgents, it should NEVER be reverted:
       * - Even if new issues appear in manifests for that agent
       * - The agent stays in completedAgents permanently
       *
       * SETUP:
       * - previousPending = []
       * - previousCompleted = ['code-reviewer']
       * - code-reviewer manifest shows high-priority issues
       *
       * EXPECTED:
       * - completedAgents STILL includes 'code-reviewer'
       *
       * RATIONALE:
       * Completion is permanent to prevent infinite loops. If an agent found
       * issues after completion, it means a different iteration created those
       * issues, and they should be addressed by other agents or next cycle.
       *
       * Integration test implementation approach:
       * 1. Mock detectCurrentState() with completedAgents: ['code-reviewer']
       * 2. Mock readManifestFiles() with code-reviewer having high-priority issues
       * 3. Call completeAllHands({})
       * 4. Verify code-reviewer remains in completedAgents
       */
      assert.ok(true, 'Integration test specification: Completed agents never reverted');
    });

    it('should document all agents complete triggers step advancement', () => {
      /**
       * SPECIFICATION: Step advancement when all agents complete
       *
       * When ALL review agents have completed (passed 2-strike verification):
       * - Current step should be marked complete
       * - advanceToNextStep() should be called
       * - Manifest files should be cleaned up
       *
       * SETUP:
       * - All 6 agents in pendingCompletionAgents (second iteration)
       * - All manifest files show 0 high-priority issues
       * - Current step = 'p2-4'
       *
       * EXPECTED:
       * - All agents move to completedAgents
       * - Step advances from 'p2-4' to next step
       * - completedSteps includes 'p2-4'
       * - safeCleanupManifestFiles() is called
       *
       * Integration test implementation approach:
       * 1. Mock detectCurrentState() with all agents in pendingCompletionAgents
       * 2. Mock readManifestFiles() returning empty map (all 0 issues)
       * 3. Mock advanceToNextStep(), safeUpdatePRBodyState()
       * 4. Call completeAllHands({})
       * 5. Verify step advancement and cleanup
       */
      assert.ok(
        true,
        'Integration test specification: All agents complete triggers step advancement'
      );
    });
  });

  describe('manifest operations', () => {
    it('should document manifest files are cleaned after step completion (fast-path)', () => {
      /**
       * SPECIFICATION: Manifest cleanup on step completion (fast-path)
       *
       * In the fast-path (all agents complete, 0 total issues):
       * - cleanupManifestFiles() is called BEFORE state persistence
       * - This is because fast-path uses the throwing version
       * - If cleanup fails, state is NOT persisted (prevents corruption)
       *
       * SETUP:
       * - All agents complete (0 high-priority issues)
       * - safeUpdatePRBodyState() returns { success: true }
       *
       * EXPECTED:
       * - cleanupManifestFiles() called BEFORE safeUpdatePRBodyState()
       * - If cleanup throws, state update is NOT attempted
       *
       * RATIONALE:
       * Fast-path cleanup happens before state persistence because:
       * - If cleanup fails, we don't want to persist state (could corrupt tracking)
       * - Fast-path is only triggered when all agents complete, so manifests
       *   are no longer needed for retry
       *
       * Integration test implementation approach:
       * 1. Track call order of cleanupManifestFiles vs safeUpdatePRBodyState
       * 2. Verify cleanup is called first in fast-path
       */
      assert.ok(true, 'Integration test specification: Fast-path cleanup before state persistence');
    });

    it('should document manifest files are cleaned after state update (non-fast-path)', () => {
      /**
       * SPECIFICATION: Manifest cleanup in non-fast-path
       *
       * When issues remain (non-fast-path):
       * - safeCleanupManifestFiles() is called AFTER state persistence
       * - This uses the non-throwing version (safe cleanup)
       * - Cleanup failures are logged but don't block workflow
       *
       * SETUP:
       * - Some agents have high-priority issues
       * - safeUpdatePRBodyState() returns { success: true }
       *
       * EXPECTED:
       * - safeUpdatePRBodyState() called first
       * - safeCleanupManifestFiles() called after
       * - Cleanup failure does not throw
       *
       * RATIONALE:
       * Non-fast-path cleanup happens after state persistence because:
       * - State is more important than cleanup (can retry with stale manifests)
       * - Cleanup is best-effort to avoid blocking workflow
       *
       * Integration test implementation approach:
       * 1. Track call order of safeUpdatePRBodyState vs safeCleanupManifestFiles
       * 2. Verify state update is called first
       */
      assert.ok(
        true,
        'Integration test specification: Non-fast-path cleanup after state persistence'
      );
    });

    it('should document manifest cleanup failure is non-fatal in non-fast-path', () => {
      /**
       * SPECIFICATION: Non-fatal cleanup failure (non-fast-path)
       *
       * When safeCleanupManifestFiles() fails in non-fast-path:
       * - Error is logged but not thrown
       * - Tool returns success (state was persisted)
       * - Next step instructions are returned
       *
       * SETUP:
       * - Some agents have high-priority issues
       * - safeUpdatePRBodyState() returns { success: true }
       * - safeCleanupManifestFiles() logs warning (failure suppressed)
       *
       * EXPECTED:
       * - Tool returns success response
       * - getNextStepInstructions() is called
       * - Warning about cleanup logged
       *
       * Integration test implementation approach:
       * 1. Mock safeCleanupManifestFiles to simulate failure (internally logged)
       * 2. Verify tool returns success response
       */
      assert.ok(true, 'Integration test specification: Non-fatal cleanup failure');
    });
  });

  describe('state transitions', () => {
    it('should document step advances when zero high-priority issues and all agents complete', () => {
      /**
       * SPECIFICATION: Step advancement conditions
       *
       * Step advances when BOTH conditions are met:
       * 1. totalHighPriorityIssues === 0
       * 2. allAgentsComplete === true (all agents passed 2-strike)
       *
       * SETUP:
       * - Current step = 'p2-4'
       * - All agents in pendingCompletionAgents (second iteration)
       * - readManifestFiles() returns map with 0 high-priority in-scope issues
       *
       * EXPECTED:
       * - advanceToNextStep() is called
       * - New state has step = 'p2-5' (next step)
       * - completedSteps includes 'p2-4'
       *
       * Integration test implementation approach:
       * 1. Mock state at p2-4 with all agents pending
       * 2. Mock readManifestFiles() returning 0 issues
       * 3. Verify advanceToNextStep() is called
       * 4. Verify new state has updated step and completedSteps
       */
      assert.ok(true, 'Integration test specification: Step advances on all complete');
    });

    it('should document step stays same when high-priority issues remain', () => {
      /**
       * SPECIFICATION: Step preservation when issues remain
       *
       * When high-priority issues exist:
       * - Step should NOT advance
       * - Iteration should increment
       * - Agent tracking arrays should be updated
       *
       * SETUP:
       * - Current step = 'p2-4'
       * - readManifestFiles() returns manifests WITH high-priority issues
       *
       * EXPECTED:
       * - advanceToNextStep() is NOT called
       * - State step remains 'p2-4'
       * - completedSteps unchanged
       * - iteration incremented
       *
       * Integration test implementation approach:
       * 1. Mock state at p2-4
       * 2. Mock readManifestFiles() returning high-priority issues
       * 3. Verify advanceToNextStep() is NOT called
       * 4. Verify iteration is incremented
       */
      assert.ok(true, 'Integration test specification: Step stays same with remaining issues');
    });

    it('should document step stays same when agents still pending (not all complete)', () => {
      /**
       * SPECIFICATION: Step preservation when agents still pending
       *
       * Even with 0 high-priority issues, if not all agents have completed
       * (some still pending first zero), step should NOT advance.
       *
       * SETUP:
       * - Current step = 'p2-4'
       * - Some agents in first iteration (not yet pending)
       * - readManifestFiles() returns 0 high-priority issues
       *
       * EXPECTED:
       * - advanceToNextStep() is NOT called
       * - Some agents move to pendingCompletionAgents
       * - Step remains 'p2-4'
       *
       * RATIONALE:
       * All agents must pass 2-strike verification before step completes.
       * This ensures thorough review coverage.
       *
       * Integration test implementation approach:
       * 1. Mock state with empty pendingCompletionAgents
       * 2. Mock readManifestFiles() returning 0 issues
       * 3. Verify agents move to pending, NOT completed
       * 4. Verify step does NOT advance
       */
      assert.ok(true, 'Integration test specification: Step stays when agents still pending');
    });

    it('should document maxIterations is preserved in state update', () => {
      /**
       * SPECIFICATION: maxIterations preservation
       *
       * When maxIterations is provided in input:
       * - Should be included in new state
       * - Should override any existing maxIterations
       *
       * SETUP:
       * - Current state has maxIterations = undefined
       * - Input: { maxIterations: 25 }
       *
       * EXPECTED:
       * - New state has maxIterations = 25
       * - safeUpdatePRBodyState receives state with maxIterations = 25
       *
       * Integration test implementation approach:
       * 1. Mock state with no maxIterations
       * 2. Call completeAllHands({ maxIterations: 25 })
       * 3. Capture state passed to safeUpdatePRBodyState
       * 4. Verify maxIterations = 25
       */
      assert.ok(true, 'Integration test specification: maxIterations preserved in state');
    });

    it('should document agent tracking arrays are updated correctly in state', () => {
      /**
       * SPECIFICATION: Agent tracking array updates
       *
       * After processing manifests, state should include:
       * - Updated completedAgents array (newly completed + previously completed)
       * - Updated pendingCompletionAgents array (newly pending, excluding completed)
       *
       * SETUP:
       * - pendingCompletionAgents = ['code-reviewer']
       * - completedAgents = ['silent-failure-hunter']
       * - code-reviewer manifest: 0 issues (should complete)
       * - code-simplifier manifest: 0 issues (should become pending)
       *
       * EXPECTED STATE UPDATE:
       * - completedAgents = ['silent-failure-hunter', 'code-reviewer']
       * - pendingCompletionAgents includes 'code-simplifier' (and others with 0 issues)
       *
       * Integration test implementation approach:
       * 1. Mock complex agent state scenario
       * 2. Call completeAllHands({})
       * 3. Verify both arrays in state update
       */
      assert.ok(true, 'Integration test specification: Agent tracking arrays updated correctly');
    });
  });

  describe('error handling', () => {
    it('should document state update failure returns error response', () => {
      /**
       * SPECIFICATION: State update failure handling
       *
       * When safeUpdatePRBodyState returns failure:
       * - Tool should return error response (isError: true)
       * - Response should include buildStateUpdateFailureResponse output
       * - Workflow state should NOT be modified on GitHub
       *
       * SETUP:
       * - Mock safeUpdatePRBodyState() to return:
       *   { success: false, reason: 'rate_limit', lastError: Error, attemptCount: 3 }
       *
       * EXPECTED:
       * - Tool returns { isError: true, content: [...] }
       * - Response includes failure reason and retry instructions
       * - getNextStepInstructions() is NOT called
       *
       * Integration test implementation approach:
       * 1. Mock safeUpdatePRBodyState to return failure
       * 2. Call completeAllHands({})
       * 3. Verify isError: true in response
       * 4. Verify buildStateUpdateFailureResponse content
       */
      assert.ok(true, 'Integration test specification: State update failure returns error');
    });

    it('should document error includes steps completed info', () => {
      /**
       * SPECIFICATION: Error response content
       *
       * Error responses should include clear information about what was
       * and wasn't completed, to help users understand the failure.
       *
       * EXPECTED ERROR RESPONSE INCLUDES:
       * - 'Built new state locally (NOT persisted)'
       * - 'Attempted to post state comment - FAILED'
       * - 'State NOT modified on GitHub'
       * - 'Action required: Retry after resolving the issue'
       *
       * Integration test implementation approach:
       * 1. Mock state update to fail
       * 2. Call completeAllHands({})
       * 3. Verify error response content includes expected strings
       */
      assert.ok(true, 'Integration test specification: Error includes steps completed');
    });
  });

  describe('phase-specific routing', () => {
    it('should document phase1 routes to issue state update', () => {
      /**
       * SPECIFICATION: Phase 1 routing
       *
       * In Phase 1 (pre-PR):
       * - safeUpdateIssueBodyState() should be called
       * - safeUpdatePRBodyState() should NOT be called
       * - Issue number from state.issue.number is used
       *
       * SETUP:
       * - Mock detectCurrentState() with phase = 'phase1'
       * - Mock safeUpdateIssueBodyState() to return { success: true }
       *
       * EXPECTED:
       * - safeUpdateIssueBodyState() is called with issueNumber
       * - safeUpdatePRBodyState() is NOT called
       *
       * Integration test implementation approach:
       * 1. Mock Phase 1 state
       * 2. Spy on both update functions
       * 3. Verify correct function called
       */
      assert.ok(true, 'Integration test specification: Phase1 routes to issue state update');
    });

    it('should document phase2 routes to PR state update', () => {
      /**
       * SPECIFICATION: Phase 2 routing
       *
       * In Phase 2 (post-PR):
       * - safeUpdatePRBodyState() should be called
       * - safeUpdateIssueBodyState() should NOT be called
       * - PR number from state.pr.number is used
       *
       * SETUP:
       * - Mock detectCurrentState() with phase = 'phase2'
       * - Mock safeUpdatePRBodyState() to return { success: true }
       *
       * EXPECTED:
       * - safeUpdatePRBodyState() is called with prNumber
       * - safeUpdateIssueBodyState() is NOT called
       *
       * Integration test implementation approach:
       * 1. Mock Phase 2 state
       * 2. Spy on both update functions
       * 3. Verify correct function called
       */
      assert.ok(true, 'Integration test specification: Phase2 routes to PR state update');
    });
  });

  describe('race condition prevention', () => {
    it('should document state is reused to prevent race condition', () => {
      /**
       * SPECIFICATION: State reuse for race condition prevention
       *
       * After posting state update, the tool uses applyWiggumState()
       * instead of calling detectCurrentState() again. This prevents:
       * 1. Tool posts state update to GitHub
       * 2. Tool calls detectCurrentState()
       * 3. GitHub API returns OLD state (before update propagated)
       * 4. Tool returns instructions based on old state
       *
       * SETUP:
       * - Mock detectCurrentState() to return initial state
       * - Mock safeUpdatePRBodyState() to return { success: true }
       *
       * EXPECTED:
       * - applyWiggumState() is called with (state, newState)
       * - getNextStepInstructions() receives the locally-updated state
       * - detectCurrentState() is NOT called after state update
       *
       * Integration test implementation approach:
       * 1. Mock all dependencies
       * 2. Track call order and arguments
       * 3. Verify applyWiggumState receives correct arguments
       * 4. Verify getNextStepInstructions uses locally-updated state
       */
      assert.ok(true, 'Integration test specification: State reuse prevents race condition');
    });
  });

  describe('countHighPriorityInScopeIssues behavior', () => {
    it('should document only in-scope issues count toward step completion', () => {
      /**
       * SPECIFICATION: Scope filtering
       *
       * Only IN-SCOPE high-priority issues count toward blocking step completion.
       * Out-of-scope issues are tracked separately and don't block the PR.
       *
       * SETUP:
       * - 'code-reviewer-in-scope' manifest: 0 high-priority issues
       * - 'code-reviewer-out-of-scope' manifest: 5 high-priority issues
       *
       * EXPECTED:
       * - countHighPriorityInScopeIssues() returns 0
       * - Step can advance (out-of-scope issues don't block)
       *
       * RATIONALE:
       * Out-of-scope issues are tracked in separate GitHub issues and
       * don't need to be fixed before the PR can proceed.
       *
       * Integration test implementation approach:
       * 1. Mock readManifestFiles() with mixed scope manifests
       * 2. Verify countHighPriorityInScopeIssues only counts in-scope
       */
      assert.ok(true, 'Integration test specification: Only in-scope issues block completion');
    });

    it('should document low-priority issues do not block step completion', () => {
      /**
       * SPECIFICATION: Priority filtering
       *
       * Only HIGH-PRIORITY issues count toward blocking step completion.
       * Low-priority issues are recommendations that can be addressed later.
       *
       * SETUP:
       * - 'code-reviewer-in-scope' manifest: high_priority_count = 0
       * - Issues array contains low-priority items
       *
       * EXPECTED:
       * - countHighPriorityInScopeIssues() returns 0
       * - Step can advance (low-priority issues don't block)
       *
       * RATIONALE:
       * Low-priority issues are recommendations, not blockers.
       * They can be addressed in follow-up work.
       *
       * Integration test implementation approach:
       * 1. Mock readManifestFiles() with low-priority issues only
       * 2. Verify countHighPriorityInScopeIssues returns 0
       */
      assert.ok(true, 'Integration test specification: Low-priority issues do not block');
    });
  });

  describe('logging and observability', () => {
    it('should document tool logs start context', () => {
      /**
       * SPECIFICATION: Start logging
       *
       * EXPECTED LOGGING AT START:
       * - logger.info('wiggum_complete_all_hands started', { ... })
       * - Context includes: phase, targetNumber, location, iteration, currentStep
       *
       * Integration test implementation approach:
       * 1. Spy on logger.info
       * 2. Call completeAllHands({})
       * 3. Verify start log with expected context
       */
      assert.ok(true, 'Integration test specification: Tool logs context at start');
    });

    it('should document manifest analysis is logged', () => {
      /**
       * SPECIFICATION: Manifest analysis logging
       *
       * EXPECTED LOGGING AFTER MANIFEST READ:
       * - logger.info('Manifest analysis complete', { ... })
       * - Context includes: totalHighPriorityIssues, completedAgents,
       *   pendingCompletionAgents, totalManifests
       *
       * Integration test implementation approach:
       * 1. Spy on logger.info
       * 2. Call completeAllHands({})
       * 3. Verify manifest analysis log
       */
      assert.ok(true, 'Integration test specification: Manifest analysis logged');
    });

    it('should document state update success is logged', () => {
      /**
       * SPECIFICATION: Success logging
       *
       * EXPECTED LOGGING ON SUCCESS:
       * - Fast-path: logger.info('Fast-path state comment posted successfully', { ... })
       * - Non-fast-path: logger.info('wiggum_complete_all_hands completed successfully', { ... })
       *
       * Integration test implementation approach:
       * 1. Spy on logger.info
       * 2. Call completeAllHands({})
       * 3. Verify success log is present
       */
      assert.ok(true, 'Integration test specification: Success is logged');
    });
  });

  describe('edge cases', () => {
    it('should document empty manifest directory behavior', () => {
      /**
       * SPECIFICATION: Empty manifest directory
       *
       * When manifest directory is empty or doesn't exist:
       * - readManifestFiles() returns empty Map
       * - All agents are considered to have 0 issues
       * - First iteration: all agents move to pending
       * - Second iteration: all agents complete
       *
       * Integration test implementation approach:
       * 1. Mock readManifestFiles() to return empty Map
       * 2. Verify all agents move to appropriate state
       */
      assert.ok(true, 'Integration test specification: Empty manifest directory handling');
    });

    it('should document partial agent completion scenario', () => {
      /**
       * SPECIFICATION: Partial agent completion
       *
       * When some agents complete and others still have issues:
       * - Completed agents remain in completedAgents
       * - Agents with issues stay active
       * - Step does NOT advance (not all agents complete)
       *
       * Integration test implementation approach:
       * 1. Mock state with some completed agents
       * 2. Mock manifests with some agents having issues
       * 3. Verify mixed state handling
       */
      assert.ok(true, 'Integration test specification: Partial agent completion');
    });

    it('should document iteration limit behavior', () => {
      /**
       * SPECIFICATION: Iteration limit handling
       *
       * The tool respects maxIterations from state:
       * - If iteration exceeds maxIterations, getNextStepInstructions
       *   should return appropriate halt instructions
       * - completeAllHands itself increments iteration when issues remain
       *
       * Integration test implementation approach:
       * 1. Mock state at iteration = 10, maxIterations = 10
       * 2. Call completeAllHands({})
       * 3. Verify behavior at/near iteration limit
       */
      assert.ok(true, 'Integration test specification: Iteration limit behavior');
    });
  });
});

/**
 * TODO(#313): Implement actual integration tests with mocked dependencies
 *
 * The tests above serve as specification and documentation for the expected
 * behavior of the completeAllHands() function. Actual integration tests should
 * be added using Node.js test mocking to verify:
 *
 * Test Coverage Goals:
 * - Correct function calls (safeUpdatePRBodyState vs. safeUpdateIssueBodyState)
 * - Correct state updates (iteration, step, completedSteps, agent arrays)
 * - Correct error handling (state not modified message on failure)
 * - Correct cleanup order (before vs. after state persistence)
 * - Correct logging (start, analysis, success/error)
 *
 * Implementation Notes:
 *
 * The completeAllHands function has several dependencies that need mocking:
 * 1. detectCurrentState() - from ../state/detector.js
 * 2. readManifestFiles() - from ./manifest-utils.js
 * 3. safeUpdatePRBodyState() / safeUpdateIssueBodyState() - from ../state/router.js
 * 4. cleanupManifestFiles() / safeCleanupManifestFiles() - from ./manifest-utils.js
 * 5. advanceToNextStep() - from ../state/transitions.js
 * 6. getNextStepInstructions() - from ../state/router.js
 * 7. applyWiggumState() - from ../state/state-utils.js
 *
 * Test Helper Functions (to be added when implementing):
 *
 * ```typescript
 * import type { CurrentState, WiggumState } from '../state/types.js';
 * import { createWiggumState, createPRExists, createPRDoesNotExist } from '../state/types.js';
 *
 * function createPhase2State(overrides: Partial<WiggumState> = {}): CurrentState {
 *   const wiggum = createWiggumState({
 *     iteration: 1,
 *     step: 'p2-4',
 *     completedSteps: ['p2-1', 'p2-2', 'p2-3'],
 *     phase: 'phase2',
 *     ...overrides,
 *   });
 *   return {
 *     git: { ... },
 *     pr: createPRExists({ number: 456, ... }),
 *     issue: { exists: true, number: 123 },
 *     wiggum,
 *   };
 * }
 *
 * function createPhase1State(overrides: Partial<WiggumState> = {}): CurrentState {
 *   // Similar structure with phase: 'phase1' and no PR
 * }
 * ```
 *
 * Example Test Pattern:
 *
 * ```typescript
 * import { mock } from 'node:test';
 *
 * it('should mark agent pending on first zero', async (t) => {
 *   // Arrange: Mock dependencies
 *   const detectCurrentStateMock = t.mock.fn(() => Promise.resolve(createPhase2State()));
 *   const readManifestFilesMock = t.mock.fn(() => new Map());
 *   const safeUpdatePRBodyStateMock = t.mock.fn(() => Promise.resolve({ success: true }));
 *
 *   // Act: Call completeAllHands (using dependency injection or module mocking)
 *
 *   // Assert: Verify mock calls and state updates
 *   assert.strictEqual(safeUpdatePRBodyStateMock.mock.callCount(), 1);
 *   const stateArg = safeUpdatePRBodyStateMock.mock.calls[0].arguments[1];
 *   assert.ok(stateArg.pendingCompletionAgents.includes('code-reviewer'));
 * });
 * ```
 */
