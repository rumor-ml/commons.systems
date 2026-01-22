/**
 * Tests for add-blocker tool - validation logic
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addBlocker } from './add-blocker.js';

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
