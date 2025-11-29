/**
 * Tests for monitor-run tool
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("MonitorRun - Concurrent Runs Logic", () => {
  it("filters runs by headSha correctly", () => {
    // Sample data from gh run list
    const runs = [
      {
        databaseId: 1,
        headSha: "abc123",
        name: "Workflow 1",
        status: "completed",
        conclusion: "success",
      },
      {
        databaseId: 2,
        headSha: "abc123",
        name: "Workflow 2",
        status: "completed",
        conclusion: "success",
      },
      {
        databaseId: 3,
        headSha: "def456",
        name: "Workflow 1",
        status: "completed",
        conclusion: "success",
      },
    ];

    // Get latest SHA
    const latestSha = runs[0]?.headSha;
    assert.equal(latestSha, "abc123");

    // Filter to concurrent runs
    const concurrentRuns = runs.filter((r) => r.headSha === latestSha);
    assert.equal(concurrentRuns.length, 2);
    assert.deepEqual(
      concurrentRuns.map((r) => r.databaseId),
      [1, 2]
    );
  });

  it("handles single run on branch", () => {
    const runs = [
      {
        databaseId: 1,
        headSha: "abc123",
        name: "Workflow 1",
        status: "completed",
        conclusion: "success",
      },
    ];

    const latestSha = runs[0]?.headSha;
    const concurrentRuns = runs.filter((r) => r.headSha === latestSha);
    assert.equal(concurrentRuns.length, 1);
    assert.equal(concurrentRuns[0].databaseId, 1);
  });

  it("correctly identifies multiple concurrent runs", () => {
    const runs = [
      { databaseId: 1, headSha: "abc123", name: "Build" },
      { databaseId: 2, headSha: "abc123", name: "Test" },
      { databaseId: 3, headSha: "abc123", name: "Lint" },
      { databaseId: 4, headSha: "def456", name: "Build" },
    ];

    const latestSha = runs[0]?.headSha;
    const concurrentRuns = runs.filter((r) => r.headSha === latestSha);
    assert.equal(concurrentRuns.length, 3);
  });

  it("all runs complete check works correctly", () => {
    const runs = new Map([
      [1, { status: "completed" }],
      [2, { status: "completed" }],
      [3, { status: "completed" }],
    ]);

    const allComplete = Array.from(runs.values()).every((run: any) =>
      ["completed"].includes(run.status)
    );
    assert.equal(allComplete, true);
  });

  it("all runs complete check detects in-progress", () => {
    const runs = new Map([
      [1, { status: "completed" }],
      [2, { status: "in_progress" }],
      [3, { status: "completed" }],
    ]);

    const allComplete = Array.from(runs.values()).every((run: any) =>
      ["completed"].includes(run.status)
    );
    assert.equal(allComplete, false);
  });

  it("fail-fast detection works across multiple runs", () => {
    const allJobs = new Map([
      [
        1,
        [
          { name: "Job 1", conclusion: "success" },
          { name: "Job 2", conclusion: "success" },
        ],
      ],
      [
        2,
        [
          { name: "Job 3", conclusion: "success" },
          { name: "Job 4", conclusion: "failure" },
        ],
      ],
      [
        3,
        [
          { name: "Job 5", conclusion: "success" },
          { name: "Job 6", conclusion: null },
        ],
      ],
    ]);

    const failureConclusions = ["failure", "cancelled", "timed_out", "action_required"];
    let failedRunId: number | null = null;

    for (const [runId, jobs] of allJobs.entries()) {
      const failedJob = (jobs as any[]).find(
        (job) => job.conclusion && failureConclusions.includes(job.conclusion)
      );

      if (failedJob) {
        failedRunId = runId;
        break;
      }
    }

    assert.equal(failedRunId, 2);
  });
});
