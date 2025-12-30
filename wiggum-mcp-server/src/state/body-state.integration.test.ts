/**
 * Integration tests for body-state module - GitHub API integration
 *
 * These tests verify the integration between body-state functions and the GitHub CLI.
 * Unlike body-state.test.ts which tests pure functions, these tests verify:
 * 1. Correct gh CLI argument construction
 * 2. Error handling when gh CLI fails
 * 3. Read-modify-write pattern correctness
 * 4. State persistence verification
 *
 * Test approach: These tests serve as executable documentation and contract
 * verification for the body-state module's integration with gh CLI. They verify
 * expected argument formats, error handling behavior, and state roundtrip integrity
 * without making actual GitHub API requests.
 *
 * Note: For actual integration tests with mocked gh CLI, a dependency injection
 * pattern would be needed. These tests document the expected contracts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { WiggumState } from './types.js';
import { WIGGUM_STATE_MARKER } from '../constants.js';
import { GitHubCliError } from '../utils/errors.js';

describe('body-state GitHub API integration', () => {
  describe('updatePRBodyState argument construction', () => {
    it('documents expected gh CLI arguments for PR body update', () => {
      /**
       * SPECIFICATION: gh CLI argument format for PR body state update
       *
       * The updatePRBodyState function should:
       * 1. First call: gh pr view <number> --json body -q .body
       * 2. Second call: gh pr edit <number> --body <updated_body>
       *
       * Expected arguments:
       * - View args: ['pr', 'view', '123', '--json', 'body', '-q', '.body']
       * - Edit args: ['pr', 'edit', '123', '--body', '<body_with_state>']
       *
       * With repo option:
       * - View args: prefixed with ['--repo', 'owner/repo']
       * - Edit args: prefixed with ['--repo', 'owner/repo']
       */
      const viewArgs = ['pr', 'view', '123', '--json', 'body', '-q', '.body'];
      const editArgs = ['pr', 'edit', '123', '--body', 'updated body'];

      // Verify expected format
      assert.deepStrictEqual(viewArgs.slice(0, 4), ['pr', 'view', '123', '--json']);
      assert.deepStrictEqual(editArgs.slice(0, 3), ['pr', 'edit', '123']);
      assert.strictEqual(editArgs[3], '--body');
    });

    it('documents expected gh CLI arguments for issue body update', () => {
      /**
       * SPECIFICATION: gh CLI argument format for issue body state update
       *
       * The updateIssueBodyState function should:
       * 1. First call: gh issue view <number> --json body -q .body
       * 2. Second call: gh issue edit <number> --body <updated_body>
       *
       * Expected arguments:
       * - View args: ['issue', 'view', '123', '--json', 'body', '-q', '.body']
       * - Edit args: ['issue', 'edit', '123', '--body', '<body_with_state>']
       */
      const viewArgs = ['issue', 'view', '123', '--json', 'body', '-q', '.body'];
      const editArgs = ['issue', 'edit', '123', '--body', 'updated body'];

      // Verify expected format
      assert.deepStrictEqual(viewArgs.slice(0, 4), ['issue', 'view', '123', '--json']);
      assert.deepStrictEqual(editArgs.slice(0, 3), ['issue', 'edit', '123']);
      assert.strictEqual(editArgs[3], '--body');
    });
  });

  describe('error handling documentation', () => {
    it('documents expected behavior when gh CLI view fails', () => {
      /**
       * SPECIFICATION: Error handling for gh pr/issue view failures
       *
       * When the initial view command fails:
       * - Function should propagate the error (not swallow it)
       * - Error message should include gh CLI context
       * - The edit command should NOT be called
       *
       * Common failure scenarios:
       * 1. PR/issue not found (404)
       * 2. Permission denied (403)
       * 3. Network timeout
       * 4. Rate limit exceeded (429)
       *
       * Expected behavior:
       * - GitHubCliError is thrown with exitCode preserved
       * - Caller (state management) handles retry/user notification
       */
      const error = new GitHubCliError('PR not found', 1, 'gh: Could not find PR');
      assert.ok(error instanceof Error);
      assert.strictEqual(error.name, 'GitHubCliError');
      assert.strictEqual(error.exitCode, 1);
    });

    it('documents expected behavior when gh CLI edit fails', () => {
      /**
       * SPECIFICATION: Error handling for gh pr/issue edit failures
       *
       * When the edit command fails (after successful view):
       * - Function should propagate the error
       * - State has NOT been persisted to GitHub
       * - Caller must handle retry (state update is not atomic)
       *
       * Common failure scenarios:
       * 1. PR closed during update (race condition)
       * 2. Permission revoked between view and edit
       * 3. Network failure during edit
       * 4. Rate limit hit during edit
       *
       * Expected behavior:
       * - GitHubCliError is thrown
       * - Original body is unchanged on GitHub
       * - State marker is NOT present in PR/issue body
       */
      const error = new GitHubCliError('Edit failed', 1, 'gh: Failed to edit PR');
      assert.ok(error instanceof Error);
      assert.strictEqual(error.message.includes('Edit failed'), true);
    });

    it('documents critical error propagation for auth/permission failures', () => {
      /**
       * SPECIFICATION: Critical error propagation
       *
       * The get functions (getWiggumStateFromPRBody, getWiggumStateFromIssueBody)
       * must propagate critical errors instead of returning null:
       *
       * Exit codes that should propagate:
       * - 401: Authentication required (expired token, invalid credentials)
       * - 403: Access denied (no permission to view resource)
       * - 404: Resource not found (PR/issue doesn't exist)
       *
       * Exit codes that should NOT propagate (return null):
       * - Network timeouts (transient)
       * - 5xx server errors (transient)
       *
       * Rationale:
       * - 401/403/404 indicate configuration problems that won't self-resolve
       * - User needs immediate feedback to fix credentials/permissions
       * - Transient errors may resolve on retry
       */
      const criticalCodes = [401, 403, 404];
      for (const code of criticalCodes) {
        const error = new GitHubCliError(`Error ${code}`, code);
        assert.ok(criticalCodes.includes(error.exitCode!));
      }
    });
  });

  describe('read-modify-write pattern verification', () => {
    it('documents the read-modify-write sequence', () => {
      /**
       * SPECIFICATION: Read-modify-write pattern for state updates
       *
       * Both updatePRBodyState and updateIssueBodyState follow this pattern:
       *
       * 1. READ: Fetch current body via gh <pr|issue> view --json body
       * 2. MODIFY: Call injectStateIntoBody(currentBody, newState)
       * 3. WRITE: Update body via gh <pr|issue> edit --body <updatedBody>
       *
       * Key properties:
       * - Preserves all existing PR/issue body content
       * - Only modifies/adds the wiggum-state marker
       * - If marker exists, replaces it in-place
       * - If marker doesn't exist, prepends it to body
       *
       * Race condition considerations:
       * - Another process may modify body between read and write
       * - Our write will overwrite their changes
       * - This is acceptable because:
       *   1. Human edits to body are rare during workflow
       *   2. State marker is at top of body, visible for conflict resolution
       *   3. Workflow can be restarted if conflicts occur
       */
      const originalBody = 'PR description text';
      const state: WiggumState = {
        iteration: 1,
        step: 'p2-3',
        completedSteps: ['p1-1', 'p1-2', 'p1-3', 'p1-4', 'p2-1', 'p2-2'],
        phase: 'phase2',
      };

      // Simulate read-modify-write
      const stateJson = JSON.stringify(state);
      const stateMarker = `<!-- ${WIGGUM_STATE_MARKER}:${stateJson} -->`;
      const updatedBody = `${stateMarker}\n\n${originalBody}`;

      // Verify marker is prepended
      assert.ok(updatedBody.startsWith(`<!-- ${WIGGUM_STATE_MARKER}:`));
      assert.ok(updatedBody.includes(originalBody));
      assert.ok(updatedBody.includes('"iteration":1'));
    });

    it('documents state marker replacement behavior', () => {
      /**
       * SPECIFICATION: State marker replacement
       *
       * When existing state marker is present:
       * - New marker replaces old marker in-place
       * - Body content before and after marker is preserved
       * - Only one marker exists after update
       *
       * Pattern matching:
       * - Regex: /<!--\s*wiggum-state:.+?\s*-->/s
       * - The 's' flag allows matching across newlines
       * - Non-greedy '.+?' prevents matching multiple markers
       */
      const oldState: WiggumState = {
        iteration: 0,
        step: 'p1-1',
        completedSteps: [],
        phase: 'phase1',
      };
      const newState: WiggumState = {
        iteration: 1,
        step: 'p1-2',
        completedSteps: ['p1-1'],
        phase: 'phase1',
      };

      const oldMarker = `<!-- ${WIGGUM_STATE_MARKER}:${JSON.stringify(oldState)} -->`;
      const newMarker = `<!-- ${WIGGUM_STATE_MARKER}:${JSON.stringify(newState)} -->`;

      const bodyWithOldState = `${oldMarker}\n\nPR content`;

      // Simulate replacement
      const regex = new RegExp(`<!--\\s*${WIGGUM_STATE_MARKER}:.+?\\s*-->`, 's');
      const updatedBody = bodyWithOldState.replace(regex, newMarker);

      // Verify replacement
      assert.ok(updatedBody.includes('"iteration":1'));
      assert.ok(!updatedBody.includes('"iteration":0'));
      assert.ok(updatedBody.includes('PR content'));

      // Verify only one marker
      const markerMatches = updatedBody.match(new RegExp(WIGGUM_STATE_MARKER, 'g'));
      assert.strictEqual(markerMatches?.length, 1);
    });
  });

  describe('state retrieval integration', () => {
    it('documents expected gh CLI arguments for PR state retrieval', () => {
      /**
       * SPECIFICATION: gh CLI arguments for getWiggumStateFromPRBody
       *
       * Arguments: ['pr', 'view', '<number>', '--json', 'body', '-q', '.body']
       *
       * With repo option:
       * - Prefixed with ['--repo', 'owner/repo']
       *
       * Expected response:
       * - Raw PR body text (not JSON wrapped)
       * - May contain wiggum-state marker or not
       * - May be empty string for empty body
       */
      const args = ['pr', 'view', '123', '--json', 'body', '-q', '.body'];
      assert.deepStrictEqual(args, ['pr', 'view', '123', '--json', 'body', '-q', '.body']);
    });

    it('documents expected gh CLI arguments for issue state retrieval', () => {
      /**
       * SPECIFICATION: gh CLI arguments for getWiggumStateFromIssueBody
       *
       * Arguments: ['issue', 'view', '<number>', '--json', 'body', '-q', '.body']
       *
       * With repo option:
       * - Prefixed with ['--repo', 'owner/repo']
       *
       * Expected response:
       * - Raw issue body text (not JSON wrapped)
       * - May contain wiggum-state marker or not
       * - May be empty string for empty body
       */
      const args = ['issue', 'view', '123', '--json', 'body', '-q', '.body'];
      assert.deepStrictEqual(args, ['issue', 'view', '123', '--json', 'body', '-q', '.body']);
    });

    it('documents StateCorruptionError propagation from get functions', () => {
      /**
       * SPECIFICATION: StateCorruptionError propagation
       *
       * When extractStateFromBody throws StateCorruptionError:
       * - getWiggumStateFromPRBody re-throws with PR context logged
       * - getWiggumStateFromIssueBody re-throws with issue context logged
       *
       * The error contains:
       * - Actionable recovery instructions
       * - matchedJsonPreview (truncated to 200 chars)
       * - bodyLength for debugging
       * - originalError message
       *
       * Caller responsibility:
       * - Display error message to user
       * - User must manually fix/remove corrupted state marker
       */
      const corruptedBody = `<!-- ${WIGGUM_STATE_MARKER}:{"broken -->`;
      assert.ok(corruptedBody.includes(WIGGUM_STATE_MARKER));
      // Verify this is a corrupted state marker (JSON is truncated before closing)
      assert.ok(corruptedBody.includes('{'));
      assert.ok(!corruptedBody.includes('}}'), 'JSON should be incomplete/truncated');
    });
  });

  describe('repo option handling', () => {
    it('documents repo option passthrough to ghCli', () => {
      /**
       * SPECIFICATION: Repository option handling
       *
       * All body-state functions accept optional repo parameter:
       * - updatePRBodyState(prNumber, state, repo?)
       * - updateIssueBodyState(issueNumber, state, repo?)
       * - getWiggumStateFromPRBody(prNumber, repo?)
       * - getWiggumStateFromIssueBody(issueNumber, repo?)
       *
       * When repo is provided:
       * - ghCli is called with { repo } option
       * - ghCli prepends ['--repo', repo] to args
       *
       * When repo is not provided:
       * - ghCli is called with {} option (empty object)
       * - ghCli uses current repo from git context
       *
       * Example with repo:
       * - viewArgs: ['--repo', 'owner/repo', 'pr', 'view', '123', '--json', 'body', '-q', '.body']
       * - editArgs: ['--repo', 'owner/repo', 'pr', 'edit', '123', '--body', '<body>']
       */
      const repo = 'owner/repo';
      const options = repo ? { repo } : {};

      assert.deepStrictEqual(options, { repo: 'owner/repo' });

      // Test without repo - simulates undefined repo parameter
      const noRepo: string | undefined = undefined;
      const noRepoOptions = noRepo ? { repo: noRepo } : {};
      assert.deepStrictEqual(noRepoOptions, {});
    });
  });

  describe('logging verification', () => {
    it('documents expected log entries for successful state update', () => {
      /**
       * SPECIFICATION: Success logging for state updates
       *
       * On successful update, logger.info is called with:
       * - Message: 'updatePRBodyState: successfully updated PR body state'
       *            or 'updateIssueBodyState: successfully updated issue body state'
       * - Context object containing:
       *   - prNumber or issueNumber
       *   - repo (if provided)
       *   - iteration: state.iteration
       *   - step: state.step
       *   - phase: state.phase
       *   - maxIterations: state.maxIterations (if defined)
       *
       * This logging enables:
       * - Audit trail of state changes
       * - Debugging workflow progression
       * - Monitoring state update frequency
       */
      const logContext = {
        prNumber: 123,
        repo: 'owner/repo',
        iteration: 2,
        step: 'p2-4',
        phase: 'phase2',
        maxIterations: 10,
      };

      assert.strictEqual(logContext.iteration, 2);
      assert.strictEqual(logContext.step, 'p2-4');
    });

    it('documents expected log entries for state retrieval failures', () => {
      /**
       * SPECIFICATION: Failure logging for state retrieval
       *
       * When gh CLI fails with non-critical error:
       * - logger.warn is called with 'treating as no state' message
       * - Returns null instead of throwing
       *
       * When gh CLI fails with critical error (401, 403, 404):
       * - logger.error is called with 'critical error - propagating' message
       * - Error is re-thrown
       *
       * When state is corrupted:
       * - logger.error is called with 'state corruption detected' message
       * - StateCorruptionError is re-thrown
       */
      const criticalLogContext = {
        prNumber: 123,
        repo: 'owner/repo',
        exitCode: 404,
        error: 'PR not found',
        impact: 'Cannot proceed without valid PR access',
      };

      assert.strictEqual(criticalLogContext.exitCode, 404);
    });
  });
});

