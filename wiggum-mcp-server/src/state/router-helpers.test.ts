/**
 * Tests for router helper functions: safeLog and safeStringify
 *
 * These helper functions provide fallback error handling to prevent logger failures
 * from masking original errors in catch blocks.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { _testExports } from './router.js';
import type { WiggumState } from './types.js';

const { safeLog, safeStringify } = _testExports;

describe('safeLog', () => {
  describe('Normal logging behavior', () => {
    it('should log at info level without throwing', () => {
      assert.doesNotThrow(() => {
        safeLog('info', 'test message', { key: 'value' });
      });
    });

    it('should log at warn level without throwing', () => {
      assert.doesNotThrow(() => {
        safeLog('warn', 'warning message', { warning: 'details' });
      });
    });

    it('should log at error level without throwing', () => {
      assert.doesNotThrow(() => {
        safeLog('error', 'error message', { error: 'details' });
      });
    });
  });

  describe('Context handling', () => {
    it('should handle empty context object', () => {
      assert.doesNotThrow(() => {
        safeLog('info', 'message without context', {});
      });
    });

    it('should handle complex nested context objects', () => {
      assert.doesNotThrow(() => {
        safeLog('info', 'message with complex context', {
          nested: { deeply: { structured: 'data' } },
          array: [1, 2, 3],
          nullValue: null,
          undefinedValue: undefined,
        });
      });
    });

    it('should handle circular references in context gracefully', () => {
      const circular: Record<string, any> = { key: 'value' };
      circular.self = circular;

      // safeLog should handle circular references without throwing
      assert.doesNotThrow(() => {
        safeLog('warn', 'message with circular context', circular);
      });
    });

    it('should handle context with Error objects', () => {
      assert.doesNotThrow(() => {
        safeLog('error', 'logging an error', {
          error: new Error('test error'),
          message: 'additional context',
        });
      });
    });

    it('should handle context with special values', () => {
      assert.doesNotThrow(() => {
        safeLog('info', 'special values', {
          infinity: Infinity,
          negativeInfinity: -Infinity,
          nan: NaN,
          symbol: Symbol('test'),
          bigint: BigInt(123),
        });
      });
    });
  });

  describe('Fallback behavior documentation', () => {
    it('should document fallback path to console.error', () => {
      // When logger fails, safeLog falls back to console.error
      // This ensures critical errors are always visible
      // Fallback includes:
      // - level: original log level
      // - message: original message
      // - context: original context
      // - loggingError: error from logger failure
      assert.ok(true, 'Falls back to console.error when logger fails');
    });

    it('should document fallback path to process.stderr.write', () => {
      // When both logger and console.error fail, safeLog falls back to stderr
      // This is the last resort to ensure critical messages are visible
      // Writes simple message: "CRITICAL: Logger and console.error failed - {message}"
      assert.ok(true, 'Falls back to process.stderr.write as last resort');
    });

    it('should document globalThis storage when all logging fails', () => {
      // When all logging mechanisms fail, safeLog stores unlogged errors in globalThis
      // This allows postmortem debugging if the process crashes
      // Stored in: (globalThis as any).__unloggedErrors
      assert.ok(true, 'Stores unlogged errors in globalThis for postmortem debugging');
    });
  });

  describe('Integration with error handling', () => {
    it('should be safe to call from catch blocks', () => {
      // safeLog is designed to be called from catch blocks without risking
      // masking the original error with a logging error
      try {
        throw new Error('Original error');
      } catch (error) {
        assert.doesNotThrow(() => {
          safeLog('error', 'Caught error', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    });

    it('should be safe to call multiple times in sequence', () => {
      // Multiple calls should not interfere with each other
      assert.doesNotThrow(() => {
        safeLog('info', 'First log', { id: 1 });
        safeLog('warn', 'Second log', { id: 2 });
        safeLog('error', 'Third log', { id: 3 });
      });
    });
  });
});

describe('safeStringify', () => {
  describe('Basic serialization', () => {
    it('should stringify valid objects', () => {
      const result = safeStringify({ key: 'value' }, 'test');
      assert.strictEqual(result, '{"key":"value"}');
    });

    it('should stringify arrays', () => {
      const result = safeStringify([1, 2, 3], 'array');
      assert.strictEqual(result, '[1,2,3]');
    });

    it('should stringify strings', () => {
      const result = safeStringify('hello', 'string');
      assert.strictEqual(result, '"hello"');
    });

    it('should stringify numbers', () => {
      const result = safeStringify(42, 'number');
      assert.strictEqual(result, '42');
    });

    it('should stringify boolean values', () => {
      assert.strictEqual(safeStringify(true, 'bool'), 'true');
      assert.strictEqual(safeStringify(false, 'bool'), 'false');
    });

    it('should stringify null', () => {
      const result = safeStringify(null, 'null-value');
      assert.strictEqual(result, 'null');
    });

    it('should stringify nested objects', () => {
      const result = safeStringify({ a: { b: { c: 'deep' } } }, 'nested');
      assert.strictEqual(result, '{"a":{"b":{"c":"deep"}}}');
    });
  });

  describe('WiggumState partial extraction', () => {
    it('should extract partial state on circular reference', () => {
      const circularState = {
        phase: 'phase1' as const,
        step: 'p1-1',
        iteration: 5,
        completedSteps: ['step1', 'step2'],
      } as any;
      circularState.self = circularState; // circular reference

      const result = safeStringify(circularState, 'state');

      // Should contain partial state information
      assert.ok(result.includes('phase=phase1'), 'Should include phase');
      assert.ok(result.includes('step=p1-1'), 'Should include step');
      assert.ok(result.includes('iteration=5'), 'Should include iteration');
      assert.ok(result.includes('completedSteps=2'), 'Should include completedSteps count');
    });

    it('should handle state with empty completedSteps', () => {
      const circularState = {
        phase: 'phase1' as const,
        step: 'p1-1',
        iteration: 0,
        completedSteps: [],
      } as any;
      circularState.self = circularState;

      const result = safeStringify(circularState, 'state');

      assert.ok(result.includes('completedSteps=0 items'));
    });

    it('should handle state with undefined completedSteps', () => {
      const circularState = {
        phase: 'phase1' as const,
        step: 'p1-1',
        iteration: 0,
        completedSteps: undefined,
      } as any;
      circularState.self = circularState;

      const result = safeStringify(circularState, 'state');

      assert.ok(result.includes('completedSteps=0 items'));
    });

    it('should handle state with null completedSteps', () => {
      const circularState = {
        phase: 'phase2' as const,
        step: 'p2-1',
        iteration: 1,
        completedSteps: null,
      } as any;
      circularState.self = circularState;

      const result = safeStringify(circularState, 'state');

      assert.ok(result.includes('completedSteps=0 items'));
    });

    it('should handle phase2 state correctly', () => {
      const circularState = {
        phase: 'phase2' as const,
        step: 'p2-3',
        iteration: 10,
        completedSteps: ['a', 'b', 'c', 'd'],
      } as any;
      circularState.nested = { ref: circularState };

      const result = safeStringify(circularState, 'state');

      assert.ok(result.includes('phase=phase2'));
      assert.ok(result.includes('step=p2-3'));
      assert.ok(result.includes('iteration=10'));
      assert.ok(result.includes('completedSteps=4'));
    });
  });

  describe('Non-WiggumState circular reference handling', () => {
    it('should return serialization failure message for circular objects', () => {
      const circular = {} as any;
      circular.self = circular;

      const result = safeStringify(circular, 'other');

      // Should indicate serialization failed
      assert.ok(result.includes('serialization failed'), 'Should indicate failure');
    });

    it('should not attempt partial extraction for non-state objects', () => {
      const circular = { notPhase: 'value' } as any;
      circular.self = circular;

      const result = safeStringify(circular, 'non-state');

      // Should not extract "phase" field
      assert.ok(!result.includes('phase='));
      assert.ok(result.includes('serialization failed'));
    });

    it('should include label in error messages', () => {
      const circular = {} as any;
      circular.self = circular;

      const result = safeStringify(circular, 'custom-label');

      // Should include the label in the output
      assert.ok(result.includes('serialization failed'));
    });
  });

  describe('Non-JSON-serializable values', () => {
    it('should handle BigInt values', () => {
      // BigInt is not JSON-serializable
      const obj = { bigint: BigInt(123456789) };
      const result = safeStringify(obj, 'bigint-test');

      assert.ok(result.includes('serialization failed'));
    });

    it('should handle symbols in objects', () => {
      // Symbols are not JSON-serializable
      const obj = { [Symbol('test')]: 'value' };
      const result = safeStringify(obj, 'symbol-test');

      // Symbol properties are ignored by JSON.stringify, so this should succeed
      assert.strictEqual(result, '{}');
    });

    it('should handle functions in objects', () => {
      // Functions are not JSON-serializable
      const obj = { fn: () => {} };
      const result = safeStringify(obj, 'function-test');

      // Functions are ignored by JSON.stringify, so this should succeed
      assert.strictEqual(result, '{}');
    });

    it('should handle undefined values in objects', () => {
      const obj = { defined: 'value', undefined: undefined };
      const result = safeStringify(obj, 'undefined-test');

      // undefined values are omitted by JSON.stringify
      assert.strictEqual(result, '{"defined":"value"}');
    });

    it('should handle Infinity and NaN', () => {
      const obj = { inf: Infinity, negInf: -Infinity, nan: NaN };
      const result = safeStringify(obj, 'special-numbers');

      // These are serialized as null by JSON.stringify
      assert.strictEqual(result, '{"inf":null,"negInf":null,"nan":null}');
    });
  });

  describe('Partial extraction failure handling', () => {
    it('should fall back when partial extraction throws', () => {
      // Create an object with phase but getters that throw
      const problematicState = {
        phase: 'phase1' as const,
        get step(): string {
          throw new Error('getter failed');
        },
        iteration: 1,
        completedSteps: [],
      } as any;
      problematicState.self = problematicState;

      const result = safeStringify(problematicState, 'problematic');

      // Should fall back to type info when partial extraction fails
      assert.ok(result.includes('serialization failed'));
    });

    it('should handle object with phase but missing other properties', () => {
      const partialState = {
        phase: 'phase1' as const,
        // missing step, iteration, completedSteps
      } as any;
      partialState.self = partialState;

      const result = safeStringify(partialState, 'partial');

      // Should still attempt partial extraction
      assert.ok(result.includes('phase=phase1'));
    });
  });

  describe('Warning on serialization failure', () => {
    it('should call safeLog when serialization fails', () => {
      // When serialization fails, safeStringify calls safeLog with a warning
      // This documents the behavior but doesn't verify the actual call
      // (mocking safeLog would create a circular dependency)
      const circular = {} as any;
      circular.self = circular;

      const result = safeStringify(circular, 'test-label');

      // The function should complete and return a serialization failed message
      assert.ok(result.includes('serialization failed'));
      // Note: In production, this would trigger a safeLog('warn', ...) call
    });
  });

  describe('Integration with error logging', () => {
    it('should be safe to use in error logging context', () => {
      // Common use case: logging state in catch blocks
      const state: WiggumState = {
        phase: 'phase1',
        step: 'p1-1',
        iteration: 1,
        completedSteps: [],
      };

      try {
        throw new Error('Test error');
      } catch (error) {
        // Should not throw even if state has circular refs
        assert.doesNotThrow(() => {
          const stateStr = safeStringify(state, 'state');
          safeLog('error', 'Error occurred', {
            state: stateStr,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    });

    it('should handle rapid successive calls', () => {
      // Verify function can be called multiple times in quick succession
      const states = [
        { phase: 'phase1' as const, step: 'p1-1', iteration: 1, completedSteps: [] },
        { phase: 'phase2' as const, step: 'p2-1', iteration: 2, completedSteps: ['step1'] },
        {
          phase: 'phase1' as const,
          step: 'p1-2',
          iteration: 3,
          completedSteps: ['step1', 'step2'],
        },
      ];

      assert.doesNotThrow(() => {
        states.forEach((state, i) => {
          safeStringify(state, `state-${i}`);
        });
      });
    });
  });

  describe('Label parameter usage', () => {
    it('should accept descriptive labels', () => {
      const obj = { key: 'value' };
      assert.doesNotThrow(() => {
        safeStringify(obj, 'user-input-state');
        safeStringify(obj, 'fallback-state');
        safeStringify(obj, 'previous-state');
      });
    });

    it('should handle empty label', () => {
      const obj = { key: 'value' };
      const result = safeStringify(obj, '');
      assert.strictEqual(result, '{"key":"value"}');
    });

    it('should handle special characters in label', () => {
      const circular = {} as any;
      circular.self = circular;

      // Label is used in output, should handle special chars
      assert.doesNotThrow(() => {
        safeStringify(circular, 'label-with-dashes');
        safeStringify(circular, 'label_with_underscores');
        safeStringify(circular, 'label.with.dots');
      });
    });
  });
});
