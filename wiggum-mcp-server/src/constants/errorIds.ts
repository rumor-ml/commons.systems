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
 */
export const ErrorIds = {
  /** General git command failures (non-zero exit codes) */
  GIT_COMMAND_FAILED: 'GIT_COMMAND_FAILED',

  /** Not in a git repository (exit code 128) */
  GIT_NOT_A_REPOSITORY: 'GIT_NOT_A_REPOSITORY',

  /** Invalid GitError parameters (validation failures) */
  GIT_VALIDATION_ERROR: 'GIT_VALIDATION_ERROR',

  /** Neither main nor master branch exists */
  GIT_NO_MAIN_BRANCH: 'GIT_NO_MAIN_BRANCH',
} as const;

/**
 * Type for error ID values
 */
export type ErrorId = (typeof ErrorIds)[keyof typeof ErrorIds];
