/**
 * Tests for add-blocker tool - validation logic
 * TODO(#1556): Consider integration tests for new gh workflow tools
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addBlocker } from './add-blocker.js';
import * as ghCli from '../utils/gh-cli.js';
import { GitHubCliError } from '../utils/errors.js';

describe('addBlocker - Input Validation', () => {
  it('throws ValidationError for non-numeric string issue numbers', async () => {
    await assert.rejects(
      async () => {
        await addBlocker({
          blocked_issue_number: 'abc',
          blocker_issue_number: 200,
        });
      },
      {
        name: 'ValidationError',
        message: /Invalid blocked_issue_number: must be a positive integer, got abc/,
      }
    );

    await assert.rejects(
      async () => {
        await addBlocker({
          blocked_issue_number: 100,
          blocker_issue_number: 'xyz',
        });
      },
      {
        name: 'ValidationError',
        message: /Invalid blocker_issue_number: must be a positive integer, got xyz/,
      }
    );
  });

  it('throws ValidationError for negative issue numbers', async () => {
    await assert.rejects(
      async () => {
        await addBlocker({
          blocked_issue_number: -1,
          blocker_issue_number: 200,
        });
      },
      {
        name: 'ValidationError',
        message: /Invalid blocked_issue_number: must be a positive integer/,
      }
    );

    await assert.rejects(
      async () => {
        await addBlocker({
          blocked_issue_number: 100,
          blocker_issue_number: -5,
        });
      },
      {
        name: 'ValidationError',
        message: /Invalid blocker_issue_number: must be a positive integer/,
      }
    );
  });

  it('throws ValidationError for zero issue numbers', async () => {
    await assert.rejects(
      async () => {
        await addBlocker({
          blocked_issue_number: 0,
          blocker_issue_number: 200,
        });
      },
      {
        name: 'ValidationError',
        message: /Invalid blocked_issue_number: must be a positive integer/,
      }
    );

    await assert.rejects(
      async () => {
        await addBlocker({
          blocked_issue_number: 100,
          blocker_issue_number: 0,
        });
      },
      {
        name: 'ValidationError',
        message: /Invalid blocker_issue_number: must be a positive integer/,
      }
    );
  });

  it('throws ValidationError for NaN issue numbers', async () => {
    await assert.rejects(
      async () => {
        await addBlocker({
          blocked_issue_number: NaN,
          blocker_issue_number: 200,
        });
      },
      {
        name: 'ValidationError',
        message: /Invalid blocked_issue_number: must be a positive integer/,
      }
    );

    await assert.rejects(
      async () => {
        await addBlocker({
          blocked_issue_number: 100,
          blocker_issue_number: NaN,
        });
      },
      {
        name: 'ValidationError',
        message: /Invalid blocker_issue_number: must be a positive integer/,
      }
    );
  });

  it('throws ValidationError for empty string issue numbers', async () => {
    await assert.rejects(
      async () => {
        await addBlocker({
          blocked_issue_number: '',
          blocker_issue_number: 200,
        });
      },
      {
        name: 'ValidationError',
        message: /Invalid blocked_issue_number: must be a positive integer/,
      }
    );
  });

  it('throws ValidationError for decimal issue numbers', async () => {
    await assert.rejects(
      async () => {
        await addBlocker({
          blocked_issue_number: 100.5,
          blocker_issue_number: 200,
        });
      },
      {
        name: 'ValidationError',
        message: /Invalid blocked_issue_number: must be a positive integer/,
      }
    );
  });
});

describe('addBlocker - Success Cases', () => {
  it('successfully adds blocker relationship', async (t) => {
    t.mock.method(ghCli, 'resolveRepo', () => Promise.resolve('owner/repo'));
    t.mock.method(ghCli, 'ghCliJson', () => Promise.resolve({ id: '999' }));
    t.mock.method(ghCli, 'ghCli', () => Promise.resolve(''));

    const result = await addBlocker({
      blocked_issue_number: 100,
      blocker_issue_number: 200,
    });

    assert.ok(!result.isError);
    assert.match(
      result.content[0].text,
      /Successfully added issue #200 as a blocker for issue #100/
    );
    assert.strictEqual((result._meta as any).blocked_issue_number, 100);
    assert.strictEqual((result._meta as any).blocker_issue_number, 200);
    assert.strictEqual((result._meta as any).blocker_issue_id, '999');
  });

  it('accepts valid numeric string issue numbers', async (t) => {
    t.mock.method(ghCli, 'resolveRepo', () => Promise.resolve('owner/repo'));
    t.mock.method(ghCli, 'ghCliJson', () => Promise.resolve({ id: '999' }));
    const ghCliMock = t.mock.method(ghCli, 'ghCli', () => Promise.resolve(''));

    const result = await addBlocker({
      blocked_issue_number: '100',
      blocker_issue_number: '200',
    });

    assert.ok(!result.isError);
    // Verify the API was called with parsed numbers
    const apiCall = ghCliMock.mock.calls[0];
    assert.ok(apiCall);
    assert.ok((apiCall.arguments[0] as string[]).join(' ').includes('issues/100/dependencies'));
  });
});

describe('addBlocker - Duplicate Handling', () => {
  it('handles duplicate blocker relationship gracefully', async (t) => {
    t.mock.method(ghCli, 'resolveRepo', () => Promise.resolve('owner/repo'));
    t.mock.method(ghCli, 'ghCliJson', () => Promise.resolve({ id: '999' }));
    t.mock.method(ghCli, 'ghCli', () => {
      throw new GitHubCliError(
        'POST repos/owner/repo/issues/100/dependencies/blocked_by: 422 Validation Failed',
        1,
        'Duplicate: relationship already exists'
      );
    });

    const result = await addBlocker({
      blocked_issue_number: 100,
      blocker_issue_number: 200,
    });

    assert.ok(!result.isError);
    assert.strictEqual((result._meta as any).alreadyExists, true);
    assert.strictEqual((result._meta as any).blocked_issue_number, 100);
    assert.strictEqual((result._meta as any).blocker_issue_number, 200);
    assert.match(result.content[0].text, /already exists/);
  });

  it('re-throws non-duplicate 422 validation errors', async (t) => {
    t.mock.method(ghCli, 'resolveRepo', () => Promise.resolve('owner/repo'));
    t.mock.method(ghCli, 'ghCliJson', () => Promise.resolve({ id: '999' }));
    t.mock.method(ghCli, 'ghCli', () => {
      throw new GitHubCliError(
        'POST repos/owner/repo/issues/100/dependencies/blocked_by: 422 Validation Failed',
        1,
        'Invalid issue_id format'
      );
    });

    await assert.rejects(
      async () => {
        await addBlocker({
          blocked_issue_number: 100,
          blocker_issue_number: 200,
        });
      },
      (error: Error) => {
        assert.ok(error instanceof GitHubCliError);
        assert.match(error.message, /422 Validation Failed/);
        return true;
      }
    );
  });

  it('re-throws 422 error when verification call fails', async (t) => {
    t.mock.method(ghCli, 'resolveRepo', () => Promise.resolve('owner/repo'));

    // First call succeeds (blocker issue lookup), second call fails (verification)
    let ghCliJsonCallCount = 0;
    t.mock.method(ghCli, 'ghCliJson', () => {
      ghCliJsonCallCount++;
      if (ghCliJsonCallCount === 1) {
        return Promise.resolve({ id: '999' });
      } else {
        throw new GitHubCliError(
          'GET repos/owner/repo/issues/100/dependencies/blocked_by: 500 Internal Server Error',
          1,
          'Verification failed'
        );
      }
    });

    // Initial blocker creation throws 422
    t.mock.method(ghCli, 'ghCli', () => {
      throw new GitHubCliError(
        'POST repos/owner/repo/issues/100/dependencies/blocked_by: 422 Validation Failed',
        1,
        'Some validation error'
      );
    });

    await assert.rejects(
      async () => {
        await addBlocker({
          blocked_issue_number: 100,
          blocker_issue_number: 200,
        });
      },
      (error: Error) => {
        assert.ok(error instanceof GitHubCliError);
        assert.match(error.message, /422 Validation Failed/);
        assert.match(error.message, /Some validation error/);
        return true;
      }
    );
  });
});

describe('addBlocker - Error Handling', () => {
  it('returns error when blocker issue does not exist', async (t) => {
    t.mock.method(ghCli, 'resolveRepo', () => Promise.resolve('owner/repo'));
    t.mock.method(ghCli, 'ghCliJson', () => {
      throw new GitHubCliError('GET repos/owner/repo/issues/999: 404 Not Found', 1, 'Not Found');
    });

    const result = await addBlocker({
      blocked_issue_number: 100,
      blocker_issue_number: 999,
    });

    assert.ok(result.isError);
    assert.match(result.content[0].text, /404/);
  });
});
