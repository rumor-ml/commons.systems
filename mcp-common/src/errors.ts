/**
 * Shared error classes for MCP servers
 *
 * This module provides a typed error hierarchy for categorizing failures in MCP tool operations.
 * Error classes enable:
 * - Type-safe error handling with instanceof checks
 * - Structured error categorization for retry logic
 * - Standardized error codes across all MCP servers
 *
 * Error Hierarchy:
 * - McpError: Base class for all MCP-related errors
 *   - TimeoutError: Operation exceeded time limit (may be retryable)
 *   - ValidationError: Invalid input parameters (terminal, not retryable)
 *   - NetworkError: Network-related failures (may be retryable)
 *
 * @module errors
 */

/**
 * Type-safe error codes used across all MCP servers
 */
export type ErrorCode =
  | 'TIMEOUT'
  | 'VALIDATION_ERROR'
  | 'NETWORK_ERROR'
  | 'GH_CLI_ERROR'
  | 'GIT_ERROR'
  | 'FILESYSTEM_ERROR'
  | 'PARSING_ERROR'
  | 'FORMATTING_ERROR'
  | 'SCRIPT_EXECUTION_ERROR'
  | 'INFRASTRUCTURE_ERROR'
  | 'TEST_OUTPUT_PARSE_ERROR'
  | 'STATE_DETECTION_ERROR'
  | 'STATE_API_ERROR'
  | 'UNEXPECTED_ERROR';

/**
 * Base error class for all MCP-related errors
 *
 * Provides optional error code for categorization and extends standard Error
 * with MCP-specific context. All MCP errors should extend this class.
 */
export class McpError extends Error {
  constructor(
    message: string,
    public readonly code?: ErrorCode
  ) {
    super(message);
    this.name = 'McpError';
  }
}

/**
 * Error thrown when an operation exceeds its time limit
 *
 * Used for polling operations, async waits, or long-running commands that
 * exceed configured timeout thresholds. May be retryable depending on context.
 */
export class TimeoutError extends McpError {
  constructor(message: string) {
    super(message, 'TIMEOUT');
    this.name = 'TimeoutError';
  }
}

/**
 * Error thrown when input parameters fail validation
 *
 * Indicates malformed or invalid input data. These errors are terminal
 * (not retryable) as they require user correction of input parameters.
 */
export class ValidationError extends McpError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

/**
 * Error thrown for network-related failures
 *
 * Covers HTTP requests, API calls, or other network operations that fail
 * due to connectivity issues, timeouts, or server errors. May be retryable.
 */
export class NetworkError extends McpError {
  constructor(message: string) {
    super(message, 'NETWORK_ERROR');
    this.name = 'NetworkError';
  }
}

/**
 * Check if a status code is valid for GitHubCliError
 *
 * Accepts:
 * - -1: Sentinel value indicating "unknown/not available"
 * - 0-255: Standard Unix exit codes
 * - 400-599: HTTP status codes (for API error classification)
 *
 * @param code - Code to validate
 * @returns true if the code is valid
 */
function isValidStatusCode(code: number): boolean {
  if (code === -1) return true; // Sentinel for "unknown"
  if (Number.isInteger(code) && code >= 0 && code <= 255) return true; // Unix exit codes
  if (Number.isInteger(code) && code >= 400 && code <= 599) return true; // HTTP status codes
  return false;
}

