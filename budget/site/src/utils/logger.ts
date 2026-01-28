/**
 * Logger utility for Budget module
 *
 * Provides structured logging with level filtering and browser console output.
 * Uses console.error/warn/info/log for native browser devtools filtering.
 * This allows developers to filter logs by severity in DevTools without custom parsing.
 * Alternative approaches (single console method with styled prefixes) lose native filtering.
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
      console.warn(
        'Failed to read log level from localStorage, using default WARN level:',
        errorMsg
      );
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
        console.warn('Failed to persist log level to localStorage:', errorMsg);
      }
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
        // Auto-capture stack trace when data is undefined
        // Pass null or empty object to skip stack capture if needed
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
