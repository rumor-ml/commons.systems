/**
 * Branded types for compile-time type safety using Zod
 *
 * This module provides branded types using Zod's branding system:
 * - Branded types: Port, URL, Timestamp, SessionID, UserID, FileID
 * - Zod schemas for validation and composition
 * - Factory functions for convenient creation
 *
 * Three approaches for creating branded types (all produce identical Zod-branded types):
 * 1. Factory functions (createPort, etc.) - User-friendly BrandedTypeError
 * 2. Parse functions (parsePort, etc.) - ZodError for schema composition
 * 3. Zod schemas (PortSchema.parse, etc.) - Full schema composability
 *
 * @module branded
 */

import { z } from 'zod';

// Note on type safety: Always use factory functions (like createPort) or Zod parsers
// (like parsePort) to create branded types - these ensure validation occurs. Avoid type
// assertions (e.g., `70000 as Port`) as they bypass validation and create runtime bugs:
//
//   const badPort = 70000 as Port;  // No compile error, but invalid!
//   server.listen(badPort);          // Runtime error: port out of range
//
// Type assertions violate the branded type's invariants and can cause production failures
// (invalid ports, malformed URLs, negative timestamps). While TypeScript allows type assertions,
// you should configure ESLint (@typescript-eslint/consistent-type-assertions) to prevent them
// and always use the provided factory functions or schemas.

/**
 * Error thrown by branded type factory functions when validation fails.
 * Provides user-friendly error messages while preserving the underlying ZodError.
 *
 * Factory functions (create*) throw this error. Parse functions (parse*) still
 * throw ZodError directly for backward compatibility and schema composition.
 */
export class BrandedTypeError extends Error {
  constructor(
    public readonly type: string,
    public readonly value: unknown,
    public readonly zodError: z.ZodError
  ) {
    const messages = zodError.issues.map((issue) => issue.message);
    const zodMessage =
      messages.length > 1 ? `\n  - ${messages.join('\n  - ')}` : messages[0] || 'validation failed';
    super(`Invalid ${type}: ${zodMessage}`);
    this.name = 'BrandedTypeError';
  }
}

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

// Max timestamp: Dec 31, 9999 23:59:59.999 UTC (253402300799999ms)
// Prevents far-future timestamps that could cause issues in date libraries or databases
const MAX_TIMESTAMP = 253402300799999;

/**
 * Zod schema for Timestamp (Unix timestamp in milliseconds)
 *
 * Validates timestamps are:
 * - Non-negative (>= 0)
 * - Finite (not Infinity or -Infinity)
 * - Before year 10000 (<= 253402300799999ms)
 *
 * @example
 * ```typescript
 * const timestamp = TimestampSchema.parse(Date.now()); // Timestamp
 * const invalid = TimestampSchema.safeParse(-1); // { success: false }
 * const tooFar = TimestampSchema.safeParse(9e15); // { success: false }
 * ```
 */
export const TimestampSchema = z
  .number()
  .finite()
  .nonnegative()
  .max(MAX_TIMESTAMP, 'Timestamp must be before year 10000')
  .brand<'Timestamp'>();

/**
 * Zod schema for SessionID (1-256 characters)
 *
 * Validates session IDs are:
 * - Non-empty (>= 1 character)
 * - Not too long (<= 256 characters)
 * - Not whitespace-only
 * - Free of control characters (prevents issues in HTTP headers, logs, etc.)
 *
 * @example
 * ```typescript
 * const sessionId = SessionIDSchema.parse('abc123'); // SessionID
 * const invalid = SessionIDSchema.safeParse(''); // { success: false }
 * const whitespace = SessionIDSchema.safeParse('   '); // { success: false }
 * ```
 */
export const SessionIDSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((s) => s.trim().length > 0, 'SessionID cannot be whitespace-only')
  .refine((s) => !/[\x00-\x1F\x7F]/.test(s), 'SessionID cannot contain control characters')
  .brand<'SessionID'>();

/**
 * Zod schema for UserID (1-256 characters)
 *
 * Validates user IDs are:
 * - Non-empty (>= 1 character)
 * - Not too long (<= 256 characters)
 * - Not whitespace-only
 * - Free of control characters (prevents issues in logs, databases, etc.)
 *
 * @example
 * ```typescript
 * const userId = UserIDSchema.parse('user_abc123'); // UserID
 * const invalid = UserIDSchema.safeParse(''); // { success: false }
 * const whitespace = UserIDSchema.safeParse('   '); // { success: false }
 * ```
 */
export const UserIDSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((s) => s.trim().length > 0, 'UserID cannot be whitespace-only')
  .refine((s) => !/[\x00-\x1F\x7F]/.test(s), 'UserID cannot contain control characters')
  .brand<'UserID'>();

