/**
 * Branded types for compile-time type safety using Zod
 *
 * This module uses Zod's branding system to create nominal types.
 * Factory functions delegate to Zod schemas for validation.
 *
 * Two approaches (both produce identical Zod-branded types):
 * 1. Factory functions (createPort, etc.) - Convenient wrappers
 * 2. Zod schemas (PortSchema, etc.) - Full schema composability
 *
 * @module branded
 */

import { z } from 'zod';

// Note on type safety: Always use factory functions (like createPort) or Zod parsers
// (like parsePort) to create branded types - these ensure validation occurs. Avoid type
// assertions (e.g., `value as Brand<T, B>`) as they bypass validation and create values
// that violate the branded type's invariants. TypeScript's type system cannot prevent
// these assertions.

/**
 * Zod Schemas for Branded Types
 *
 * These schemas provide schema-based validation with Zod's composability features.
 * Use these when you need to:
 * - Compose schemas into larger objects
 * - Get detailed validation error messages
 * - Use Zod's transform, refine, or other features
 * - Validate data from external sources (API, database, etc.)
 *
 * @example
 * ```typescript
 * // Using schemas directly
 * const port = PortSchema.parse(3000); // Port
 * const result = PortSchema.safeParse(70000); // { success: false, error: ZodError }
 *
 * // Composing into larger schemas
 * const ServerConfigSchema = z.object({
 *   port: PortSchema,
 *   url: URLSchema,
 * });
 *
 * // Using parse functions for convenience
 * const port = parsePort(3000); // Port (throws on invalid)
 * ```
 */

/**
 * Zod schema for Port (0-65535)
 *
 * @example
 * ```typescript
 * const port = PortSchema.parse(3000); // Port
 * const invalid = PortSchema.safeParse(-1); // { success: false }
 * ```
 */
export const PortSchema = z.number().int().min(0).max(65535).brand<'Port'>();

/**
 * Zod schema for URL string
 *
 * @example
 * ```typescript
 * const url = URLSchema.parse('https://example.com'); // URL
 * const invalid = URLSchema.safeParse('not a url'); // { success: false }
 * ```
 */
export const URLSchema = z.string().url().brand<'URL'>();

/**
 * Zod schema for Timestamp (Unix timestamp in milliseconds)
 *
 * @example
 * ```typescript
 * const timestamp = TimestampSchema.parse(Date.now()); // Timestamp
 * const invalid = TimestampSchema.safeParse(-1); // { success: false }
 * ```
 */
export const TimestampSchema = z.number().finite().nonnegative().brand<'Timestamp'>();

/**
 * Zod schema for SessionID (1-256 characters)
 *
 * @example
 * ```typescript
 * const sessionId = SessionIDSchema.parse('abc123'); // SessionID
 * const invalid = SessionIDSchema.safeParse(''); // { success: false }
 * ```
 */
export const SessionIDSchema = z.string().min(1).max(256).brand<'SessionID'>();

/**
 * Zod schema for UserID (1-256 characters)
 *
 * @example
 * ```typescript
 * const userId = UserIDSchema.parse('user_abc123'); // UserID
 * const invalid = UserIDSchema.safeParse(''); // { success: false }
 * ```
 */
export const UserIDSchema = z.string().min(1).max(256).brand<'UserID'>();

/**
 * Zod schema for FileID (1-256 characters)
 *
 * @example
 * ```typescript
 * const fileId = FileIDSchema.parse('hash123'); // FileID
 * const invalid = FileIDSchema.safeParse(''); // { success: false }
 * ```
 */
export const FileIDSchema = z.string().min(1).max(256).brand<'FileID'>();

/**
 * Port number (0-65535)
 *
 * Prevents accidentally using invalid port numbers or mixing ports with other numbers.
 */
export type Port = z.infer<typeof PortSchema>;

/**
 * URL string
 *
 * Represents a validated URL. Prevents accidentally using non-URL strings.
 */
export type URL = z.infer<typeof URLSchema>;

/**
 * Unix timestamp in milliseconds
 *
 * Prevents mixing up different time representations (seconds vs milliseconds, Date vs number).
 */
export type Timestamp = z.infer<typeof TimestampSchema>;

/**
 * Session ID string
 *
 * Prevents mixing up session IDs with other string identifiers (user IDs, file IDs, etc.).
 */
export type SessionID = z.infer<typeof SessionIDSchema>;

/**
 * User ID string
 *
 * Prevents mixing up user IDs with other string identifiers.
 */
export type UserID = z.infer<typeof UserIDSchema>;

/**
 * File ID string (e.g., content hash, UUID, or other file identifier)
 *
 * Prevents mixing up file IDs with other string identifiers like user IDs or session IDs.
 */
export type FileID = z.infer<typeof FileIDSchema>;

/**
 * Parse a Port with Zod validation
 *
 * @param n - Port number
 * @returns Branded Port type
 * @throws ZodError if port is not in valid range (0-65535)
 */
// TODO(#1157): Consider wrapping ZodError in user-friendly error messages or providing safeParse wrappers
export const parsePort = (n: unknown): Port => PortSchema.parse(n);

