/**
 * Tool: wiggum_complete_pr_creation
 *
 * Called when Step 0 (Ensure PR) instructs creation of PR
 * Codifies the entire PR creation process following completion tool pattern
 *
 * ERROR HANDLING STRATEGY:
 *
 * This handler implements defensive error handling with explicit ValidationError throws
 * for all user-facing error conditions. Error handling is split into three categories:
 *
 * 1. VALIDATION ERRORS (throw ValidationError - user must intervene):
 *    - PR already exists for branch (handleStepEnsurePR validation)
 *    - Invalid branch name format (extractIssueNumber function)
 *    - Failed to parse PR number from gh output (after gh pr create)
 *    - Failed to verify PR after creation (getPR verification)
 *    - GitHub API errors during PR creation (gh pr create errors)
 *
 * 2. LOGGED ERRORS (logged but execution continues with fallback):
 *    - Failed to fetch commits from GitHub API (commits fetch try/catch)
 *      Fallback: Include error message in PR body with manual workaround
 *
 * 3. STRUCTURED LOGGING (info/error logging for observability):
 *    - PR creation start (wiggum_complete_pr_creation entry)
 *    - Closed/merged PR exists (state validation)
 *    - Commit fetch failure (commits fetch catch block)
 *    - PR creation success (after gh pr create)
 *    - PR verification success (after getPR call)
 *    - PR creation failure (outer catch block)
 *
 * All ValidationErrors include actionable context for the user.
 * All errors are logged with structured metadata (prNumber, branch, error message).
 */

import { z } from 'zod';
import { detectCurrentState } from '../state/detector.js';
import { getNextStepInstructions } from '../state/router.js';
import { addToCompletedSteps } from '../state/state-utils.js';
import { logger } from '../utils/logger.js';
import { STEP_PHASE1_CREATE_PR, NEEDS_REVIEW_LABEL } from '../constants.js';
import { ValidationError, StateApiError, NetworkError } from '../utils/errors.js';
import { getCurrentBranch } from '../utils/git.js';
import { ghCli, getPR } from '../utils/gh-cli.js';
import { sanitizeErrorMessage } from '../utils/security.js';
import type { ToolResult } from '../types.js';
import type { WiggumState, CurrentState } from '../state/types.js';

export const CompletePRCreationInputSchema = z.object({
  pr_description: z.string().describe("Agent's description of PR contents and changes"),
});

export type CompletePRCreationInput = z.infer<typeof CompletePRCreationInputSchema>;

/**
 * Extract issue number from branch name
 * Expected format: "123-feature-name" -> "123"
 */
function extractIssueNumber(branchName: string): string {
  const issueNum = branchName.split('-')[0];
  if (!/^\d+$/.test(issueNum)) {
    throw new ValidationError(
      `First segment of branch name must be numeric issue number. Got: "${issueNum}" from branch: "${branchName}"`
    );
  }

  return issueNum;
}

/**
 * Create PR and complete Step 0
 */