/**
 * Zod schema for FileID (1-256 characters)
 *
 * Validates file IDs are:
 * - Non-empty (>= 1 character)
 * - Not too long (<= 256 characters)
 * - Not whitespace-only
 * - Free of control characters
 * - Free of path traversal sequences (..)
 *
 * This prevents security issues when file IDs are used in filesystem operations
 * or database queries.
 *
 * @example
 * ```typescript
 * const fileId = FileIDSchema.parse('hash123'); // FileID
 * const invalid = FileIDSchema.safeParse(''); // { success: false }
 * const whitespace = FileIDSchema.safeParse('   '); // { success: false }
 * const traversal = FileIDSchema.safeParse('../etc/passwd'); // { success: false }
 * ```
 */
export const FileIDSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((s) => s.trim().length > 0, 'FileID cannot be whitespace-only')
  .refine((s) => !/[\x00-\x1F\x7F]/.test(s), 'FileID cannot contain control characters')
  .refine((s) => {
    // Block path traversal patterns
    // Match ".." but not "..." (3+ dots)
    // Using negative lookahead to ensure we don't match when followed by more dots
    if (/(?:^|\/)\.\.(?:\/|$)/.test(s)) return false; // ../path or /.. or path/..
    if (/^\.\.(?!\.)/.test(s)) return false; // Starts with .. (but not ...)
    if (/[^.]\.\.(?!\.)/.test(s)) return false; // Contains .. not preceded by dot (but not ...)

    // Block absolute paths (Unix and Windows)
    if (s.startsWith('/') || /^[A-Za-z]:[/\\]/.test(s)) return false;

    // Block URL-encoded dots and slashes
    if (/%2e/i.test(s) || /%2f/i.test(s) || /%5c/i.test(s)) return false;

    // Block backslashes (Windows path separators)
    if (s.includes('\\')) return false;

    return true;
  }, 'FileID cannot contain path traversal or absolute path sequences')
  .brand<'FileID'>();

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
 * This function throws ZodError for schema composition and backward compatibility.
 * For user-friendly errors, use createPort() instead which throws BrandedTypeError.
 *
 * @param n - Port number
 * @returns Branded Port type
 * @throws {z.ZodError} if port is not in valid range (0-65535)
 */
export const parsePort = (n: unknown): Port => PortSchema.parse(n);

/**
 * Parse a URL with Zod validation
 *
 * This function throws ZodError for schema composition and backward compatibility.
 * For user-friendly errors, use createURL() instead which throws BrandedTypeError.
 *
 * @param s - URL string
 * @returns Branded URL type
 * @throws {z.ZodError} if URL is malformed
 */
export const parseURL = (s: unknown): URL => URLSchema.parse(s);

/**
 * Parse a Timestamp with Zod validation
 *
 * This function throws ZodError for schema composition and backward compatibility.
 * For user-friendly errors, use createTimestamp() instead which throws BrandedTypeError.
 *
 * @param ms - Milliseconds since Unix epoch
 * @returns Branded Timestamp
 * @throws {z.ZodError} if timestamp is negative, not finite, or too far in the future
 */
export const parseTimestamp = (ms: unknown): Timestamp => TimestampSchema.parse(ms);

/**
 * Parse a SessionID with Zod validation
 *
 * This function throws ZodError for schema composition and backward compatibility.
 * For user-friendly errors, use createSessionID() instead which throws BrandedTypeError.
 *
 * @param s - Session ID string
 * @returns Branded SessionID
 * @throws {z.ZodError} if session ID is empty, too long, whitespace-only, or contains control characters
 */
export const parseSessionID = (s: unknown): SessionID => SessionIDSchema.parse(s);

/**
 * Parse a UserID with Zod validation
 *
 * This function throws ZodError for schema composition and backward compatibility.
 * For user-friendly errors, use createUserID() instead which throws BrandedTypeError.
 *
 * @param s - User ID string
 * @returns Branded UserID
 * @throws {z.ZodError} if user ID is empty, too long, whitespace-only, or contains control characters
 */
export const parseUserID = (s: unknown): UserID => UserIDSchema.parse(s);

/**
 * Parse a FileID with Zod validation
 *
 * This function throws ZodError for schema composition and backward compatibility.
 * For user-friendly errors, use createFileID() instead which throws BrandedTypeError.
 *
 * @param s - File ID string
 * @returns Branded FileID
 * @throws {z.ZodError} if file ID is empty, too long, whitespace-only, contains control characters, or has path traversal sequences
 */
export const parseFileID = (s: unknown): FileID => FileIDSchema.parse(s);

