/**
 * Logger utility for Budget module
 *
 * Provides structured logging with level filtering and browser console output.
 * Uses console.error/warn/info/log for native browser devtools filtering.
 * This allows developers to filter logs by severity in DevTools without custom parsing.
 * For example, DevTools can show only console.error() calls when 'Errors' filter is selected,
 * which would not work if all logs used console.log() with severity prefixes.
 * Alternative approaches (single console method with styled prefixes) lose native filtering.
 * Log level is configurable via localStorage BUDGET_LOG_LEVEL.
 */

import type { ErrorId } from '../constants/errorIds';

// TODO(#1876): Consider using const enum for zero runtime cost (requires refactoring reverse mapping usage)
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

export class Logger {
  private level: LogLevel;
  private localStorageAvailable: boolean = true;

  constructor() {
    this.level = this.loadLogLevel();
  }

  private loadLogLevel(): LogLevel {
    // Read log level from localStorage (default: WARN)
    // Try-catch handles any localStorage access errors (private browsing, sandboxed contexts, etc.)
    // Falls back to default WARN level
    let storedLevel: string | null = null;
    try {
      storedLevel = localStorage.getItem('BUDGET_LOG_LEVEL')?.toUpperCase() ?? null;
    } catch (error) {
      // localStorage access denied in restricted context - use default
      this.localStorageAvailable = false;
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Note: Using console.warn directly here is intentional - logger can't use itself during construction
      // Only warn once per window to avoid duplicate warnings if Logger is instantiated multiple times
      if (typeof window !== 'undefined' && !(window as any).__budgetLoggerInitWarned) {
        console.warn(
          '[Logger Init] Failed to read log level from localStorage, using default WARN level:',
          errorMsg
        );
        (window as any).__budgetLoggerInitWarned = true;
      }
      return LogLevel.WARN;
    }

    if (!storedLevel) {
      return LogLevel.WARN;
    }

    // Validate that the parsed value is a valid LogLevel
    const parsed = LogLevel[storedLevel as keyof typeof LogLevel];
    if (typeof parsed === 'number' && parsed >= LogLevel.ERROR && parsed <= LogLevel.DEBUG) {
      return parsed;
    }

    console.warn(`Invalid log level "${storedLevel}", using default WARN level`);
    return LogLevel.WARN;
  }

  // Add public API for runtime level changes
  public setLevel(level: LogLevel): void {
    if (typeof level !== 'number' || level < LogLevel.ERROR || level > LogLevel.DEBUG) {
      console.warn(`Invalid log level ${level}, keeping current level ${LogLevel[this.level]}`);
      return;
    }
    this.level = level;
    if (this.localStorageAvailable) {
      try {
        localStorage.setItem('BUDGET_LOG_LEVEL', LogLevel[level]);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        // Note: Using console.warn directly is intentional - avoids infinite recursion if logger.warn fails
        console.warn('Failed to persist log level to localStorage:', errorMsg);
        // Mark localStorage as unavailable to prevent repeated failure attempts
        this.localStorageAvailable = false;
      }
    }
  }

  /**
   * Re-check localStorage availability and sync level from storage if available.
   * Useful if localStorage becomes available after initialization (e.g., permission changes).
   * Also synchronizes with external changes made by other tabs or scripts.
   */
  public syncFromStorage(): void {
    try {
      const storedLevel = localStorage.getItem('BUDGET_LOG_LEVEL')?.toUpperCase() ?? null;
      this.localStorageAvailable = true;

      if (storedLevel) {
        const parsed = LogLevel[storedLevel as keyof typeof LogLevel];
        if (typeof parsed === 'number' && parsed >= LogLevel.ERROR && parsed <= LogLevel.DEBUG) {
          this.level = parsed;
        }
      }
    } catch (error) {
      this.localStorageAvailable = false;
    }
  }

  public getLevel(): LogLevel {
    return this.level;
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (level > this.level) return;

    const timestamp = new Date().toISOString();
    const levelName = LogLevel[level];

    // Format log message
    const logMessage = `[${timestamp}] [${levelName}] ${message}`;

    // Select appropriate console method based on level
    // This enables native browser devtools filtering
    switch (level) {
      case LogLevel.ERROR:
        // Auto-capture stack trace when data is undefined (convenience for simple error logs).
        // If you call logger.error() without a data argument, we automatically capture the stack
        // because you probably want debugging info. To skip stack capture, explicitly pass null or an empty object.
        if (data !== undefined) {
          console.error(logMessage, data);
        } else {
          const stack = new Error().stack;
          console.error(logMessage, stack);
        }
        break;
      case LogLevel.WARN:
        console.warn(logMessage, data);
        break;
      case LogLevel.INFO:
        console.info(logMessage, data);
        break;
      case LogLevel.DEBUG:
        console.log(logMessage, data);
        break;
    }
  }

  error(message: string, data?: unknown): void {
    this.log(LogLevel.ERROR, message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log(LogLevel.WARN, message, data);
  }

  info(message: string, data?: unknown): void {
    this.log(LogLevel.INFO, message, data);
  }

  debug(message: string, data?: unknown): void {
    this.log(LogLevel.DEBUG, message, data);
  }
}

// Export singleton instance
export const logger = new Logger();

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
