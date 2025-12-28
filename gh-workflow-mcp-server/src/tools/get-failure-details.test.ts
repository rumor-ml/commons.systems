/**
 * Tests for get-failure-details tool
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { getFailureDetails } from './get-failure-details.js';
import * as ghCli from '../utils/gh-cli.js';

describe('GetFailureDetails - Fallback Warning', () => {
  it('displays fallback warning when log-failed fails', async () => {
    // Mock getWorkflowRun to return a failed run
    mock.method(ghCli, 'getWorkflowRun', () =>
      Promise.resolve({
        databaseId: 123,
        name: 'Test Workflow',
        status: 'completed',
        conclusion: 'failure',
        url: 'https://github.com/owner/repo/actions/runs/123',
      })
    );

    // Mock resolveRepo to return a valid repo
    mock.method(ghCli, 'resolveRepo', () => Promise.resolve('owner/repo'));

    // Mock getFailedStepLogs to throw error (simulating log-failed failure)
    mock.method(ghCli, 'getFailedStepLogs', () => {
      throw new Error('gh run view --log-failed failed');
    });

    // Mock parseFailedStepLogs (not called when getFailedStepLogs fails)
    mock.method(ghCli, 'parseFailedStepLogs', () => ({
      steps: [],
      totalLines: 0,
      skippedLines: 0,
      successRate: 1,
      isComplete: true,
    }));

    // Mock getWorkflowJobs to return failed jobs (fallback path)
    mock.method(ghCli, 'getWorkflowJobs', () =>
      Promise.resolve([
        {
          databaseId: 456,
          name: 'Test Job',
          status: 'completed',
          conclusion: 'failure',
          url: 'https://github.com/owner/repo/actions/runs/123/job/456',
          steps: [
            {
              name: 'Test Step',
              status: 'completed',
              conclusion: 'failure',
              number: 1,
            },
          ],
        },
      ])
    );

    // Mock getJobLogs to return empty logs
    mock.method(ghCli, 'getJobLogs', () => Promise.resolve(''));

    const result = await getFailureDetails({ run_id: 123, max_chars: 10000 });

    // Verify result is successful (function doesn't crash)
    assert.ok(result.isError === undefined || result.isError === false);

    // Verify output contains the fallback warning prefix
    const output = typeof result === 'string' ? result : result.content?.[0]?.text || '';
    assert.match(output, /⚠️\s+WARNING: Unable to use/);
    assert.match(output, /Falling back to:/);
  });

  it('does NOT display fallback warning when log-failed succeeds', async () => {
    // Mock getWorkflowRun to return a failed run
    mock.method(ghCli, 'getWorkflowRun', () =>
      Promise.resolve({
        databaseId: 123,
        name: 'Test Workflow',
        status: 'completed',
        conclusion: 'failure',
        url: 'https://github.com/owner/repo/actions/runs/123',
      })
    );

    // Mock resolveRepo to return a valid repo
    mock.method(ghCli, 'resolveRepo', () => Promise.resolve('owner/repo'));

    // Mock getFailedStepLogs to succeed
    mock.method(ghCli, 'getFailedStepLogs', () =>
      Promise.resolve('Test failure output from --log-failed')
    );

    // Mock parseFailedStepLogs to return parsed failures with completeness info
    mock.method(ghCli, 'parseFailedStepLogs', () => ({
      steps: [
        {
          jobName: 'Test Job',
          stepName: 'Test Step',
          lines: ['Test failure output'],
        },
      ],
      totalLines: 1,
      skippedLines: 0,
      successRate: 1,
      isComplete: true,
    }));

    const result = await getFailureDetails({ run_id: 123, max_chars: 10000 });

    // Verify result is successful
    assert.ok(result.isError === undefined || result.isError === false);

    // Verify output does NOT contain the fallback warning
    const output = typeof result === 'string' ? result : result.content?.[0]?.text || '';
    assert.doesNotMatch(output, /⚠️\s+WARNING: Unable to use/);
    assert.doesNotMatch(output, /Falling back to:/);
  });
});