/**
 * Error thrown when GitHub CLI (gh) commands fail
 *
 * Captures structured information from gh command failures including:
 * - Exit/status code (validated, see below)
 * - stderr output (can be empty string)
 * - stdout output (optional)
 *
 * Exit code handling:
 * - Sentinel value (-1): Indicates "exit code unknown" (process didn't run)
 * - Valid Unix range (0-255): Standard process exit codes
 * - HTTP status codes (400-599): For API error classification (e.g., 404, 429)
 * - Invalid values: Throws ValidationError
 *
 * NOTE: This field has dual semantics - it stores either Unix exit codes
 * (from process execution) OR HTTP status codes (from API responses).
 * This is intentional to support both `gh` CLI exit codes and GitHub
 * API response status codes for error classification.
 *
 * Interpreting exit codes: Values 0-255 are typically Unix exit codes,
 * while 400-599 are HTTP status codes. Context matters - check the error
 * message or stderr to determine which domain applies. For example, 1 is
 * almost always a Unix exit code, while 404 is almost always HTTP.
 *
 * @example
 * ```typescript
 * // When a gh command fails, capture the error details:
 * throw new GitHubCliError(
 *   'Failed to create PR',
 *   1,
 *   'Error: could not create pull request',
 *   '',
 *   undefined
 * );
 *
 * // HTTP status codes are valid for API errors:
 * throw new GitHubCliError('Rate limited', 429, 'Too many requests');
 *
 * // Invalid exit code throws ValidationError:
 * new GitHubCliError('Failed', 1000, 'stderr'); // throws!
 * ```
 */
/**
 * Exit code domain for GitHubCliError
 *
 * The exitCode field in GitHubCliError has dual semantics:
 * - 'unknown': Sentinel value (-1) indicating exit code unavailable
 * - 'unix': Process exit codes (0-255)
 * - 'http': HTTP status codes (400-599)
 *
 * Use getExitCodeDomain() to determine the domain at runtime.
 */
export type ExitCodeDomain = 'unknown' | 'unix' | 'http';

/**
 * Determine the domain of a GitHubCliError exit code
 *
 * Since exit code ranges are non-overlapping (0-255 for Unix, 400-599 for HTTP),
 * the domain can be inferred from the value itself:
 * - -1: 'unknown' (process didn't run or exit code unavailable)
 * - 0-255: 'unix' (standard process exit codes)
 * - 400-599: 'http' (HTTP status codes from API responses)
 *
 * @param exitCode - The exit code to classify
 * @returns The domain of the exit code
 *
 * @example
 * ```typescript
 * const error = new GitHubCliError('Not found', 404, 'stderr');
 * const domain = getExitCodeDomain(error.exitCode);
 * // domain === 'http'
 *
 * const error2 = new GitHubCliError('Command failed', 1, 'stderr');
 * const domain2 = getExitCodeDomain(error2.exitCode);
 * // domain2 === 'unix'
 * ```
 */
export function getExitCodeDomain(exitCode: number): ExitCodeDomain {
  if (exitCode === -1) return 'unknown';
  if (exitCode >= 0 && exitCode <= 255) return 'unix';
  if (exitCode >= 400 && exitCode <= 599) return 'http';
  // This should never happen due to constructor validation
  throw new ValidationError(
    `Invalid exit code: ${exitCode}. Valid ranges: -1, 0-255 (Unix), 400-599 (HTTP).`
  );
}

/**
 * Type guard to check if an exit code is an HTTP status code
 *
 * @param exitCode - The exit code to check
 * @returns true if the exit code is an HTTP status code (400-599)
 */
export function isHttpStatusCode(exitCode: number): boolean {
  return getExitCodeDomain(exitCode) === 'http';
}

/**
 * Type guard to check if an exit code is a Unix exit code
 *
 * @param exitCode - The exit code to check
 * @returns true if the exit code is a Unix exit code (0-255)
 */
export function isUnixExitCode(exitCode: number): boolean {
  return getExitCodeDomain(exitCode) === 'unix';
}

export class GitHubCliError extends McpError {
  public readonly exitCode: number;

  /**
   * Get the domain of this error's exit code
   *
   * @returns 'unknown' if exit code is -1, 'unix' for 0-255, 'http' for 400-599
   */
  public get exitCodeDomain(): ExitCodeDomain {
    return getExitCodeDomain(this.exitCode);
  }

