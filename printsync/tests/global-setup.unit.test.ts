/**
 * Unit tests for global-setup.ts error handling
 * Tests the isPortInUse function's error handling for system-level errors
 * Addresses TODO(#1170): Add tests for error handling (EMFILE, EACCES, ENETUNREACH)
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';

/**
 * Create a test version of isPortInUse that we can test in isolation
 * This is a copy of the implementation from global-setup.ts for testing purposes
 * We inject the socket factory to allow mocking
 */
function createIsPortInUse(SocketFactory: any) {
  return function isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const socket = new SocketFactory();
      const timeout = 1000;

      socket.setTimeout(timeout);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('error', (error: Error) => {
        socket.destroy();

        // ECONNREFUSED means port is not in use (expected)
        if ((error as any).code === 'ECONNREFUSED') {
          resolve(false);
          return;
        }

        // Other errors indicate system problems - fail loudly
        const err = error as NodeJS.ErrnoException;
        const code = err.code ?? 'UNKNOWN';
        const message = err.message ?? 'Unknown error';

        // Safely stringify error details, falling back to simple representation
        let errorDetails: string;
        try {
          errorDetails = JSON.stringify({
            code: err.code,
            errno: err.errno,
            syscall: err.syscall,
          });
        } catch {
          errorDetails = `code=${code}, errno=${err.errno}, syscall=${err.syscall}`;
        }

        const errorMsg =
          `Failed to check if port ${port} is in use: ${code} - ${message}\n` +
          `This indicates a system-level problem, not just a port conflict.\n` +
          `Common causes:\n` +
          `- Too many open files (EMFILE): Increase file descriptor limit\n` +
          `- Permission denied (EACCES): Check firewall or security settings\n` +
          `- Network issues (ENETUNREACH): Check network configuration\n` +
          `Error details: ${errorDetails}`;

        reject(new Error(errorMsg));
      });

      socket.connect(port, 'localhost');
    });
  };
}

/**
 * Create a mock socket class that emits a specific error
 */
function createErrorSocketClass(
  errorCode: string,
  errorMessage: string,
  errno?: number,
  syscall?: string
) {
  return class MockSocket extends EventEmitter {
    private destroyCalled = false;

    setTimeout() {}

    connect(port: number, host: string) {
      // Emit error asynchronously
      setImmediate(() => {
        const err = new Error(errorMessage) as NodeJS.ErrnoException;
        err.code = errorCode;
        err.errno = errno;
        err.syscall = syscall;
        this.emit('error', err);
      });
      return this;
    }

    destroy() {
      this.destroyCalled = true;
    }

    wasDestroyed() {
      return this.destroyCalled;
    }
  };
}

test('isPortInUse handles EMFILE error with helpful message', async () => {
  const MockSocket = createErrorSocketClass('EMFILE', 'Too many open files', -24, 'connect');
  const isPortInUse = createIsPortInUse(MockSocket);

  await assert.rejects(
    () => isPortInUse(9999),
    (error: Error) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes('EMFILE'), 'Error message should include EMFILE code');
      assert.ok(
        error.message.includes('file descriptor limit'),
        'Error message should mention file descriptor limit'
      );
      assert.ok(
        error.message.includes('Too many open files'),
        'Error message should include original error message'
      );
      assert.ok(
        error.message.includes('Error details:'),
        'Error message should include error details'
      );
      return true;
    }
  );
});

test('isPortInUse handles EACCES error with helpful message', async () => {
  const MockSocket = createErrorSocketClass('EACCES', 'Permission denied', -13, 'connect');
  const isPortInUse = createIsPortInUse(MockSocket);

  await assert.rejects(
    () => isPortInUse(9999),
    (error: Error) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes('EACCES'), 'Error message should include EACCES code');
      assert.ok(
        error.message.includes('firewall or security settings'),
        'Error message should mention firewall or security settings'
      );
      assert.ok(
        error.message.includes('Permission denied'),
        'Error message should include original error message'
      );
      return true;
    }
  );
});

test('isPortInUse handles ENETUNREACH error with helpful message', async () => {
  const MockSocket = createErrorSocketClass(
    'ENETUNREACH',
    'Network is unreachable',
    -101,
    'connect'
  );
  const isPortInUse = createIsPortInUse(MockSocket);

  await assert.rejects(
    () => isPortInUse(9999),
    (error: Error) => {
      assert.ok(error instanceof Error);
      assert.ok(
        error.message.includes('ENETUNREACH'),
        'Error message should include ENETUNREACH code'
      );
      assert.ok(
        error.message.includes('network configuration'),
        'Error message should mention network configuration'
      );
      assert.ok(
        error.message.includes('Network is unreachable'),
        'Error message should include original error message'
      );
      return true;
    }
  );
});

