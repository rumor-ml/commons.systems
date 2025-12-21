/**
 * Branded types for compile-time type safety
 *
 * Branded types use TypeScript's structural typing to create nominal types.
 * This prevents accidentally passing a regular number where a Port is expected,
 * or mixing up different string-based IDs.
 *
 * ## Two Validation Approaches
 *
 * This module provides two ways to create and validate branded types:
 *
 * 1. **TypeScript validators** (e.g., `createPort()`, `createURLString()`):
 *    - Throw simple Error objects with clear messages
 *    - Best for internal application code
 *    - Lighter weight and simpler error handling
 *
 * 2. **Zod validators** (e.g., `createPortZod()`, `createURLStringZod()`):
 *    - Throw ZodError objects with detailed validation information
 *    - Best for API boundaries and external data validation
 *    - Support `.safeParse()` for non-throwing validation
 *    - Can be composed with other Zod schemas
 *
 * Both approaches produce identical branded types that are fully compatible.
 * Choose based on your error handling needs and architectural boundaries.
 *
 * @module branded
 */

import { z } from 'zod';

/**
 * Brand utility type
 *
 * Creates a branded type by intersecting the base type with a unique brand.
 * The `__brand` property is a "phantom type" - it exists only at compile-time
 * for type checking and is completely erased at runtime. This means:
 *
 * - Zero runtime overhead: branded values are identical to their base types
 * - No memory cost: the __brand property never actually exists
 * - Full compatibility: can be serialized, logged, and stored like base types
 * - Type safety: TypeScript prevents mixing different branded types at compile-time
 *
 * @example
 * ```typescript
 * type UserId = Brand<string, 'UserId'>;
 * type OrderId = Brand<string, 'OrderId'>;
 *
 * // Type error! Cannot assign plain string to branded type:
 * // const userId: UserId = 'user123';
 *
 * // Type error! Cannot mix different branded types:
 * // const userId: UserId = orderId;
 *
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
export type URLString = Brand<string, 'URLString'>;

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
 * File ID string
 *
 * Prevents mixing up file IDs with other string identifiers.
 * Can be any non-empty string up to 256 characters (e.g., content hashes, UUIDs, database IDs).
 */
export type FileID = Brand<string, 'FileID'>;

/**
 * Create a Port with validation
 *
 * Validates that the port number is within the valid TCP/UDP range (0-65535).
 * This is the standard range for network ports, defined by the 16-bit unsigned
 * integer limit used in TCP and UDP protocols.
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
 * Create a URLString with validation
 *
 * @param s - URL string
 * @returns Branded URLString type
 * @throws Error if URL is malformed
 *
 * @example
 * ```typescript
 * const url = createURLString('https://example.com'); // OK
 * const invalid = createURLString('not a url'); // throws Error
 * ```
 */
