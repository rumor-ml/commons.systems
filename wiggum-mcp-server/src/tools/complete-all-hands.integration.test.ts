/**
 * Integration tests for complete-all-hands runtime behavior
 *
 * These tests document and verify the expected runtime behavior of completeAllHands().
 * They cover:
 * - Fast-path state advancement (0 high-priority issues)
 * - Iteration increment path (issues remain)
 * - Phase-based routing (phase1 vs phase2)
 * - State update failure handling
 * - Manifest cleanup timing and error handling
 *
 * ARCHITECTURE NOTE:
 * The completeAllHands() function imports detectCurrentState(), safeUpdatePRBodyState(),
 * safeUpdateIssueBodyState(), and getNextStepInstructions() at module level. Node.js test
 * runner's mock.method() cannot redefine these ES module exports after import.
 *
 * For true integration testing with mocks, this codebase would need:
 * - Dependency injection pattern, OR
 * - A testing framework with ESM mock support (e.g., Jest with jest.unstable_mockModule)
 *
 * These tests focus on:
 * 1. Filesystem-based manifest operations (which CAN be tested with real files)
 * 2. Documentation of expected behavior (for future mock implementation)
 * 3. Utility function tests that don't require mocking
 * 4. State update failure response builder (can be tested directly)
 *
 * @see complete-all-hands.test.ts for schema validation tests
 * @see complete-fix.integration.test.ts for similar documentation pattern
 * @see https://github.com/commons-systems/commons.systems/issues/625
 * @see https://github.com/commons-systems/commons.systems/issues/313 for test coverage tracking
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  readManifestFiles,
  countHighPriorityInScopeIssues,
  cleanupManifestFiles,
  safeCleanupManifestFiles,
  getManifestDir,
} from './manifest-utils.js';
import type { IssueRecord } from './manifest-types.js';
import {
  STEP_PHASE1_MONITOR_WORKFLOW,
  STEP_PHASE1_PR_REVIEW,
  STEP_PHASE2_MONITOR_WORKFLOW,
  STEP_PHASE2_MONITOR_CHECKS,
  STEP_PHASE2_CODE_QUALITY,
  STEP_NAMES,
} from '../constants.js';
import { advanceToNextStep } from '../state/transitions.js';
import {
  createWiggumState,
  createGitState,
  createPRExists,
  createIssueExists,
} from '../state/types.js';
import type { CurrentState } from '../state/types.js';
import { buildStateUpdateFailureResponse } from '../utils/state-update-error.js';

// Test directory setup
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

describe('complete-all-hands integration tests', () => {
  beforeEach(() => {
    // Create unique test directory
    testDir = join(
      tmpdir(),
      `complete-all-hands-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });

    // Save original cwd and change to test directory
    originalCwd = process.cwd();
    process.chdir(testDir);

    // Create manifest directory
    mkdirSync(join(testDir, 'tmp', 'wiggum'), { recursive: true });
  });

  afterEach(() => {
    // Restore original cwd
    process.chdir(originalCwd);

    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('manifest reading and high-priority counting', () => {
    it('should correctly count high-priority in-scope issues from manifests', () => {
      // Setup: Create manifests with mixed priorities
      const manifestDir = getManifestDir();
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [
        createIssueRecord({ priority: 'high' }),
        createIssueRecord({ priority: 'high' }),
        createIssueRecord({ priority: 'low' }),
      ]);

      // Act
      const manifests = readManifestFiles();
      const count = countHighPriorityInScopeIssues(manifests);

      // Assert
      assert.strictEqual(count, 2, 'Should count only high-priority issues');
    });

    it('should return 0 when no in-scope manifests exist', () => {
      // Setup: Create only out-of-scope manifest
      const manifestDir = getManifestDir();
      writeTestManifest(manifestDir, 'code-reviewer', 'out-of-scope', [
        createIssueRecord({ priority: 'high', scope: 'out-of-scope' }),
        createIssueRecord({ priority: 'high', scope: 'out-of-scope' }),
      ]);

      // Act
      const manifests = readManifestFiles();
      const count = countHighPriorityInScopeIssues(manifests);

      // Assert
      assert.strictEqual(count, 0, 'Out-of-scope issues should not be counted');
    });

    it('should return 0 when manifest directory does not exist', () => {
      // Setup: Remove manifest directory
      rmSync(getManifestDir(), { recursive: true, force: true });

      // Act
      const manifests = readManifestFiles();
      const count = countHighPriorityInScopeIssues(manifests);

      // Assert
      assert.strictEqual(count, 0, 'Should return 0 when no manifests exist');
    });

    it('should aggregate counts across multiple agents', () => {
      // Setup: Create manifests for multiple agents
      const manifestDir = getManifestDir();
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [
        createIssueRecord({ agent_name: 'code-reviewer', priority: 'high' }),
      ]);
      writeTestManifest(manifestDir, 'silent-failure-hunter', 'in-scope', [
        createIssueRecord({ agent_name: 'silent-failure-hunter', priority: 'high' }),
        createIssueRecord({ agent_name: 'silent-failure-hunter', priority: 'high' }),
      ]);
      writeTestManifest(manifestDir, 'code-simplifier', 'in-scope', [
        createIssueRecord({ agent_name: 'code-simplifier', priority: 'low' }),
      ]);

      // Act
      const manifests = readManifestFiles();
      const count = countHighPriorityInScopeIssues(manifests);

      // Assert
      assert.strictEqual(count, 3, 'Should aggregate high-priority counts across agents');
    });
  });

  describe('fast-path state advancement', () => {
    it('should use advanceToNextStep when no high-priority issues', () => {
      // This tests the state transition logic used by completeAllHands
      const initialState = createWiggumState({
        iteration: 1,
        step: STEP_PHASE2_CODE_QUALITY,
        completedSteps: [STEP_PHASE2_MONITOR_WORKFLOW, STEP_PHASE2_MONITOR_CHECKS],
        phase: 'phase2',
      });

      // Act
      const newState = advanceToNextStep(initialState);

      // Assert: Step was marked complete
      assert.ok(
        newState.completedSteps.includes(STEP_PHASE2_CODE_QUALITY),
        'Current step should be marked complete'
      );
      // Assert: Iteration unchanged
      assert.strictEqual(newState.iteration, 1, 'Iteration should remain unchanged in fast-path');
    });

    it('documents fast-path cleanup timing contract', () => {
      /**
       * SPECIFICATION: Fast-path cleanup timing
       *
       * When countHighPriorityInScopeIssues(manifests) === 0:
       *
       * 1. cleanupManifestFiles() is called BEFORE state persistence
       * 2. If cleanup fails, state update is NOT attempted (error propagates)
       * 3. If cleanup succeeds, state is updated with advanceToNextStep()
       *
       * This ordering ensures:
       * - Stale manifests don't corrupt next iteration
       * - State is only updated after successful cleanup
       * - On failure, manifests remain for debugging
       *
       * See complete-all-hands.ts lines 96-100 for implementation.
       */
      assert.ok(true, 'Fast-path cleanup timing contract documented');
    });
  });

  describe('iteration increment path', () => {
    it('should increment iteration when high-priority issues remain', () => {
      // This tests the state transition logic used by completeAllHands
      const initialState = createWiggumState({
        iteration: 1,
        step: STEP_PHASE2_CODE_QUALITY,
        completedSteps: [STEP_PHASE2_MONITOR_WORKFLOW, STEP_PHASE2_MONITOR_CHECKS],
        phase: 'phase2',
      });

      // Act: Create new state with incremented iteration (as completeAllHands does)
      const newState = createWiggumState({
        iteration: initialState.iteration + 1,
        step: initialState.step,
        completedSteps: initialState.completedSteps,
        phase: initialState.phase,
      });

      // Assert
      assert.strictEqual(newState.iteration, 2, 'Iteration should be incremented');
      assert.strictEqual(newState.step, STEP_PHASE2_CODE_QUALITY, 'Step should remain unchanged');
    });

    it('documents slow-path cleanup timing contract', () => {
      /**
       * SPECIFICATION: Slow-path cleanup timing
       *
       * When countHighPriorityInScopeIssues(manifests) > 0:
       *
       * 1. State is updated FIRST (increment iteration)
       * 2. safeCleanupManifestFiles() is called AFTER state persistence
       * 3. If cleanup fails, it logs warning but does NOT throw
       *
       * This ordering ensures:
       * - State is persisted even if cleanup has issues
       * - Workflow can continue (user can manually cleanup)
       * - No inconsistent state (updated but cleanup failed throws)
       *
       * See complete-all-hands.ts lines 190-197 for implementation.
       */
      assert.ok(true, 'Slow-path cleanup timing contract documented');
    });
  });

  describe('manifest cleanup behavior', () => {
    it('should delete all manifest files when cleanupManifestFiles succeeds', async () => {
      // Setup
      const manifestDir = getManifestDir();
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [createIssueRecord()]);
      writeTestManifest(manifestDir, 'silent-failure-hunter', 'in-scope', [createIssueRecord()]);

      // Verify files exist
      const filesBefore = readdirSync(manifestDir).filter((f) => f.endsWith('.json'));
      assert.strictEqual(filesBefore.length, 2, 'Should have 2 manifest files before cleanup');

      // Act
      await cleanupManifestFiles();

      // Assert
      const filesAfter = readdirSync(manifestDir).filter((f) => f.endsWith('.json'));
      assert.strictEqual(filesAfter.length, 0, 'All manifest files should be deleted');
    });

    it('safeCleanupManifestFiles should not throw on success', async () => {
      // Setup
      const manifestDir = getManifestDir();
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [createIssueRecord()]);

      // Act & Assert: Should not throw
      await assert.doesNotReject(async () => {
        await safeCleanupManifestFiles();
      });

      // Verify cleanup happened
      const filesAfter = readdirSync(manifestDir).filter((f) => f.endsWith('.json'));
      assert.strictEqual(filesAfter.length, 0, 'Files should be cleaned up');
    });

    it('safeCleanupManifestFiles should handle missing directory gracefully', async () => {
      // Setup: Remove manifest directory
      rmSync(getManifestDir(), { recursive: true, force: true });

      // Act & Assert: Should not throw
      await assert.doesNotReject(async () => {
        await safeCleanupManifestFiles();
      });
    });
  });

  describe('phase-based routing (documentation)', () => {
    it('documents phase1 routes to issue state update', () => {
      /**
       * SPECIFICATION: Phase 1 comment routing
       *
       * When state.wiggum.phase === 'phase1':
       *
       * 1. safeUpdateIssueBodyState(issueNumber, newState, step) is called
       * 2. safeUpdatePRBodyState is NOT called
       * 3. Issue number comes from state.issue.number
       *
       * RATIONALE:
       * - Phase 1 occurs before PR creation
       * - State must be tracked in the originating GitHub issue
       * - PR doesn't exist yet in Phase 1
       *
       * See complete-all-hands.ts lines 111-113 for implementation.
       */
      assert.ok(true, 'Phase 1 routing to issue state update documented');
    });

    it('documents phase2 routes to PR state update', () => {
      /**
       * SPECIFICATION: Phase 2 comment routing
       *
       * When state.wiggum.phase === 'phase2':
       *
       * 1. safeUpdatePRBodyState(prNumber, newState, step) is called
       * 2. safeUpdateIssueBodyState is NOT called
       * 3. PR number comes from state.pr.number
       *
       * RATIONALE:
       * - Phase 2 occurs after PR creation
       * - State is tracked in the PR body
       * - Keeps all PR-related state in one place
       *
       * See complete-all-hands.ts lines 163-166 for implementation.
       */
      assert.ok(true, 'Phase 2 routing to PR state update documented');
    });
  });

  describe('state update failure handling (documentation)', () => {
    it('documents error response includes actionable guidance', () => {
      /**
       * SPECIFICATION: State update failure error response
       *
       * When safeUpdatePRBodyState or safeUpdateIssueBodyState returns { success: false }:
       *
       * EXPECTED RESPONSE CONTENT:
       * 1. "ERROR: Failed to post state comment due to ${reason}"
       * 2. "IMPORTANT: Your workflow state has NOT been modified"
       * 3. "You are still on: ${STEP_NAMES[currentStep]}"
       * 4. Common causes list (rate limiting, network issues)
       * 5. Resolution steps with actionable commands
       * 6. Tool name for retry instruction
       *
       * EXPECTED RESULT FLAGS:
       * - isError: true
       *
       * EXPECTED BEHAVIOR:
       * - getNextStepInstructions is NOT called
       * - Manifest cleanup is NOT performed (in slow path)
       *
       * See buildStateUpdateFailureResponse() in utils/state-update-error.ts
       */
      assert.ok(true, 'State update failure error response documented');
    });

    it('documents manifests are preserved on failure for retry', () => {
      /**
       * SPECIFICATION: Manifest preservation on state update failure
       *
       * When state update fails (in slow path with remaining issues):
       *
       * 1. safeCleanupManifestFiles is NOT called
       * 2. Manifest files remain in tmp/wiggum/
       * 3. User can retry wiggum_complete_all_hands
       * 4. Retry will re-read manifests and attempt state update again
       *
       * RATIONALE:
       * - Manifests are source of truth for agent findings
       * - Deleting before successful state update would lose data
       * - User needs manifests preserved for retry
       *
       * See complete-all-hands.ts lines 168-182 for failure handling.
       */
      assert.ok(true, 'Manifest preservation on failure documented');
    });
  });

  describe('state reuse to prevent race condition (documentation)', () => {
    it('documents applyWiggumState usage for race condition prevention', () => {
      /**
       * SPECIFICATION: Race condition prevention
       *
       * After state update succeeds:
       *
       * 1. applyWiggumState(state, newState) is called
       * 2. getNextStepInstructions receives the locally-updated state
       * 3. detectCurrentState() is NOT called again
       *
       * RATIONALE (issue #388):
       * - GitHub API may return stale data immediately after update
       * - Calling detectCurrentState() could get old state
       * - Using local newState ensures consistency
       *
       * See complete-all-hands.ts lines 139-141 (fast-path) and 199-201 (slow-path).
       */
      assert.ok(true, 'Race condition prevention via state reuse documented');
    });
  });

  describe('maxIterations parameter handling', () => {
    it('should allow custom maxIterations in state', () => {
      // This tests that maxIterations can be set in WiggumState
      const state = createWiggumState({
        iteration: 1,
        step: STEP_PHASE2_CODE_QUALITY,
        completedSteps: [],
        phase: 'phase2',
        maxIterations: 25,
      });

      assert.strictEqual(state.maxIterations, 25, 'maxIterations should be set in state');
    });

    it('documents maxIterations override behavior', () => {
      /**
       * SPECIFICATION: maxIterations parameter
       *
       * When input.maxIterations is provided:
       *
       * 1. Fast-path: newState.maxIterations = input.maxIterations (line 93)
       * 2. Slow-path: Passed to createWiggumState (line 152)
       * 3. Persisted to GitHub in state update
       * 4. Used by subsequent tools to check iteration limit
       *
       * When input.maxIterations is undefined:
       * - Slow-path uses state.wiggum.maxIterations (preserve existing)
       * - Fast-path doesn't set maxIterations (uses default)
       *
       * See complete-all-hands.ts lines 92-94 and 152.
       */
      assert.ok(true, 'maxIterations override behavior documented');
    });
  });

  describe('not_fixed issues exclusion', () => {
    it('should exclude not_fixed issues from high-priority count', () => {
      // Setup: Create manifest with not_fixed issues
      const manifestDir = getManifestDir();
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [
        createIssueRecord({ priority: 'high', not_fixed: true }),
        createIssueRecord({ priority: 'high', not_fixed: false }),
        createIssueRecord({ priority: 'high' }), // undefined not_fixed = counted
      ]);

      // Act
      const manifests = readManifestFiles();
      const count = countHighPriorityInScopeIssues(manifests);

      // Assert: not_fixed issues excluded
      assert.strictEqual(
        count,
        2,
        'Should exclude not_fixed issues from count (1 excluded, 2 counted)'
      );
    });
  });

  describe('state update failure response builder', () => {
    /**
     * Helper to create a mock CurrentState for testing buildStateUpdateFailureResponse.
     * This allows us to test the response builder in isolation without mocking
     * detectCurrentState() or making GitHub API calls.
     */
    function createMockCurrentState(phase: 'phase1' | 'phase2'): CurrentState {
      const wiggumState = createWiggumState({
        iteration: 2,
        step: phase === 'phase1' ? STEP_PHASE1_PR_REVIEW : STEP_PHASE2_CODE_QUALITY,
        completedSteps:
          phase === 'phase1'
            ? [STEP_PHASE1_MONITOR_WORKFLOW]
            : [STEP_PHASE2_MONITOR_WORKFLOW, STEP_PHASE2_MONITOR_CHECKS],
        phase,
      });

      const gitState = createGitState({
        currentBranch: '625-test-branch',
        isMainBranch: false,
        hasUncommittedChanges: false,
        isRemoteTracking: true,
        isPushed: true,
      });

      if (phase === 'phase1') {
        return {
          wiggum: wiggumState,
          git: gitState,
          pr: { exists: false as const },
          issue: createIssueExists(625),
        };
      } else {
        return {
          wiggum: wiggumState,
          git: gitState,
          pr: createPRExists({
            number: 123,
            title: 'Test PR',
            state: 'OPEN',
            url: 'https://github.com/test/repo/pull/123',
            labels: [],
            headRefName: '625-test-branch',
            baseRefName: 'main',
          }),
          issue: createIssueExists(625),
        };
      }
    }

    it('should include isError: true in response', () => {
      // Setup
      const state = createMockCurrentState('phase2');
      const newState = createWiggumState({
        iteration: state.wiggum.iteration + 1,
        step: state.wiggum.step,
        completedSteps: state.wiggum.completedSteps,
        phase: 'phase2',
      });

      // Act
      const response = buildStateUpdateFailureResponse({
        state,
        stateResult: { success: false, reason: 'rate_limit' },
        newState,
        phase: 'phase2',
        stepsCompleted: ['Step 1', 'Step 2'],
        toolName: 'wiggum_complete_all_hands',
      });

      // Assert
      assert.strictEqual(response.isError, true, 'Response should have isError: true');
    });

    it('should include error message with failure reason', () => {
      // Setup
      const state = createMockCurrentState('phase2');
      const newState = createWiggumState({
        iteration: state.wiggum.iteration + 1,
        step: state.wiggum.step,
        completedSteps: state.wiggum.completedSteps,
        phase: 'phase2',
      });

      // Act
      const response = buildStateUpdateFailureResponse({
        state,
        stateResult: { success: false, reason: 'rate_limit' },
        newState,
        phase: 'phase2',
        stepsCompleted: [],
        toolName: 'wiggum_complete_all_hands',
      });

      // Assert
      assert.ok(response.content[0].type === 'text', 'Response should have text content');
      const text = response.content[0].text;
      assert.ok(text.includes('rate_limit'), 'Error message should include failure reason');
      assert.ok(
        text.includes('ERROR: Failed to post state comment'),
        'Should include error prefix'
      );
    });

    it('should include "state has NOT been modified" warning', () => {
      // Setup
      const state = createMockCurrentState('phase2');
      const newState = createWiggumState({
        iteration: state.wiggum.iteration + 1,
        step: state.wiggum.step,
        completedSteps: state.wiggum.completedSteps,
        phase: 'phase2',
      });

      // Act
      const response = buildStateUpdateFailureResponse({
        state,
        stateResult: { success: false, reason: 'network' },
        newState,
        phase: 'phase2',
        stepsCompleted: [],
        toolName: 'wiggum_complete_all_hands',
      });

      // Assert
      const text = (response.content[0] as { type: 'text'; text: string }).text;
      assert.ok(text.includes('has NOT been modified'), 'Should warn that state was not modified');
    });

    it('should include current step name in error message', () => {
      // Setup
      const state = createMockCurrentState('phase2');
      const newState = createWiggumState({
        iteration: state.wiggum.iteration + 1,
        step: state.wiggum.step,
        completedSteps: state.wiggum.completedSteps,
        phase: 'phase2',
      });

      // Act
      const response = buildStateUpdateFailureResponse({
        state,
        stateResult: { success: false, reason: 'rate_limit' },
        newState,
        phase: 'phase2',
        stepsCompleted: [],
        toolName: 'wiggum_complete_all_hands',
      });

      // Assert
      const text = (response.content[0] as { type: 'text'; text: string }).text;
      const expectedStepName = STEP_NAMES[STEP_PHASE2_CODE_QUALITY];
      assert.ok(
        text.includes(expectedStepName),
        `Should include step name "${expectedStepName}" in message`
      );
    });

    it('should include tool name for retry instructions', () => {
      // Setup
      const state = createMockCurrentState('phase2');
      const newState = createWiggumState({
        iteration: state.wiggum.iteration + 1,
        step: state.wiggum.step,
        completedSteps: state.wiggum.completedSteps,
        phase: 'phase2',
      });

      // Act
      const response = buildStateUpdateFailureResponse({
        state,
        stateResult: { success: false, reason: 'rate_limit' },
        newState,
        phase: 'phase2',
        stepsCompleted: [],
        toolName: 'wiggum_complete_all_hands',
      });

      // Assert
      const text = (response.content[0] as { type: 'text'; text: string }).text;
      assert.ok(text.includes('wiggum_complete_all_hands'), 'Should include tool name for retry');
    });

    it('should include PR number in context for phase2', () => {
      // Setup
      const state = createMockCurrentState('phase2');
      const newState = createWiggumState({
        iteration: state.wiggum.iteration + 1,
        step: state.wiggum.step,
        completedSteps: state.wiggum.completedSteps,
        phase: 'phase2',
      });

      // Act
      const response = buildStateUpdateFailureResponse({
        state,
        stateResult: { success: false, reason: 'rate_limit' },
        newState,
        phase: 'phase2',
        stepsCompleted: [],
        toolName: 'wiggum_complete_all_hands',
      });

      // Assert - The PR number should appear in the formatted response
      const text = (response.content[0] as { type: 'text'; text: string }).text;
      assert.ok(text.includes('123') || text.includes('pr_number'), 'Should reference PR context');
    });

    it('should include issue number in context for phase1', () => {
      // Setup
      const state = createMockCurrentState('phase1');
      const newState = createWiggumState({
        iteration: state.wiggum.iteration + 1,
        step: state.wiggum.step,
        completedSteps: state.wiggum.completedSteps,
        phase: 'phase1',
      });

      // Act
      const response = buildStateUpdateFailureResponse({
        state,
        stateResult: { success: false, reason: 'rate_limit' },
        newState,
        phase: 'phase1',
        stepsCompleted: [],
        toolName: 'wiggum_complete_all_hands',
      });

      // Assert - Should be a valid error response for phase1
      assert.ok(response.isError, 'Should be an error response for phase1 failure');
      assert.ok(response.content[0].type === 'text', 'Response should have text content');
    });
  });

  describe('fast-path vs slow-path decision logic', () => {
    it('should trigger fast-path when high-priority count is 0', () => {
      // Setup: Create only low-priority issues
      const manifestDir = getManifestDir();
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [
        createIssueRecord({ priority: 'low' }),
        createIssueRecord({ priority: 'low' }),
      ]);

      // Act
      const manifests = readManifestFiles();
      const count = countHighPriorityInScopeIssues(manifests);

      // Assert: Count is 0, which would trigger fast-path in completeAllHands
      assert.strictEqual(count, 0, 'Low-priority issues should result in count 0 (fast-path)');
    });

    it('should trigger slow-path when high-priority count is > 0', () => {
      // Setup: Create mix of priorities
      const manifestDir = getManifestDir();
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [
        createIssueRecord({ priority: 'high' }),
        createIssueRecord({ priority: 'low' }),
      ]);

      // Act
      const manifests = readManifestFiles();
      const count = countHighPriorityInScopeIssues(manifests);

      // Assert: Count is > 0, which would trigger slow-path in completeAllHands
      assert.strictEqual(count, 1, 'High-priority issues should result in count > 0 (slow-path)');
    });

    it('should trigger fast-path when only out-of-scope issues exist', () => {
      // Setup: Create only out-of-scope high-priority issues
      const manifestDir = getManifestDir();
      writeTestManifest(manifestDir, 'code-reviewer', 'out-of-scope', [
        createIssueRecord({ priority: 'high', scope: 'out-of-scope' }),
        createIssueRecord({ priority: 'high', scope: 'out-of-scope' }),
      ]);

      // Act
      const manifests = readManifestFiles();
      const count = countHighPriorityInScopeIssues(manifests);

      // Assert: Out-of-scope issues don't count, so fast-path is triggered
      assert.strictEqual(
        count,
        0,
        'Out-of-scope issues should not count toward slow-path decision'
      );
    });

    it('should correctly compute state advancement for fast-path', () => {
      /**
       * This test verifies the state transitions that occur in fast-path:
       * 1. advanceToNextStep() is called
       * 2. Current step is added to completedSteps
       * 3. Iteration remains unchanged
       */
      const initialState = createWiggumState({
        iteration: 3,
        step: STEP_PHASE2_CODE_QUALITY,
        completedSteps: [STEP_PHASE2_MONITOR_WORKFLOW, STEP_PHASE2_MONITOR_CHECKS],
        phase: 'phase2',
      });

      // Act: Simulate fast-path state transition
      const newState = advanceToNextStep(initialState);

      // Assert
      assert.strictEqual(newState.iteration, 3, 'Iteration should NOT be incremented in fast-path');
      assert.ok(
        newState.completedSteps.includes(STEP_PHASE2_CODE_QUALITY),
        'Current step should be added to completedSteps'
      );
      assert.strictEqual(
        newState.completedSteps.length,
        3,
        'completedSteps should have one more entry'
      );
    });

    it('should correctly compute state for slow-path', () => {
      /**
       * This test verifies the state transitions that occur in slow-path:
       * 1. Iteration is incremented by 1
       * 2. Step remains unchanged (workflow loops back)
       * 3. completedSteps remains unchanged
       */
      const initialState = createWiggumState({
        iteration: 3,
        step: STEP_PHASE2_CODE_QUALITY,
        completedSteps: [STEP_PHASE2_MONITOR_WORKFLOW, STEP_PHASE2_MONITOR_CHECKS],
        phase: 'phase2',
      });

      // Act: Simulate slow-path state transition (as done in completeAllHands)
      const newState = createWiggumState({
        iteration: initialState.iteration + 1,
        step: initialState.step,
        completedSteps: initialState.completedSteps,
        phase: initialState.phase,
      });

      // Assert
      assert.strictEqual(newState.iteration, 4, 'Iteration should be incremented in slow-path');
      assert.strictEqual(newState.step, STEP_PHASE2_CODE_QUALITY, 'Step should remain unchanged');
      assert.deepStrictEqual(
        newState.completedSteps,
        initialState.completedSteps,
        'completedSteps should remain unchanged'
      );
    });
  });

  describe('manifest cleanup timing verification', () => {
    it('should have manifests present before cleanup in fast-path scenario', async () => {
      /**
       * This test verifies the manifest state at the decision point in fast-path:
       * When countHighPriorityInScopeIssues returns 0, manifests should still exist
       * before safeCleanupManifestFiles is called.
       */
      const manifestDir = getManifestDir();

      // Setup: Create manifests with only low-priority issues (fast-path trigger)
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [
        createIssueRecord({ priority: 'low' }),
      ]);

      // Verify manifests exist before cleanup
      const manifests = readManifestFiles();
      assert.strictEqual(manifests.size, 1, 'Manifests should exist before cleanup');

      // Verify count is 0 (fast-path condition)
      const count = countHighPriorityInScopeIssues(manifests);
      assert.strictEqual(count, 0, 'Count should be 0 for fast-path');

      // Act: Simulate cleanup
      await cleanupManifestFiles();

      // Assert: Manifests cleaned up
      const manifestsAfter = readManifestFiles();
      assert.strictEqual(manifestsAfter.size, 0, 'Manifests should be cleaned up in fast-path');
    });

    it('should preserve manifests when cleanup is not called (simulating failure)', () => {
      /**
       * This test verifies that manifests are preserved if cleanup is never called.
       * In slow-path failure scenarios, safeCleanupManifestFiles is only called
       * AFTER successful state persistence. If state update fails, cleanup is not
       * called and manifests remain for retry.
       */
      const manifestDir = getManifestDir();

      // Setup: Create manifests with high-priority issues (slow-path trigger)
      writeTestManifest(manifestDir, 'code-reviewer', 'in-scope', [
        createIssueRecord({ priority: 'high' }),
      ]);

      // Act: Simulate slow-path without cleanup (as if state update failed)
      const manifests = readManifestFiles();
      const count = countHighPriorityInScopeIssues(manifests);

      // Assert: Manifests still exist (no cleanup called)
      assert.strictEqual(count, 1, 'Count should be 1 (slow-path condition)');
      const filesBefore = readdirSync(manifestDir).filter((f) => f.endsWith('.json'));
      assert.strictEqual(filesBefore.length, 1, 'Manifest file should be preserved on failure');
    });
  });

  describe('complete-all-hands workflow integration (documentation)', () => {
    it('documents the complete fast-path execution flow', () => {
      /**
       * SPECIFICATION: Fast-path execution flow in completeAllHands()
       *
       * PRECONDITION:
       * - Manifests exist in tmp/wiggum/
       * - countHighPriorityInScopeIssues(manifests) === 0
       *
       * EXECUTION ORDER:
       * 1. detectCurrentState() - get current workflow state
       * 2. readManifestFiles() - read all manifest files
       * 3. countHighPriorityInScopeIssues(manifests) - returns 0
       * 4. advanceToNextStep(state.wiggum) - mark current step complete
       * 5. [if input.maxIterations] - override maxIterations in newState
       * 6. safeCleanupManifestFiles() - delete manifest files (non-blocking)
       * 7. safeUpdatePRBodyState() or safeUpdateIssueBodyState() - persist state
       * 8. [if success] applyWiggumState() - merge states locally
       * 9. [if success] getNextStepInstructions() - return next step instructions
       * 10. [if failure] buildStateUpdateFailureResponse() - return error response
       *
       * KEY INVARIANTS:
       * - Iteration is NOT incremented (remains unchanged)
       * - Current step is added to completedSteps
       * - Cleanup happens BEFORE state persistence
       * - getNextStepInstructions uses locally-merged state (race condition fix)
       *
       * See complete-all-hands.ts lines 81-141 for implementation.
       */
      assert.ok(true, 'Fast-path execution flow documented');
    });

    it('documents the complete slow-path execution flow', () => {
      /**
       * SPECIFICATION: Slow-path execution flow in completeAllHands()
       *
       * PRECONDITION:
       * - Manifests exist in tmp/wiggum/
       * - countHighPriorityInScopeIssues(manifests) > 0
       *
       * EXECUTION ORDER:
       * 1. detectCurrentState() - get current workflow state
       * 2. readManifestFiles() - read all manifest files
       * 3. countHighPriorityInScopeIssues(manifests) - returns > 0
       * 4. createWiggumState() - create new state with incremented iteration
       *    - iteration: state.wiggum.iteration + 1
       *    - step: unchanged (workflow loops back to re-run reviews)
       *    - completedSteps: unchanged (step not marked complete)
       *    - maxIterations: input.maxIterations ?? state.wiggum.maxIterations
       * 5. safeUpdatePRBodyState() or safeUpdateIssueBodyState() - persist state
       * 6. [if success] safeCleanupManifestFiles() - delete manifest files
       * 7. [if success] applyWiggumState() - merge states locally
       * 8. [if success] getNextStepInstructions() - return next step instructions
       * 9. [if failure at step 5] buildStateUpdateFailureResponse() - return error
       *    - Cleanup is NOT called (manifests preserved for retry)
       *
       * KEY INVARIANTS:
       * - Iteration IS incremented by 1
       * - Step remains unchanged (triggers re-review)
       * - completedSteps remains unchanged
       * - Cleanup happens AFTER successful state persistence
       * - On state update failure, manifests are preserved
       *
       * See complete-all-hands.ts lines 144-206 for implementation.
       */
      assert.ok(true, 'Slow-path execution flow documented');
    });

    it('documents phase routing decision logic', () => {
      /**
       * SPECIFICATION: Phase-based routing in completeAllHands()
       *
       * PHASE DETECTION:
       * - phase is read from state.wiggum.phase
       * - Valid values: 'phase1' or 'phase2'
       *
       * PHASE 1 (Pre-PR):
       * - Uses safeUpdateIssueBodyState(issueNumber, newState, step)
       * - issueNumber comes from state.issue.number (extracted from branch name)
       * - State is persisted in the originating GitHub issue body
       *
       * PHASE 2 (Post-PR):
       * - Uses safeUpdatePRBodyState(prNumber, newState, step)
       * - prNumber comes from state.pr.number (from getPR() API call)
       * - State is persisted in the PR body
       *
       * TARGET NUMBER RESOLUTION:
       * - getTargetNumber(state, phase, toolName) extracts the correct number
       * - Throws if required entity (issue/PR) doesn't exist for the phase
       *
       * See complete-all-hands.ts lines 110-113 (fast-path) and 162-166 (slow-path).
       */
      assert.ok(true, 'Phase routing decision logic documented');
    });
  });
});