  constructor(
    message: string,
    exitCode: number = -1,
    public readonly stderr: string = '',
    public readonly stdout?: string,
    cause?: Error
  ) {
    // Validate exit code
    if (!isValidStatusCode(exitCode)) {
      throw new ValidationError(
        `Invalid exit/status code: ${exitCode}. ` +
          `Must be -1 (unknown), 0-255 (Unix exit code), or 400-599 (HTTP status code).`
      );
    }

    super(message, 'GH_CLI_ERROR');
    this.name = 'GitHubCliError';
    this.exitCode = exitCode;
    if (cause) {
      this.cause = cause;
    }
  }

  /**
   * Safely create GitHubCliError with automatic exit code clamping
   *
   * This factory never throws - it clamps invalid exit codes to the valid
   * Unix range (0-255) and adds a warning prefix to the message. Use this
   * when processing external command output where exit codes may be unexpected.
   *
   * @param message - Error message
   * @param exitCode - Exit code (will be clamped if invalid)
   * @param stderr - Standard error output (default: '')
   * @param stdout - Standard output (optional)
   * @param cause - Root cause error (optional)
   * @returns GitHubCliError instance (never throws)
   *
   * @example
   * ```typescript
   * // Safe construction from external process output:
   * const error = GitHubCliError.createSafe('Command failed', 999, stderr);
   * // error.message === '[Warning: Invalid exit code 999 clamped to 255] Command failed'
   * // error.exitCode === 255
   *
   * // Valid exit codes pass through unchanged:
   * const error2 = GitHubCliError.createSafe('Not found', 404, stderr);
   * // error2.exitCode === 404 (valid HTTP status code)
   * ```
   */
  static createSafe(
    message: string,
    exitCode: number = -1,
    stderr: string = '',
    stdout?: string,
    cause?: Error
  ): GitHubCliError {
    if (!isValidStatusCode(exitCode)) {
      const clampedExitCode = exitCode === -1 ? -1 : Math.max(0, Math.min(255, exitCode));
      const warningPrefix = `[Warning: Invalid exit code ${exitCode} clamped to ${clampedExitCode}] `;
      return new GitHubCliError(warningPrefix + message, clampedExitCode, stderr, stdout, cause);
    }
    return new GitHubCliError(message, exitCode, stderr, stdout, cause);
  }
}

/**
 * Known error categories from MCP error classes.
 *
 * These are the error types returned by analyzeRetryability() for known MCP errors.
 * Note: errorType can also be any Error subclass name (e.g., 'TypeError', 'RangeError')
 * or typeof value for non-Error objects (e.g., 'string', 'object', 'undefined').
 */
export type KnownErrorCategory =
  | 'ValidationError'
  | 'FormattingError'
  | 'TimeoutError'
  | 'NetworkError'
  | 'GitHubCliError'
  | 'ParsingError'
  | 'McpError';

/**
 * Array of known error category names for runtime validation.
 *
 * This is kept in sync with the KnownErrorCategory type union above.
 * Used by isKnownErrorCategory() for runtime type narrowing.
 */
const KNOWN_ERROR_CATEGORIES: readonly string[] = [
  'ValidationError',
  'FormattingError',
  'TimeoutError',
  'NetworkError',
  'GitHubCliError',
  'ParsingError',
  'McpError',
] as const;

/**
 * Type guard to check if an error type string is a known MCP error category.
 *
 * This enables runtime type narrowing for the RetryDecision.errorType field,
 * allowing consumers to distinguish between known MCP errors and unknown errors.
 *
 * @param errorType - The error type string to check
 * @returns true if errorType is a KnownErrorCategory, with type narrowing
 *
 * @example
 * ```typescript
 * const decision = analyzeRetryability(error);
 * if (isKnownErrorCategory(decision.errorType)) {
 *   // decision.errorType is now typed as KnownErrorCategory
 *   handleKnownError(decision.errorType);
 * } else {
 *   // decision.errorType is typed as string (unknown error type)
 *   logUnknownError(decision.errorType);
 * }
 * ```
 */
export function isKnownErrorCategory(errorType: string): errorType is KnownErrorCategory {
  return KNOWN_ERROR_CATEGORIES.includes(errorType);
}

