/**
 * Example tests for error handling utilities
 *
 * This demonstrates testing patterns for MCP server code.
 * Run with: npm test
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  McpError,
  TimeoutError,
  ValidationError,
  NetworkError,
  createErrorResult,
  isTerminalError,
} from "./errors.js";

describe("Error Classes", () => {
  it("McpError includes error code", () => {
    const error = new McpError("Test error", "TEST_CODE");
    assert.equal(error.message, "Test error");
    assert.equal(error.code, "TEST_CODE");
    assert.equal(error.name, "McpError");
  });

  it("TimeoutError has TIMEOUT code", () => {
    const error = new TimeoutError("Operation timed out");
    assert.equal(error.message, "Operation timed out");
    assert.equal(error.code, "TIMEOUT");
    assert.equal(error.name, "TimeoutError");
  });

  it("ValidationError has VALIDATION_ERROR code", () => {
    const error = new ValidationError("Invalid input");
    assert.equal(error.message, "Invalid input");
    assert.equal(error.code, "VALIDATION_ERROR");
    assert.equal(error.name, "ValidationError");
  });

  it("NetworkError has NETWORK_ERROR code", () => {
    const error = new NetworkError("Connection failed");
    assert.equal(error.message, "Connection failed");
    assert.equal(error.code, "NETWORK_ERROR");
    assert.equal(error.name, "NetworkError");
  });
});

describe("createErrorResult", () => {
  it("categorizes TimeoutError correctly", () => {
    const error = new TimeoutError("Timed out");
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    assert.equal(result.content[0]?.type, "text");
    assert.equal((result.content[0] as any).text, "Error: Timed out");
    assert.equal((result._meta as any)?.errorType, "TimeoutError");
    assert.equal((result._meta as any)?.errorCode, "TIMEOUT");
  });

  it("categorizes ValidationError correctly", () => {
    const error = new ValidationError("Invalid parameter");
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    assert.equal((result._meta as any)?.errorType, "ValidationError");
    assert.equal((result._meta as any)?.errorCode, "VALIDATION_ERROR");
  });

  it("categorizes NetworkError correctly", () => {
    const error = new NetworkError("Connection refused");
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    assert.equal((result._meta as any)?.errorType, "NetworkError");
    assert.equal((result._meta as any)?.errorCode, "NETWORK_ERROR");
  });

  it("handles generic Error", () => {
    const error = new Error("Generic error");
    const result = createErrorResult(error);

    assert.equal(result.isError, true);
    assert.equal((result.content[0] as any).text, "Error: Generic error");
    assert.equal((result._meta as any)?.errorType, "UnknownError");
  });

  it("handles string errors", () => {
    const result = createErrorResult("String error");

    assert.equal(result.isError, true);
    assert.equal((result.content[0] as any).text, "Error: String error");
    assert.equal((result._meta as any)?.errorType, "UnknownError");
  });
});

describe("isTerminalError", () => {
  it("ValidationError is terminal", () => {
    const error = new ValidationError("Bad input");
    assert.equal(isTerminalError(error), true);
  });

  it("TimeoutError is not terminal (may be retryable)", () => {
    const error = new TimeoutError("Timed out");
    assert.equal(isTerminalError(error), false);
  });

  it("NetworkError is not terminal (may be retryable)", () => {
    const error = new NetworkError("Connection failed");
    assert.equal(isTerminalError(error), false);
  });

  it("Generic error is not terminal", () => {
    const error = new Error("Generic error");
    assert.equal(isTerminalError(error), false);
  });
});
