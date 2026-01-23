/**
 * Logger utility for Budget module
 *
 * Provides structured logging with level filtering and browser console output.
 * Uses console.error/warn/info/log for native browser devtools filtering.
 * Log level is configurable via localStorage BUDGET_LOG_LEVEL.
 */

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

export class Logger {
  private level: LogLevel;

  constructor() {
    // Read log level from localStorage (default: WARN)
    const storedLevel = localStorage.getItem('BUDGET_LOG_LEVEL')?.toUpperCase();
    this.level = LogLevel[storedLevel as keyof typeof LogLevel] ?? LogLevel.WARN;
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
        // Auto-capture stack trace for errors
        if (data instanceof Error) {
          console.error(logMessage, data);
        } else if (data !== undefined) {
          console.error(logMessage, data);
        } else {
          // Capture stack trace by creating temporary Error
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