/**
 * Retry decision information with structured metadata
 *
 * Provides detailed information about whether an error should be retried,
 * including the error type and reason for the retry decision.
 *
 * Use isKnownErrorCategory() to narrow errorType to KnownErrorCategory at runtime.
 */
export interface RetryDecision {
  /** Whether the error is terminal (should not be retried) */
  readonly isTerminal: boolean;
  /**
   * The error type for categorization.
   *
   * For known MCP errors, this is one of KnownErrorCategory values.
   * For other Error instances, this is error.constructor.name (e.g., 'TypeError', 'RangeError').
   * For non-Error objects, this is typeof error (e.g., 'string', 'object', 'undefined').
   */
  readonly errorType: KnownErrorCategory | string;
  /** Human-readable explanation of why the error is or is not terminal */
  readonly reason: string;
}

/**
 * Analyze an error to determine if it should be retried
 *
 * Returns structured metadata about the retry decision including:
 * - Whether the error is terminal
 * - The error type
 * - The reason for the decision
 *
 * Retry Strategy:
 * - ValidationError: Terminal (requires user input correction)
 * - TimeoutError: Potentially retryable (may succeed with more time)
 * - NetworkError: Potentially retryable (transient network issues)
 * - Other errors: Treated as potentially retryable (conservative approach)
 *
 * Conservative Default Rationale:
 * Unknown errors are assumed retryable because:
 * 1. Many infrastructure failures (DB locks, rate limits, transient service issues) are temporary
 * 2. Retrying maximizes system resilience without user intervention
 * 3. Retry limits (maxRetries) prevent infinite loops
 * 4. Only ValidationError is definitively terminal (bad input won't become valid via retry)
 * This errs on the side of availability over failing fast.
 *
 * Trade-offs:
 * - Pro: Automatic recovery from transient failures (network blips, DB contention)
 * - Con: May mask systemic issues that need immediate attention
 * - Con: Adds latency if retries are unsuccessful
 * Servers can override this behavior by checking specific error types before retrying.
 *
 * @param error - Error to analyze
 * @returns Structured retry decision with metadata
 *
 * @example
 * ```typescript
 * const decision = analyzeRetryability(error);
 * if (decision.isTerminal) {
 *   console.error(`Terminal error: ${decision.reason}`);
 *   return createErrorResult(error);
 * }
 * console.log(`Retrying: ${decision.reason}`);
 * await retry(operation);
 * ```
 */
export function analyzeRetryability(error: unknown): RetryDecision {
  // ValidationError is terminal - requires user input correction
  if (error instanceof ValidationError) {
    return {
      isTerminal: true,
      errorType: 'ValidationError',
      reason: 'Invalid input requires user correction',
    };
  }

  // FormattingError is terminal - indicates data structure violation
  if (error instanceof FormattingError) {
    return {
      isTerminal: true,
      errorType: 'FormattingError',
      reason: 'Invalid response structure that does not match expected schema',
    };
  }

  // All other error types are retryable by default (conservative approach)
  if (error instanceof Error) {
    const errorType = error.constructor.name;
    const isKnownType = error instanceof McpError;

    if (process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true') {
      console.debug('[mcp-common] Error marked as retryable:', {
        type: errorType,
        message: error.message.substring(0, 100),
        isKnownType,
      });
    }

    return {
      isTerminal: false,
      errorType,
      reason: isKnownType
        ? `${errorType} may be transient, retry may succeed`
        : 'Unknown error type treated as retryable (conservative default)',
    };
  }

  // Non-Error objects (strings, numbers, etc.)
  const errorType = typeof error;
  return {
    isTerminal: false,
    errorType,
    reason: `Non-Error object (${errorType}) treated as retryable`,
  };
}