/**
 * Create a Port with validation
 *
 * Use this for simple validation with user-friendly errors. For schema composition
 * or to catch ZodError directly, use PortSchema.parse() or parsePort().
 *
 * @param n - Port number
 * @returns Branded Port type
 * @throws {BrandedTypeError} if port is not in valid range (0-65535)
 *
 * @example
 * ```typescript
 * const port = createPort(3000); // OK
 * const invalid = createPort(70000); // throws BrandedTypeError
 * ```
 */
export function createPort(n: number): Port {
  const result = PortSchema.safeParse(n);
  if (!result.success) {
    throw new BrandedTypeError('Port', n, result.error);
  }
  return result.data;
}

/**
 * Create a URL with validation
 *
 * Use this for simple validation with user-friendly errors. For schema composition
 * or to catch ZodError directly, use URLSchema.parse() or parseURL().
 *
 * @param s - URL string
 * @returns Branded URL type
 * @throws {BrandedTypeError} if URL is malformed
 *
 * @example
 * ```typescript
 * const url = createURL('https://example.com'); // OK
 * const invalid = createURL('not a url'); // throws BrandedTypeError
 * ```
 */
export function createURL(s: string): URL {
  const result = URLSchema.safeParse(s);
  if (!result.success) {
    throw new BrandedTypeError('URL', s, result.error);
  }
  return result.data;
}

/**
 * Create a Timestamp from current time
 *
 * Use this for simple validation with user-friendly errors. For schema composition
 * or to catch ZodError directly, use TimestampSchema.parse() or parseTimestamp().
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
 * @throws {BrandedTypeError} if Date is invalid (NaN) or too far in the future
 */
export function createTimestamp(date: Date): Timestamp;
/**
 * Create a Timestamp from milliseconds with validation
 *
 * @param ms - Milliseconds since Unix epoch
 * @returns Branded Timestamp
 * @throws {BrandedTypeError} if timestamp is negative, not finite, or too far in the future
 */
export function createTimestamp(ms: number): Timestamp;
export function createTimestamp(input?: number | Date): Timestamp {
  let value: number;
  if (input === undefined) {
    value = Date.now();
  } else if (input instanceof Date) {
    value = input.getTime();
  } else {
    value = input;
  }

  const result = TimestampSchema.safeParse(value);
  if (!result.success) {
    throw new BrandedTypeError('Timestamp', input, result.error);
  }
  return result.data;
}

/**
 * Create a SessionID with validation
 *
 * Use this for simple validation with user-friendly errors. For schema composition
 * or to catch ZodError directly, use SessionIDSchema.parse() or parseSessionID().
 *
 * @param s - Session ID string
 * @returns Branded SessionID
 * @throws {BrandedTypeError} if session ID is empty, too long, whitespace-only, or contains control characters
 *
 * @example
 * ```typescript
 * const sessionId = createSessionID('abc123'); // OK
 * const invalid = createSessionID(''); // throws BrandedTypeError
 * ```
 */
export function createSessionID(s: string): SessionID {
  const result = SessionIDSchema.safeParse(s);
  if (!result.success) {
    throw new BrandedTypeError('SessionID', s, result.error);
  }
  return result.data;
}

/**
 * Create a UserID with validation
 *
 * Use this for simple validation with user-friendly errors. For schema composition
 * or to catch ZodError directly, use UserIDSchema.parse() or parseUserID().
 *
 * @param s - User ID string
 * @returns Branded UserID
 * @throws {BrandedTypeError} if user ID is empty, too long, whitespace-only, or contains control characters
 *
 * @example
 * ```typescript
 * const userId = createUserID('user_abc123'); // OK
 * const invalid = createUserID(''); // throws BrandedTypeError
 * ```
 */
export function createUserID(s: string): UserID {
  const result = UserIDSchema.safeParse(s);
  if (!result.success) {
    throw new BrandedTypeError('UserID', s, result.error);
  }
  return result.data;
}

/**
 * Create a FileID with validation
 *
 * Use this for simple validation with user-friendly errors. For schema composition
 * or to catch ZodError directly, use FileIDSchema.parse() or parseFileID().
 * File IDs are string identifiers for files.
 *
 * Security validation prevents common path traversal attacks:
 * - Rejects '..' sequences (e.g., '../etc/passwd')
 * - Rejects absolute paths (Unix: '/', Windows: 'C:\')
 * - Rejects URL-encoded traversal patterns (%2e%2e, %2f)
 * - Rejects backslashes (Windows path separators)
 *
 * Note: FileIDs are opaque identifiers. If constructing file paths,
 * always use path.basename() or equivalent normalization.
 *
 * @param s - File ID string
 * @returns Branded FileID
 * @throws {BrandedTypeError} if file ID is invalid
 *
 * @example
 * ```typescript
 * const fileId = createFileID('abc123'); // OK
 * const invalid = createFileID(''); // throws BrandedTypeError
 * const unsafe = createFileID('../etc/passwd'); // throws BrandedTypeError
 * ```
 */
