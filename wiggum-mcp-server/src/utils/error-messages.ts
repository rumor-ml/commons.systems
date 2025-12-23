/**
 * Error message formatting utilities for consistent, actionable error messages.
 *
 * All ValidationErrors should follow a 4-part pattern:
 * 1. Problem statement (what went wrong)
 * 2. Current context (what we observed)
 * 3. Expected format (what we need)
 * 4. Remediation steps (how to fix it)
 */

export interface ErrorMessageParts {
  /** Clear statement of what went wrong */
  problem: string;
  /** Current context - what we observed that caused the error */
  context?: string;
  /** Expected format or valid values */
  expected?: string;
  /** Array of specific remediation steps */
  remediation?: string[];
}

/**
 * Build a consistent, actionable error message from structured parts.
 *
 * @param parts - Structured error message components
 * @returns Formatted multi-line error message
 *
 * @example
 * buildValidationErrorMessage({
 *   problem: "fix_description cannot be empty",
 *   context: "Received: '' (length: 0)",
 *   expected: "Non-empty string describing what was fixed",
 *   remediation: [
 *     "Provide a brief description of what you fixed",
 *     "Example: 'Fixed authentication bug in login flow'",
 *     "Keep it concise (1-2 sentences)"
 *   ]
 * })
 *
 * // Returns:
 * // Problem: fix_description cannot be empty
 * //
 * // Current context:
 * // Received: '' (length: 0)
 * //
 * // Expected:
 * // Non-empty string describing what was fixed
 * //
 * // How to fix:
 * // 1. Provide a brief description of what you fixed
 * // 2. Example: 'Fixed authentication bug in login flow'
 * // 3. Keep it concise (1-2 sentences)
 */
export function buildValidationErrorMessage(parts: ErrorMessageParts): string {
  const lines: string[] = [];

  // Problem statement (required)
  lines.push(`Problem: ${parts.problem}`);

  // Current context (optional)
  if (parts.context) {
    lines.push('');
    lines.push('Current context:');
    lines.push(parts.context);
  }

  // Expected format (optional)
  if (parts.expected) {
    lines.push('');
    lines.push('Expected:');
    lines.push(parts.expected);
  }

  // Remediation steps (optional)
  if (parts.remediation && parts.remediation.length > 0) {
    lines.push('');
    lines.push('How to fix:');
    parts.remediation.forEach((step, index) => {
      lines.push(`${index + 1}. ${step}`);
    });
  }

  return lines.join('\n');
}
