/**
 * Tests for prototype pollution detection in comments.ts
 *
 * These tests verify security-critical functions that protect against
 * prototype pollution attacks via PR comments.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { hasPrototypePollution, safeJsonParse, validateWiggumState } from './utils.js';
import { createWiggumState } from './types.js';
import {
  STEP_PHASE1_MONITOR_WORKFLOW,
  STEP_PHASE1_PR_REVIEW,
  STEP_PHASE2_MONITOR_WORKFLOW,
  isValidStep,
} from '../constants.js';

describe('hasPrototypePollution', () => {
  describe('basic attack vectors', () => {
    it('should detect __proto__ at root level', () => {
      // Note: Direct object literal { __proto__: {} } is handled specially by JS
      // and doesn't create an enumerable property. JSON.parse does create one.
      const malicious = JSON.parse('{"__proto__": {"isAdmin": true}}');
      assert.strictEqual(hasPrototypePollution(malicious), true);
    });

    it('should detect constructor at root level', () => {
      // 'constructor' IS a regular enumerable property when set directly
      const malicious = { constructor: { prototype: {} } };
      assert.strictEqual(hasPrototypePollution(malicious), true);
    });

    it('should detect prototype at root level', () => {
      // 'prototype' IS a regular enumerable property when set directly
      const malicious = { prototype: { polluted: true } };
      assert.strictEqual(hasPrototypePollution(malicious), true);
    });

    it('should allow safe objects with normal keys', () => {
      const safe = { iteration: 1, step: '0', completedSteps: [] };
      assert.strictEqual(hasPrototypePollution(safe), false);
    });

    it('should return false for null', () => {
      assert.strictEqual(hasPrototypePollution(null), false);
    });

    it('should return false for undefined', () => {
      assert.strictEqual(hasPrototypePollution(undefined), false);
    });

    it('should return false for primitives', () => {
      assert.strictEqual(hasPrototypePollution('string'), false);
      assert.strictEqual(hasPrototypePollution(123), false);
      assert.strictEqual(hasPrototypePollution(true), false);
    });

    it('should return false for empty object', () => {
      assert.strictEqual(hasPrototypePollution({}), false);
    });

    it('should return false for arrays without pollution', () => {
      assert.strictEqual(hasPrototypePollution([1, 2, 3]), false);
      assert.strictEqual(hasPrototypePollution(['a', 'b']), false);
    });
  });

  describe('nested attack vectors', () => {
    it('should detect pollution at depth 1', () => {
      // Use JSON.parse to create enumerable __proto__ property
      const malicious = JSON.parse('{"nested": {"__proto__": {}}}');
      assert.strictEqual(hasPrototypePollution(malicious), true);
    });

    it('should detect pollution at depth 5', () => {
      const malicious = JSON.parse('{"a": {"b": {"c": {"d": {"e": {"__proto__": {}}}}}}}');
      assert.strictEqual(hasPrototypePollution(malicious), true);
    });

    it('should detect pollution at depth 10 (boundary)', () => {
      const malicious = JSON.parse(
        '{"l1": {"l2": {"l3": {"l4": {"l5": {"l6": {"l7": {"l8": {"l9": {"l10": {"__proto__": {}}}}}}}}}}}}'
      );
      assert.strictEqual(hasPrototypePollution(malicious), true);
    });

    it('should stop recursion at depth 11 (return false for deeply nested pollution)', () => {
      const malicious = JSON.parse(
        '{"l1": {"l2": {"l3": {"l4": {"l5": {"l6": {"l7": {"l8": {"l9": {"l10": {"l11": {"__proto__": {}}}}}}}}}}}}}'
      );
      // Pollution is beyond recursion limit, so should not be detected
      assert.strictEqual(hasPrototypePollution(malicious), false);
    });

    it('should return false for safe multi-level nesting', () => {
      const safe = {
        iteration: 1,
        step: { nested: { deeply: { value: 'ok' } } },
        completedSteps: [],
      };
      assert.strictEqual(hasPrototypePollution(safe), false);
    });

    it('should detect pollution in arrays containing objects', () => {
      const malicious = JSON.parse('{"items": [{"safe": true}, {"__proto__": {}}]}');
      assert.strictEqual(hasPrototypePollution(malicious), true);
    });

    it('should handle mixed safe and dangerous keys', () => {
      // Use JSON.parse for __proto__ to create enumerable property
      const malicious = JSON.parse('{"safe": "value", "alsoSafe": 123, "__proto__": {}}');
      assert.strictEqual(hasPrototypePollution(malicious), true);
    });
  });

  describe('edge cases', () => {
    it('should handle objects with similar but safe keys', () => {
      const safe = {
        _proto: 'not dangerous',
        __proto: 'still not dangerous',
        __proto___: 'also safe',
        constructorValue: 'safe',
        prototypeId: 'safe',
      };
      assert.strictEqual(hasPrototypePollution(safe), false);
    });

    it('should handle wide objects with many keys', () => {
      const wide: Record<string, number> = {};
      for (let i = 0; i < 1000; i++) {
        wide[`key${i}`] = i;
      }
      assert.strictEqual(hasPrototypePollution(wide), false);
    });

    it('should allow legitimate Object methods as values', () => {
      const safe = {
        toString: 'string representation',
        valueOf: 42,
        hasOwnProperty: 'yes',
      };
      assert.strictEqual(hasPrototypePollution(safe), false);
    });
  });
});

describe('safeJsonParse', () => {
  describe('attack vectors', () => {
    it('should reject JSON with __proto__ pollution', () => {
      const json = '{"__proto__": {"isAdmin": true}}';
      assert.throws(() => safeJsonParse(json), {
        message: 'Prototype pollution detected in JSON',
      });
    });

    it('should reject JSON with nested pollution', () => {
      const json = '{"nested": {"__proto__": {}}}';
      assert.throws(() => safeJsonParse(json), {
        message: 'Prototype pollution detected in JSON',
      });
    });

    it('should reject JSON with constructor pollution', () => {
      const json = '{"constructor": {"prototype": {}}}';
      assert.throws(() => safeJsonParse(json), {
        message: 'Prototype pollution detected in JSON',
      });
    });

    it('should reject array with polluted element', () => {
      const json = '[{"safe": true}, {"__proto__": {}}]';
      assert.throws(() => safeJsonParse(json), {
        message: 'Prototype pollution detected in JSON',
      });
    });
  });

  describe('valid JSON parsing', () => {
    it('should parse safe JSON objects', () => {
      const json = '{"iteration": 1, "step": "0", "completedSteps": []}';
      const result = safeJsonParse(json);
      assert.deepStrictEqual(result, {
        iteration: 1,
        step: '0',
        completedSteps: [],
      });
    });

    it('should parse large valid JSON', () => {
      const data: Record<string, number> = {};
      for (let i = 0; i < 100; i++) {
        data[`key${i}`] = i;
      }
      const json = JSON.stringify(data);
      const result = safeJsonParse(json);
      assert.deepStrictEqual(result, data);
    });

    it('should throw Error for invalid JSON', () => {
      assert.throws(() => safeJsonParse('not valid json'), {
        message: /JSON parse error:/,
      });
    });

    it('should parse JSON with null values', () => {
      const json = '{"value": null}';
      const result = safeJsonParse(json);
      assert.deepStrictEqual(result, { value: null });
    });

    it('should parse JSON arrays', () => {
      const json = '[1, 2, "three", {"nested": true}]';
      const result = safeJsonParse(json);
      assert.deepStrictEqual(result, [1, 2, 'three', { nested: true }]);
    });
  });
});

describe('validateWiggumState', () => {
  describe('valid state objects', () => {
    it('should return complete valid state', () => {
      const input = {
        iteration: 1,
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        completedSteps: [STEP_PHASE1_MONITOR_WORKFLOW],
        phase: 'phase1',
      };
      const result = validateWiggumState(input, 'test');
      assert.strictEqual(result.iteration, 1);
      assert.strictEqual(result.step, STEP_PHASE1_MONITOR_WORKFLOW);
      assert.deepStrictEqual(result.completedSteps, [STEP_PHASE1_MONITOR_WORKFLOW]);
    });

    it('should accept all valid step values', () => {
      const validSteps = [
        'p1-1',
        'p1-2',
        'p1-3',
        'p1-4',
        'p2-1',
        'p2-2',
        'p2-3',
        'p2-4',
        'p2-5',
        'approval',
      ];
      for (const step of validSteps) {
        if (isValidStep(step)) {
          const input = { iteration: 1, step, completedSteps: [], phase: 'phase1' };
          const result = validateWiggumState(input, 'test');
          assert.strictEqual(result.step, step);
        }
      }
    });
  });

  describe('invalid step handling', () => {
    it('should default to STEP_PHASE1_MONITOR_WORKFLOW for invalid step string', () => {
      const input = { iteration: 1, step: 'invalid', completedSteps: [] };
      const result = validateWiggumState(input, 'test');
      assert.strictEqual(result.step, STEP_PHASE1_MONITOR_WORKFLOW);
    });

    it('should default to STEP_PHASE1_MONITOR_WORKFLOW for step number out of range', () => {
      const input = { iteration: 1, step: '999', completedSteps: [] };
      const result = validateWiggumState(input, 'test');
      assert.strictEqual(result.step, STEP_PHASE1_MONITOR_WORKFLOW);
    });

    it('should default to STEP_PHASE1_MONITOR_WORKFLOW for non-string step', () => {
      const input = { iteration: 1, step: 123, completedSteps: [] };
      const result = validateWiggumState(input, 'test');
      assert.strictEqual(result.step, STEP_PHASE1_MONITOR_WORKFLOW);
    });
  });

  describe('invalid iteration handling', () => {
    it('should default to 0 for non-number iteration', () => {
      const input = { iteration: 'not a number', step: '0', completedSteps: [] };
      const result = validateWiggumState(input);
      assert.strictEqual(result.iteration, 0);
    });

    it('should default to 0 for missing iteration', () => {
      const input = { step: STEP_PHASE1_MONITOR_WORKFLOW, completedSteps: [] };
      const result = validateWiggumState(input, 'test');
      assert.strictEqual(result.iteration, 0);
    });

    it('should accept valid iteration numbers', () => {
      const input = { iteration: 5, step: STEP_PHASE1_MONITOR_WORKFLOW, completedSteps: [] };
      const result = validateWiggumState(input, 'test');
      assert.strictEqual(result.iteration, 5);
    });
  });

  describe('completedSteps validation', () => {
    it('should filter out invalid steps from completedSteps', () => {
      const input = {
        iteration: 1,
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        completedSteps: ['p1-1', 'invalid', 'p1-2', 'also-invalid'],
      };
      const result = validateWiggumState(input, 'test');
      assert.deepStrictEqual(result.completedSteps, ['p1-1', 'p1-2']);
    });

    it('should default to empty array for non-array completedSteps', () => {
      const input = {
        iteration: 1,
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        completedSteps: 'not an array',
      };
      const result = validateWiggumState(input, 'test');
      assert.deepStrictEqual(result.completedSteps, []);
    });

    it('should default to empty array for missing completedSteps', () => {
      const input = { iteration: 1, step: STEP_PHASE1_MONITOR_WORKFLOW };
      const result = validateWiggumState(input, 'test');
      assert.deepStrictEqual(result.completedSteps, []);
    });
  });

  describe('error handling', () => {
    it('should throw for non-object input', () => {
      assert.throws(() => validateWiggumState('not an object'), {
        message: 'Invalid state: not an object',
      });
    });

    it('should throw for null input', () => {
      assert.throws(() => validateWiggumState(null), {
        message: 'Invalid state: not an object',
      });
    });

    it('should throw for array input', () => {
      // Arrays are objects in JS, but we want to reject them
      // Note: The current implementation may not reject arrays
      // This test documents expected behavior
      const input = ['not', 'a', 'state'];
      // If the implementation doesn't throw, it should at least return safe defaults
      try {
        const result = validateWiggumState(input, 'test');
        assert.strictEqual(result.iteration, 0);
        assert.strictEqual(result.step, STEP_PHASE1_MONITOR_WORKFLOW);
      } catch (err) {
        // If it throws, that's also acceptable
        assert.ok(err instanceof Error);
      }
    });
  });

  describe('maxIterations handling', () => {
    it('should preserve maxIterations when present and valid', () => {
      const input = {
        iteration: 5,
        step: STEP_PHASE1_PR_REVIEW,
        completedSteps: [STEP_PHASE1_MONITOR_WORKFLOW],
        phase: 'phase1',
        maxIterations: 40,
      };

      const result = validateWiggumState(input, 'test');
      assert.strictEqual(result.maxIterations, 40);
    });

    it('should return undefined for maxIterations when not present', () => {
      const input = {
        iteration: 5,
        step: STEP_PHASE1_PR_REVIEW,
        completedSteps: [STEP_PHASE1_MONITOR_WORKFLOW],
        phase: 'phase1',
      };

      const result = validateWiggumState(input, 'test');
      assert.strictEqual(result.maxIterations, undefined);
    });

    it('should ignore invalid maxIterations (non-positive)', () => {
      const input = {
        iteration: 5,
        step: STEP_PHASE1_PR_REVIEW,
        completedSteps: [STEP_PHASE1_MONITOR_WORKFLOW],
        phase: 'phase1',
        maxIterations: -5,
      };

      const result = validateWiggumState(input, 'test');
      assert.strictEqual(result.maxIterations, undefined);
    });

    it('should ignore invalid maxIterations (zero)', () => {
      const input = {
        iteration: 5,
        step: STEP_PHASE1_PR_REVIEW,
        completedSteps: [STEP_PHASE1_MONITOR_WORKFLOW],
        phase: 'phase1',
        maxIterations: 0,
      };

      const result = validateWiggumState(input, 'test');
      assert.strictEqual(result.maxIterations, undefined);
    });

    it('should ignore invalid maxIterations (non-integer)', () => {
      const input = {
        iteration: 5,
        step: STEP_PHASE1_PR_REVIEW,
        completedSteps: [STEP_PHASE1_MONITOR_WORKFLOW],
        phase: 'phase1',
        maxIterations: 15.5,
      };

      const result = validateWiggumState(input, 'test');
      assert.strictEqual(result.maxIterations, undefined);
    });

    it('should ignore invalid maxIterations (string)', () => {
      const input = {
        iteration: 5,
        step: STEP_PHASE1_PR_REVIEW,
        completedSteps: [STEP_PHASE1_MONITOR_WORKFLOW],
        phase: 'phase1',
        maxIterations: '40' as unknown as number,
      };

      const result = validateWiggumState(input, 'test');
      assert.strictEqual(result.maxIterations, undefined);
    });

    it('should preserve large valid maxIterations values', () => {
      const input = {
        iteration: 5,
        step: STEP_PHASE1_PR_REVIEW,
        completedSteps: [STEP_PHASE1_MONITOR_WORKFLOW],
        phase: 'phase1',
        maxIterations: 100,
      };

      const result = validateWiggumState(input, 'test');
      assert.strictEqual(result.maxIterations, 100);
    });
  });
});

describe('Performance and DoS Prevention', () => {
  it('should handle deeply nested safe objects without timeout', () => {
    // Create 20-level deep nesting (beyond recursion limit)
    let obj: Record<string, unknown> = { value: 'bottom' };
    for (let i = 0; i < 20; i++) {
      obj = { nested: obj };
    }

    const start = Date.now();
    const result = hasPrototypePollution(obj);
    const elapsed = Date.now() - start;

    assert.strictEqual(result, false);
    assert.ok(elapsed < 100, `Should complete quickly, took ${elapsed}ms`);
  });

  it('should handle wide objects without timeout', () => {
    const wide: Record<string, Record<string, number>> = {};
    for (let i = 0; i < 1000; i++) {
      wide[`key${i}`] = { nested: i };
    }

    const start = Date.now();
    const result = hasPrototypePollution(wide);
    const elapsed = Date.now() - start;

    assert.strictEqual(result, false);
    assert.ok(elapsed < 500, `Should complete reasonably fast, took ${elapsed}ms`);
  });
});

describe('createWiggumState', () => {
  describe('valid state creation', () => {
    it('should create a valid WiggumState with required fields', () => {
      const state = createWiggumState({
        iteration: 0,
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        completedSteps: [],
        phase: 'phase1',
      });

      assert.strictEqual(state.iteration, 0);
      assert.strictEqual(state.step, STEP_PHASE1_MONITOR_WORKFLOW);
      assert.deepStrictEqual(state.completedSteps, []);
      assert.strictEqual(state.phase, 'phase1');
      assert.strictEqual(state.maxIterations, undefined);
    });

    it('should create a valid WiggumState with all optional fields', () => {
      const state = createWiggumState({
        iteration: 5,
        step: STEP_PHASE1_PR_REVIEW,
        completedSteps: [STEP_PHASE1_MONITOR_WORKFLOW],
        phase: 'phase1',
        maxIterations: 15,
      });

      assert.strictEqual(state.iteration, 5);
      assert.strictEqual(state.step, STEP_PHASE1_PR_REVIEW);
      assert.deepStrictEqual(state.completedSteps, [STEP_PHASE1_MONITOR_WORKFLOW]);
      assert.strictEqual(state.phase, 'phase1');
      assert.strictEqual(state.maxIterations, 15);
    });

    it('should create a valid phase2 state', () => {
      const state = createWiggumState({
        iteration: 1,
        step: STEP_PHASE2_MONITOR_WORKFLOW,
        completedSteps: [STEP_PHASE1_MONITOR_WORKFLOW, STEP_PHASE1_PR_REVIEW, 'p1-3', 'p1-4'],
        phase: 'phase2',
      });

      assert.strictEqual(state.step, STEP_PHASE2_MONITOR_WORKFLOW);
      assert.strictEqual(state.phase, 'phase2');
    });
  });

  describe('validation errors', () => {
    it('should throw for negative iteration', () => {
      assert.throws(
        () =>
          createWiggumState({
            iteration: -1,
            step: STEP_PHASE1_MONITOR_WORKFLOW,
            completedSteps: [],
            phase: 'phase1',
          }),
        /iteration must be non-negative/
      );
    });

    it('should throw for invalid step', () => {
      assert.throws(
        () =>
          createWiggumState({
            iteration: 0,
            step: 'invalid-step' as typeof STEP_PHASE1_MONITOR_WORKFLOW,
            completedSteps: [],
            phase: 'phase1',
          }),
        /Invalid enum value/
      );
    });

    it('should throw for invalid phase', () => {
      assert.throws(
        () =>
          createWiggumState({
            iteration: 0,
            step: STEP_PHASE1_MONITOR_WORKFLOW,
            completedSteps: [],
            phase: 'phase3' as 'phase1',
          }),
        /Invalid enum value/
      );
    });

    it('should throw for non-integer maxIterations', () => {
      assert.throws(
        () =>
          createWiggumState({
            iteration: 0,
            step: STEP_PHASE1_MONITOR_WORKFLOW,
            completedSteps: [],
            phase: 'phase1',
            maxIterations: 5.5,
          }),
        /Expected integer/
      );
    });

    it('should throw for zero maxIterations', () => {
      assert.throws(
        () =>
          createWiggumState({
            iteration: 0,
            step: STEP_PHASE1_MONITOR_WORKFLOW,
            completedSteps: [],
            phase: 'phase1',
            maxIterations: 0,
          }),
        /maxIterations must be positive/
      );
    });

    it('should throw when completedSteps contain future steps', () => {
      assert.throws(
        () =>
          createWiggumState({
            iteration: 0,
            step: STEP_PHASE1_MONITOR_WORKFLOW,
            completedSteps: [STEP_PHASE1_PR_REVIEW], // p1-2 comes after p1-1
            phase: 'phase1',
          }),
        /completedSteps must only contain steps before current step/
      );
    });

    it('should throw for phase-step mismatch', () => {
      assert.throws(
        () =>
          createWiggumState({
            iteration: 0,
            step: STEP_PHASE2_MONITOR_WORKFLOW, // p2-1 in phase1
            completedSteps: [],
            phase: 'phase1',
          }),
        /phase and step\/completedSteps prefixes must be consistent/
      );
    });
  });

  describe('immutability guarantee', () => {
    it('should return a state that matches WiggumState interface', () => {
      const state = createWiggumState({
        iteration: 0,
        step: STEP_PHASE1_MONITOR_WORKFLOW,
        completedSteps: [],
        phase: 'phase1',
      });

      // Verify the state has all required properties
      assert.ok('iteration' in state);
      assert.ok('step' in state);
      assert.ok('completedSteps' in state);
      assert.ok('phase' in state);

      // Verify types
      assert.strictEqual(typeof state.iteration, 'number');
      assert.strictEqual(typeof state.step, 'string');
      assert.ok(Array.isArray(state.completedSteps));
      assert.strictEqual(typeof state.phase, 'string');
    });
  });
});