export function createFileID(s: string): FileID {
  const result = FileIDSchema.safeParse(s);
  if (!result.success) {
    throw new BrandedTypeError('FileID', s, result.error);
  }
  return result.data;
}

/**
 * Runtime assertion helpers for debugging type assertion misuse
 *
 * WARNING: These helpers are for test/debug code only. In production, always use
 * factory functions (create*) or parse functions (parse*) to create branded types.
 *
 * These helpers validate at runtime to catch incorrect type assertions like:
 *   const badPort = 70000 as Port;  // Compiles but violates invariants!
 *   assertPort(badPort);            // Throws in dev, helping catch the bug early
 *
 * Assertions only run in non-production environments to avoid performance overhead.
 */

/**
 * Assert that a value is a valid Port (for debugging only)
 *
 * ⚠️ WARNING: This function DOES NOT VALIDATE in production!
 * Production code will silently accept invalid Ports.
 * Only use this for debugging type assertion misuse in development.
 * NEVER rely on this for production data validation.
 *
 * @param value - Value to validate as Port
 * @throws {z.ZodError} if value is not a valid Port (only in non-production)
 */
export function assertPort(value: Port): asserts value is Port {
  if (process.env.NODE_ENV !== 'production') {
    PortSchema.parse(value);
  }
}

/**
 * Assert that a value is a valid URL (for debugging only)
 *
 * ⚠️ WARNING: This function DOES NOT VALIDATE in production!
 * Production code will silently accept invalid URLs.
 * Only use this for debugging type assertion misuse in development.
 * NEVER rely on this for production data validation.
 *
 * @param value - Value to validate as URL
 * @throws {z.ZodError} if value is not a valid URL (only in non-production)
 */
export function assertURL(value: URL): asserts value is URL {
  if (process.env.NODE_ENV !== 'production') {
    URLSchema.parse(value);
  }
}

/**
 * Assert that a value is a valid Timestamp (for debugging only)
 *
 * ⚠️ WARNING: This function DOES NOT VALIDATE in production!
 * Production code will silently accept invalid Timestamps.
 * Only use this for debugging type assertion misuse in development.
 * NEVER rely on this for production data validation.
 *
 * @param value - Value to validate as Timestamp
 * @throws {z.ZodError} if value is not a valid Timestamp (only in non-production)
 */
export function assertTimestamp(value: Timestamp): asserts value is Timestamp {
  if (process.env.NODE_ENV !== 'production') {
    TimestampSchema.parse(value);
  }
}

/**
 * Assert that a value is a valid SessionID (for debugging only)
 *
 * ⚠️ WARNING: This function DOES NOT VALIDATE in production!
 * Production code will silently accept invalid SessionIDs.
 * Only use this for debugging type assertion misuse in development.
 * NEVER rely on this for production data validation.
 *
 * @param value - Value to validate as SessionID
 * @throws {z.ZodError} if value is not a valid SessionID (only in non-production)
 */
export function assertSessionID(value: SessionID): asserts value is SessionID {
  if (process.env.NODE_ENV !== 'production') {
    SessionIDSchema.parse(value);
  }
}

/**
 * Assert that a value is a valid UserID (for debugging only)
 *
 * ⚠️ WARNING: This function DOES NOT VALIDATE in production!
 * Production code will silently accept invalid UserIDs.
 * Only use this for debugging type assertion misuse in development.
 * NEVER rely on this for production data validation.
 *
 * @param value - Value to validate as UserID
 * @throws {z.ZodError} if value is not a valid UserID (only in non-production)
 */
export function assertUserID(value: UserID): asserts value is UserID {
  if (process.env.NODE_ENV !== 'production') {
    UserIDSchema.parse(value);
  }
}

/**
 * Assert that a value is a valid FileID (for debugging only)
 *
 * ⚠️ WARNING: This function DOES NOT VALIDATE in production!
 * Production code will silently accept invalid FileIDs.
 * Only use this for debugging type assertion misuse in development.
 * NEVER rely on this for production data validation.
 *
 * @param value - Value to validate as FileID
 * @throws {z.ZodError} if value is not a valid FileID (only in non-production)
 */
export function assertFileID(value: FileID): asserts value is FileID {
  if (process.env.NODE_ENV !== 'production') {
    FileIDSchema.parse(value);
  }
}
