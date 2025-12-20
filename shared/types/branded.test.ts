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
  createPortZod,
  createURLZod,
  createTimestampZod,
  createSessionIDZod,
  createUserIDZod,
  createFileIDZod,
  PortSchema,
  URLSchema,
  TimestampSchema,
  SessionIDSchema,
  UserIDSchema,
  FileIDSchema,
  unwrap,
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
    expect(() => createPort(-1)).toThrow('Port must be between 0 and 65535');
  });

  it('rejects ports above 65535', () => {
    expect(() => createPort(65536)).toThrow('Port must be between 0 and 65535');
    expect(() => createPort(70000)).toThrow('Port must be between 0 and 65535');
  });

  it('rejects non-integer ports', () => {
    expect(() => createPort(3000.5)).toThrow('Port must be an integer');
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

  it('returns branded Timestamp type', () => {
    const timestamp: Timestamp = createTimestamp();
    expect(typeof timestamp).toBe('number');
  });
});

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
    expect(() => createSessionID(123 as any)).toThrow('SessionID must be a string');
    expect(() => createSessionID(null as any)).toThrow('SessionID must be a string');
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
    expect(() => createUserID(123 as any)).toThrow('UserID must be a string');
  });

  it('rejects user IDs that are too long', () => {
    const tooLong = 'a'.repeat(257);
    expect(() => createUserID(tooLong)).toThrow('UserID too long');
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
    expect(() => createFileID(123 as any)).toThrow('FileID must be a string');
  });

  it('rejects file IDs that are too long', () => {
    const tooLong = 'a'.repeat(257);
    expect(() => createFileID(tooLong)).toThrow('FileID too long');
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

// ============================================================================
// Zod Validation Tests
// ============================================================================

describe('PortSchema', () => {
  it('validates valid port numbers', () => {
    expect(PortSchema.parse(0)).toBe(0);
    expect(PortSchema.parse(80)).toBe(80);
    expect(PortSchema.parse(443)).toBe(443);
    expect(PortSchema.parse(3000)).toBe(3000);
    expect(PortSchema.parse(65535)).toBe(65535);
  });

  it('rejects invalid port numbers', () => {
    expect(() => PortSchema.parse(-1)).toThrow(ZodError);
    expect(() => PortSchema.parse(65536)).toThrow(ZodError);
    expect(() => PortSchema.parse(3000.5)).toThrow(ZodError);
  });
});

describe('createPortZod', () => {
  it('creates valid port numbers', () => {
    expect(createPortZod(0)).toBe(0);
    expect(createPortZod(3000)).toBe(3000);
    expect(createPortZod(65535)).toBe(65535);
  });

  it('rejects invalid port numbers', () => {
    expect(() => createPortZod(-1)).toThrow(ZodError);
    expect(() => createPortZod(65536)).toThrow(ZodError);
    expect(() => createPortZod(3000.5)).toThrow(ZodError);
  });

  it('returns branded Port type compatible with TypeScript validator', () => {
    const portZod: Port = createPortZod(3000);
    const portTs: Port = createPort(3000);
    expect(portZod).toBe(portTs);
  });
});

describe('URLSchema', () => {
  it('validates valid URLs', () => {
    expect(URLSchema.parse('https://example.com')).toBe('https://example.com');
    expect(URLSchema.parse('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('rejects invalid URLs', () => {
    expect(() => URLSchema.parse('not a url')).toThrow(ZodError);
    expect(() => URLSchema.parse('')).toThrow(ZodError);
  });
});

describe('createURLZod', () => {
  it('creates valid URLs', () => {
    expect(createURLZod('https://example.com')).toBe('https://example.com');
    expect(createURLZod('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('rejects malformed URLs', () => {
    expect(() => createURLZod('not a url')).toThrow(ZodError);
    expect(() => createURLZod('')).toThrow(ZodError);
  });

  it('returns branded URL type', () => {
    const url: URL = createURLZod('https://example.com');
    expect(url).toBe('https://example.com');
  });
});

describe('TimestampSchema', () => {
  it('validates valid timestamps', () => {
    expect(TimestampSchema.parse(0)).toBe(0);
    expect(TimestampSchema.parse(Date.now())).toBeGreaterThan(0);
  });

  it('rejects invalid timestamps', () => {
    expect(() => TimestampSchema.parse(-1)).toThrow(ZodError);
    expect(() => TimestampSchema.parse(Infinity)).toThrow(ZodError);
    expect(() => TimestampSchema.parse(NaN)).toThrow(ZodError);
  });
});

describe('createTimestampZod', () => {
  it('creates valid timestamps', () => {
    const ts = Date.now();
    expect(createTimestampZod(ts)).toBe(ts);
    expect(createTimestampZod(0)).toBe(0);
  });

  it('rejects invalid timestamps', () => {
    expect(() => createTimestampZod(-1)).toThrow(ZodError);
    expect(() => createTimestampZod(Infinity)).toThrow(ZodError);
    expect(() => createTimestampZod(NaN)).toThrow(ZodError);
  });

  it('returns branded Timestamp type', () => {
    const timestamp: Timestamp = createTimestampZod(Date.now());
    expect(typeof timestamp).toBe('number');
  });
});

describe('SessionIDSchema', () => {
  it('validates valid session IDs', () => {
    expect(SessionIDSchema.parse('abc123')).toBe('abc123');
    expect(SessionIDSchema.parse('a')).toBe('a');
  });

  it('rejects invalid session IDs', () => {
    expect(() => SessionIDSchema.parse('')).toThrow(ZodError);
    expect(() => SessionIDSchema.parse('a'.repeat(257))).toThrow(ZodError);
  });
});

describe('createSessionIDZod', () => {
  it('creates valid session IDs', () => {
    expect(createSessionIDZod('abc123')).toBe('abc123');
    expect(createSessionIDZod('session-id-with-dashes')).toBe('session-id-with-dashes');
  });

  it('rejects invalid session IDs', () => {
    expect(() => createSessionIDZod('')).toThrow(ZodError);
    expect(() => createSessionIDZod('a'.repeat(257))).toThrow(ZodError);
  });

  it('returns branded SessionID type', () => {
    const sessionId: SessionID = createSessionIDZod('session123');
    expect(sessionId).toBe('session123');
  });
});

describe('UserIDSchema', () => {
  it('validates valid user IDs', () => {
    expect(UserIDSchema.parse('user123')).toBe('user123');
    expect(UserIDSchema.parse('user_abc')).toBe('user_abc');
  });

  it('rejects invalid user IDs', () => {
    expect(() => UserIDSchema.parse('')).toThrow(ZodError);
    expect(() => UserIDSchema.parse('a'.repeat(257))).toThrow(ZodError);
  });
});

describe('createUserIDZod', () => {
  it('creates valid user IDs', () => {
    expect(createUserIDZod('user123')).toBe('user123');
    expect(createUserIDZod('user_abc')).toBe('user_abc');
  });

  it('rejects invalid user IDs', () => {
    expect(() => createUserIDZod('')).toThrow(ZodError);
    expect(() => createUserIDZod('a'.repeat(257))).toThrow(ZodError);
  });

  it('returns branded UserID type', () => {
    const userId: UserID = createUserIDZod('user123');
    expect(userId).toBe('user123');
  });
});

describe('FileIDSchema', () => {
  it('validates valid file IDs', () => {
    expect(FileIDSchema.parse('abc123')).toBe('abc123');
    expect(FileIDSchema.parse('64-char-hash')).toBe('64-char-hash');
  });

  it('rejects invalid file IDs', () => {
    expect(() => FileIDSchema.parse('')).toThrow(ZodError);
    expect(() => FileIDSchema.parse('a'.repeat(257))).toThrow(ZodError);
  });
});

describe('createFileIDZod', () => {
  it('creates valid file IDs', () => {
    expect(createFileIDZod('abc123')).toBe('abc123');
    expect(createFileIDZod('64-char-hash')).toBe('64-char-hash');
  });

  it('rejects invalid file IDs', () => {
    expect(() => createFileIDZod('')).toThrow(ZodError);
    expect(() => createFileIDZod('a'.repeat(257))).toThrow(ZodError);
  });

  it('returns branded FileID type', () => {
    const fileId: FileID = createFileIDZod('hash123');
    expect(fileId).toBe('hash123');
  });
});

describe('Zod and TypeScript validation compatibility', () => {
  it('both validators produce compatible Port types', () => {
    const portZod = createPortZod(3000);
    const portTs = createPort(3000);

    // Both should be assignable to Port type
    const ports: Port[] = [portZod, portTs];
    expect(ports).toHaveLength(2);
  });

  it('both validators produce compatible URL types', () => {
    const urlZod = createURLZod('https://example.com');
    const urlTs = createURL('https://example.com');

    const urls: URL[] = [urlZod, urlTs];
    expect(urls).toHaveLength(2);
  });

  it('both validators produce compatible Timestamp types', () => {
    const ts = Date.now();
    const timestampZod = createTimestampZod(ts);
    const timestampTs = createTimestamp(ts);

    const timestamps: Timestamp[] = [timestampZod, timestampTs];
    expect(timestamps).toHaveLength(2);
  });
});