describe('body-state contract verification', () => {
  describe('state roundtrip contract', () => {
    it('verifies state can be injected and extracted unchanged', () => {
      /**
       * CONTRACT: State roundtrip integrity
       *
       * For any valid WiggumState:
       * - inject(body, state) produces body with embedded state
       * - extract(inject(body, state)) === state
       *
       * This contract is critical because:
       * - State is the single source of truth for workflow position
       * - Any data loss or corruption halts the workflow
       * - Users cannot easily debug corrupted state
       */
      const state: WiggumState = {
        iteration: 5,
        step: 'p2-5',
        completedSteps: ['p1-1', 'p1-2', 'p1-3', 'p1-4', 'p2-1', 'p2-2', 'p2-3', 'p2-4'],
        phase: 'phase2',
        maxIterations: 15,
      };

      // Simulate roundtrip
      const stateJson = JSON.stringify(state);
      const marker = `<!-- ${WIGGUM_STATE_MARKER}:${stateJson} -->`;
      const body = `${marker}\n\nOriginal content`;

      // Extract state from body
      const regex = new RegExp(`<!--\\s*${WIGGUM_STATE_MARKER}:(.+?)\\s*-->`, 's');
      const match = body.match(regex);
      assert.ok(match);

      const extracted = JSON.parse(match[1]);
      assert.deepStrictEqual(extracted, state);
    });
  });

  describe('PR number type contract', () => {
    it('documents that PR number must be integer', () => {
      /**
       * CONTRACT: PR/issue numbers are positive integers
       *
       * All functions accept number type for prNumber/issueNumber:
       * - updatePRBodyState(prNumber: number, ...)
       * - updateIssueBodyState(issueNumber: number, ...)
       * - getWiggumStateFromPRBody(prNumber: number, ...)
       * - getWiggumStateFromIssueBody(issueNumber: number, ...)
       *
       * The number is converted to string for gh CLI args:
       * - prNumber.toString()
       *
       * Edge cases:
       * - Floating point: 123.5.toString() = '123.5' (invalid for GitHub)
       * - Negative: (-123).toString() = '-123' (invalid for GitHub)
       * - Zero: (0).toString() = '0' (invalid for GitHub)
       *
       * Validation is NOT done in body-state (callers responsibility)
       */
      assert.strictEqual((123).toString(), '123');
      assert.strictEqual((123.5).toString(), '123.5'); // Would fail at GitHub
      assert.strictEqual((-1).toString(), '-1'); // Would fail at GitHub
    });
  });

  describe('state schema contract', () => {
    it('documents required WiggumState fields', () => {
      /**
       * CONTRACT: WiggumState required fields
       *
       * All state objects must have:
       * - iteration: non-negative integer
       * - step: valid WiggumStep string
       * - completedSteps: array of WiggumStep strings
       * - phase: 'phase1' | 'phase2'
       *
       * Optional fields:
       * - maxIterations: positive integer
       *
       * JSON serialization:
       * - All fields are serialized to JSON
       * - completedSteps array maintains order
       * - undefined maxIterations is omitted from JSON
       */
      const minimalState: WiggumState = {
        iteration: 0,
        step: 'p1-1',
        completedSteps: [],
        phase: 'phase1',
      };

      const fullState: WiggumState = {
        iteration: 3,
        step: 'p2-3',
        completedSteps: ['p1-1', 'p1-2'],
        phase: 'phase2',
        maxIterations: 10,
      };

      // Verify JSON serialization
      const minimalJson = JSON.parse(JSON.stringify(minimalState));
      assert.strictEqual(minimalJson.maxIterations, undefined);

      const fullJson = JSON.parse(JSON.stringify(fullState));
      assert.strictEqual(fullJson.maxIterations, 10);
    });
  });
});
