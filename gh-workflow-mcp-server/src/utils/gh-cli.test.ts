/**
 * Unit tests for GitHub CLI state mapping functions
 */

import { describe, test } from "node:test";
import assert from "node:assert";
import { mapStateToStatus, mapStateToConclusion } from "./gh-cli.js";

describe("mapStateToStatus", () => {
  test("maps PENDING to in_progress", () => {
    assert.strictEqual(mapStateToStatus("PENDING"), "in_progress");
  });

  test("maps QUEUED to in_progress", () => {
    assert.strictEqual(mapStateToStatus("QUEUED"), "in_progress");
  });

  test("maps IN_PROGRESS to in_progress", () => {
    assert.strictEqual(mapStateToStatus("IN_PROGRESS"), "in_progress");
  });

  test("maps WAITING to in_progress", () => {
    assert.strictEqual(mapStateToStatus("WAITING"), "in_progress");
  });

  test("maps SUCCESS to completed", () => {
    assert.strictEqual(mapStateToStatus("SUCCESS"), "completed");
  });

  test("maps FAILURE to completed", () => {
    assert.strictEqual(mapStateToStatus("FAILURE"), "completed");
  });

  test("maps ERROR to completed", () => {
    assert.strictEqual(mapStateToStatus("ERROR"), "completed");
  });

  test("maps CANCELLED to completed", () => {
    assert.strictEqual(mapStateToStatus("CANCELLED"), "completed");
  });

  test("maps SKIPPED to completed", () => {
    assert.strictEqual(mapStateToStatus("SKIPPED"), "completed");
  });

  test("maps STALE to completed", () => {
    assert.strictEqual(mapStateToStatus("STALE"), "completed");
  });

  test("maps unknown states to completed", () => {
    assert.strictEqual(mapStateToStatus("UNKNOWN"), "completed");
    assert.strictEqual(mapStateToStatus("CUSTOM_STATE"), "completed");
  });

  test("handles lowercase states (treats as unknown, maps to completed)", () => {
    assert.strictEqual(mapStateToStatus("pending"), "completed");
    assert.strictEqual(mapStateToStatus("success"), "completed");
  });

  test("handles empty string (treats as unknown, maps to completed)", () => {
    assert.strictEqual(mapStateToStatus(""), "completed");
  });
});

describe("mapStateToConclusion", () => {
  test("maps SUCCESS to success", () => {
    assert.strictEqual(mapStateToConclusion("SUCCESS"), "success");
  });

  test("maps FAILURE to failure", () => {
    assert.strictEqual(mapStateToConclusion("FAILURE"), "failure");
  });

  test("maps ERROR to failure (edge case: errors treated as failures)", () => {
    assert.strictEqual(mapStateToConclusion("ERROR"), "failure");
  });

  test("maps CANCELLED to cancelled", () => {
    assert.strictEqual(mapStateToConclusion("CANCELLED"), "cancelled");
  });

  test("maps SKIPPED to skipped", () => {
    assert.strictEqual(mapStateToConclusion("SKIPPED"), "skipped");
  });

  test("maps STALE to skipped (edge case: stale checks treated as skipped)", () => {
    assert.strictEqual(mapStateToConclusion("STALE"), "skipped");
  });

  test("maps PENDING to null (in-progress state)", () => {
    assert.strictEqual(mapStateToConclusion("PENDING"), null);
  });

  test("maps QUEUED to null (in-progress state)", () => {
    assert.strictEqual(mapStateToConclusion("QUEUED"), null);
  });

  test("maps IN_PROGRESS to null (in-progress state)", () => {
    assert.strictEqual(mapStateToConclusion("IN_PROGRESS"), null);
  });

  test("maps WAITING to null (in-progress state)", () => {
    assert.strictEqual(mapStateToConclusion("WAITING"), null);
  });

  test("maps unknown states to null", () => {
    assert.strictEqual(mapStateToConclusion("UNKNOWN"), null);
    assert.strictEqual(mapStateToConclusion("CUSTOM_STATE"), null);
  });

  test("handles lowercase states (treats as unknown, maps to null)", () => {
    assert.strictEqual(mapStateToConclusion("success"), null);
    assert.strictEqual(mapStateToConclusion("failure"), null);
  });

  test("handles empty string (treats as unknown, maps to null)", () => {
    assert.strictEqual(mapStateToConclusion(""), null);
  });
});

describe("mapStateToStatus and mapStateToConclusion consistency", () => {
  test("all in-progress states map to in_progress status and null conclusion", () => {
    const inProgressStates = ["PENDING", "QUEUED", "IN_PROGRESS", "WAITING"];

    for (const state of inProgressStates) {
      assert.strictEqual(
        mapStateToStatus(state),
        "in_progress",
        `${state} should map to in_progress status`
      );
      assert.strictEqual(
        mapStateToConclusion(state),
        null,
        `${state} should map to null conclusion`
      );
    }
  });

  test("all terminal states map to completed status and non-null conclusion", () => {
    const terminalStates = [
      { state: "SUCCESS", conclusion: "success" },
      { state: "FAILURE", conclusion: "failure" },
      { state: "ERROR", conclusion: "failure" },
      { state: "CANCELLED", conclusion: "cancelled" },
      { state: "SKIPPED", conclusion: "skipped" },
      { state: "STALE", conclusion: "skipped" },
    ];

    for (const { state, conclusion } of terminalStates) {
      assert.strictEqual(
        mapStateToStatus(state),
        "completed",
        `${state} should map to completed status`
      );
      assert.strictEqual(
        mapStateToConclusion(state),
        conclusion,
        `${state} should map to ${conclusion} conclusion`
      );
    }
  });
});
