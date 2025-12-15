/**
 * Logger utility for Wiggum MCP server
 *
 * Provides structured logging with level filtering and stderr output.
 * Uses stderr (console.error) to avoid interfering with MCP stdio protocol.
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
    const envLevel = process.env.WIGGUM_LOG_LEVEL?.toUpperCase();
    this.level = LogLevel[envLevel as keyof typeof LogLevel] ?? LogLevel.WARN;
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (level <= this.level) {
      const timestamp = new Date().toISOString();
      const levelName = LogLevel[level];
      const logMessage = data
        ? `[${timestamp}] [${levelName}] ${message} ${JSON.stringify(data)}`
        : `[${timestamp}] [${levelName}] ${message}`;

      // CRITICAL: Always use stderr to not interfere with MCP stdio protocol
      console.error(logMessage);
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
