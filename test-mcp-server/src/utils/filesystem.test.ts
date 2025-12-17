import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getErrorCode, getClaudeTmpDir, getClaudeTmpPath } from './filesystem.js';
import path from 'path';

describe('getErrorCode', () => {
  it('extracts code from error objects', () => {
    assert.equal(getErrorCode({ code: 'ENOENT' }), 'ENOENT');
    assert.equal(getErrorCode({ code: 'EPERM' }), 'EPERM');
    assert.equal(getErrorCode({ code: 123 }), '123');
  });

  it('returns "unknown" for errors without code', () => {
    assert.equal(getErrorCode(new Error('msg')), 'unknown');
    assert.equal(getErrorCode('string'), 'unknown');
    assert.equal(getErrorCode(null), 'unknown');
    assert.equal(getErrorCode(undefined), 'unknown');
    assert.equal(getErrorCode({}), 'unknown');
  });
});

describe('getClaudeTmpDir', () => {
  it('returns /tmp/claude path', () => {
    assert.equal(getClaudeTmpDir(), '/tmp/claude');
  });
});

describe('getClaudeTmpPath', () => {
  it('joins segments with /tmp/claude', () => {
    assert.equal(
      getClaudeTmpPath('test', 'file.txt'),
      path.join('/tmp/claude', 'test', 'file.txt')
    );
  });

  it('handles single segment', () => {
    assert.equal(
      getClaudeTmpPath('file.txt'),
      path.join('/tmp/claude', 'file.txt')
    );
  });

  it('handles empty segments', () => {
    assert.equal(getClaudeTmpPath(), '/tmp/claude');
  });
});
