/**
 * Error ID constants for Sentry tracking
 *
 * Error IDs enable Sentry to group related errors effectively and provide
 * better monitoring dashboards for production issues.
 *
 * @module errorIds
 */

/**
 * Error ID constants for different error scenarios
 *
 * Uses `satisfies Record<string, string>` to ensure type safety while maintaining
 * type inference. This approach:
 * - Prevents typos between key and value (TypeScript will catch mismatches)
 * - Preserves literal types for each value (better autocomplete)
 * - Ensures all values are strings (no accidental numbers or other types)
 */
const errorIds = {
  /** General git command failures (non-zero exit codes). Use as fallback when specific error IDs don't apply. */
  GIT_COMMAND_FAILED: 'GIT_COMMAND_FAILED',

  /** Not in a git repository (exit code 128). Use instead of GIT_COMMAND_FAILED for this specific case. */
  GIT_NOT_A_REPOSITORY: 'GIT_NOT_A_REPOSITORY',

  /**
   * Invalid GitError parameters (validation failures in git operations)
   *
   * Note: This is NOT used in GitError.create() parameter validation,
   * as those throw ValidationError (from mcp-common) which doesn't support errorId.
   * This constant is reserved for git commands that fail due to invalid inputs
   * (e.g., invalid branch names, malformed refs), not for validating our own parameters.
   */
  GIT_VALIDATION_ERROR: 'GIT_VALIDATION_ERROR',

  /** Neither main nor master branch exists */
  GIT_NO_MAIN_BRANCH: 'GIT_NO_MAIN_BRANCH',
} as const satisfies Record<string, string>;

export const ErrorIds = errorIds;

/**
 * Type for error ID values
 */
export type ErrorId = (typeof errorIds)[keyof typeof errorIds];
