/**
 * Tests for branded types
 */

import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  createPort,
  createURL,
  createTimestamp,
  createSessionID,
  createUserID,
  createFileID,
  unwrap,
  PortSchema,
  URLSchema,
  TimestampSchema,
  SessionIDSchema,
  UserIDSchema,
  FileIDSchema,
  parsePort,
  parseURL,
  parseTimestamp,
  parseSessionID,
  parseUserID,
  parseFileID,
  type Port,
  type URL,
  type Timestamp,
  type SessionID,
  type UserID,
  type FileID,
} from './branded.js';

describe('createPort', () => {
  it('creates valid port numbers', () => {
    expect(createPort(0)).toBe(0);
    expect(createPort(80)).toBe(80);
    expect(createPort(443)).toBe(443);
    expect(createPort(3000)).toBe(3000);
    expect(createPort(65535)).toBe(65535);
  });

  it('rejects negative ports', () => {
    // TODO(#1126): Use exact error message matching instead of partial string matching
    expect(() => createPort(-1)).toThrow('Port must be between 0 and 65535');
  });

  it('rejects ports above 65535', () => {
    expect(() => createPort(65536)).toThrow('Port must be between 0 and 65535');
    expect(() => createPort(70000)).toThrow('Port must be between 0 and 65535');
  });

  it('rejects non-integer ports', () => {
    expect(() => createPort(3000.5)).toThrow('Port must be an integer');
  });

  it('rejects NaN ports', () => {
    expect(() => createPort(NaN)).toThrow('Port must be an integer');
  });

  it('rejects infinite port numbers', () => {
    expect(() => createPort(Infinity)).toThrow('Port must be an integer');
    expect(() => createPort(-Infinity)).toThrow('Port must be an integer');
  });

  it('returns branded Port type', () => {
    const port: Port = createPort(3000);
    expect(port).toBe(3000);
  });
});

describe('createURL', () => {
  it('creates valid URLs', () => {
    expect(createURL('https://example.com')).toBe('https://example.com');
    expect(createURL('http://localhost:3000')).toBe('http://localhost:3000');
    expect(createURL('https://example.com/path?query=1')).toBe('https://example.com/path?query=1');
  });

  it('rejects malformed URLs', () => {
    expect(() => createURL('not a url')).toThrow('Invalid URL');
    expect(() => createURL('')).toThrow('Invalid URL');
    expect(() => createURL('//example.com')).toThrow('Invalid URL');
  });

  it('re-throws unexpected errors from URL constructor', () => {
    // Mock the URL constructor to throw a non-TypeError
    const originalURL = globalThis.URL;
    globalThis.URL = class {
      constructor() {
        throw new Error('Unexpected error');
      }
    } as any;

    try {
      expect(() => createURL('https://example.com')).toThrow('Unexpected error');
      expect(() => createURL('https://example.com')).not.toThrow('Invalid URL');
    } finally {
      globalThis.URL = originalURL;
    }
  });

  it('returns branded URL type', () => {
    const url: URL = createURL('https://example.com');
    expect(url).toBe('https://example.com');
  });
});

describe('createTimestamp', () => {
  it('creates timestamp from current time', () => {
    const before = Date.now();
    const timestamp = createTimestamp();
    const after = Date.now();

    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });

  it('creates timestamp from Date object', () => {
    const date = new Date('2024-01-01T00:00:00Z');
    const timestamp = createTimestamp(date);
    expect(timestamp).toBe(date.getTime());
  });

  it('creates timestamp from milliseconds', () => {
    const ms = 1704067200000; // 2024-01-01T00:00:00Z
    const timestamp = createTimestamp(ms);
    expect(timestamp).toBe(ms);
  });

  it('rejects negative timestamps', () => {
    expect(() => createTimestamp(-1)).toThrow('Timestamp cannot be negative');
  });

  it('rejects infinite timestamps', () => {
    expect(() => createTimestamp(Infinity)).toThrow('Timestamp must be finite');
    expect(() => createTimestamp(-Infinity)).toThrow('Timestamp must be finite');
  });

  it('rejects NaN timestamps', () => {
    expect(() => createTimestamp(NaN)).toThrow('Timestamp must be finite');
  });

  it('rejects invalid Date objects', () => {
    const invalidDate = new Date('invalid');
    expect(() => createTimestamp(invalidDate)).toThrow('Invalid Date object');
  });

  it('accepts zero timestamp (epoch)', () => {
    const epochZero = createTimestamp(0);
    expect(epochZero).toBe(0);
  });

  it('returns branded Timestamp type', () => {
    const timestamp: Timestamp = createTimestamp();
    expect(typeof timestamp).toBe('number');
  });
});

