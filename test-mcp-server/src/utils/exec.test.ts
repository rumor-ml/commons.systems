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
    await assert.rejects(
      async () => execScript('/bin/sh', ['-c', 'echo error >&2 && exit 1']),
      (err: Error) => {
        assert.ok(err instanceof ScriptExecutionError);
        if (err instanceof ScriptExecutionError) {
          assert.ok(err.stderr?.includes('error') || err.message.includes('error'));
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
    const output = await captureOutput('/bin/sh', ['-c', 'echo line1; echo line2']);
    assert.ok(output.includes('line1'));
    assert.ok(output.includes('line2'));
    // Should be trimmed (no leading/trailing whitespace)
    assert.strictEqual(output, output.trim());
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
    await execScriptBackground('/bin/sh', ['-c', `echo test > "${testFile}"`]);

    // Wait a bit for command to complete
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify file was created
    const content = await fs.readFile(testFile, 'utf-8');
    assert.strictEqual(content.trim(), 'test');

    // Cleanup
    await fs.unlink(testFile);
  });

  it('should not throw on command failure', async () => {
    // Background processes swallow errors
    await assert.doesNotReject(async () => {
      await execScriptBackground('/bin/false', []);
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
