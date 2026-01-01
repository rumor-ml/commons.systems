/**
 * Branded types for compile-time type safety
 *
 * Branded types use TypeScript's structural typing to create nominal types.
 * This prevents accidentally passing a regular number where a Port is expected,
 * or mixing up different string-based IDs.
 *
 * This module provides two approaches to validation:
 * 1. Factory functions (createPort, createURL, etc.) - Simple runtime validation
 * 2. Zod schemas (PortSchema, URLSchema, etc.) - Schema-based validation with composability
 *
 * @module branded
 */

import { z } from 'zod';

/**
 * Brand utility type
 *
 * Creates a branded type by intersecting the base type with a unique brand.
 * The __brand property is never actually present at runtime - it's a phantom type.
 *
 * @example
 * ```typescript
 * type UserId = Brand<string, 'UserId'>;
 * type OrderId = Brand<string, 'OrderId'>;
 *
 * const userId: UserId = 'user123' as UserId; // Type error!
 * const userId: UserId = createUserId('user123'); // OK with factory
 * ```
 */
export type Brand<T, B> = T & { readonly __brand: B };

/**
 * Port number (0-65535)
 *
 * Prevents accidentally using invalid port numbers or mixing ports with other numbers.
 */
export type Port = Brand<number, 'Port'>;

/**
 * URL string
 *
 * Represents a validated URL. Prevents accidentally using non-URL strings.
 */
export type URL = Brand<string, 'URL'>;

/**
 * Unix timestamp in milliseconds
 *
 * Prevents mixing up different time representations (seconds vs milliseconds, Date vs number).
 */
export type Timestamp = Brand<number, 'Timestamp'>;

/**
 * Session ID string
 *
 * Prevents mixing up session IDs with other string identifiers (user IDs, file IDs, etc.).
 */
export type SessionID = Brand<string, 'SessionID'>;

/**
 * User ID string
 *
 * Prevents mixing up user IDs with other string identifiers.
 */
export type UserID = Brand<string, 'UserID'>;

/**
 * File ID string (typically a hash)
 *
 * Prevents mixing up file IDs with other string identifiers.
 */
export type FileID = Brand<string, 'FileID'>;

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
 * Parse a Port with Zod validation
 *
 * @param n - Port number
 * @returns Branded Port type
 * @throws ZodError if port is not in valid range (0-65535)
 */
export const parsePort = (n: unknown): Port => PortSchema.parse(n) as unknown as Port;

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
 * Parse a URL with Zod validation
 *
 * @param s - URL string
 * @returns Branded URL type
 * @throws ZodError if URL is malformed
 */
export const parseURL = (s: unknown): URL => URLSchema.parse(s) as unknown as URL;

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
 * Parse a Timestamp with Zod validation
 *
 * @param ms - Milliseconds since Unix epoch
 * @returns Branded Timestamp
 * @throws ZodError if timestamp is negative or not finite
 */
export const parseTimestamp = (ms: unknown): Timestamp =>
  TimestampSchema.parse(ms) as unknown as Timestamp;

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
 * Parse a SessionID with Zod validation
 *
 * @param s - Session ID string
 * @returns Branded SessionID
 * @throws ZodError if session ID is empty or too long
 */
export const parseSessionID = (s: unknown): SessionID =>
  SessionIDSchema.parse(s) as unknown as SessionID;

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
 * Parse a UserID with Zod validation
 *
 * @param s - User ID string
 * @returns Branded UserID
 * @throws ZodError if user ID is empty or too long
 */
export const parseUserID = (s: unknown): UserID => UserIDSchema.parse(s) as unknown as UserID;

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
 * Parse a FileID with Zod validation
 *
 * @param s - File ID string (hash)
 * @returns Branded FileID
 * @throws ZodError if file ID is empty or too long
 */
export const parseFileID = (s: unknown): FileID => FileIDSchema.parse(s) as unknown as FileID;

/**
 * Create a Port with validation
 *
 * @param n - Port number
 * @returns Branded Port type
 * @throws Error if port is not in valid range (0-65535)
 *
 * @example
 * ```typescript
 * const port = createPort(3000); // OK
 * const invalid = createPort(70000); // throws Error
 * ```
 */
