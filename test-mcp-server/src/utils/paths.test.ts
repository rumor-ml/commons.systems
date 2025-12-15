/**
 * Tests for path resolution utilities
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { getWorktreeRoot, getScriptPath, getCwd } from './paths.js';
import { SCRIPTS_DIR } from '../constants.js';

describe('getCwd', () => {
  it('should return current working directory', () => {
    const cwd = getCwd();
    assert.strictEqual(typeof cwd, 'string');
    assert.ok(cwd.length > 0);
    assert.strictEqual(cwd, process.cwd());
  });

  it('should return absolute path', () => {
    const cwd = getCwd();
    assert.ok(path.isAbsolute(cwd));
  });
});

describe('getWorktreeRoot', () => {
  it('should return a string path', async () => {
    const root = await getWorktreeRoot();
    assert.strictEqual(typeof root, 'string');
    assert.ok(root.length > 0);
  });

  it('should return absolute path', async () => {
    const root = await getWorktreeRoot();
    assert.ok(path.isAbsolute(root));
  });

  it('should not have trailing slash', async () => {
    const root = await getWorktreeRoot();
    assert.ok(!root.endsWith('/'));
  });

  it('should be consistent across multiple calls', async () => {
    const root1 = await getWorktreeRoot();
    const root2 = await getWorktreeRoot();
    assert.strictEqual(root1, root2);
  });
});

describe('getScriptPath', () => {
  it('should return absolute path for script', async () => {
    const scriptPath = await getScriptPath('test-run.sh');
    assert.strictEqual(typeof scriptPath, 'string');
    assert.ok(path.isAbsolute(scriptPath));
  });

  it('should include scripts directory in path', async () => {
    const scriptPath = await getScriptPath('test-run.sh');
    assert.ok(scriptPath.includes(SCRIPTS_DIR));
  });

  it('should end with script name', async () => {
    const scriptName = 'test-run.sh';
    const scriptPath = await getScriptPath(scriptName);
    assert.ok(scriptPath.endsWith(scriptName));
  });

  it('should work with different script names', async () => {
    const scriptNames = [
      'test-run.sh',
      'emulator-start.sh',
      'emulator-stop.sh',
      'dev-server-start.sh',
    ];

    for (const name of scriptNames) {
      const scriptPath = await getScriptPath(name);
      assert.ok(scriptPath.endsWith(name));
      assert.ok(scriptPath.includes(SCRIPTS_DIR));
    }
  });

  it('should construct path using worktree root', async () => {
    const root = await getWorktreeRoot();
    const scriptPath = await getScriptPath('test-run.sh');
    const expectedPath = path.join(root, SCRIPTS_DIR, 'test-run.sh');
    assert.strictEqual(scriptPath, expectedPath);
  });
});

describe('Path Relationships', () => {
  it('should have script path within worktree root', async () => {
    const root = await getWorktreeRoot();
    const scriptPath = await getScriptPath('test-run.sh');
    assert.ok(scriptPath.startsWith(root));
  });
});