// TODO(#1152): Missing test for string ID schemas with special characters and Unicode
describe('createSessionID', () => {
  it('creates valid session IDs', () => {
    expect(createSessionID('abc123')).toBe('abc123');
    expect(createSessionID('session-id-with-dashes')).toBe('session-id-with-dashes');
    expect(createSessionID('a')).toBe('a'); // Single char is valid
  });

  it('rejects empty session IDs', () => {
    expect(() => createSessionID('')).toThrow('SessionID cannot be empty');
  });

  it('rejects non-string session IDs', () => {
    expect(() => createSessionID(123 as any)).toThrow('SessionID must be a string, got number');
    expect(() => createSessionID(null as any)).toThrow('SessionID must be a string, got object');
  });

  it('rejects undefined session IDs with specific error message', () => {
    expect(() => createSessionID(undefined as any)).toThrow(
      'SessionID must be a string, got undefined'
    );
  });

  it('rejects boolean session IDs with specific error message', () => {
    expect(() => createSessionID(true as any)).toThrow('SessionID must be a string, got boolean');
  });

  it('rejects session IDs that are too long', () => {
    const tooLong = 'a'.repeat(257);
    expect(() => createSessionID(tooLong)).toThrow('SessionID too long');
  });

  it('accepts session IDs up to 256 characters', () => {
    const maxLength = 'a'.repeat(256);
    expect(createSessionID(maxLength)).toBe(maxLength);
  });

  it('returns branded SessionID type', () => {
    const sessionId: SessionID = createSessionID('session123');
    expect(sessionId).toBe('session123');
  });
});

describe('createUserID', () => {
  it('creates valid user IDs', () => {
    expect(createUserID('user123')).toBe('user123');
    expect(createUserID('user_abc')).toBe('user_abc');
  });

  it('rejects empty user IDs', () => {
    expect(() => createUserID('')).toThrow('UserID cannot be empty');
  });

  it('rejects non-string user IDs', () => {
    expect(() => createUserID(123 as any)).toThrow('UserID must be a string, got number');
    expect(() => createUserID(null as any)).toThrow('UserID must be a string, got object');
  });

  it('rejects undefined user IDs with specific error message', () => {
    expect(() => createUserID(undefined as any)).toThrow('UserID must be a string, got undefined');
  });

  it('rejects boolean user IDs with specific error message', () => {
    expect(() => createUserID(true as any)).toThrow('UserID must be a string, got boolean');
  });

  it('rejects user IDs that are too long', () => {
    const tooLong = 'a'.repeat(257);
    expect(() => createUserID(tooLong)).toThrow('UserID too long');
  });

  it('accepts user IDs up to 256 characters', () => {
    const maxLength = 'a'.repeat(256);
    expect(createUserID(maxLength)).toBe(maxLength);
  });

  it('returns branded UserID type', () => {
    const userId: UserID = createUserID('user123');
    expect(userId).toBe('user123');
  });
});