export async function completePRCreation(input: CompletePRCreationInput): Promise<ToolResult> {
  const state = await detectCurrentState();

  logger.info('wiggum_complete_pr_creation', {
    branch: state.git.currentBranch,
    iteration: state.wiggum.iteration,
  });

  // Validate PR doesn't already exist (or is closed/merged)
  if (state.pr.exists && state.pr.state === 'OPEN') {
    throw new ValidationError(
      `An open PR #${state.pr.number} already exists for this branch: "${state.pr.title}". ` +
        `Cannot create a duplicate PR while an open PR exists. ` +
        `If you just created this PR manually with gh pr create, you should NOT call this tool. ` +
        `This tool handles PR creation automatically. The PR already exists, so workflow can continue. ` +
        `Call wiggum_init to get next step instructions instead.`
    );
  }

  // If a closed/merged PR exists, we can create a new one
  // Log this for transparency
  if (state.pr.exists && state.pr.state !== 'OPEN') {
    logger.info(
      `A ${state.pr.state.toLowerCase()} PR #${state.pr.number} exists for branch "${state.git.currentBranch}". Creating a new PR as the previous one is not open.`,
      {
        previousPrNumber: state.pr.number,
        previousPrState: state.pr.state,
        branch: state.git.currentBranch,
      }
    );
  }

  // Get current branch
  const branchName = await getCurrentBranch();

  // Extract and validate issue number from branch name
  const issueNum = extractIssueNumber(branchName);

  // Get commit messages for PR body
  let commits: string;
  let commitsFallback = false;

  try {
    commits = await ghCli([
      'api',
      'repos/{owner}/{repo}/compare/main...HEAD',
      '--jq',
      '.commits | map("- " + .commit.message) | join("\\n")',
    ]);
    commits = commits.trim();
  } catch (error) {
    commitsFallback = true;
    const errorMsg = error instanceof Error ? error.message : String(error);

    logger.warn('Failed to fetch commits - using fallback message in PR body', {
      error: errorMsg,
      branch: branchName,
      willContinue: true,
    });

    // Sanitize error message for PR body using security utility
    // Full error is already logged above for debugging
    const sanitizedError = sanitizeErrorMessage(errorMsg, 500);

    commits = `⚠️ **Unable to fetch commits from GitHub API**

Error: ${sanitizedError}

**Manual workaround:** Run \`git log main..HEAD --oneline\` to see commits.`;
  }

  // Build PR body
  const prBody = `closes #${issueNum}

${input.pr_description}

## Commits

${commits}`;

  // Create PR using gh CLI
  let prNumber: number;
  let createOutput: string;

  try {
    createOutput = await ghCli([
      'pr',
      'create',
      '--base',
      'main',
      '--label',
      NEEDS_REVIEW_LABEL,
      '--title',
      branchName,
      '--body',
      prBody,
    ]);

    logger.info('PR creation command executed successfully', {
      outputLength: createOutput.length,
      branch: branchName,
      commitsFallback,
    });

    // Parse PR URL from output (gh pr create outputs the PR URL)
    const prUrl = createOutput.trim();

    // Extract PR number from URL (format: https://github.com/owner/repo/pull/123)
    const urlMatch = prUrl.match(/\/pull\/(\d+)$/);
    if (!urlMatch) {
      logger.error('Failed to parse PR number from gh pr create output', {
        output: prUrl,
        branch: branchName,
      });
      throw new ValidationError(
        `Failed to parse PR number from gh pr create output. ` +
          `Expected URL format: "https://github.com/owner/repo/pull/123". ` +
          `Got: "${prUrl}"`
      );
    }
    prNumber = parseInt(urlMatch[1], 10);

    // Verify PR was created by fetching it
    let pr;
    try {
      pr = await getPR(prNumber);
      logger.info('PR verified successfully', {
        prNumber,
        title: pr.title,
        state: pr.state,
      });
    } catch (verifyError) {
      const errorMsg = verifyError instanceof Error ? verifyError.message : String(verifyError);

      logger.error('Failed to verify PR after creation', {
        prNumber,
        errorType: verifyError instanceof Error ? verifyError.constructor.name : typeof verifyError,
        error: errorMsg,
      });

      // Re-throw specific error types with proper context
      if (verifyError instanceof StateApiError || verifyError instanceof NetworkError) {
        throw verifyError;
      }

      // Only treat unknown errors as verification failures
      throw new ValidationError(
        `PR #${prNumber} was created but could not be verified. ` +
          `This may indicate a timing issue with GitHub API. ` +
          `Error: ${errorMsg}`
      );
    }

    // Mark Phase 1 Step 4 complete and transition to Phase 2
    // Reset maxIterations to default for the new PR (Phase 2)
    // State will be persisted to PR body by getNextStepInstructions() via safeUpdatePRBodyState()
    const newState: WiggumState = {
      iteration: state.wiggum.iteration,
      step: STEP_PHASE1_CREATE_PR,
      completedSteps: addToCompletedSteps(state.wiggum.completedSteps, STEP_PHASE1_CREATE_PR),
      phase: 'phase2',
      maxIterations: undefined,
    };

    // Fix stale PR state after PR creation (issue #429)
    // The state captured at line 83 has pr.exists = false since no PR existed yet.
    // We have authoritative PR data from the verified getPR() call, so we construct
    // a complete updated state with both the new wiggum state AND the new PR state.
    const updatedState: CurrentState = {
      ...state,
      wiggum: newState,
      pr: {
        exists: true,
        number: prNumber,
        title: pr.title,
        state: 'OPEN',
        url: createOutput.trim(),
        labels: [NEEDS_REVIEW_LABEL],
        headRefName: branchName,
        baseRefName: pr.baseRefName,
      },
    };

    logger.info('Updated state with newly created PR', {
      issueRef: '#429',
      prNumber,
      prTitle: pr.title,
      phase: newState.phase,
    });

    return await getNextStepInstructions(updatedState);
  } catch (error) {
    // Check if error indicates PR already exists
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('PR creation failed', {
      error: errorMsg,
      branch: branchName,
      issueNum,
    });

    if (errorMsg.includes('already exists')) {
      throw new ValidationError(
        `PR already exists for branch "${branchName}". Cannot create duplicate PR. ` +
          `If you just created this PR manually, call wiggum_init instead to continue.`
      );
    }
    // Re-throw other errors (including ValidationError from parsing/verification)
    throw error;
  }
}
