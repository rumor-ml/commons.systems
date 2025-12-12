/**
 * GitHub Actions workflow monitoring utilities
 */

import { ghCli, sleep } from './gh-cli.js';

export interface MonitorResult {
  success: boolean;
  errorSummary?: string;
}

interface WorkflowRun {
  databaseId: number;
  status: string;
  conclusion: string | null;
}

interface PRCheck {
  name: string;
  status: string;
  conclusion: string | null;
}

/**
 * Monitor a workflow run until completion
 *
 * Polls the latest workflow run for the specified branch until it completes.
 * Waits for status to be 'completed' and checks conclusion for success/failure.
 *
 * @param branch - Branch name to monitor
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 600000 = 10 minutes)
 * @returns MonitorResult with success status and optional error summary
 *
 * @example
 * ```typescript
 * const result = await monitorRun('feature-123');
 * if (!result.success) {
 *   console.log(result.errorSummary);
 * }
 * ```
 */
export async function monitorRun(branch: string, timeoutMs = 600000): Promise<MonitorResult> {
  const startTime = Date.now();
  const pollInterval = 10000; // 10 seconds

  try {
    // Get latest run for branch
    const runsOutput = await ghCli([
      'run',
      'list',
      '--branch',
      branch,
      '--limit',
      '1',
      '--json',
      'databaseId,status,conclusion',
    ]);

    const runs = JSON.parse(runsOutput) as WorkflowRun[];
    if (runs.length === 0) {
      return {
        success: false,
        errorSummary: `No workflow runs found for branch ${branch}`,
      };
    }

    const runId = runs[0].databaseId;

    // Poll until completion or timeout
    while (Date.now() - startTime < timeoutMs) {
      const runOutput = await ghCli([
        'run',
        'view',
        runId.toString(),
        '--json',
        'status,conclusion',
      ]);
      const run = JSON.parse(runOutput) as WorkflowRun;

      // Check if run is complete
      if (run.status === 'completed') {
        if (run.conclusion === 'success') {
          return { success: true };
        } else {
          // Get failure details
          const failureOutput = await ghCli(['run', 'view', runId.toString(), '--log-failed']);
          return {
            success: false,
            errorSummary: `Workflow failed with conclusion: ${run.conclusion}\n\nFailed logs:\n${failureOutput.substring(0, 2000)}`,
          };
        }
      }

      // Wait before next poll
      await sleep(pollInterval);
    }

    // Timeout reached
    return {
      success: false,
      errorSummary: `Workflow monitoring timed out after ${timeoutMs}ms. Run ID: ${runId}`,
    };
  } catch (error) {
    return {
      success: false,
      errorSummary: `Error monitoring workflow: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Monitor PR checks until all complete
 *
 * Polls all status checks for the specified PR until they all complete.
 * Returns success only if all checks pass.
 *
 * @param prNumber - PR number to monitor
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 600000 = 10 minutes)
 * @returns MonitorResult with success status and optional error summary
 *
 * @example
 * ```typescript
 * const result = await monitorPRChecks(123);
 * if (!result.success) {
 *   console.log(result.errorSummary);
 * }
 * ```
 */
export async function monitorPRChecks(
  prNumber: number,
  timeoutMs = 600000
): Promise<MonitorResult> {
  const startTime = Date.now();
  const pollInterval = 10000; // 10 seconds

  try {
    // Poll until all checks complete or timeout
    while (Date.now() - startTime < timeoutMs) {
      const checksOutput = await ghCli([
        'pr',
        'checks',
        prNumber.toString(),
        '--json',
        'name,status,conclusion',
      ]);

      const checks = JSON.parse(checksOutput) as PRCheck[];

      if (checks.length === 0) {
        return {
          success: false,
          errorSummary: `No checks found for PR #${prNumber}`,
        };
      }

      // Check if all checks are complete
      const allComplete = checks.every(
        (check) => check.status !== 'in_progress' && check.status !== 'queued'
      );

      if (allComplete) {
        // Check if all passed
        const failedChecks = checks.filter((check) => check.conclusion !== 'success');

        if (failedChecks.length === 0) {
          return { success: true };
        } else {
          const failedNames = failedChecks.map((c) => `${c.name} (${c.conclusion})`).join(', ');
          return {
            success: false,
            errorSummary: `PR checks failed: ${failedNames}`,
          };
        }
      }

      // Wait before next poll
      await sleep(pollInterval);
    }

    // Timeout reached
    return {
      success: false,
      errorSummary: `PR checks monitoring timed out after ${timeoutMs}ms for PR #${prNumber}`,
    };
  } catch (error) {
    return {
      success: false,
      errorSummary: `Error monitoring PR checks: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