describe('createFileID', () => {
  it('creates valid file IDs', () => {
    expect(createFileID('abc123')).toBe('abc123');
    expect(createFileID('64-char-hash')).toBe('64-char-hash');
  });

  it('rejects empty file IDs', () => {
    expect(() => createFileID('')).toThrow('FileID cannot be empty');
  });

  it('rejects non-string file IDs', () => {
    expect(() => createFileID(123 as any)).toThrow('FileID must be a string, got number');
    expect(() => createFileID(null as any)).toThrow('FileID must be a string, got object');
  });

  it('rejects undefined file IDs with specific error message', () => {
    expect(() => createFileID(undefined as any)).toThrow('FileID must be a string, got undefined');
  });

  it('rejects boolean file IDs with specific error message', () => {
    expect(() => createFileID(true as any)).toThrow('FileID must be a string, got boolean');
  });

  it('rejects file IDs that are too long', () => {
    const tooLong = 'a'.repeat(257);
    expect(() => createFileID(tooLong)).toThrow('FileID too long');
  });

  it('accepts file IDs up to 256 characters', () => {
    const maxLength = 'a'.repeat(256);
    expect(createFileID(maxLength)).toBe(maxLength);
  });

  it('returns branded FileID type', () => {
    const fileId: FileID = createFileID('hash123');
    expect(fileId).toBe('hash123');
  });
});

describe('unwrap', () => {
  it('unwraps Port to number', () => {
    const port = createPort(3000);
    const num: number = unwrap(port);
    expect(num).toBe(3000);
  });

  it('unwraps URL to string', () => {
    const url = createURL('https://example.com');
    const str: string = unwrap(url);
    expect(str).toBe('https://example.com');
  });

  it('unwraps Timestamp to number', () => {
    const timestamp = createTimestamp(1704067200000);
    const num: number = unwrap(timestamp);
    expect(num).toBe(1704067200000);
  });

  it('unwraps SessionID to string', () => {
    const sessionId = createSessionID('session123');
    const str: string = unwrap(sessionId);
    expect(str).toBe('session123');
  });

  it('unwraps UserID to string', () => {
    const userId = createUserID('user123');
    const str: string = unwrap(userId);
    expect(str).toBe('user123');
  });

  it('unwraps FileID to string', () => {
    const fileId = createFileID('hash123');
    const str: string = unwrap(fileId);
    expect(str).toBe('hash123');
  });

  it('unwraps multiple different branded types correctly', () => {
    const port = createPort(3000);
    const url = createURL('https://example.com');
    const timestamp = createTimestamp(1704067200000);

    // Unwrap in same expression
    const combined = `${unwrap(url)}:${unwrap(port)} at ${unwrap(timestamp)}`;
    expect(combined).toBe('https://example.com:3000 at 1704067200000');

    // Unwrap in function call
    const values = [unwrap(port), unwrap(timestamp)];
    expect(values).toEqual([3000, 1704067200000]);
  });

  // TODO(#1155): Add negative tests for unwrap edge cases (type mismatches, null/undefined, performance)
});

describe('Type safety (compile-time checks)', () => {
  it('prevents mixing branded types', () => {
    const port = createPort(3000);
    const sessionId = createSessionID('session123');

    // These would be type errors at compile time:
    // const wrongPort: Port = sessionId; // Type error!
    // const wrongSession: SessionID = port; // Type error!

    // Runtime checks - these pass because types are erased
    expect(port).toBe(3000);
    expect(sessionId).toBe('session123');
  });

  it('prevents using plain values as branded types', () => {
    // This would be a type error at compile time:
    // const port: Port = 3000; // Type error!

    // Must use factory:
    const port: Port = createPort(3000);
    expect(port).toBe(3000);
  });

  it('branded types work with type narrowing', () => {
    const timestamp = createTimestamp();

    if (timestamp > 0) {
      // TypeScript knows timestamp is still Timestamp here
      const ts: Timestamp = timestamp;
      expect(typeof ts).toBe('number');
    }
  });
});

describe('Real-world usage patterns', () => {
  it('port numbers in server config', () => {
    interface ServerConfig {
      port: Port;
      host: string;
    }

    const config: ServerConfig = {
      port: createPort(3000),
      host: 'localhost',
    };

    expect(config.port).toBe(3000);
  });

  it('session tracking', () => {
    interface Session {
      id: SessionID;
      userId: UserID;
      createdAt: Timestamp;
    }

    const session: Session = {
      id: createSessionID('sess_abc123'),
      userId: createUserID('user_xyz789'),
      createdAt: createTimestamp(),
    };

    expect(session.id).toBe('sess_abc123');
    expect(session.userId).toBe('user_xyz789');
    expect(session.createdAt).toBeGreaterThan(0);
  });

  it('API endpoint URLs', () => {
    interface ApiEndpoint {
      name: string;
      url: URL;
    }

    const endpoint: ApiEndpoint = {
      name: 'users',
      url: createURL('https://api.example.com/users'),
    };

    expect(endpoint.url).toBe('https://api.example.com/users');
  });
});

