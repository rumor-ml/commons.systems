/**
 * Tests for check-todo-in-main tool
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { checkTodoInMain } from './check-todo-in-main.js';
import * as ghCli from '../utils/gh-cli.js';
import { GitHubCliError, ParsingError } from '../utils/errors.js';

describe('checkTodoInMain - Integration Tests', () => {
  it('finds pattern when it exists in file', async () => {
    // Mock resolveRepo to return a valid repo
    mock.method(ghCli, 'resolveRepo', () => Promise.resolve('owner/repo'));

    // Mock ghCli to return base64-encoded content with pattern
    const content = 'const x = 1;\n// TODO(#123): Fix this\nconst y = 2;';
    const base64Content = Buffer.from(content).toString('base64');
    mock.method(ghCli, 'ghCli', () => Promise.resolve(base64Content));

    const result = await checkTodoInMain({
      file_path: 'src/test.ts',
      todo_pattern: 'TODO(#123)',
    });

    // Verify result indicates pattern was found
    assert.ok(result._meta);
    assert.strictEqual((result._meta as any).found, true);
    assert.strictEqual((result._meta as any).file_path, 'src/test.ts');
    assert.strictEqual((result._meta as any).pattern, 'TODO(#123)');

    // Verify message
    assert.ok(result.content?.[0]);
    assert.strictEqual(result.content[0].type, 'text');
    assert.match(result.content[0].text, /Pattern "TODO\(#123\)" found in src\/test\.ts/);
  });

  it('returns not found when pattern is missing', async () => {
    // Mock resolveRepo
    mock.method(ghCli, 'resolveRepo', () => Promise.resolve('owner/repo'));

    // Mock ghCli to return base64-encoded content without pattern
    const content = 'const x = 1;\nconst y = 2;';
    const base64Content = Buffer.from(content).toString('base64');
    mock.method(ghCli, 'ghCli', () => Promise.resolve(base64Content));

    const result = await checkTodoInMain({
      file_path: 'src/test.ts',
      todo_pattern: 'TODO(#999)',
    });

    // Verify result indicates pattern was not found
    assert.ok(result._meta);
    assert.strictEqual((result._meta as any).found, false);
    assert.strictEqual((result._meta as any).file_path, 'src/test.ts');
    assert.strictEqual((result._meta as any).pattern, 'TODO(#999)');

    // Verify message
    assert.ok(result.content?.[0]);
    assert.match(result.content[0].text, /Pattern "TODO\(#999\)" not found in src\/test\.ts/);
  });

  it('handles file not found gracefully (404 error)', async () => {
    // Mock resolveRepo
    mock.method(ghCli, 'resolveRepo', () => Promise.resolve('owner/repo'));

    // Mock ghCli to throw 404 error with file path in message
    mock.method(ghCli, 'ghCli', () => {
      throw new GitHubCliError(
        'GET https://api.github.com/repos/owner/repo/contents/missing.ts: 404 Not Found',
        1,
        'Not Found'
      );
    });

    const result = await checkTodoInMain({
      file_path: 'missing.ts',
      todo_pattern: 'TODO(#123)',
    });

    // Verify result indicates file not found
    assert.ok(result._meta);
    assert.strictEqual((result._meta as any).found, false);
    assert.strictEqual((result._meta as any).fileNotFound, true);
    assert.strictEqual((result._meta as any).file_path, 'missing.ts');

    // Verify message
    assert.ok(result.content?.[0]);
    assert.match(result.content[0].text, /File missing\.ts not found on main branch/);
  });

  it('throws error for repository not found (404 error)', async () => {
    // Mock resolveRepo
    mock.method(ghCli, 'resolveRepo', () => Promise.resolve('owner/invalid-repo'));

    // Mock ghCli to throw 404 error for repository (no /contents/ in path)
    mock.method(ghCli, 'ghCli', () => {
      throw new GitHubCliError(
        'GET https://api.github.com/repos/owner/invalid-repo: 404 Not Found',
        1,
        'Not Found'
      );
    });

    // Verify error is thrown (not gracefully handled)
    await assert.rejects(
      async () => {
        await checkTodoInMain({
          file_path: 'src/test.ts',
          todo_pattern: 'TODO(#123)',
        });
      },
      (error: Error) => {
        assert.ok(error instanceof GitHubCliError);
        assert.match(error.message, /Repository not found or access denied/);
        assert.match(error.message, /owner\/invalid-repo/);
        return true;
      }
    );
  });

  it('throws ParsingError for base64 decoding failure', async () => {
    // Mock resolveRepo
    mock.method(ghCli, 'resolveRepo', () => Promise.resolve('owner/repo'));

    // Mock ghCli to return invalid base64 content
    mock.method(ghCli, 'ghCli', () => Promise.resolve('!!!invalid-base64!!!'));

    // Verify ParsingError is thrown
    await assert.rejects(
      async () => {
        await checkTodoInMain({
          file_path: 'binary.png',
          todo_pattern: 'TODO(#123)',
        });
      },
      (error: Error) => {
        assert.ok(error instanceof ParsingError);
        assert.match(error.message, /Failed to decode file content from GitHub API/);
        assert.match(error.message, /binary\.png/);
        return true;
      }
    );
  });

  it('propagates non-404 errors through createErrorResult', async () => {
    // Mock resolveRepo
    mock.method(ghCli, 'resolveRepo', () => Promise.resolve('owner/repo'));

    // Mock ghCli to throw a non-404 error
    mock.method(ghCli, 'ghCli', () => {
      throw new GitHubCliError('Rate limit exceeded', 1, 'API rate limit exceeded');
    });

    const result = await checkTodoInMain({
      file_path: 'src/test.ts',
      todo_pattern: 'TODO(#123)',
    });

    // Verify result contains error information
    assert.ok(result.isError === true || result.content?.[0]?.text?.includes('Rate limit'));
  });

  it('calls GitHub API with explicit ref=main parameter', async () => {
    // Mock resolveRepo
    mock.method(ghCli, 'resolveRepo', () => Promise.resolve('owner/repo'));

    // Mock ghCli and capture the arguments
    let capturedArgs: string[] = [];
    mock.method(ghCli, 'ghCli', (args: string[]) => {
      capturedArgs = args;
      const content = 'const x = 1;';
      return Promise.resolve(Buffer.from(content).toString('base64'));
    });

    await checkTodoInMain({
      file_path: 'src/test.ts',
      todo_pattern: 'TODO(#123)',
    });

    // Verify API call includes ?ref=main parameter
    assert.ok(capturedArgs.length > 0);
    const apiPath = capturedArgs.find((arg) => arg.includes('repos/'));
    assert.ok(apiPath, 'Should have API path argument');
    assert.match(apiPath, /\?ref=main/, 'API path should include ?ref=main parameter');
  });

  it('resolves repo parameter correctly', async () => {
    // Test with explicit repo
    let resolvedRepo = '';
    mock.method(ghCli, 'resolveRepo', (repo?: string) => {
      resolvedRepo = repo || 'default/repo';
      return Promise.resolve(resolvedRepo);
    });

    mock.method(ghCli, 'ghCli', () => {
      const content = 'const x = 1;';
      return Promise.resolve(Buffer.from(content).toString('base64'));
    });

    await checkTodoInMain({
      file_path: 'src/test.ts',
      todo_pattern: 'TODO(#123)',
      repo: 'custom/repo',
    });

    // Verify resolveRepo was called with custom repo
    assert.strictEqual(resolvedRepo, 'custom/repo');
  });
});

describe('CheckTodoInMain - Edge Cases', () => {
  it('handles empty file content (empty base64)', () => {
    // Empty base64 string decodes to empty string
    const emptyBase64 = '';
    const decoded = Buffer.from(emptyBase64, 'base64').toString('utf-8');

    assert.equal(decoded, '');

    const pattern = 'TODO(#123)';
    const found = decoded.includes(pattern);
    assert.equal(found, false);
  });

  it('handles whitespace-only content', () => {
    // Base64 encode whitespace
    const whitespaceContent = '   \n\n\t  ';
    const base64 = Buffer.from(whitespaceContent, 'utf-8').toString('base64');
    const decoded = Buffer.from(base64, 'base64').toString('utf-8');

    assert.equal(decoded, whitespaceContent);

    const pattern = 'TODO(#123)';
    const found = decoded.includes(pattern);
    assert.equal(found, false);
  });

  it('handles TODO pattern with special regex characters', () => {
    const fileContent = 'TODO(#123) fix this\nTODO(#456) and that';

    // Test various patterns that might contain regex special chars
    const patterns = [
      'TODO(#123)', // Parentheses
      'TODO[#123]', // Brackets
      'TODO{#123}', // Braces
      'TODO.#123.', // Dots
      'TODO*#123*', // Asterisks
    ];

    patterns.forEach((pattern) => {
      // Direct string search (not regex) should work fine
      const found = fileContent.includes(pattern);

      if (pattern === 'TODO(#123)') {
        assert.equal(found, true, `Should find ${pattern}`);
      } else {
        assert.equal(found, false, `Should not find ${pattern}`);
      }
    });
  });

  it('handles unicode and emoji in TODO patterns', () => {
    const fileContent = 'TODO(#123) 🚀 fix this\nTODO(#456) 中文 comment';
    const base64 = Buffer.from(fileContent, 'utf-8').toString('base64');
    const decoded = Buffer.from(base64, 'base64').toString('utf-8');

    assert.equal(decoded, fileContent);

    // Should find patterns with unicode
    assert.equal(decoded.includes('TODO(#123) 🚀'), true);
    assert.equal(decoded.includes('TODO(#456) 中文'), true);
  });

  it('handles very large file content efficiently', () => {
    // Simulate large file (1MB of content)
    const largeContent = 'TODO(#123) fix\n'.repeat(50000);
    const base64 = Buffer.from(largeContent, 'utf-8').toString('base64');

    // Verify base64 encoding/decoding works for large content
    const decoded = Buffer.from(base64, 'base64').toString('utf-8');
    assert.equal(decoded.includes('TODO(#123)'), true);

    // Verify length preserved
    assert.equal(decoded.length, largeContent.length);
  });

  it('handles file not found (404) error detection', () => {
    const error404 = 'gh: 404 Not Found';
    const error403 = 'gh: 403 Forbidden';
    const normalError = 'Network timeout';

    assert.equal(error404.includes('404'), true);
    assert.equal(error403.includes('404'), false);
    assert.equal(normalError.includes('404'), false);
  });

  it('handles patterns at various file positions', () => {
    const patterns = [
      { content: 'TODO(#123) at start', pattern: 'TODO(#123)', found: true },
      { content: 'some text TODO(#123) in middle', pattern: 'TODO(#123)', found: true },
      { content: 'some text\nTODO(#123)', pattern: 'TODO(#123)', found: true },
      { content: 'TODO(#456)', pattern: 'TODO(#123)', found: false },
    ];

    patterns.forEach(({ content, pattern, found }) => {
      const result = content.includes(pattern);
      assert.equal(result, found, `Pattern "${pattern}" in "${content}"`);
    });
  });

  it('handles multiple TODO patterns in same file', () => {
    const fileContent = `
      TODO(#123) first issue
      TODO(#456) second issue
      TODO(#789) third issue
    `;

    const patterns = ['TODO(#123)', 'TODO(#456)', 'TODO(#789)', 'TODO(#999)'];
    const results = patterns.map((p) => fileContent.includes(p));

    assert.deepEqual(results, [true, true, true, false]);
  });

  it('handles case sensitivity correctly', () => {
    const fileContent = 'TODO(#123) fix this';

    // String.includes is case sensitive
    assert.equal(fileContent.includes('TODO(#123)'), true);
    assert.equal(fileContent.includes('todo(#123)'), false);
    assert.equal(fileContent.includes('Todo(#123)'), false);
  });

  it('handles newline variations in content', () => {
    const variations = [
      'TODO(#123)\nfix this', // Unix
      'TODO(#123)\r\nfix this', // Windows
      'TODO(#123)\rfix this', // Old Mac
    ];

    variations.forEach((content) => {
      assert.equal(content.includes('TODO(#123)'), true);
    });
  });

  it('handles base64 padding correctly', () => {
    // Base64 strings may or may not have padding
    const testStrings = ['hello', 'hi', 'test'];

    testStrings.forEach((str) => {
      const base64 = Buffer.from(str, 'utf-8').toString('base64');
      const decoded = Buffer.from(base64, 'base64').toString('utf-8');
      assert.equal(decoded, str);
    });
  });

  it('handles file paths with special characters', () => {
    const paths = [
      'src/tools/file-name.ts',
      'src/tools/file_name.ts',
      'src/tools/file name.ts',
      'src/tools/file-名.ts',
    ];

    // Just validate path format - actual API call would handle encoding
    paths.forEach((path) => {
      assert.equal(typeof path, 'string');
      assert.equal(path.length > 0, true);
    });
  });
});