/**
 * Parse a URL with Zod validation
 *
 * @param s - URL string
 * @returns Branded URL type
 * @throws ZodError if URL is malformed
 */
export const parseURL = (s: unknown): URL => URLSchema.parse(s);

/**
 * Parse a Timestamp with Zod validation
 *
 * @param ms - Milliseconds since Unix epoch
 * @returns Branded Timestamp
 * @throws ZodError if timestamp is negative or not finite
 */
export const parseTimestamp = (ms: unknown): Timestamp => TimestampSchema.parse(ms);

/**
 * Parse a SessionID with Zod validation
 *
 * @param s - Session ID string
 * @returns Branded SessionID
 * @throws ZodError if session ID is empty or too long
 */
export const parseSessionID = (s: unknown): SessionID => SessionIDSchema.parse(s);

/**
 * Parse a UserID with Zod validation
 *
 * @param s - User ID string
 * @returns Branded UserID
 * @throws ZodError if user ID is empty or too long
 */
export const parseUserID = (s: unknown): UserID => UserIDSchema.parse(s);

/**
 * Parse a FileID with Zod validation
 *
 * @param s - File ID string
 * @returns Branded FileID
 * @throws ZodError if file ID is empty or too long
 */
export const parseFileID = (s: unknown): FileID => FileIDSchema.parse(s);

/**
 * Create a Port with validation
 *
 * Use this for simple validation. For schema composition or detailed error messages, use PortSchema.
 *
 * @param n - Port number
 * @returns Branded Port type
 * @throws ZodError if port is not in valid range (0-65535)
 *
 * @example
 * ```typescript
 * const port = createPort(3000); // OK
 * const invalid = createPort(70000); // throws ZodError
 * ```
 */
export function createPort(n: number): Port {
  return PortSchema.parse(n);
}

/**
 * Create a URL with validation
 *
 * Use this for simple validation. For schema composition or detailed error messages, use URLSchema.
 *
 * @param s - URL string
 * @returns Branded URL type
 * @throws ZodError if URL is malformed
 *
 * @example
 * ```typescript
 * const url = createURL('https://example.com'); // OK
 * const invalid = createURL('not a url'); // throws ZodError
 * ```
 */
export function createURL(s: string): URL {
  return URLSchema.parse(s);
}

/**
 * Create a Timestamp from current time
 *
 * Use this for simple validation. For schema composition or detailed error messages, use TimestampSchema.
 *
 * @returns Current time as branded Timestamp
 *
 * @example
 * ```typescript
 * const now = createTimestamp(); // Current time in ms
 * ```
 */
export function createTimestamp(): Timestamp;
/**
 * Create a Timestamp from a Date
 *
 * @param date - Date object
 * @returns Date converted to branded Timestamp
 */
export function createTimestamp(date: Date): Timestamp;
/**
 * Create a Timestamp from milliseconds with validation
 *
 * @param ms - Milliseconds since Unix epoch
 * @returns Branded Timestamp
 * @throws ZodError if timestamp is negative
 */
export function createTimestamp(ms: number): Timestamp;
export function createTimestamp(input?: number | Date): Timestamp {
  if (input === undefined) {
    return TimestampSchema.parse(Date.now());
  }
  if (input instanceof Date) {
    const ms = input.getTime();
    if (isNaN(ms)) {
      throw new Error('Invalid Date object');
    }
    return TimestampSchema.parse(ms);
  }
  return TimestampSchema.parse(input);
}

/**
 * Create a SessionID with validation
 *
 * Use this for simple validation. For schema composition or detailed error messages, use SessionIDSchema.
 *
 * @param s - Session ID string
 * @returns Branded SessionID
 * @throws ZodError if session ID is empty or too long
 *
 * @example
 * ```typescript
 * const sessionId = createSessionID('abc123'); // OK
 * const invalid = createSessionID(''); // throws ZodError
 * ```
 */
export function createSessionID(s: string): SessionID {
  return SessionIDSchema.parse(s);
}

/**
 * Create a UserID with validation
 *
 * Use this for simple validation. For schema composition or detailed error messages, use UserIDSchema.
 *
 * @param s - User ID string
 * @returns Branded UserID
 * @throws ZodError if user ID is empty or too long
 *
 * @example
 * ```typescript
 * const userId = createUserID('user_abc123'); // OK
 * const invalid = createUserID(''); // throws ZodError
 * ```
 */
export function createUserID(s: string): UserID {
  return UserIDSchema.parse(s);
}

/**
 * Create a FileID with validation
 *
 * Use this for simple validation. For schema composition or detailed error messages, use FileIDSchema.
 * File IDs are string identifiers for files.
 *
 * TODO(#1159): Add format validation to prevent whitespace-only, control characters, and path traversal
 *
 * @param s - File ID string
 * @returns Branded FileID
 * @throws ZodError if file ID is empty or too long
 *
 * @example
 * ```typescript
 * const fileId = createFileID('abc123'); // OK
 * const invalid = createFileID(''); // throws ZodError
 * ```
 */
export function createFileID(s: string): FileID {
  return FileIDSchema.parse(s);
}