/**
 * Determine if an error is terminal (not retryable)
 *
 * This is a convenience wrapper around analyzeRetryability() that returns
 * only the boolean terminal status. For detailed retry decision information,
 * use analyzeRetryability() instead.
 *
 * Retry Strategy:
 * - ValidationError: Terminal (requires user input correction)
 * - TimeoutError: Potentially retryable (may succeed with more time)
 * - NetworkError: Potentially retryable (transient network issues)
 * - Other errors: Treated as potentially retryable (conservative approach)
 *
 * IMPORTANT: This function currently ONLY returns true for ValidationError and FormattingError.
 * All other error types (including unknown errors, null, strings, etc.) return false.
 *
 * @param error - Error to check
 * @returns true if error is terminal and should not be retried
 *
 * @see analyzeRetryability For detailed retry decision information
 */
export function isTerminalError(error: unknown): boolean {
  return analyzeRetryability(error).isTerminal;
}

/**
 * Format an error for display with optional context
 *
 * Formats errors with type information and optional stack traces for debugging.
 * For McpError instances, includes error code if present.
 *
 * @param error - Error to format
 * @param includeStack - Whether to include stack trace (default: false)
 * @returns Formatted error message string
 */
export function formatError(error: unknown, includeStack = false): string {
  if (error instanceof McpError) {
    const parts = [`[${error.name}]`, error.code ? `(${error.code})` : '', error.message];

    if (includeStack && error.stack) {
      parts.push(`\nStack: ${error.stack}`);
    }

    return parts.filter(Boolean).join(' ');
  }

  if (error instanceof Error) {
    const formatted = `[${error.name}] ${error.message}`;
    return includeStack && error.stack ? `${formatted}\nStack: ${error.stack}` : formatted;
  }

  return String(error);
}

/**
 * System error codes that should be re-thrown without wrapping
 *
 * These errors indicate critical system failures that applications
 * cannot recover from and should propagate to the caller.
 */
export const SYSTEM_ERROR_CODES = [
  'ENOMEM', // Out of memory
  'ENOSPC', // No space left on device
  'EMFILE', // Too many open files (process limit)
  'ENFILE', // Too many open files (system limit)
] as const;

/**
 * Check if an error is a system-level error that should not be wrapped
 *
 * @param error - Error to check
 * @returns true if error is a system error
 */
export function isSystemError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return false;
  }

  // Only check errors that have a string code property
  const errorCode = (error as { code: unknown }).code;

  if (typeof errorCode !== 'string') {
    const warningMessage = '[mcp-common] Error object has non-string code';

    // THROW in development mode to catch type bugs early
    if (process.env.NODE_ENV === 'development') {
      throw new ValidationError(
        `${warningMessage}. Error codes must be strings. ` +
          `Received type: ${typeof errorCode}, value: ${String(errorCode)}`
      );
    }

    // Log in production and return false
    console.warn(warningMessage, {
      code: errorCode,
      type: typeof errorCode,
    });

    return false;
  }

  return (SYSTEM_ERROR_CODES as readonly string[]).includes(errorCode);
}

/**
 * Context data for parsing errors
 *
 * Provides structured metadata about parsing failures to aid in debugging
 * and error classification.
 */
export interface ParsingErrorContext {
  /** Total number of lines/items attempted to parse */
  totalLines?: number;
  /** Number of lines/items that failed to parse or were skipped */
  skippedLines?: number;
  /** Success rate as a decimal (0.0 to 1.0) */
  successRate?: number;
  /** Minimum acceptable success rate threshold (0.0 to 1.0) */
  minSuccessRate?: number;
  /** Generic count of successfully parsed items (deprecated: use parsedLines or parsedSteps) */
  parsedCount?: number;
  /** Number of successfully parsed lines */
  parsedLines?: number;
  /** Number of successfully parsed steps */
  parsedSteps?: number;
  /** Type of parsing operation (e.g., 'workflow-logs', 'json', 'csv') */
  parseType?: string;
  /** Sample of the input that failed to parse (truncated for safety) */
  outputSnippet?: string;
  /** Additional context-specific properties */
  [key: string]: unknown;
}

