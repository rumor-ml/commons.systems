import type { ErrorId } from '../constants/errorIds';

/**
 * Options for logging errors with structured data.
 */
export interface LogErrorOptions {
  errorId: ErrorId;
  error: Error;
  context?: Record<string, unknown>;
}

/**
 * Log an error with structured data for tracking and monitoring.
 *
 * This provides a foundation for error tracking that can be extended
 * with Sentry or other monitoring services in the future.
 *
 * @param message - Human-readable error message
 * @param options - Error ID, error object, and optional context
 */
export function logError(message: string, options: LogErrorOptions): void {
  const { errorId, error, context } = options;

  // Structured error logging
  console.error(`[${errorId}] ${message}`, {
    errorId,
    message,
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    context,
    timestamp: new Date().toISOString(),
  });

  // Future: Send to Sentry or other monitoring service
  // if (window.Sentry) {
  //   window.Sentry.captureException(error, {
  //     tags: { errorId },
  //     contexts: { custom: context },
  //   });
  // }
}
