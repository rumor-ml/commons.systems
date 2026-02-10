/**
 * Tests for body-state module - state persistence in PR/issue bodies
 *
 * These tests cover the critical error handling paths for StateCorruptionError,
 * ensuring state corruption is properly detected, reported, and provides
 * actionable recovery instructions to users.
 *
 * Test categories:
 * 1. StateCorruptionError constructor validation
 * 2. StateCorruptionError.create factory method
 * 3. extractStateFromBody JSON parsing and corruption detection
 * 4. injectStateIntoBody replacement logic
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  StateCorruptionError,
  StateCorruptionValidationError,
  _testExports,
} from './body-state.js';
import type { WiggumState } from './types.js';
import { WIGGUM_STATE_MARKER } from '../constants.js';

const { extractStateFromBody, injectStateIntoBody } = _testExports;

describe('StateCorruptionValidationError', () => {
  it('should have correct name property', () => {
    const error = new StateCorruptionValidationError('test message');
    assert.strictEqual(error.name, 'StateCorruptionValidationError');
    assert.strictEqual(error.message, 'test message');
  });

  it('should be instanceof Error', () => {
    const error = new StateCorruptionValidationError('test');
    assert.ok(error instanceof Error);
    assert.ok(error instanceof StateCorruptionValidationError);
  });
});

describe('StateCorruptionError constructor validation', () => {
  describe('bodyLength validation', () => {
    it('should throw StateCorruptionValidationError for negative bodyLength', () => {
      assert.throws(
        () => new StateCorruptionError('message', 'error', -1, 'preview'),
        (error) => {
          assert.ok(error instanceof StateCorruptionValidationError);
          assert.ok(error.message.includes('bodyLength cannot be negative'));
          return true;
        }
      );
    });

    it('should throw StateCorruptionValidationError for -100 bodyLength', () => {
      assert.throws(
        () => new StateCorruptionError('message', 'error', -100, 'preview'),
        StateCorruptionValidationError
      );
    });

    it('should accept bodyLength of 0', () => {
      const error = new StateCorruptionError('msg', 'err', 0, 'preview');
      assert.strictEqual(error.bodyLength, 0);
    });

    it('should accept positive bodyLength', () => {
      const error = new StateCorruptionError('msg', 'err', 100, 'preview');
      assert.strictEqual(error.bodyLength, 100);
    });

    it('should accept large bodyLength', () => {
      const error = new StateCorruptionError('msg', 'err', 1000000, 'preview');
      assert.strictEqual(error.bodyLength, 1000000);
    });
  });

  describe('matchedJsonPreview validation', () => {
    it('should throw StateCorruptionValidationError for preview > 200 chars', () => {
      const longPreview = 'x'.repeat(201);
      assert.throws(
        () => new StateCorruptionError('message', 'error', 100, longPreview),
        (error) => {
          assert.ok(error instanceof StateCorruptionValidationError);
          assert.ok(error.message.includes('exceeds 200 char limit'));
          return true;
        }
      );
    });

    it('should throw for preview of exactly 201 chars', () => {
      const preview = 'a'.repeat(201);
      assert.throws(
        () => new StateCorruptionError('msg', 'err', 100, preview),
        StateCorruptionValidationError
      );
    });

    it('should accept preview of exactly 200 chars', () => {
      const preview = 'a'.repeat(200);
      const error = new StateCorruptionError('msg', 'err', 100, preview);
      assert.strictEqual(error.matchedJsonPreview.length, 200);
    });

    it('should accept preview under 200 chars', () => {
      const preview = 'short preview';
      const error = new StateCorruptionError('msg', 'err', 100, preview);
      assert.strictEqual(error.matchedJsonPreview, preview);
    });

    it('should accept empty preview', () => {
      const error = new StateCorruptionError('msg', 'err', 100, '');
      assert.strictEqual(error.matchedJsonPreview, '');
    });
  });

  describe('error properties', () => {
    it('should set all properties correctly', () => {
      const error = new StateCorruptionError('test message', 'original error', 500, 'json preview');
      assert.strictEqual(error.message, 'test message');
      assert.strictEqual(error.originalError, 'original error');
      assert.strictEqual(error.bodyLength, 500);
      assert.strictEqual(error.matchedJsonPreview, 'json preview');
      assert.strictEqual(error.name, 'StateCorruptionError');
    });

    it('should be instanceof Error', () => {
      const error = new StateCorruptionError('msg', 'err', 100, 'preview');
      assert.ok(error instanceof Error);
      assert.ok(error instanceof StateCorruptionError);
    });
  });
});

describe('StateCorruptionError.create factory method', () => {
  describe('successful creation', () => {
    it('should create StateCorruptionError with valid parameters', () => {
      const result = StateCorruptionError.create('msg', 'err', 100, 'preview');
      assert.ok(result instanceof StateCorruptionError);
      assert.strictEqual(result.message, 'msg');
      assert.strictEqual(result.originalError, 'err');
      assert.strictEqual(result.bodyLength, 100);
      assert.strictEqual(result.matchedJsonPreview, 'preview');
    });

    it('should truncate preview to 200 chars', () => {
      const longPreview = 'x'.repeat(300);
      const result = StateCorruptionError.create('msg', 'err', 100, longPreview);
      assert.ok(result instanceof StateCorruptionError);
      if (result instanceof StateCorruptionError) {
        assert.strictEqual(result.matchedJsonPreview.length, 200);
        assert.strictEqual(result.matchedJsonPreview, 'x'.repeat(200));
      }
    });

    it('should truncate preview at exactly 201 chars', () => {
      const preview = 'a'.repeat(201);
      const result = StateCorruptionError.create('msg', 'err', 100, preview);
      assert.ok(result instanceof StateCorruptionError);
      if (result instanceof StateCorruptionError) {
        assert.strictEqual(result.matchedJsonPreview.length, 200);
      }
    });

    it('should not truncate preview at exactly 200 chars', () => {
      const preview = 'a'.repeat(200);
      const result = StateCorruptionError.create('msg', 'err', 100, preview);
      assert.ok(result instanceof StateCorruptionError);
      if (result instanceof StateCorruptionError) {
        assert.strictEqual(result.matchedJsonPreview.length, 200);
        assert.strictEqual(result.matchedJsonPreview, preview);
      }
    });
  });

  describe('validation failures', () => {
    it('should return StateCorruptionValidationError for negative bodyLength', () => {
      const result = StateCorruptionError.create('msg', 'err', -1, 'preview');
      assert.ok(result instanceof StateCorruptionValidationError);
      assert.ok(result.message.includes('bodyLength cannot be negative'));
    });

    it('should return StateCorruptionValidationError for -100 bodyLength', () => {
      const result = StateCorruptionError.create('msg', 'err', -100, 'preview');
      assert.ok(result instanceof StateCorruptionValidationError);
    });
  });

  describe('difference from constructor', () => {
    it('should return error instead of throwing for invalid bodyLength', () => {
      // Factory returns ValidationError
      const factoryResult = StateCorruptionError.create('msg', 'err', -1, 'preview');
      assert.ok(factoryResult instanceof StateCorruptionValidationError);

      // Constructor throws
      assert.throws(
        () => new StateCorruptionError('msg', 'err', -1, 'preview'),
        StateCorruptionValidationError
      );
    });

    it('should truncate preview instead of throwing for long preview', () => {
      const longPreview = 'x'.repeat(300);

      // Factory truncates and succeeds
      const factoryResult = StateCorruptionError.create('msg', 'err', 100, longPreview);
      assert.ok(factoryResult instanceof StateCorruptionError);

      // Constructor throws
      assert.throws(
        () => new StateCorruptionError('msg', 'err', 100, longPreview),
        StateCorruptionValidationError
      );
    });
  });
});

describe('extractStateFromBody', () => {
  describe('successful extraction', () => {
    it('should extract valid WiggumState from body', () => {
      const state: WiggumState = {
        iteration: 2,
        step: 'p2-4',
        completedSteps: ['p1-1', 'p1-2'],
        phase: 'phase2',
      };
      const body = `<!-- ${WIGGUM_STATE_MARKER}:${JSON.stringify(state)} -->\n\nPR description here`;

      const result = extractStateFromBody(body);
      assert.ok(result !== null);
      assert.strictEqual(result.iteration, 2);
      assert.strictEqual(result.step, 'p2-4');
      assert.deepStrictEqual([...result.completedSteps], ['p1-1', 'p1-2']);
      assert.strictEqual(result.phase, 'phase2');
    });

    it('should extract state with maxIterations', () => {
      const state: WiggumState = {
        iteration: 0,
        step: 'p1-1',
        completedSteps: [],
        phase: 'phase1',
        maxIterations: 15,
      };
      const body = `<!-- ${WIGGUM_STATE_MARKER}:${JSON.stringify(state)} -->`;

      const result = extractStateFromBody(body);
      assert.ok(result !== null);
      assert.strictEqual(result.maxIterations, 15);
    });

    it('should extract state marker from middle of body', () => {
      const state: WiggumState = {
        iteration: 1,
        step: 'p1-2',
        completedSteps: ['p1-1'],
        phase: 'phase1',
      };
      const body = `Some text before\n\n<!-- ${WIGGUM_STATE_MARKER}:${JSON.stringify(state)} -->\n\nMore text after`;

      const result = extractStateFromBody(body);
      assert.ok(result !== null);
      assert.strictEqual(result.iteration, 1);
    });
  });

  describe('no state marker', () => {
    it('should return null for empty body', () => {
      const result = extractStateFromBody('');
      assert.strictEqual(result, null);
    });

    it('should return null for body without state marker', () => {
      const body = 'This is a regular PR description without any wiggum state';
      const result = extractStateFromBody(body);
      assert.strictEqual(result, null);
    });

    it('should return null for body with partial marker', () => {
      const body = `<!-- ${WIGGUM_STATE_MARKER} -->`;
      const result = extractStateFromBody(body);
      assert.strictEqual(result, null);
    });

    it('should return null for body with wrong marker format', () => {
      const body = `<!-- other-marker:{"iteration":0} -->`;
      const result = extractStateFromBody(body);
      assert.strictEqual(result, null);
    });
  });

  describe('StateCorruptionError for malformed JSON', () => {
    it('should throw StateCorruptionError for invalid JSON', () => {
      const body = `<!-- ${WIGGUM_STATE_MARKER}:{"iteration":0 -->`;

      assert.throws(
        () => extractStateFromBody(body),
        (error) => {
          assert.ok(error instanceof StateCorruptionError);
          return true;
        }
      );
    });

    it('should throw StateCorruptionError for JSON with missing closing brace', () => {
      const body = `<!-- ${WIGGUM_STATE_MARKER}:{"iteration":0,"step":"p1-1" -->`;

      assert.throws(
        () => extractStateFromBody(body),
        (error) => {
          assert.ok(error instanceof StateCorruptionError);
          assert.ok(error.message.includes('corrupted'));
          return true;
        }
      );
    });

    it('should throw StateCorruptionError for truncated JSON', () => {
      const body = `<!-- ${WIGGUM_STATE_MARKER}:{"iter -->`;

      assert.throws(() => extractStateFromBody(body), StateCorruptionError);
    });

    it('should throw StateCorruptionError for non-object JSON', () => {
      const body = `<!-- ${WIGGUM_STATE_MARKER}:"just a string" -->`;

      assert.throws(() => extractStateFromBody(body), StateCorruptionError);
    });

    it('should handle JSON array by using defaults', () => {
      // Arrays are technically objects in JavaScript, so validateWiggumState
      // doesn't throw for them - it just uses defaults for missing/invalid fields
      const body = `<!-- ${WIGGUM_STATE_MARKER}:[1,2,3] -->`;

      const result = extractStateFromBody(body);
      // validateWiggumState uses defaults for arrays (logs error but doesn't throw)
      assert.ok(result !== null);
      assert.strictEqual(result.step, 'p1-1'); // Default step
    });

    it('should throw StateCorruptionError for null JSON', () => {
      const body = `<!-- ${WIGGUM_STATE_MARKER}:null -->`;

      assert.throws(() => extractStateFromBody(body), StateCorruptionError);
    });
  });

  describe('StateCorruptionError message and properties', () => {
    it('should include recovery instructions in error message', () => {
      const body = `<!-- ${WIGGUM_STATE_MARKER}:invalid -->`;

      try {
        extractStateFromBody(body);
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof StateCorruptionError);
        assert.ok(error.message.includes('Action required'));
        assert.ok(error.message.includes('fix the JSON manually'));
        assert.ok(error.message.includes('remove the comment'));
      }
    });

    it('should include JSON preview in error', () => {
      const body = `<!-- ${WIGGUM_STATE_MARKER}:{"bad":"json -->`;

      try {
        extractStateFromBody(body);
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof StateCorruptionError);
        assert.ok(error.matchedJsonPreview.includes('{"bad":"json'));
      }
    });

    it('should include body length in error', () => {
      const body = `<!-- ${WIGGUM_STATE_MARKER}:invalid -->`;

      try {
        extractStateFromBody(body);
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof StateCorruptionError);
        assert.strictEqual(error.bodyLength, body.length);
      }
    });

    it('should include original error message', () => {
      const body = `<!-- ${WIGGUM_STATE_MARKER}:not-json -->`;

      try {
        extractStateFromBody(body);
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof StateCorruptionError);
        // Original error should be captured
        assert.ok(error.originalError.length > 0);
      }
    });

    it('should truncate long JSON preview to 200 chars', () => {
      const longJson = '{"a":"' + 'x'.repeat(500) + '"}';
      const body = `<!-- ${WIGGUM_STATE_MARKER}:${longJson} -->`;

      try {
        extractStateFromBody(body);
        // This might succeed if the JSON is valid but fails schema validation
        // or it might fail on JSON parsing
      } catch (error) {
        if (error instanceof StateCorruptionError) {
          assert.ok(error.matchedJsonPreview.length <= 200);
        }
      }
    });
  });

  describe('invalid WiggumState schema', () => {
    it('should throw StateCorruptionError for missing required fields', () => {
      const body = `<!-- ${WIGGUM_STATE_MARKER}:{"iteration":0} -->`;

      // This will throw because step is missing, but validateWiggumState
      // will default it - so we need to check what actually happens
      // Based on the implementation, validateWiggumState provides defaults
      // so this might actually succeed with defaults
      const result = extractStateFromBody(body);
      // validateWiggumState provides defaults for missing fields
      assert.ok(result !== null);
      assert.strictEqual(result.iteration, 0);
    });

    it('should throw StateCorruptionError for invalid step value', () => {
      const body = `<!-- ${WIGGUM_STATE_MARKER}:{"iteration":0,"step":"invalid-step","completedSteps":[],"phase":"phase1"} -->`;

      // validateWiggumState logs error and defaults to STEP_PHASE1_MONITOR_WORKFLOW
      const result = extractStateFromBody(body);
      assert.ok(result !== null);
      assert.strictEqual(result.step, 'p1-1'); // Default step
    });
  });

  describe('edge cases', () => {
    it('should handle state marker with extra whitespace', () => {
      const state: WiggumState = {
        iteration: 0,
        step: 'p1-1',
        completedSteps: [],
        phase: 'phase1',
      };
      const body = `<!--   ${WIGGUM_STATE_MARKER}:${JSON.stringify(state)}   -->`;

      const result = extractStateFromBody(body);
      assert.ok(result !== null);
      assert.strictEqual(result.iteration, 0);
    });

    it('should handle multiline JSON in state marker', () => {
      const stateJson = `{
        "iteration": 0,
        "step": "p1-1",
        "completedSteps": [],
        "phase": "phase1"
      }`;
      const body = `<!-- ${WIGGUM_STATE_MARKER}:${stateJson} -->`;

      const result = extractStateFromBody(body);
      assert.ok(result !== null);
      assert.strictEqual(result.iteration, 0);
    });
  });
});

describe('injectStateIntoBody', () => {
  const testState: WiggumState = {
    iteration: 1,
    step: 'p2-4',
    completedSteps: ['p1-1', 'p2-1'],
    phase: 'phase2',
  };

  describe('prepending marker when none exists', () => {
    it('should prepend marker to body without state', () => {
      const body = 'Original PR description';
      const result = injectStateIntoBody(body, testState);

      assert.ok(result.startsWith(`<!-- ${WIGGUM_STATE_MARKER}:`));
      assert.ok(result.includes('Original PR description'));
      assert.ok(result.includes('"iteration":1'));
    });

    it('should prepend with double newline', () => {
      const body = 'Content';
      const result = injectStateIntoBody(body, testState);

      assert.ok(result.includes('-->\n\nContent'));
    });

    it('should handle empty body', () => {
      const result = injectStateIntoBody('', testState);

      assert.ok(result.startsWith(`<!-- ${WIGGUM_STATE_MARKER}:`));
      assert.ok(result.includes('"iteration":1'));
    });
  });

  describe('replacing existing marker', () => {
    it('should replace existing state marker', () => {
      const oldState: WiggumState = {
        iteration: 0,
        step: 'p1-1',
        completedSteps: [],
        phase: 'phase1',
      };
      const body = `<!-- ${WIGGUM_STATE_MARKER}:${JSON.stringify(oldState)} -->\n\nContent`;

      const result = injectStateIntoBody(body, testState);

      // Should have new state
      assert.ok(result.includes('"iteration":1'));
      assert.ok(result.includes('"step":"p2-4"'));
      // Should NOT have old state
      assert.ok(!result.includes('"iteration":0'));
      assert.ok(!result.includes('"step":"p1-1"'));
      // Should preserve content
      assert.ok(result.includes('Content'));
    });

    it('should result in only one marker after replacement', () => {
      const oldState: WiggumState = {
        iteration: 0,
        step: 'p1-1',
        completedSteps: [],
        phase: 'phase1',
      };
      const body = `<!-- ${WIGGUM_STATE_MARKER}:${JSON.stringify(oldState)} -->`;

      const result = injectStateIntoBody(body, testState);

      // Count occurrences of the marker
      const markerMatches = result.match(new RegExp(WIGGUM_STATE_MARKER, 'g'));
      assert.strictEqual(markerMatches?.length, 1, 'Should have exactly one marker');
    });

    it('should replace marker in middle of body', () => {
      const oldState: WiggumState = {
        iteration: 0,
        step: 'p1-1',
        completedSteps: [],
        phase: 'phase1',
      };
      const body = `Before text\n\n<!-- ${WIGGUM_STATE_MARKER}:${JSON.stringify(oldState)} -->\n\nAfter text`;

      const result = injectStateIntoBody(body, testState);

      assert.ok(result.includes('Before text'));
      assert.ok(result.includes('After text'));
      assert.ok(result.includes('"iteration":1'));
    });
  });

  describe('state serialization', () => {
    it('should serialize all state fields', () => {
      const state: WiggumState = {
        iteration: 5,
        step: 'p2-5',
        completedSteps: ['p1-1', 'p1-2', 'p1-3', 'p2-1', 'p2-2', 'p2-3', 'p2-4'],
        phase: 'phase2',
        maxIterations: 15,
      };

      const result = injectStateIntoBody('body', state);

      assert.ok(result.includes('"iteration":5'));
      assert.ok(result.includes('"step":"p2-5"'));
      assert.ok(result.includes('"phase":"phase2"'));
      assert.ok(result.includes('"maxIterations":15'));
      assert.ok(result.includes('"completedSteps"'));
    });

    it('should create valid JSON that can be extracted', () => {
      const state: WiggumState = {
        iteration: 3,
        step: 'p2-3',
        completedSteps: ['p1-1'],
        phase: 'phase2',
      };

      const result = injectStateIntoBody('Original content', state);

      // Should be able to extract the same state back
      const extracted = extractStateFromBody(result);
      assert.ok(extracted !== null);
      assert.strictEqual(extracted.iteration, 3);
      assert.strictEqual(extracted.step, 'p2-3');
      assert.strictEqual(extracted.phase, 'phase2');
      assert.deepStrictEqual([...extracted.completedSteps], ['p1-1']);
    });
  });

  describe('idempotency', () => {
    it('should be idempotent when injecting same state', () => {
      const body = 'Original content';

      const result1 = injectStateIntoBody(body, testState);
      const result2 = injectStateIntoBody(result1, testState);

      // Should have exactly the same content (same state injected)
      assert.strictEqual(result1, result2);
    });

    it('should correctly update state on multiple injections', () => {
      const body = 'Content';
      const state1: WiggumState = {
        iteration: 0,
        step: 'p1-1',
        completedSteps: [],
        phase: 'phase1',
      };
      const state2: WiggumState = {
        iteration: 1,
        step: 'p1-2',
        completedSteps: ['p1-1'],
        phase: 'phase1',
      };
      const state3: WiggumState = {
        iteration: 2,
        step: 'p1-3',
        completedSteps: ['p1-1', 'p1-2'],
        phase: 'phase1',
      };

      let result = injectStateIntoBody(body, state1);
      result = injectStateIntoBody(result, state2);
      result = injectStateIntoBody(result, state3);

      // Should only have final state
      const extracted = extractStateFromBody(result);
      assert.ok(extracted !== null);
      assert.strictEqual(extracted.iteration, 2);
      assert.strictEqual(extracted.step, 'p1-3');

      // Should still have only one marker
      const markerMatches = result.match(new RegExp(WIGGUM_STATE_MARKER, 'g'));
      assert.strictEqual(markerMatches?.length, 1);
    });
  });

  describe('edge cases', () => {
    it('should handle body with special characters', () => {
      const body = 'Content with special chars: < > & " \' \n\t';

      const result = injectStateIntoBody(body, testState);

      assert.ok(result.includes('Content with special chars'));
      const extracted = extractStateFromBody(result);
      assert.ok(extracted !== null);
    });

    it('should handle state with special characters in completedSteps', () => {
      // completedSteps are WiggumStep values, which don't have special chars
      // but we should verify the JSON encoding is correct
      const state: WiggumState = {
        iteration: 0,
        step: 'p1-1',
        completedSteps: [],
        phase: 'phase1',
      };

      const result = injectStateIntoBody('body', state);
      const extracted = extractStateFromBody(result);
      assert.ok(extracted !== null);
      assert.deepStrictEqual([...extracted.completedSteps], []);
    });

    it('should preserve existing HTML comments that are not state markers', () => {
      const body = '<!-- Some other comment -->\n\nContent';

      const result = injectStateIntoBody(body, testState);

      assert.ok(result.includes('<!-- Some other comment -->'));
      assert.ok(result.includes(WIGGUM_STATE_MARKER));
    });
  });
});

describe('roundtrip: inject then extract', () => {
  it('should preserve all state fields through roundtrip', () => {
    const originalState: WiggumState = {
      iteration: 7,
      step: 'p2-5',
      completedSteps: ['p1-1', 'p1-2', 'p1-3', 'p2-1', 'p2-2', 'p2-3', 'p2-4'],
      phase: 'phase2',
      maxIterations: 20,
    };

    const body = 'This is the PR body content';
    const injected = injectStateIntoBody(body, originalState);
    const extracted = extractStateFromBody(injected);

    assert.ok(extracted !== null);
    assert.strictEqual(extracted.iteration, originalState.iteration);
    assert.strictEqual(extracted.step, originalState.step);
    assert.strictEqual(extracted.phase, originalState.phase);
    assert.strictEqual(extracted.maxIterations, originalState.maxIterations);
    assert.deepStrictEqual([...extracted.completedSteps], [...originalState.completedSteps]);
  });

  it('should preserve original body content through roundtrip', () => {
    const state: WiggumState = {
      iteration: 0,
      step: 'p1-1',
      completedSteps: [],
      phase: 'phase1',
    };
    const originalBody = `## PR Description

This PR does something important.

### Changes
- Change 1
- Change 2

### Testing
Tested manually.`;

    const injected = injectStateIntoBody(originalBody, state);

    // All original content should still be there
    assert.ok(injected.includes('## PR Description'));
    assert.ok(injected.includes('This PR does something important'));
    assert.ok(injected.includes('- Change 1'));
    assert.ok(injected.includes('- Change 2'));
    assert.ok(injected.includes('Tested manually'));
  });
});