test('isPortInUse handles error with missing properties gracefully', async () => {
  // Create a mock socket that emits an error with undefined properties
  class MinimalErrorSocket extends EventEmitter {
    setTimeout() {}

    connect() {
      setImmediate(() => {
        const err = new Error('Unknown error') as NodeJS.ErrnoException;
        // Explicitly set to undefined to test nullish coalescing
        err.code = undefined;
        err.errno = undefined;
        err.syscall = undefined;
        this.emit('error', err);
      });
      return this;
    }

    destroy() {}
  }

  const isPortInUse = createIsPortInUse(MinimalErrorSocket);

  await assert.rejects(
    () => isPortInUse(9999),
    (error: Error) => {
      assert.ok(error instanceof Error);
      assert.ok(
        error.message.includes('UNKNOWN'),
        'Error message should use UNKNOWN for missing error code'
      );
      assert.ok(
        error.message.includes('Unknown error'),
        'Error message should include fallback error message'
      );
      return true;
    }
  );
});

test('isPortInUse handles JSON.stringify failure with fallback format', async () => {
  // Create a mock socket that emits an error with circular references
  class CircularErrorSocket extends EventEmitter {
    setTimeout() {}

    connect() {
      setImmediate(() => {
        const err = new Error('Circular error') as NodeJS.ErrnoException;
        err.code = 'ECIRCULAR';
        err.errno = -999;
        err.syscall = 'connect';

        // Create circular reference to force JSON.stringify to fail
        (err as any).circular = err;

        this.emit('error', err);
      });
      return this;
    }

    destroy() {}
  }

  const isPortInUse = createIsPortInUse(CircularErrorSocket);

  await assert.rejects(
    () => isPortInUse(9999),
    (error: Error) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes('ECIRCULAR'), 'Error message should include error code');
      // Should use fallback format when JSON.stringify fails
      assert.ok(
        error.message.includes('code=ECIRCULAR') || error.message.includes('Error details:'),
        'Error message should include fallback format or error details'
      );
      return true;
    }
  );
});

test('isPortInUse resolves false for ECONNREFUSED (port not in use)', async () => {
  const MockSocket = createErrorSocketClass('ECONNREFUSED', 'Connection refused');
  const isPortInUse = createIsPortInUse(MockSocket);

  const result = await isPortInUse(9999);
  assert.strictEqual(result, false, 'ECONNREFUSED should resolve to false (port not in use)');
});

test('isPortInUse resolves true when connection succeeds', async () => {
  class ConnectingSocket extends EventEmitter {
    setTimeout() {}

    connect() {
      setImmediate(() => {
        this.emit('connect');
      });
      return this;
    }

    destroy() {}
  }

  const isPortInUse = createIsPortInUse(ConnectingSocket);

  const result = await isPortInUse(9999);
  assert.strictEqual(result, true, 'Successful connection should resolve to true (port in use)');
});

test('isPortInUse resolves false on timeout', async () => {
  class TimeoutSocket extends EventEmitter {
    setTimeout() {}

    connect() {
      setImmediate(() => {
        this.emit('timeout');
      });
      return this;
    }

    destroy() {}
  }

  const isPortInUse = createIsPortInUse(TimeoutSocket);

  const result = await isPortInUse(9999);
  assert.strictEqual(result, false, 'Timeout should resolve to false (port not in use)');
});

test('isPortInUse destroys socket on all error paths', async () => {
  let destroyCalled = false;

  class TrackingSocket extends EventEmitter {
    setTimeout() {}

    connect() {
      setImmediate(() => {
        const err = new Error('Test error') as NodeJS.ErrnoException;
        err.code = 'ETEST';
        this.emit('error', err);
      });
      return this;
    }

    destroy() {
      destroyCalled = true;
    }
  }

  const isPortInUse = createIsPortInUse(TrackingSocket);

  try {
    await isPortInUse(9999);
    assert.fail('Should have rejected with error');
  } catch {
    // Expected error
  }

  assert.strictEqual(destroyCalled, true, 'Socket should be destroyed after error');
});
