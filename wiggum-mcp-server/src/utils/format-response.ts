/**
 * Response formatting utilities for Wiggum MCP server
 *
 * This module provides type-safe formatting of wiggum tool responses as markdown.
 * It converts structured wiggum instruction data into human-readable markdown format
 * to avoid JSON decoding errors and improve readability in agent logs.
 *
 * Protocol Context:
 * - Response structure must match ResponseData interface (see lines 43-50)
 * - All fields are required per protocol specification
 * - Context field ordering follows protocol definition but is not semantically significant
 * - Markdown output is consumed directly by LLM agents (not parsed)
 *
 * Key features:
 * - Type-safe response data validation
 * - Robust handling of various context value types
 * - Clear error messages for invalid input
 * - Comprehensive formatting of instructions and metadata
 *
 * @module format-response
 */

import { FormattingError } from './errors.js';

/**
 * Allowed types for context values
 * Supports primitives and arrays for flexibility while maintaining type safety
 */
type ContextValue = string | number | boolean | null | undefined | string[] | number[];

/**
 * Type-safe context object with known fields and extensible additional fields
 */
interface ResponseContext {
  pr_number?: number;
  current_branch?: string;
  [key: string]: ContextValue;
}

/**
 * Structured response data from wiggum tools
 */
interface ResponseData {
  current_step: string;
  step_number: string;
  iteration_count: number;
  instructions: string;
  steps_completed_by_tool: string[];
  context: ResponseContext;
}

/**
 * Validate response data has all required fields with correct types
 *
 * Enforces ResponseData interface schema requirements (see lines 43-50):
 * - All fields are required by protocol specification
 * - Types must match exactly (string, number, array, object as specified)
 * - Missing or mistyped fields indicate protocol violation
 *
 * @param data - Data to validate
 * @throws {FormattingError} If validation fails
 */
function validateResponseData(data: unknown): asserts data is ResponseData {
  if (!data || typeof data !== 'object') {
    throw new FormattingError('Response data must be an object');
  }

  const d = data as Record<string, unknown>;

  // Validate required string fields
  const stringFields = ['current_step', 'step_number', 'instructions'] as const;
  for (const field of stringFields) {
    if (typeof d[field] !== 'string') {
      throw new FormattingError(
        `Missing or invalid ${field}: expected string, got ${typeof d[field]}`
      );
    }
  }

  // Validate iteration_count
  if (typeof d.iteration_count !== 'number') {
    throw new FormattingError(
      `Invalid iteration_count: expected number, got ${typeof d.iteration_count}`
    );
  }

  // Validate steps_completed_by_tool
  if (!Array.isArray(d.steps_completed_by_tool)) {
    throw new FormattingError(
      `Invalid steps_completed_by_tool: expected array, got ${typeof d.steps_completed_by_tool}`
    );
  }
  if (!d.steps_completed_by_tool.every((item) => typeof item === 'string')) {
    throw new FormattingError('All items in steps_completed_by_tool must be strings');
  }

  // Validate context
  if (!d.context || typeof d.context !== 'object') {
    throw new FormattingError(`Invalid context: expected object, got ${typeof d.context}`);
  }
}

/**
 * Format a context value for display in markdown
 *
 * Handles various types (strings, numbers, booleans, arrays, null/undefined)
 * with appropriate formatting for each type.
 *
 * @param value - The value to format
 * @returns Formatted string representation
 */
function formatContextValue(value: ContextValue): string {
  if (value === null || value === undefined) {
    return '_(none)_';
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '_(empty)_';
    }
    return value.join(', ');
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  return String(value);
}

/**
 * Format wiggum response as markdown
 *
 * Takes structured response data and formats it as markdown with clear sections:
 * - Step header with iteration count
 * - Binding instructions section (multiline)
 * - Workflow continuation checklist
 * - Steps completed by tool (bulleted list or "none")
 * - Context section (key-value pairs)
 *
 * Markdown Structure & Semantics:
 * - "BINDING INSTRUCTIONS" section contains imperative commands that MUST be executed
 * - These are state machine transitions, not suggestions or informational content
 * - LLM agent is expected to execute instructions immediately without user interaction
 * - Checklist reinforces protocol requirement to continue until explicit completion
 *
 * @param data - Structured response data from wiggum tool
 * @returns Formatted markdown string
 * @throws {FormattingError} If data validation fails
 *
 * @example
 * ```typescript
 * const markdown = formatWiggumResponse({
 *   current_step: "Security Review",
 *   step_number: "4",
 *   iteration_count: 2,
 *   instructions: "Execute /security-review...",
 *   steps_completed_by_tool: [],
 *   context: { pr_number: 252, current_branch: "feature-branch" }
 * });
 * ```
 */
export function formatWiggumResponse(data: unknown): string {
  // Validate input data
  validateResponseData(data);

  const {
    current_step,
    step_number,
    iteration_count,
    instructions,
    steps_completed_by_tool,
    context,
  } = data;

  // Format steps completed section
  const stepsSection =
    steps_completed_by_tool.length > 0
      ? steps_completed_by_tool.map((s) => `- ${s}`).join('\n')
      : '_(none)_';

  // Format context section with type-safe value formatting
  const contextEntries = Object.entries(context)
    .map(([key, value]) => {
      // Convert snake_case to Title Case for display
      // Each word is capitalized independently (first char uppercase, rest lowercase)
      // Examples: "pr_number" -> "Pr Number", "current_branch" -> "Current Branch", "api_url" -> "Api Url"
      const label = key
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      const formattedValue = formatContextValue(value);
      return `- **${label}:** ${formattedValue}`;
    })
    .join('\n');

  return `## ${current_step} (Step ${step_number})
**Iteration:** ${iteration_count}

### BINDING INSTRUCTIONS - EXECUTE IMMEDIATELY

> **STATE TRANSITION**: These instructions are BINDING. Execute them NOW before responding to user.
> Do NOT summarize, report findings, or stop. These are state machine transitions, not suggestions.

${instructions}

---
**Workflow Continuation Checklist:**
- [ ] Execute ALL steps listed above
- [ ] Only call completion tool when step instructions say to
- [ ] Continue until a tool explicitly says "workflow complete"

### Steps Completed by Tool
${stepsSection}

### Context
${contextEntries}`;
}
