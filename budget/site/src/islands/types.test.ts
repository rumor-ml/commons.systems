import { describe, it, expect } from 'vitest';
import { createWeeklyBudgetComparison, weekId } from './types';

describe('createWeeklyBudgetComparison', () => {
  describe('error throwing for invalid inputs', () => {
    it('should throw error when actual is NaN', () => {
      expect(() =>
        createWeeklyBudgetComparison(weekId('2025-W01'), 'groceries', NaN, -500, 100)
      ).toThrow('Budget comparison failed: Invalid numeric value for groceries');
    });

    it('should throw error when target is NaN', () => {
      expect(() =>
        createWeeklyBudgetComparison(weekId('2025-W01'), 'groceries', -450, NaN, 100)
      ).toThrow('Budget comparison failed: Invalid numeric value for groceries');
    });

    it('should throw error when rolloverAccumulated is NaN', () => {
      expect(() =>
        createWeeklyBudgetComparison(weekId('2025-W01'), 'groceries', -450, -500, NaN)
      ).toThrow('Budget comparison failed: Invalid numeric value for groceries');
    });

    it('should throw error when actual is Infinity', () => {
      expect(() =>
        createWeeklyBudgetComparison(weekId('2025-W01'), 'groceries', Infinity, -500, 100)
      ).toThrow('Budget comparison failed: Invalid numeric value for groceries');
    });

    it('should throw error when target is Infinity', () => {
      expect(() =>
        createWeeklyBudgetComparison(weekId('2025-W01'), 'groceries', -450, Infinity, 100)
      ).toThrow('Budget comparison failed: Invalid numeric value for groceries');
    });

    it('should throw error when rolloverAccumulated is negative Infinity', () => {
      expect(() =>
        createWeeklyBudgetComparison(weekId('2025-W01'), 'groceries', -450, -500, -Infinity)
      ).toThrow('Budget comparison failed: Invalid numeric value for groceries');
    });

    it('should throw error when multiple inputs are invalid', () => {
      expect(() =>
        createWeeklyBudgetComparison(weekId('2025-W01'), 'groceries', NaN, Infinity, -Infinity)
      ).toThrow('Budget comparison failed: Invalid numeric value for groceries');
    });
  });

  describe('arithmetic overflow handling', () => {
    it('should throw error when variance calculation overflows to Infinity', () => {
      expect(() =>
        createWeeklyBudgetComparison(
          weekId('2025-W01'),
          'groceries',
          Number.MAX_VALUE,
          -Number.MAX_VALUE,
          0
        )
      ).toThrow('Budget comparison failed: Arithmetic overflow for groceries');
    });

    it('should throw error when effectiveTarget calculation overflows to Infinity', () => {
      expect(() =>
        createWeeklyBudgetComparison(
          weekId('2025-W01'),
          'groceries',
          -450,
          Number.MAX_VALUE,
          Number.MAX_VALUE
        )
      ).toThrow('Budget comparison failed: Arithmetic overflow for groceries');
    });

    it('should throw error when effectiveTarget calculation overflows to negative Infinity', () => {
      expect(() =>
        createWeeklyBudgetComparison(
          weekId('2025-W01'),
          'groceries',
          -450,
          -Number.MAX_VALUE,
          -Number.MAX_VALUE
        )
      ).toThrow('Budget comparison failed: Arithmetic overflow for groceries');
    });
  });

  describe('valid input behavior', () => {
    it('should calculate correct values for typical budget data', () => {
      const result = createWeeklyBudgetComparison(weekId('2025-W01'), 'groceries', -450, -500, 100);
      expect(result.week).toBe('2025-W01');
      expect(result.category).toBe('groceries');
      expect(result.actual).toBe(-450);
      expect(result.target).toBe(-500);
      expect(result.variance).toBe(50); // -450 - (-500)
      expect(result.rolloverAccumulated).toBe(100);
      expect(result.effectiveTarget).toBe(-400); // -500 + 100
    });

    it('should handle zero values correctly', () => {
      const result = createWeeklyBudgetComparison(weekId('2025-W01'), 'groceries', 0, 0, 0);
      expect(result.actual).toBe(0);
      expect(result.target).toBe(0);
      expect(result.variance).toBe(0);
      expect(result.rolloverAccumulated).toBe(0);
      expect(result.effectiveTarget).toBe(0);
    });

    it('should handle negative actual and positive rollover', () => {
      const result = createWeeklyBudgetComparison(weekId('2025-W01'), 'groceries', -300, -500, -50);
      expect(result.actual).toBe(-300);
      expect(result.target).toBe(-500);
      expect(result.variance).toBe(200);
      expect(result.rolloverAccumulated).toBe(-50);
      expect(result.effectiveTarget).toBe(-550);
    });
  });
});