export function createURLString(s: string): URLString {
  try {
    new URL(s); // Validate using URL constructor
    return s as URLString;
  } catch (error) {
    throw new Error(`Invalid URL: ${s}`, { cause: error });
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

  // input is number (TypeScript narrows the type)
  if (!Number.isFinite(input)) {
    throw new Error(`Timestamp must be finite, got ${input}`);
  }
  if (input < 0) {
    throw new Error(`Timestamp cannot be negative, got ${input}`);
  }
  return input as Timestamp;
}

/**
 * Validates a string ID value
 *
 * String IDs are limited to 256 characters by default because:
 * - Accommodates common ID formats (UUIDs: 36 chars, SHA-256: 64 chars, base64: ~44 chars)
 * - Prevents accidental use of large text content as IDs
 * - Safe for database VARCHAR columns and JSON serialization
 * - Reasonable limit for network transmission and logging
 *
 * @param value - String value to validate
 * @param typeName - Name of the type for error messages
 * @param maxLength - Maximum allowed length (default 256)
 * @throws Error if validation fails
 */
function validateStringID(value: string, typeName: string, maxLength: number = 256): void {
  if (typeof value !== 'string') {
    throw new Error(`${typeName} must be a string, got ${typeof value}`);
  }
  if (value.length === 0) {
    throw new Error(`${typeName} cannot be empty`);
  }
  if (value.length > maxLength) {
    throw new Error(`${typeName} too long (max ${maxLength} chars), got ${value.length}`);
  }
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
  validateStringID(s, 'SessionID');
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
  validateStringID(s, 'UserID');
  return s as UserID;
}

/**
 * Create a FileID with validation
 *
 * File IDs can be any non-empty string up to 256 characters.
 * Common use cases include content hashes (e.g., SHA-256), UUIDs, or database IDs.
 *
 * @param s - File ID string
 * @returns Branded FileID
 * @throws Error if file ID is empty or exceeds 256 characters
 *
 * @example
 * ```typescript
 * const fileId = createFileID('abc123...'); // OK for hash
 * const uuidId = createFileID('550e8400-e29b-41d4-a716-446655440000'); // OK for UUID
 * const invalid = createFileID(''); // throws Error
 * ```
 */
export function createFileID(s: string): FileID {
  validateStringID(s, 'FileID');
  return s as FileID;
}

// ============================================================================
// Zod Schemas and Validation
// ============================================================================

/**
 * Zod schema for Port validation
 *
 * Validates that a number is an integer between 0 and 65535.
 * This range represents the valid TCP/UDP port range (16-bit unsigned integer).
 */
export const PortSchema = z.number().int().min(0).max(65535).brand<'Port'>();

/**
 * Zod schema for URLString validation
 *
 * Validates that a string is a valid URL.
 */
export const URLStringSchema = z.string().url().brand<'URLString'>();

/**
 * Zod schema for Timestamp validation
 *
 * Validates that a number is finite and non-negative.
 */
export const TimestampSchema = z.number().finite().nonnegative().brand<'Timestamp'>();

/**
 * Zod schema for SessionID validation
 *
 * Validates that a string is non-empty and at most 256 characters.
 * The 256 character limit accommodates common ID formats while preventing
 * accidental use of large text content as IDs.
 */
export const SessionIDSchema = z.string().min(1).max(256).brand<'SessionID'>();

/**
 * Zod schema for UserID validation
 *
 * Validates that a string is non-empty and at most 256 characters.
 * The 256 character limit accommodates common ID formats while preventing
 * accidental use of large text content as IDs.
 */
export const UserIDSchema = z.string().min(1).max(256).brand<'UserID'>();

/**
 * Zod schema for FileID validation
 *
 * Validates that a string is non-empty and at most 256 characters.
 * The 256 character limit accommodates common ID formats while preventing
 * accidental use of large text content as IDs.
 */
export const FileIDSchema = z.string().min(1).max(256).brand<'FileID'>();

/**
 * Create a Port with Zod validation
 *
 * @param n - Port number
 * @returns Branded Port type
 * @throws ZodError if validation fails
 *
 * @example
 * ```typescript
 * const port = createPortZod(3000); // OK
 * const invalid = createPortZod(70000); // throws ZodError
 * ```
 */
export function createPortZod(n: number): Port {
  return PortSchema.parse(n) as unknown as Port;
}

/**
 * Create a URLString with Zod validation
 *
 * @param s - URL string
 * @returns Branded URLString type
 * @throws ZodError if validation fails
 *
 * @example
 * ```typescript
 * const url = createURLStringZod('https://example.com'); // OK
 * const invalid = createURLStringZod('not a url'); // throws ZodError
 * ```
 */
export function createURLStringZod(s: string): URLString {
  return URLStringSchema.parse(s) as unknown as URLString;
}

/**
 * Create a Timestamp with Zod validation
 *
 * @param ms - Milliseconds since Unix epoch
 * @returns Branded Timestamp
 * @throws ZodError if validation fails
 *
 * @example
 * ```typescript
 * const timestamp = createTimestampZod(Date.now()); // OK
 * const invalid = createTimestampZod(-1); // throws ZodError
 * ```
 */
export function createTimestampZod(ms: number): Timestamp {
  return TimestampSchema.parse(ms) as unknown as Timestamp;
}

/**
 * Create a SessionID with Zod validation
 *
 * @param s - Session ID string
 * @returns Branded SessionID
 * @throws ZodError if validation fails
 *
 * @example
 * ```typescript
 * const sessionId = createSessionIDZod('abc123'); // OK
 * const invalid = createSessionIDZod(''); // throws ZodError
 * ```
 */
export function createSessionIDZod(s: string): SessionID {
  return SessionIDSchema.parse(s) as unknown as SessionID;
}

/**
 * Create a UserID with Zod validation
 *
 * @param s - User ID string
 * @returns Branded UserID
 * @throws ZodError if validation fails
 *
 * @example
 * ```typescript
 * const userId = createUserIDZod('user_abc123'); // OK
 * const invalid = createUserIDZod(''); // throws ZodError
 * ```
 */
export function createUserIDZod(s: string): UserID {
  return UserIDSchema.parse(s) as unknown as UserID;
}

/**
 * Create a FileID with Zod validation
 *
 * @param s - File ID string (hash)
 * @returns Branded FileID
 * @throws ZodError if validation fails
 *
 * @example
 * ```typescript
 * const fileId = createFileIDZod('abc123...'); // OK for hash
 * const invalid = createFileIDZod(''); // throws ZodError
 * ```
 */
export function createFileIDZod(s: string): FileID {
  return FileIDSchema.parse(s) as unknown as FileID;
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