export function createPort(n: number): Port {
  if (!Number.isInteger(n)) {
    throw new Error(`Port must be an integer, got ${n}`);
  }
  if (n < 0 || n > 65535) {
    throw new Error(`Port must be between 0 and 65535, got ${n}`);
  }
  return n as Port;
}

/**
 * Create a URL with validation
 *
 * @param s - URL string
 * @returns Branded URL type
 * @throws Error if URL is malformed
 *
 * @example
 * ```typescript
 * const url = createURL('https://example.com'); // OK
 * const invalid = createURL('not a url'); // throws Error
 * ```
 */
export function createURL(s: string): URL {
  try {
    new globalThis.URL(s); // Validate using URL constructor
    return s as URL;
  } catch (error) {
    throw new Error(`Invalid URL: ${s}`);
  }
}

/**
 * Create a Timestamp from current time
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
 * @throws Error if timestamp is negative
 */
export function createTimestamp(ms: number): Timestamp;
export function createTimestamp(input?: number | Date): Timestamp {
  if (input === undefined) {
    return Date.now() as Timestamp;
  }

  if (input instanceof Date) {
    const ms = input.getTime();
    if (isNaN(ms)) {
      throw new Error('Invalid Date object');
    }
    return ms as Timestamp;
  }

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new Error(`Timestamp must be finite, got ${input}`);
    }
    if (input < 0) {
      throw new Error(`Timestamp cannot be negative, got ${input}`);
    }
    return input as Timestamp;
  }

  throw new Error(`Invalid timestamp input: ${input}`);
}

/**
 * Create a SessionID with validation
 *
 * @param s - Session ID string
 * @returns Branded SessionID
 * @throws Error if session ID is empty or too long
 *
 * @example
 * ```typescript
 * const sessionId = createSessionID('abc123'); // OK
 * const invalid = createSessionID(''); // throws Error
 * ```
 */
export function createSessionID(s: string): SessionID {
  if (typeof s !== 'string') {
    throw new Error(`SessionID must be a string, got ${typeof s}`);
  }
  if (s.length === 0) {
    throw new Error('SessionID cannot be empty');
  }
  if (s.length > 256) {
    throw new Error(`SessionID too long (max 256 chars), got ${s.length}`);
  }
  return s as SessionID;
}

/**
 * Create a UserID with validation
 *
 * @param s - User ID string
 * @returns Branded UserID
 * @throws Error if user ID is empty or too long
 *
 * @example
 * ```typescript
 * const userId = createUserID('user_abc123'); // OK
 * const invalid = createUserID(''); // throws Error
 * ```
 */
export function createUserID(s: string): UserID {
  if (typeof s !== 'string') {
    throw new Error(`UserID must be a string, got ${typeof s}`);
  }
  if (s.length === 0) {
    throw new Error('UserID cannot be empty');
  }
  if (s.length > 256) {
    throw new Error(`UserID too long (max 256 chars), got ${s.length}`);
  }
  return s as UserID;
}

/**
 * Create a FileID with validation
 *
 * File IDs are typically SHA-256 hashes (64 hex characters).
 *
 * @param s - File ID string (hash)
 * @returns Branded FileID
 * @throws Error if file ID is empty or invalid format
 *
 * @example
 * ```typescript
 * const fileId = createFileID('abc123...'); // OK for hash
 * const invalid = createFileID(''); // throws Error
 * ```
 */
export function createFileID(s: string): FileID {
  if (typeof s !== 'string') {
    throw new Error(`FileID must be a string, got ${typeof s}`);
  }
  if (s.length === 0) {
    throw new Error('FileID cannot be empty');
  }
  if (s.length > 256) {
    throw new Error(`FileID too long (max 256 chars), got ${s.length}`);
  }
  return s as FileID;
}

/**
 * Unwrap a branded type to its base type
 *
 * Useful when you need to pass a branded type to an API that expects the base type.
 *
 * @param branded - Branded value
 * @returns Base value
 *
 * @example
 * ```typescript
 * const port: Port = createPort(3000);
 * const num: number = unwrap(port); // 3000
 * ```
 */
export function unwrap<T>(branded: Brand<T, any>): T {
  return branded as T;
}
