/**
 * Tests for remove-label-if-exists tool
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { removeLabelIfExists } from './remove-label-if-exists.js';
import * as ghCli from '../utils/gh-cli.js';
import { ValidationError } from '../utils/errors.js';

describe('removeLabelIfExists', () => {
  it('removes label when it exists on the issue', async () => {
    // Mock resolveRepo to return a valid repo
    mock.method(ghCli, 'resolveRepo', () => Promise.resolve('owner/repo'));

    // Mock ghCliJson to return labels including target label
    mock.method(ghCli, 'ghCliJson', () =>
      Promise.resolve([{ name: 'bug' }, { name: 'enhancement' }, { name: 'documentation' }])
    );

    // Mock ghCli to succeed on issue edit
    mock.method(ghCli, 'ghCli', () => Promise.resolve(''));

    const result = await removeLabelIfExists({
      issue_number: 123,
      label: 'bug',
    });

    // Verify result structure
    assert.ok(!result.isError);
    assert.ok(result.content);
    assert.strictEqual(result.content.length, 1);
    assert.strictEqual(result.content[0].type, 'text');
    assert.match(result.content[0].text, /Successfully removed label "bug" from issue #123/);

    // Verify metadata
    assert.ok(result._meta);
    assert.strictEqual((result._meta as any).labelRemoved, true);
    assert.strictEqual((result._meta as any).issue_number, 123);
    assert.strictEqual((result._meta as any).label, 'bug');
  });

  it('skips removal when label does not exist (idempotent)', async () => {
    // Mock resolveRepo to return a valid repo
    mock.method(ghCli, 'resolveRepo', () => Promise.resolve('owner/repo'));

    // Mock ghCliJson to return labels not including target label
    mock.method(ghCli, 'ghCliJson', () =>
      Promise.resolve([{ name: 'enhancement' }, { name: 'documentation' }])
    );

    // Mock ghCli (should not be called, but mock anyway)
    const ghCliMock = mock.method(ghCli, 'ghCli', () => Promise.resolve(''));

    const result = await removeLabelIfExists({
      issue_number: 123,
      label: 'bug',
    });

    // Verify result structure
    assert.ok(!result.isError);
    assert.ok(result.content);
    assert.strictEqual(result.content.length, 1);
    assert.strictEqual(result.content[0].type, 'text');
    assert.match(result.content[0].text, /Label "bug" not found on issue #123 \(no action taken\)/);

    // Verify metadata
    assert.ok(result._meta);
    assert.strictEqual((result._meta as any).labelRemoved, false);
    assert.strictEqual((result._meta as any).issue_number, 123);
    assert.strictEqual((result._meta as any).label, 'bug');

    // Verify ghCli was not called (no removal attempted)
    assert.strictEqual(ghCliMock.mock.callCount(), 0);
  });

  it('converts string issue numbers to integers', async () => {
    // Mock resolveRepo to return a valid repo
    mock.method(ghCli, 'resolveRepo', () => Promise.resolve('owner/repo'));

    // Mock ghCliJson to return labels
    const ghCliJsonMock = mock.method(ghCli, 'ghCliJson', () => Promise.resolve([{ name: 'bug' }]));

    // Mock ghCli
    const ghCliMock = mock.method(ghCli, 'ghCli', () => Promise.resolve(''));

    await removeLabelIfExists({
      issue_number: '456',
      label: 'bug',
    });

    // Verify ghCliJson was called with string representation of number
    assert.strictEqual(ghCliJsonMock.mock.callCount(), 1);
    const jsonCall = ghCliJsonMock.mock.calls[0];
    assert.ok(jsonCall);
    assert.ok((jsonCall.arguments[0] as string[]).includes('456'));

    // Verify ghCli was called with string representation of number
    assert.strictEqual(ghCliMock.mock.callCount(), 1);
    const cliCall = ghCliMock.mock.calls[0];
    assert.ok(cliCall);
    assert.ok((cliCall.arguments[0] as string[]).includes('456'));
  });

  it('handles exact label name matching', async () => {
    // Mock resolveRepo to return a valid repo
    mock.method(ghCli, 'resolveRepo', () => Promise.resolve('owner/repo'));

    // Mock ghCliJson to return labels with similar names
    mock.method(ghCli, 'ghCliJson', () =>
      Promise.resolve([{ name: 'bugfix' }, { name: 'critical-bug' }, { name: 'enhancement' }])
    );

    // Mock ghCli (should not be called since exact match "bug" is not present)
    const ghCliMock = mock.method(ghCli, 'ghCli', () => Promise.resolve(''));

    const result = await removeLabelIfExists({
      issue_number: 123,
      label: 'bug',
    });

    // Verify no removal occurred (exact match not found)
    assert.ok(result._meta);
    assert.strictEqual((result._meta as any).labelRemoved, false);

    // Verify ghCli was not called
    assert.strictEqual(ghCliMock.mock.callCount(), 0);
  });

  it('resolves repo parameter correctly', async () => {
    // Mock resolveRepo
    const resolveRepoMock = mock.method(ghCli, 'resolveRepo', () => Promise.resolve('owner/repo'));

    // Mock ghCliJson
    mock.method(ghCli, 'ghCliJson', () => Promise.resolve([{ name: 'bug' }]));

    // Mock ghCli
    mock.method(ghCli, 'ghCli', () => Promise.resolve(''));

    // Test with explicit repo
    await removeLabelIfExists({
      issue_number: 123,
      label: 'bug',
      repo: 'explicit/repo',
    });

    // Verify resolveRepo was called with explicit repo
    assert.strictEqual(resolveRepoMock.mock.callCount(), 1);
    assert.strictEqual(resolveRepoMock.mock.calls[0].arguments[0], 'explicit/repo');

    // Test with default repo (undefined)
    await removeLabelIfExists({
      issue_number: 456,
      label: 'enhancement',
    });

    // Verify resolveRepo was called with undefined
    assert.strictEqual(resolveRepoMock.mock.callCount(), 2);
    assert.strictEqual(resolveRepoMock.mock.calls[1].arguments[0], undefined);
  });

  it('validates issue_number is a positive integer', async () => {
    // Mock resolveRepo (will be called before validation)
    mock.method(ghCli, 'resolveRepo', () => Promise.resolve('owner/repo'));

    // Test with NaN (from parsing invalid string)
    await assert.rejects(
      async () => {
        await removeLabelIfExists({
          issue_number: 'invalid',
          label: 'bug',
        });
      },
      (err: Error) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /Invalid issue_number: must be a positive integer/);
        return true;
      }
    );

    // Test with zero
    await assert.rejects(
      async () => {
        await removeLabelIfExists({
          issue_number: 0,
          label: 'bug',
        });
      },
      (err: Error) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /Invalid issue_number: must be a positive integer/);
        return true;
      }
    );

    // Test with negative number
    await assert.rejects(
      async () => {
        await removeLabelIfExists({
          issue_number: -5,
          label: 'bug',
        });
      },
      (err: Error) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /Invalid issue_number: must be a positive integer/);
        return true;
      }
    );

    // Test with decimal
    await assert.rejects(
      async () => {
        await removeLabelIfExists({
          issue_number: 12.5,
          label: 'bug',
        });
      },
      (err: Error) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /Invalid issue_number: must be a positive integer/);
        return true;
      }
    );
  });

  it('propagates errors through createErrorResult', async () => {
    // Mock resolveRepo to succeed
    mock.method(ghCli, 'resolveRepo', () => Promise.resolve('owner/repo'));

    // Mock ghCliJson to throw error
    mock.method(ghCli, 'ghCliJson', () => {
      throw new Error('gh CLI command failed');
    });

    const result = await removeLabelIfExists({
      issue_number: 123,
      label: 'bug',
    });

    // Verify error result structure
    assert.ok(result.isError);
    assert.ok(result.content);
    assert.strictEqual(result.content.length, 1);
    assert.strictEqual(result.content[0].type, 'text');
    assert.match(result.content[0].text, /gh CLI command failed/);
  });
});