/**
 * ParsingError - Error thrown when parsing data fails
 *
 * Used for JSON parsing failures, malformed responses, and data format errors.
 * Commonly seen with gh CLI JSON output parsing.
 *
 * @example
 * ```typescript
 * try {
 *   return JSON.parse(output);
 * } catch (error) {
 *   throw new ParsingError(
 *     `Failed to parse JSON: ${error.message}`,
 *     error,
 *     { parseType: 'json', outputSnippet: output.slice(0, 100) }
 *   );
 * }
 * ```
 *
 * @example
 * ```typescript
 * // With structured context for metrics
 * throw new ParsingError(
 *   'Failed to parse workflow logs',
 *   undefined,
 *   {
 *     successRate: 0.65,
 *     minSuccessRate: 0.7,
 *     totalLines: 100,
 *     parsedLines: 65,
 *     parseType: 'workflow-logs'
 *   }
 * );
 * ```
 */
export class ParsingError extends McpError {
  constructor(
    message: string,
    cause?: Error,
    public readonly context?: ParsingErrorContext
  ) {
    super(message, 'PARSING_ERROR');
    this.name = 'ParsingError';
    if (cause) {
      this.cause = cause;
    }
  }
}

/**
 * FormattingError - Error thrown when formatting data fails
 *
 * Used for string formatting failures, template errors, and output generation issues.
 * Commonly seen when constructing error messages or formatted output.
 *
 * @example
 * ```typescript
 * try {
 *   return formatTemplate(data);
 * } catch (error) {
 *   throw new FormattingError(`Failed to format template: ${error.message}`, error);
 * }
 * ```
 */
export class FormattingError extends McpError {
  constructor(message: string, cause?: Error) {
    super(message, 'FORMATTING_ERROR');
    this.name = 'FormattingError';
    if (cause) {
      this.cause = cause;
    }
  }
}

/**
 * GitHub error classification result
 *
 * Used to categorize GitHub API errors for retry logic and error handling.
 * All flags are mutually exclusive except isTransient/isCritical which summarize the others.
 */
export interface GitHubErrorClassification {
  /** True if error is 404 not found */
  readonly is404: boolean;
  /** True if error is authentication/permission failure (401, 403) */
  readonly isAuth: boolean;
  /** True if error is rate limit (429) */
  readonly isRateLimit: boolean;
  /** True if error is network failure (ECONNREFUSED, ETIMEDOUT, etc.) */
  readonly isNetwork: boolean;
  /** True if error is transient (isRateLimit || isNetwork) - safe to retry */
  readonly isTransient: boolean;
  /** True if error is critical (is404 || isAuth) - should not retry */
  readonly isCritical: boolean;
}

/**
 * Classify a GitHub API error for retry logic
 *
 * Determines error type based on error message patterns and exit codes.
 * Uses both exit code (most reliable when available) and message pattern
 * matching (fallback for wrapped errors).
 *
 * Network vs HTTP error classification:
 * - Network errors: Use message pattern matching (ECONNREFUSED, ETIMEDOUT, ENOTFOUND)
 *   because network failure exit codes vary by tool/platform.
 * - HTTP errors (404, 429): Use reliable exitCode values from gh CLI.
 *
 * @param error - Error object or message to classify
 * @param exitCode - Optional exit code from CLI command
 * @returns Classification result with boolean flags
 */
export function classifyGitHubError(error: unknown, exitCode?: number): GitHubErrorClassification {
  const errorMsg =
    error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);

  const is404 = /not found|404/i.test(errorMsg) || exitCode === 404;
  const isAuth =
    /permission|forbidden|unauthorized|401|403/i.test(errorMsg) ||
    exitCode === 401 ||
    exitCode === 403;
  const isRateLimit = /rate limit|429/i.test(errorMsg) || exitCode === 429;
  const isNetwork = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|network|fetch/i.test(errorMsg);

  return {
    is404,
    isAuth,
    isRateLimit,
    isNetwork,
    isTransient: isRateLimit || isNetwork,
    isCritical: is404 || isAuth,
  };
}
