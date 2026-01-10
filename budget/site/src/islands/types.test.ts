import { describe, it, expect } from 'vitest';
import { createWeeklyBudgetComparison, createCashFlowPrediction, weekId } from './types';

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

describe('createCashFlowPrediction', () => {
  describe('error throwing for invalid inputs', () => {
    it('should throw error when totalIncomeTarget is NaN', () => {
      expect(() => createCashFlowPrediction(NaN, 500, 2000, 400)).toThrow(
        'Cash flow prediction failed: Invalid numeric values in inputs'
      );
    });

    it('should throw error when totalExpenseTarget is NaN', () => {
      expect(() => createCashFlowPrediction(2000, NaN, 2000, 400)).toThrow(
        'Cash flow prediction failed: Invalid numeric values in inputs'
      );
    });

    it('should throw error when historicAvgIncome is NaN', () => {
      expect(() => createCashFlowPrediction(2000, 500, NaN, 400)).toThrow(
        'Cash flow prediction failed: Invalid numeric values in inputs'
      );
    });

    it('should throw error when historicAvgExpense is NaN', () => {
      expect(() => createCashFlowPrediction(2000, 500, 2000, NaN)).toThrow(
        'Cash flow prediction failed: Invalid numeric values in inputs'
      );
    });

    it('should throw error when totalIncomeTarget is Infinity', () => {
      expect(() => createCashFlowPrediction(Infinity, 500, 2000, 400)).toThrow(
        'Cash flow prediction failed: Invalid numeric values in inputs'
      );
    });

    it('should throw error when totalExpenseTarget is negative Infinity', () => {
      expect(() => createCashFlowPrediction(2000, -Infinity, 2000, 400)).toThrow(
        'Cash flow prediction failed: Invalid numeric values in inputs'
      );
    });

    it('should throw error when historicAvgIncome is Infinity', () => {
      expect(() => createCashFlowPrediction(2000, 500, Infinity, 400)).toThrow(
        'Cash flow prediction failed: Invalid numeric values in inputs'
      );
    });

    it('should throw error when historicAvgExpense is negative Infinity', () => {
      expect(() => createCashFlowPrediction(2000, 500, 2000, -Infinity)).toThrow(
        'Cash flow prediction failed: Invalid numeric values in inputs'
      );
    });

    it('should throw error when multiple inputs are invalid', () => {
      expect(() => createCashFlowPrediction(NaN, Infinity, -Infinity, NaN)).toThrow(
        'Cash flow prediction failed: Invalid numeric values in inputs'
      );
    });
  });

  describe('arithmetic overflow handling', () => {
    it('should throw error when predictedNetIncome calculation overflows to Infinity', () => {
      expect(() =>
        createCashFlowPrediction(Number.MAX_VALUE, -Number.MAX_VALUE, 2000, 400)
      ).toThrow('Cash flow prediction failed: Arithmetic overflow in calculations');
    });

    it('should throw error when predictedNetIncome calculation overflows to negative Infinity', () => {
      expect(() =>
        createCashFlowPrediction(-Number.MAX_VALUE, Number.MAX_VALUE, 2000, 400)
      ).toThrow('Cash flow prediction failed: Arithmetic overflow in calculations');
    });

    it('should throw error when historicNetIncome calculation overflows to Infinity', () => {
      expect(() =>
        createCashFlowPrediction(2000, 400, Number.MAX_VALUE, -Number.MAX_VALUE)
      ).toThrow('Cash flow prediction failed: Arithmetic overflow in calculations');
    });

    it('should throw error when historicNetIncome calculation overflows to negative Infinity', () => {
      expect(() =>
        createCashFlowPrediction(2000, 400, -Number.MAX_VALUE, Number.MAX_VALUE)
      ).toThrow('Cash flow prediction failed: Arithmetic overflow in calculations');
    });

    it('should throw error when variance calculation overflows to Infinity', () => {
      expect(() => createCashFlowPrediction(Number.MAX_VALUE, 0, -Number.MAX_VALUE, 0)).toThrow(
        'Cash flow prediction failed: Arithmetic overflow in variance calculation'
      );
    });

    it('should throw error when variance calculation overflows to negative Infinity', () => {
      expect(() => createCashFlowPrediction(-Number.MAX_VALUE, 0, Number.MAX_VALUE, 0)).toThrow(
        'Cash flow prediction failed: Arithmetic overflow in variance calculation'
      );
    });
  });

  describe('valid input behavior', () => {
    it('should calculate correct values for typical cash flow data', () => {
      const result = createCashFlowPrediction(2000, 500, 1800, 450);
      expect(result.totalIncomeTarget).toBe(2000);
      expect(result.totalExpenseTarget).toBe(500);
      expect(result.predictedNetIncome).toBe(1500); // 2000 - 500
      expect(result.historicAvgIncome).toBe(1800);
      expect(result.historicAvgExpense).toBe(450);
      expect(result.variance).toBe(150); // 1500 - 1350
    });

    it('should handle zero values correctly', () => {
      const result = createCashFlowPrediction(0, 0, 0, 0);
      expect(result.totalIncomeTarget).toBe(0);
      expect(result.totalExpenseTarget).toBe(0);
      expect(result.predictedNetIncome).toBe(0);
      expect(result.historicAvgIncome).toBe(0);
      expect(result.historicAvgExpense).toBe(0);
      expect(result.variance).toBe(0);
    });

    it('should handle negative variance when historic performance was better', () => {
      const result = createCashFlowPrediction(1500, 400, 2000, 300);
      expect(result.predictedNetIncome).toBe(1100); // 1500 - 400
      const historicNetIncome = 1700; // 2000 - 300
      expect(result.variance).toBe(-600); // 1100 - 1700
    });

    it('should handle positive variance when predicted performance is better', () => {
      const result = createCashFlowPrediction(2500, 400, 2000, 500);
      expect(result.predictedNetIncome).toBe(2100); // 2500 - 400
      const historicNetIncome = 1500; // 2000 - 500
      expect(result.variance).toBe(600); // 2100 - 1500
    });

    it('should handle large but valid numbers without overflow', () => {
      const result = createCashFlowPrediction(1000000, 200000, 950000, 190000);
      expect(result.predictedNetIncome).toBe(800000);
      expect(result.variance).toBe(40000); // 800000 - 760000
    });
  });
});
