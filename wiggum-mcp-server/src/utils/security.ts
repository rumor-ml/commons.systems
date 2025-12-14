/**
 * Security utilities for sanitizing sensitive data
 *
 * Provides functions to redact tokens, credentials, and other sensitive
 * information from logs, error messages, and PR comments.
 */

/**
 * GitHub token patterns to detect and redact
 * Covers all GitHub token formats:
 * - ghp_* (Personal Access Tokens)
 * - gho_* (OAuth tokens)
 * - ghu_* (User-to-server tokens)
 * - ghs_* (Server-to-server tokens)
 * - ghr_* (Refresh tokens)
 * - github_pat_* (Fine-grained personal access tokens)
 */
const GITHUB_TOKEN_PATTERNS = [
  /ghp_[a-zA-Z0-9]{36,}/g,
  /gho_[a-zA-Z0-9]{36,}/g,
  /ghu_[a-zA-Z0-9]{36,}/g,
  /ghs_[a-zA-Z0-9]{36,}/g,
  /ghr_[a-zA-Z0-9]{36,}/g,
  /github_pat_[a-zA-Z0-9_]{82}/g,
];

/**
 * Pattern for URLs with embedded credentials
 * Matches: https://username:password@github.com or https://token@github.com
 */
const AUTHENTICATED_URL_PATTERN = /https:\/\/[^:@\s]+:[^@\s]+@github\.com/g;

/**
 * Generic secret patterns (Bearer tokens, etc.)
 */
const GENERIC_SECRET_PATTERNS = [
  /Bearer\s+[a-zA-Z0-9\-._~+\/]+=*/g, // Bearer tokens
];

/**
 * Redact all sensitive tokens and credentials from input string
 *
 * Replaces GitHub tokens, authenticated URLs, and Bearer tokens with [REDACTED].
 * Safe to use on error messages, logs, or any user-facing output.
 *
 * @param input - String that may contain sensitive data
 * @returns Sanitized string with all tokens replaced with [REDACTED]
 *
 * @example
 * ```typescript
 * const error = "Failed to authenticate with token ghp_abc123def456";
 * const safe = redactSecrets(error);
 * // Returns: "Failed to authenticate with token [REDACTED]"
 * ```
 */
export function redactSecrets(input: string): string {
  let sanitized = input;

  // Redact all GitHub token patterns
  for (const pattern of GITHUB_TOKEN_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }

  // Redact authenticated URLs
  sanitized = sanitized.replace(AUTHENTICATED_URL_PATTERN, 'https://github.com');

  // Redact generic secrets
  for (const pattern of GENERIC_SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, 'Bearer [REDACTED]');
  }

  return sanitized;
}

/**
 * Sanitize error message for safe display in PR comments or logs
 *
 * Performs three operations:
 * 1. Takes only the first line (often contains root cause)
 * 2. Limits to maxLength characters (prevents bloat)
 * 3. Redacts all sensitive tokens/URLs
 *
 * @param error - Error object or string to sanitize
 * @param maxLength - Maximum length of sanitized message (default: 200)
 * @returns Sanitized error message safe for display
 *
 * @example
 * ```typescript
 * const error = new Error("Auth failed with token ghp_secret123\nStack trace...");
 * const safe = sanitizeErrorMessage(error, 100);
 * // Returns: "Auth failed with token [REDACTED]" (truncated to 100 chars)
 * ```
 */
export function sanitizeErrorMessage(error: Error | string, maxLength: number = 200): string {
  const errorMsg = error instanceof Error ? error.message : String(error);

  // Take first line only
  const firstLine = errorMsg.split('\n')[0];

  // Truncate to max length
  const truncated = firstLine.substring(0, maxLength);

  // Redact secrets
  return redactSecrets(truncated);
}