describe('Zod Schema Validation', () => {
  describe('PortSchema', () => {
    it('parses valid port numbers', () => {
      expect(PortSchema.parse(0)).toBe(0);
      expect(PortSchema.parse(80)).toBe(80);
      expect(PortSchema.parse(443)).toBe(443);
      expect(PortSchema.parse(3000)).toBe(3000);
      expect(PortSchema.parse(65535)).toBe(65535);
    });

    it('rejects invalid ports with ZodError', () => {
      expect(() => PortSchema.parse(-1)).toThrow(ZodError);
      expect(() => PortSchema.parse(65536)).toThrow(ZodError);
      expect(() => PortSchema.parse(70000)).toThrow(ZodError);
      expect(() => PortSchema.parse(3000.5)).toThrow(ZodError);
      expect(() => PortSchema.parse('3000')).toThrow(ZodError);
      expect(() => PortSchema.parse(NaN)).toThrow(ZodError);
      expect(() => PortSchema.parse(Infinity)).toThrow(ZodError);
    });

    it('rejects null, undefined, arrays, and objects', () => {
      expect(() => PortSchema.parse(null)).toThrow(ZodError);
      expect(() => PortSchema.parse(undefined)).toThrow(ZodError);
      expect(() => PortSchema.parse([3000])).toThrow(ZodError);
      expect(() => PortSchema.parse({ port: 3000 })).toThrow(ZodError);
    });

    it('safeParse returns correct success/error objects', () => {
      const validResult = PortSchema.safeParse(3000);
      expect(validResult.success).toBe(true);
      if (validResult.success) {
        expect(validResult.data).toBe(3000);
      }

      const invalidResult = PortSchema.safeParse(-1);
      expect(invalidResult.success).toBe(false);
      if (!invalidResult.success) {
        expect(invalidResult.error).toBeInstanceOf(ZodError);
      }
    });

    it('safeParse provides detailed error for type mismatch', () => {
      const result = PortSchema.safeParse('not a number');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].code).toBe('invalid_type');
        expect(result.error.issues[0].expected).toBe('number');
        expect(result.error.issues[0].received).toBe('string');
      }
    });

    it('parsePort helper works correctly', () => {
      expect(parsePort(3000)).toBe(3000);
      expect(() => parsePort(-1)).toThrow(ZodError);
      expect(() => parsePort('invalid')).toThrow(ZodError);
    });

    it('branded type is compatible with factory function', () => {
      const schemaPort: Port = PortSchema.parse(3000);
      const factoryPort: Port = createPort(3000);

      // Both should work in contexts expecting Port
      const ports: Port[] = [schemaPort, factoryPort];
      expect(ports).toHaveLength(2);
    });
  });

  describe('URLSchema', () => {
    it('parses valid URLs', () => {
      expect(URLSchema.parse('https://example.com')).toBe('https://example.com');
      expect(URLSchema.parse('http://localhost:3000')).toBe('http://localhost:3000');
      expect(URLSchema.parse('https://example.com/path?query=1')).toBe(
        'https://example.com/path?query=1'
      );
    });

    it('rejects invalid URLs with ZodError', () => {
      expect(() => URLSchema.parse('not a url')).toThrow(ZodError);
      expect(() => URLSchema.parse('')).toThrow(ZodError);
      expect(() => URLSchema.parse('//example.com')).toThrow(ZodError);
      expect(() => URLSchema.parse(123)).toThrow(ZodError);
    });

    it('rejects null, undefined, arrays, and objects', () => {
      expect(() => URLSchema.parse(null)).toThrow(ZodError);
      expect(() => URLSchema.parse(undefined)).toThrow(ZodError);
      expect(() => URLSchema.parse(['https://example.com'])).toThrow(ZodError);
      expect(() => URLSchema.parse({ url: 'https://example.com' })).toThrow(ZodError);
    });

    it('safeParse returns correct success/error objects', () => {
      const validResult = URLSchema.safeParse('https://example.com');
      expect(validResult.success).toBe(true);

      const invalidResult = URLSchema.safeParse('not a url');
      expect(invalidResult.success).toBe(false);
    });

    it('safeParse provides detailed error for type mismatch', () => {
      const result = URLSchema.safeParse(123);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].code).toBe('invalid_type');
        expect(result.error.issues[0].expected).toBe('string');
        expect(result.error.issues[0].received).toBe('number');
      }
    });

    it('parseURL helper works correctly', () => {
      expect(parseURL('https://example.com')).toBe('https://example.com');
      expect(() => parseURL('invalid')).toThrow(ZodError);
    });

    it('branded type is compatible with factory function', () => {
      const schemaURL: URL = URLSchema.parse('https://example.com');
      const factoryURL: URL = createURL('https://example.com');

      const urls: URL[] = [schemaURL, factoryURL];
      expect(urls).toHaveLength(2);
    });
  });

  describe('TimestampSchema', () => {
    it('parses valid timestamps', () => {
      expect(TimestampSchema.parse(0)).toBe(0);
      expect(TimestampSchema.parse(Date.now())).toBeGreaterThan(0);
      expect(TimestampSchema.parse(1704067200000)).toBe(1704067200000);
    });

    it('rejects invalid timestamps with ZodError', () => {
      expect(() => TimestampSchema.parse(-1)).toThrow(ZodError);
      expect(() => TimestampSchema.parse(Infinity)).toThrow(ZodError);
      expect(() => TimestampSchema.parse(-Infinity)).toThrow(ZodError);
      expect(() => TimestampSchema.parse(NaN)).toThrow(ZodError);
      expect(() => TimestampSchema.parse('1704067200000')).toThrow(ZodError);
    });

    it('rejects null, undefined, arrays, and objects', () => {
      expect(() => TimestampSchema.parse(null)).toThrow(ZodError);
      expect(() => TimestampSchema.parse(undefined)).toThrow(ZodError);
      expect(() => TimestampSchema.parse([1704067200000])).toThrow(ZodError);
      expect(() => TimestampSchema.parse({ timestamp: 1704067200000 })).toThrow(ZodError);
    });

    it('safeParse returns correct success/error objects', () => {
      const validResult = TimestampSchema.safeParse(Date.now());
      expect(validResult.success).toBe(true);

      const invalidResult = TimestampSchema.safeParse(-1);
      expect(invalidResult.success).toBe(false);
    });

    it('safeParse provides detailed error for type mismatch', () => {
      const result = TimestampSchema.safeParse('not a number');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].code).toBe('invalid_type');
        expect(result.error.issues[0].expected).toBe('number');
        expect(result.error.issues[0].received).toBe('string');
      }
    });

    it('parseTimestamp helper works correctly', () => {
      const now = Date.now();
      expect(parseTimestamp(now)).toBe(now);
      expect(() => parseTimestamp(-1)).toThrow(ZodError);
    });

    it('branded type is compatible with factory function', () => {
      const now = Date.now();
      const schemaTimestamp: Timestamp = TimestampSchema.parse(now);
      const factoryTimestamp: Timestamp = createTimestamp(now);

      const timestamps: Timestamp[] = [schemaTimestamp, factoryTimestamp];
      expect(timestamps).toHaveLength(2);
    });
  });

  describe('SessionIDSchema', () => {
    it('parses valid session IDs', () => {
      expect(SessionIDSchema.parse('abc123')).toBe('abc123');
      expect(SessionIDSchema.parse('session-id-with-dashes')).toBe('session-id-with-dashes');
      expect(SessionIDSchema.parse('a')).toBe('a');
    });

    it('rejects invalid session IDs with ZodError', () => {
      expect(() => SessionIDSchema.parse('')).toThrow(ZodError);
      expect(() => SessionIDSchema.parse('a'.repeat(257))).toThrow(ZodError);
      expect(() => SessionIDSchema.parse(123)).toThrow(ZodError);
    });

    it('rejects null, undefined, arrays, and objects', () => {
      expect(() => SessionIDSchema.parse(null)).toThrow(ZodError);
      expect(() => SessionIDSchema.parse(undefined)).toThrow(ZodError);
      expect(() => SessionIDSchema.parse(['session123'])).toThrow(ZodError);
      expect(() => SessionIDSchema.parse({ id: 'session123' })).toThrow(ZodError);
    });

    it('safeParse returns correct success/error objects', () => {
      const validResult = SessionIDSchema.safeParse('session123');
      expect(validResult.success).toBe(true);

      const invalidResult = SessionIDSchema.safeParse('');
      expect(invalidResult.success).toBe(false);
    });

    it('safeParse provides detailed error for type mismatch', () => {
      const result = SessionIDSchema.safeParse(123);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].code).toBe('invalid_type');
        expect(result.error.issues[0].expected).toBe('string');
        expect(result.error.issues[0].received).toBe('number');
      }
    });

    it('parseSessionID helper works correctly', () => {
      expect(parseSessionID('session123')).toBe('session123');
      expect(() => parseSessionID('')).toThrow(ZodError);
    });

    it('branded type is compatible with factory function', () => {
      const schemaSessionID: SessionID = SessionIDSchema.parse('session123');
      const factorySessionID: SessionID = createSessionID('session123');

      const sessionIds: SessionID[] = [schemaSessionID, factorySessionID];
      expect(sessionIds).toHaveLength(2);
    });
  });

  describe('UserIDSchema', () => {
    it('parses valid user IDs', () => {
      expect(UserIDSchema.parse('user123')).toBe('user123');
      expect(UserIDSchema.parse('user_abc')).toBe('user_abc');
    });

    it('rejects invalid user IDs with ZodError', () => {
      expect(() => UserIDSchema.parse('')).toThrow(ZodError);
      expect(() => UserIDSchema.parse('a'.repeat(257))).toThrow(ZodError);
      expect(() => UserIDSchema.parse(123)).toThrow(ZodError);
    });

    it('rejects null, undefined, arrays, and objects', () => {
      expect(() => UserIDSchema.parse(null)).toThrow(ZodError);
      expect(() => UserIDSchema.parse(undefined)).toThrow(ZodError);
      expect(() => UserIDSchema.parse(['user123'])).toThrow(ZodError);
      expect(() => UserIDSchema.parse({ id: 'user123' })).toThrow(ZodError);
    });

    it('safeParse returns correct success/error objects', () => {
      const validResult = UserIDSchema.safeParse('user123');
      expect(validResult.success).toBe(true);

      const invalidResult = UserIDSchema.safeParse('');
      expect(invalidResult.success).toBe(false);
    });

    it('safeParse provides detailed error for type mismatch', () => {
      const result = UserIDSchema.safeParse(123);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].code).toBe('invalid_type');
        expect(result.error.issues[0].expected).toBe('string');
        expect(result.error.issues[0].received).toBe('number');
      }
    });

    it('parseUserID helper works correctly', () => {
      expect(parseUserID('user123')).toBe('user123');
      expect(() => parseUserID('')).toThrow(ZodError);
    });

    it('branded type is compatible with factory function', () => {
      const schemaUserID: UserID = UserIDSchema.parse('user123');
      const factoryUserID: UserID = createUserID('user123');

      const userIds: UserID[] = [schemaUserID, factoryUserID];
      expect(userIds).toHaveLength(2);
    });
  });

  describe('FileIDSchema', () => {
    it('parses valid file IDs', () => {
      expect(FileIDSchema.parse('abc123')).toBe('abc123');
      expect(FileIDSchema.parse('64-char-hash')).toBe('64-char-hash');
    });

    it('rejects invalid file IDs with ZodError', () => {
      expect(() => FileIDSchema.parse('')).toThrow(ZodError);
      expect(() => FileIDSchema.parse('a'.repeat(257))).toThrow(ZodError);
      expect(() => FileIDSchema.parse(123)).toThrow(ZodError);
    });

    it('rejects null, undefined, arrays, and objects', () => {
      expect(() => FileIDSchema.parse(null)).toThrow(ZodError);
      expect(() => FileIDSchema.parse(undefined)).toThrow(ZodError);
      expect(() => FileIDSchema.parse(['hash123'])).toThrow(ZodError);
      expect(() => FileIDSchema.parse({ id: 'hash123' })).toThrow(ZodError);
    });

    it('safeParse returns correct success/error objects', () => {
      const validResult = FileIDSchema.safeParse('hash123');
      expect(validResult.success).toBe(true);

      const invalidResult = FileIDSchema.safeParse('');
      expect(invalidResult.success).toBe(false);
    });

    it('safeParse provides detailed error for type mismatch', () => {
      const result = FileIDSchema.safeParse(123);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].code).toBe('invalid_type');
        expect(result.error.issues[0].expected).toBe('string');
        expect(result.error.issues[0].received).toBe('number');
      }
    });

    it('parseFileID helper works correctly', () => {
      expect(parseFileID('hash123')).toBe('hash123');
      expect(() => parseFileID('')).toThrow(ZodError);
    });

    it('branded type is compatible with factory function', () => {
      const schemaFileID: FileID = FileIDSchema.parse('hash123');
      const factoryFileID: FileID = createFileID('hash123');

      const fileIds: FileID[] = [schemaFileID, factoryFileID];
      expect(fileIds).toHaveLength(2);
    });
  });

  describe('Schema Composition', () => {
    it('can compose branded type schemas into larger schemas', async () => {
      const { z } = await import('zod');

      const ServerConfigSchema = z.object({
        port: PortSchema,
        url: URLSchema,
      });

      const validConfig = {
        port: 3000,
        url: 'https://example.com',
      };

      const parsed = ServerConfigSchema.parse(validConfig);
      expect(parsed.port).toBe(3000);
      expect(parsed.url).toBe('https://example.com');

      // Type-level check: parsed values should be branded
      const port: Port = parsed.port;
      const url: URL = parsed.url;
      expect(port).toBe(3000);
      expect(url).toBe('https://example.com');
    });

    it('validates nested schemas correctly', async () => {
      const { z } = await import('zod');

      const SessionSchema = z.object({
        id: SessionIDSchema,
        userId: UserIDSchema,
        createdAt: TimestampSchema,
      });

      const validSession = {
        id: 'sess_abc123',
        userId: 'user_xyz789',
        createdAt: Date.now(),
      };

      const parsed = SessionSchema.parse(validSession);
      expect(parsed.id).toBe('sess_abc123');
      expect(parsed.userId).toBe('user_xyz789');
      expect(parsed.createdAt).toBeGreaterThan(0);
    });

    it('rejects invalid nested data', async () => {
      const { z } = await import('zod');

      const ServerConfigSchema = z.object({
        port: PortSchema,
        url: URLSchema,
      });

      const invalidConfig = {
        port: -1, // Invalid port
        url: 'https://example.com',
      };

      expect(() => ServerConfigSchema.parse(invalidConfig)).toThrow(ZodError);
    });
  });

  describe('Error Messages', () => {
    it('provides detailed error messages for invalid data', () => {
      try {
        PortSchema.parse(-1);
        expect.fail('Should have thrown ZodError');
      } catch (error) {
        expect(error).toBeInstanceOf(ZodError);
        const zodError = error as ZodError;
        expect(zodError.issues).toHaveLength(1);
        expect(zodError.issues[0].message).toContain('greater than or equal to 0');
      }
    });

    it('provides error messages for type mismatches', () => {
      try {
        PortSchema.parse('not a number');
        expect.fail('Should have thrown ZodError');
      } catch (error) {
        expect(error).toBeInstanceOf(ZodError);
        const zodError = error as ZodError;
        expect(zodError.issues[0].code).toBe('invalid_type');
      }
    });
  });
});
