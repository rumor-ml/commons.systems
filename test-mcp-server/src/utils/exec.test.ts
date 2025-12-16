/**
 * Tests for shell script execution utilities
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execScript, captureOutput, execScriptBackground } from './exec.js';
import { ScriptExecutionError } from './errors.js';
import path from 'path';
import fs from 'fs/promises';

describe('execScript', () => {
  it('should execute successful command and return output', async () => {
    const result = await execScript('/bin/echo', ['hello world']);
    assert.strictEqual(result.stdout.trim(), 'hello world');
    assert.strictEqual(result.exitCode, 0);
  });

  it('should handle commands with no output', async () => {
    const result = await execScript('/usr/bin/true', []);
    assert.strictEqual(result.stdout, '');
    assert.strictEqual(result.exitCode, 0);
  });

  it('should throw ScriptExecutionError on non-zero exit code', async () => {
    await assert.rejects(
      async () => execScript('/bin/false', []),
      (err: Error) => {
        assert.ok(err instanceof ScriptExecutionError);
        assert.ok(err.message.includes('exit code 1'));
        return true;
      }
    );
  });

  it('should handle command with arguments containing spaces', async () => {
    const result = await execScript('/bin/echo', ['hello world', 'with spaces']);
    assert.ok(result.stdout.includes('hello world'));
    assert.ok(result.stdout.includes('with spaces'));
  });

  it('should respect timeout option', async () => {
    await assert.rejects(
      async () => execScript('/bin/sh', ['-c', 'sleep 10'], { timeout: 100 }),
      (err: Error) => {
        // May be TimeoutError or ScriptExecutionError depending on timing
        assert.ok(err instanceof Error);
        return true;
      }
    );
  });

  it('should pass environment variables', async () => {
    const result = await execScript('/bin/sh', ['-c', 'echo $TEST_VAR'], {
      env: { TEST_VAR: 'test_value' },
    });
    assert.strictEqual(result.stdout.trim(), 'test_value');
  });

  it('should respect cwd option', async () => {
    const tmpDir = '/tmp';
    const result = await execScript('/bin/sh', ['-c', 'pwd'], { cwd: tmpDir });
    // On macOS, /tmp is symlinked to /private/tmp
    const output = result.stdout.trim();
    assert.ok(output === tmpDir || output === '/private/tmp');
  });

  it('should handle stderr output in error', async () => {
    // Use ls with invalid path to generate stderr output
    await assert.rejects(
      async () => execScript('/bin/ls', ['/nonexistent/path/that/does/not/exist']),
      (err: Error) => {
        assert.ok(err instanceof ScriptExecutionError);
        if (err instanceof ScriptExecutionError) {
          // Stderr should contain error message about path not existing
          assert.ok(
            err.stderr?.includes('No such file') ||
              err.message.includes('No such file') ||
              err.stderr?.includes('cannot access') ||
              err.message.includes('cannot access')
          );
        }
        return true;
      }
    );
  });
});

describe('captureOutput', () => {
  it('should return trimmed stdout only', async () => {
    const output = await captureOutput('/bin/echo', ['  hello  ']);
    assert.strictEqual(output, 'hello');
  });

  it('should handle empty output', async () => {
    const output = await captureOutput('/usr/bin/true', []);
    assert.strictEqual(output, '');
  });

  it('should throw on non-zero exit code', async () => {
    await assert.rejects(async () => captureOutput('/bin/false', []), ScriptExecutionError);
  });

  it('should return multi-line output trimmed', async () => {
    // Create a temporary file with multi-line content
    const testFile = path.join('/tmp', `test-multiline-${Date.now()}.txt`);
    await fs.writeFile(testFile, 'line1\nline2\n');

    try {
      // Use cat to read the file (multi-line output)
      const output = await captureOutput('/bin/cat', [testFile]);
      assert.ok(output.includes('line1'));
      assert.ok(output.includes('line2'));
      // Should be trimmed (no leading/trailing whitespace)
      assert.strictEqual(output, output.trim());
    } finally {
      // Cleanup
      await fs.unlink(testFile);
    }
  });
});

describe('execScriptBackground', () => {
  it('should return immediately without waiting for completion', async () => {
    const startTime = Date.now();
    await execScriptBackground('/bin/sh', ['-c', 'sleep 2']);
    const duration = Date.now() - startTime;
    // Should return in ~500ms (startup delay), not 2 seconds
    assert.ok(duration < 1500, `Background execution took ${duration}ms, should be < 1500ms`);
  });

  it('should handle command with arguments', async () => {
    // Create a temporary file to verify command ran
    const testFile = path.join('/tmp', `test-bg-${Date.now()}.txt`);

    // Use touch instead of shell redirect (avoids shell metacharacter validation issues)
    await execScriptBackground('/usr/bin/touch', [testFile]);

    // Wait a bit for command to complete
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify file was created
    await fs.access(testFile);

    // Cleanup
    await fs.unlink(testFile);
  });

  it('should not throw on command failure', async () => {
    // Background processes swallow errors - use ls with non-existent path
    await assert.doesNotReject(async () => {
      await execScriptBackground('/bin/ls', ['/nonexistent/path/12345']);
    });
  });
});

describe('Error Handling', () => {
  it('should wrap unknown errors in ScriptExecutionError', async () => {
    await assert.rejects(
      async () => execScript('/nonexistent/command', []),
      (err: Error) => {
        assert.ok(err instanceof ScriptExecutionError);
        // Error message might vary, just check it's a ScriptExecutionError
        return true;
      }
    );
  });

  it('should preserve ScriptExecutionError when re-thrown', async () => {
    await assert.rejects(
      async () => execScript('/bin/sh', ['-c', 'exit 42']),
      (err: Error) => {
        assert.ok(err instanceof ScriptExecutionError);
        if (err instanceof ScriptExecutionError) {
          assert.strictEqual(err.exitCode, 42);
        }
        return true;
      }
    );
  });
});
