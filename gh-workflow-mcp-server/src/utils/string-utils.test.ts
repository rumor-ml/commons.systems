/**
 * Tests for string utility functions
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { slugify, generateBranchName } from './string-utils.js';

describe('slugify', () => {
  test('converts basic text to slug', () => {
    assert.strictEqual(slugify('Hello World'), 'hello-world');
  });

  test('handles special characters', () => {
    assert.strictEqual(
      slugify('Fix: Bug in @user/component (urgent!)'),
      'fix-bug-in-user-component-urgent'
    );
  });

  test('removes consecutive hyphens', () => {
    assert.strictEqual(slugify('Multiple   spaces    here'), 'multiple-spaces-here');
  });

  test('removes leading and trailing hyphens', () => {
    assert.strictEqual(slugify('--trim-me--'), 'trim-me');
  });

  test('truncates to max length', () => {
    const longText = 'This is a very long text that should be truncated to fit the max length';
    const result = slugify(longText, 20);
    assert.ok(result.length <= 20);
    assert.strictEqual(result, 'this-is-a-very-long');
  });

  test('removes trailing hyphen after truncation', () => {
    // "hello-world-test" truncated at 11 would be "hello-world" (hyphen at position 11)
    const result = slugify('hello world test', 11);
    assert.strictEqual(result, 'hello-world');
  });

  test('handles empty string', () => {
    assert.strictEqual(slugify(''), '');
  });

  test('handles unicode characters', () => {
    assert.strictEqual(slugify('Café ☕ façade'), 'caf-fa-ade');
  });

  test('handles strings with only special characters', () => {
    assert.strictEqual(slugify('!!!'), '');
  });

  test('collapses hyphens from consecutive special chars', () => {
    assert.strictEqual(slugify('hello!!!world'), 'hello-world');
  });
});

describe('generateBranchName', () => {
  test('generates branch name with issue number', () => {
    assert.strictEqual(
      generateBranchName(123, 'Fix authentication bug'),
      '123-fix-authentication-bug'
    );
  });

  test('generates branch name without issue number', () => {
    assert.strictEqual(
      generateBranchName(undefined, 'Implement new feature'),
      'implement-new-feature'
    );
  });

  test('handles complex titles with special characters', () => {
    assert.strictEqual(
      generateBranchName(456, 'Update @commons/ui: Add new Button component'),
      '456-update-commons-ui-add-new-button-component'
    );
  });

  test('handles long titles with truncation', () => {
    const longTitle =
      'This is a very long issue title that describes a complex feature with many details';
    const result = generateBranchName(789, longTitle);
    assert.match(result, /^789-/);
    assert.ok(result.length <= 54); // 3 digits + hyphen + 50 chars
  });

  test('handles issue number 0', () => {
    assert.strictEqual(generateBranchName(0, 'Fix bug'), '0-fix-bug');
  });

  test('handles empty title', () => {
    assert.strictEqual(generateBranchName(123, ''), '123-');
  });

  test('handles title with only special characters', () => {
    assert.strictEqual(generateBranchName(999, '!!!'), '999-');
  });
});
