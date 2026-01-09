import { describe, it, expect } from 'vitest';
import {
  getISOWeek,
  getWeekBoundaries,
  getCurrentWeek,
  aggregateTransactionsByWeek,
  calculateRolloverAccumulation,
  calculateWeeklyComparison,
  predictCashFlow,
  getAvailableWeeks,
  getNextWeek,
  getPreviousWeek,
} from './weeklyAggregation';
import {
  Transaction,
  WeeklyData,
  WeekId,
  Category,
  BudgetPlan,
  QualifierBreakdown,
} from '../islands/types';

describe('weeklyAggregation', () => {
  describe('getISOWeek', () => {
    it('should calculate ISO week for year boundary transitions', () => {
      // 2024-12-30 is Monday of 2025-W01
      expect(getISOWeek('2024-12-30')).toBe('2025-W01');
      expect(getISOWeek('2024-12-31')).toBe('2025-W01');
      expect(getISOWeek('2025-01-01')).toBe('2025-W01');
      expect(getISOWeek('2025-01-05')).toBe('2025-W01'); // Sunday
    });

    it('should calculate ISO week for last week of year', () => {
      // 2024-12-23 is Monday of 2024-W52
      expect(getISOWeek('2024-12-23')).toBe('2024-W52');
      expect(getISOWeek('2024-12-29')).toBe('2024-W52'); // Sunday
    });

    it('should handle week 53 years', () => {
      // 2020 had 53 ISO weeks
      // 2020-12-28 is Monday of 2020-W53
      expect(getISOWeek('2020-12-28')).toBe('2020-W53');
      expect(getISOWeek('2020-12-31')).toBe('2020-W53');
    });

    it('should calculate week 1 correctly', () => {
      // 2025-01-06 is Monday of 2025-W02
      expect(getISOWeek('2025-01-06')).toBe('2025-W02');
      // 2025-W01 starts on 2024-12-30
      expect(getISOWeek('2024-12-30')).toBe('2025-W01');
    });

    it('should handle mid-year dates', () => {
      expect(getISOWeek('2025-06-15')).toBe('2025-W24');
    });
  });

  describe('getWeekBoundaries', () => {
    it('should return correct boundaries for year boundary week', () => {
      const boundaries = getWeekBoundaries('2025-W01');
      expect(boundaries.start).toBe('2024-12-30'); // Monday
      expect(boundaries.end).toBe('2025-01-05'); // Sunday
    });

    it('should return correct boundaries for week 52', () => {
      const boundaries = getWeekBoundaries('2024-W52');
      expect(boundaries.start).toBe('2024-12-23'); // Monday
      expect(boundaries.end).toBe('2024-12-29'); // Sunday
    });

    it('should return correct boundaries for week 53', () => {
      const boundaries = getWeekBoundaries('2020-W53');
      expect(boundaries.start).toBe('2020-12-28'); // Monday
      expect(boundaries.end).toBe('2021-01-03'); // Sunday
    });

    it('should throw error for invalid week ID', () => {
      expect(() => getWeekBoundaries('invalid' as WeekId)).toThrow('Invalid week ID');
      expect(() => getWeekBoundaries('2025-W' as WeekId)).toThrow('Invalid week ID');
      expect(() => getWeekBoundaries('2025-54' as WeekId)).toThrow('Invalid week ID');
    });

    it('should support roundtrip: getWeekBoundaries(getISOWeek(date)) contains date', () => {
      const testDate = '2025-06-15';
      const weekId = getISOWeek(testDate);
      const boundaries = getWeekBoundaries(weekId);
      expect(testDate >= boundaries.start && testDate <= boundaries.end).toBe(true);
    });
  });

  describe('getCurrentWeek', () => {
    it('should return a valid ISO week identifier', () => {
      const week = getCurrentWeek();
      expect(week).toMatch(/^\d{4}-W\d{2}$/);
    });
  });

  describe('aggregateTransactionsByWeek', () => {
    const createTransaction = (overrides: Partial<Transaction>): Transaction => ({
      id: 'txn-1',
      date: '2025-01-06',
      category: 'Groceries' as Category,
      amount: -100,
      description: 'Test',
      transfer: false,
      vacation: false,
      redeemable: false,
      redemptionRate: 0,
      ...overrides,
    });

    it('should filter out transfer transactions', () => {
      const transactions = [
        createTransaction({ id: 'txn-1', amount: -100 }),
        createTransaction({ id: 'txn-2', amount: -50, transfer: true }),
      ];
      const result = aggregateTransactionsByWeek(transactions, {
        hiddenCategories: new Set(),
        showVacation: true,
      });
      expect(result.length).toBe(1);
      expect(result[0].amount).toBe(-100);
    });

    it('should filter vacation transactions when showVacation=false', () => {
      const transactions = [
        createTransaction({ id: 'txn-1', amount: -100 }),
        createTransaction({ id: 'txn-2', amount: -50, vacation: true }),
      ];
      const result = aggregateTransactionsByWeek(transactions, {
        hiddenCategories: new Set(),
        showVacation: false,
      });
      expect(result.length).toBe(1);
      expect(result[0].amount).toBe(-100);
    });

    it('should filter hidden categories', () => {
      const transactions = [
        createTransaction({ id: 'txn-1', category: 'Groceries' as Category, amount: -100 }),
        createTransaction({ id: 'txn-2', category: 'Entertainment' as Category, amount: -50 }),
      ];
      const result = aggregateTransactionsByWeek(transactions, {
        hiddenCategories: new Set(['Entertainment']),
        showVacation: true,
      });
      expect(result.length).toBe(1);
      expect(result[0].category).toBe('Groceries');
    });

    it('should apply redemption rate to redeemable transactions', () => {
      const transactions = [
        createTransaction({
          id: 'txn-1',
          amount: -100,
          redeemable: true,
          redemptionRate: 0.5,
        }),
      ];
      const result = aggregateTransactionsByWeek(transactions, {
        hiddenCategories: new Set(),
        showVacation: true,
      });
      expect(result[0].amount).toBe(-50);
      expect(result[0].qualifiers.redeemable).toBe(-50);
      expect(result[0].qualifiers.nonRedeemable).toBe(0);
    });

    it('should track qualifiers correctly', () => {
      const transactions = [
        createTransaction({
          id: 'txn-1',
          amount: -100,
          redeemable: true,
          redemptionRate: 0.5,
        }),
        createTransaction({
          id: 'txn-2',
          amount: -50,
          redeemable: false,
        }),
      ];
      const result = aggregateTransactionsByWeek(transactions, {
        hiddenCategories: new Set(),
        showVacation: true,
      });
      expect(result[0].qualifiers.redeemable).toBe(-50);
      expect(result[0].qualifiers.nonRedeemable).toBe(-50);
      expect(result[0].qualifiers.transactionCount).toBe(2);
    });

    it('should aggregate multiple transactions in same week and category', () => {
      const transactions = [
        createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100 }),
        createTransaction({ id: 'txn-2', date: '2025-01-07', amount: -50 }),
      ];
      const result = aggregateTransactionsByWeek(transactions, {
        hiddenCategories: new Set(),
        showVacation: true,
      });
      expect(result.length).toBe(1);
      expect(result[0].amount).toBe(-150);
      expect(result[0].qualifiers.transactionCount).toBe(2);
    });

    it('should split transactions across multiple weeks', () => {
      const transactions = [
        createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100 }),
        createTransaction({ id: 'txn-2', date: '2025-01-13', amount: -50 }),
      ];
      const result = aggregateTransactionsByWeek(transactions, {
        hiddenCategories: new Set(),
        showVacation: true,
      });
      expect(result.length).toBe(2);
      expect(result[0].week).toBe('2025-W02');
      expect(result[1].week).toBe('2025-W03');
    });

    it('should return empty array for empty transactions', () => {
      const result = aggregateTransactionsByWeek([], {
        hiddenCategories: new Set(),
        showVacation: true,
      });
      expect(result).toEqual([]);
    });

    it('should set isIncome correctly', () => {
      const transactions = [
        createTransaction({ id: 'txn-1', category: 'Salary' as Category, amount: 1000 }), // income
        createTransaction({ id: 'txn-2', category: 'Groceries' as Category, amount: -100 }), // expense
      ];
      const result = aggregateTransactionsByWeek(transactions, {
        hiddenCategories: new Set(),
        showVacation: true,
      });
      expect(result.length).toBe(2);
      expect(result.find((r) => r.amount > 0)?.isIncome).toBe(true);
      expect(result.find((r) => r.amount < 0)?.isIncome).toBe(false);
    });

    it('should include week boundaries in output', () => {
      const transactions = [createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100 })];
      const result = aggregateTransactionsByWeek(transactions, {
        hiddenCategories: new Set(),
        showVacation: true,
      });
      expect(result[0].weekStartDate).toBe('2025-01-06');
      expect(result[0].weekEndDate).toBe('2025-01-12');
    });
  });

  describe('calculateRolloverAccumulation', () => {
    const createWeeklyData = (overrides: Partial<WeeklyData>): WeeklyData => ({
      week: '2025-W02' as WeekId,
      category: 'Groceries' as Category,
      amount: -100,
      isIncome: false,
      qualifiers: {
        redeemable: 0,
        nonRedeemable: -100,
        vacation: 0,
        nonVacation: -100,
        transactionCount: 1,
      },
      weekStartDate: '2025-01-06',
      weekEndDate: '2025-01-12',
      ...overrides,
    });

    const createBudgetPlan = (): BudgetPlan => ({
      categoryBudgets: {
        Groceries: {
          weeklyTarget: -500,
          rolloverEnabled: true,
        },
        Income: {
          weeklyTarget: 2000,
          rolloverEnabled: true,
        },
      },
    });

    it('should calculate rollover for expense category with surplus', () => {
      const weeklyData = [
        createWeeklyData({ week: '2025-W02', amount: -400 }), // spent $400 with $500 budget
      ];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        '2025-W02',
        '2025-W03'
      );
      // variance = actual - target = -400 - (-500) = 100 (surplus)
      expect(rollover.get('Groceries')).toBe(100);
    });

    it('should calculate rollover for expense category with deficit', () => {
      const weeklyData = [
        createWeeklyData({ week: '2025-W02', amount: -600 }), // spent $600 with $500 budget
      ];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        '2025-W02',
        '2025-W03'
      );
      // variance = actual - target = -600 - (-500) = -100 (deficit)
      expect(rollover.get('Groceries')).toBe(-100);
    });

    it('should accumulate rollover across multiple weeks', () => {
      const weeklyData = [
        createWeeklyData({ week: '2025-W02', amount: -400 }), // +100 surplus
        createWeeklyData({ week: '2025-W03', amount: -600 }), // -100 deficit
        createWeeklyData({ week: '2025-W04', amount: -450 }), // +50 surplus
      ];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        '2025-W02',
        '2025-W05'
      );
      // cumulative: 100 + (-100) + 50 = 50
      expect(rollover.get('Groceries')).toBe(50);
    });

    it('should handle income category rollover', () => {
      const weeklyData = [
        createWeeklyData({
          week: '2025-W02',
          category: 'Income' as Category,
          amount: 2500, // earned $2500 with $2000 target
          isIncome: true,
        }),
      ];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        '2025-W02',
        '2025-W03'
      );
      // variance = 2500 - 2000 = 500 (surplus)
      expect(rollover.get('Income')).toBe(500);
    });

    it('should handle missing week data', () => {
      const weeklyData = [
        createWeeklyData({ week: '2025-W02', amount: -400 }), // week 3 missing
        createWeeklyData({ week: '2025-W04', amount: -450 }),
      ];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        '2025-W02',
        '2025-W05'
      );
      // W02: -400 - (-500) = 100
      // W03: no data, so not processed (missing weeks are skipped)
      // W04: -450 - (-500) = 50
      // total: 100 + 50 = 150
      expect(rollover.get('Groceries')).toBe(150);
    });

    it('should skip categories with rollover disabled', () => {
      const weeklyData = [createWeeklyData({ week: '2025-W02', amount: -400 })];
      const budgetPlan: BudgetPlan = {
        categoryBudgets: {
          Groceries: {
            weeklyTarget: -500,
            rolloverEnabled: false, // disabled
          },
        },
      };
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        '2025-W02',
        '2025-W03'
      );
      expect(rollover.has('Groceries')).toBe(false);
    });

    it('should return zero when fromWeek equals toWeek', () => {
      const weeklyData = [createWeeklyData({ week: '2025-W02', amount: -400 })];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        '2025-W02',
        '2025-W02'
      );
      expect(rollover.get('Groceries')).toBe(0);
    });
  });

  describe('calculateWeeklyComparison', () => {
    const createWeeklyData = (overrides: Partial<WeeklyData>): WeeklyData => ({
      week: '2025-W02' as WeekId,
      category: 'Groceries' as Category,
      amount: -100,
      isIncome: false,
      qualifiers: {
        redeemable: 0,
        nonRedeemable: -100,
        vacation: 0,
        nonVacation: -100,
        transactionCount: 1,
      },
      weekStartDate: '2025-01-06',
      weekEndDate: '2025-01-12',
      ...overrides,
    });

    const createBudgetPlan = (): BudgetPlan => ({
      categoryBudgets: {
        Groceries: {
          weeklyTarget: -500,
          rolloverEnabled: true,
        },
        Income: {
          weeklyTarget: 2000,
          rolloverEnabled: false,
        },
      },
    });

    it('should calculate comparison with budget but no transactions', () => {
      const weeklyData: WeeklyData[] = [];
      const budgetPlan = createBudgetPlan();
      const comparison = calculateWeeklyComparison(weeklyData, budgetPlan, '2025-W02');

      const groceries = comparison.find((c) => c.category === 'Groceries');
      expect(groceries).toBeDefined();
      expect(groceries!.actual).toBe(0);
      expect(groceries!.target).toBe(-500);
      expect(groceries!.variance).toBe(500); // 0 - (-500) = 500 (overspent by 500)
    });

    it('should calculate comparison with transactions but no budget', () => {
      const weeklyData = [
        createWeeklyData({ category: 'Entertainment' as Category, amount: -100 }),
      ];
      const budgetPlan = createBudgetPlan();
      const comparison = calculateWeeklyComparison(weeklyData, budgetPlan, '2025-W02');

      // Entertainment has no budget, should not appear in comparison
      expect(comparison.find((c) => c.category === 'Entertainment')).toBeUndefined();
    });

    it('should calculate variance correctly', () => {
      const weeklyData = [createWeeklyData({ week: '2025-W02', amount: -400 })];
      const budgetPlan = createBudgetPlan();
      const comparison = calculateWeeklyComparison(weeklyData, budgetPlan, '2025-W02');

      const groceries = comparison.find((c) => c.category === 'Groceries');
      expect(groceries!.variance).toBe(100); // -400 - (-500) = 100
    });

    it('should include rollover in effectiveTarget', () => {
      const weeklyData = [
        createWeeklyData({ week: '2025-W02', amount: -400 }), // creates 100 rollover
        createWeeklyData({ week: '2025-W03', amount: -0 }),
      ];
      const budgetPlan = createBudgetPlan();
      const comparison = calculateWeeklyComparison(weeklyData, budgetPlan, '2025-W03');

      const groceries = comparison.find((c) => c.category === 'Groceries');
      expect(groceries!.rolloverAccumulated).toBe(100);
      expect(groceries!.effectiveTarget).toBe(-400); // -500 + 100 = -400
    });

    it('should return comparison for all categories in budget plan', () => {
      const weeklyData = [createWeeklyData({ week: '2025-W02', amount: -400 })];
      const budgetPlan = createBudgetPlan();
      const comparison = calculateWeeklyComparison(weeklyData, budgetPlan, '2025-W02');

      expect(comparison.length).toBe(2); // Groceries and Income
      expect(comparison.find((c) => c.category === 'Groceries')).toBeDefined();
      expect(comparison.find((c) => c.category === 'Income')).toBeDefined();
    });
  });

  describe('predictCashFlow', () => {
    const createWeeklyData = (overrides: Partial<WeeklyData>): WeeklyData => ({
      week: '2025-W02' as WeekId,
      category: 'Groceries' as Category,
      amount: -100,
      isIncome: false,
      qualifiers: {
        redeemable: 0,
        nonRedeemable: -100,
        vacation: 0,
        nonVacation: -100,
        transactionCount: 1,
      },
      weekStartDate: '2025-01-06',
      weekEndDate: '2025-01-12',
      ...overrides,
    });

    const createBudgetPlan = (): BudgetPlan => ({
      categoryBudgets: {
        Groceries: {
          weeklyTarget: -500,
          rolloverEnabled: true,
        },
        Salary: {
          weeklyTarget: 2000,
          rolloverEnabled: false,
        },
      },
    });

    it('should calculate predicted net income from budget plan', () => {
      const budgetPlan = createBudgetPlan();
      const prediction = predictCashFlow(budgetPlan, [], 12);

      expect(prediction.totalIncomeTarget).toBe(2000);
      expect(prediction.totalExpenseTarget).toBe(500);
      expect(prediction.predictedNetIncome).toBe(1500); // 2000 - 500
    });

    it('should return zero historic values with no data', () => {
      const budgetPlan = createBudgetPlan();
      const prediction = predictCashFlow(budgetPlan, [], 12);

      expect(prediction.historicAvgIncome).toBe(0);
      expect(prediction.historicAvgExpense).toBe(0);
      expect(prediction.variance).toBe(1500); // predicted - 0
    });

    it('should calculate historic averages from last N weeks', () => {
      const historicData = [
        createWeeklyData({
          week: '2025-W01',
          category: 'Salary' as Category,
          amount: 2000,
          isIncome: true,
        }),
        createWeeklyData({ week: '2025-W01', amount: -400 }),
        createWeeklyData({
          week: '2025-W02',
          category: 'Salary' as Category,
          amount: 2200,
          isIncome: true,
        }),
        createWeeklyData({ week: '2025-W02', amount: -600 }),
        createWeeklyData({
          week: '2025-W03',
          category: 'Salary' as Category,
          amount: 1800,
          isIncome: true,
        }),
        createWeeklyData({ week: '2025-W03', amount: -500 }),
      ];
      const budgetPlan = createBudgetPlan();
      const prediction = predictCashFlow(budgetPlan, historicData, 12);

      // Average income: (2000 + 2200 + 1800) / 3 = 2000
      // Average expense: (400 + 600 + 500) / 3 = 500
      expect(prediction.historicAvgIncome).toBe(2000);
      expect(prediction.historicAvgExpense).toBe(500);
      expect(prediction.variance).toBe(0); // predicted 1500 - historic 1500 = 0
    });

    it('should use only last N weeks when data exceeds weeksToAverage', () => {
      const historicData = [
        createWeeklyData({
          week: '2025-W01',
          category: 'Salary' as Category,
          amount: 1000,
          isIncome: true,
        }),
        createWeeklyData({
          week: '2025-W02',
          category: 'Salary' as Category,
          amount: 2000,
          isIncome: true,
        }),
        createWeeklyData({
          week: '2025-W03',
          category: 'Salary' as Category,
          amount: 3000,
          isIncome: true,
        }),
      ];
      const budgetPlan = createBudgetPlan();
      const prediction = predictCashFlow(budgetPlan, historicData, 2); // only last 2 weeks

      // Should use W02 and W03 only: (2000 + 3000) / 2 = 2500
      expect(prediction.historicAvgIncome).toBe(2500);
    });

    it('should calculate variance correctly', () => {
      const historicData = [
        createWeeklyData({
          week: '2025-W01',
          category: 'Salary' as Category,
          amount: 1500,
          isIncome: true,
        }),
        createWeeklyData({ week: '2025-W01', amount: -400 }),
      ];
      const budgetPlan = createBudgetPlan();
      const prediction = predictCashFlow(budgetPlan, historicData, 12);

      // Predicted: 2000 - 500 = 1500
      // Historic: 1500 - 400 = 1100
      // Variance: 1500 - 1100 = 400
      expect(prediction.variance).toBe(400);
    });

    it('should handle fewer weeks than weeksToAverage', () => {
      const historicData = [
        createWeeklyData({
          week: '2025-W01',
          category: 'Salary' as Category,
          amount: 2000,
          isIncome: true,
        }),
        createWeeklyData({ week: '2025-W01', amount: -500 }),
      ];
      const budgetPlan = createBudgetPlan();
      const prediction = predictCashFlow(budgetPlan, historicData, 12);

      // Should use all available weeks (1 week)
      expect(prediction.historicAvgIncome).toBe(2000);
      expect(prediction.historicAvgExpense).toBe(500);
    });
  });

  describe('getAvailableWeeks', () => {
    const createTransaction = (overrides: Partial<Transaction>): Transaction => ({
      id: 'txn-1',
      date: '2025-01-06',
      category: 'Groceries' as Category,
      amount: -100,
      description: 'Test',
      transfer: false,
      vacation: false,
      redeemable: false,
      redemptionRate: 0,
      ...overrides,
    });

    it('should return unique weeks sorted', () => {
      const transactions = [
        createTransaction({ date: '2025-01-06' }), // W02
        createTransaction({ date: '2025-01-13' }), // W03
        createTransaction({ date: '2025-01-07' }), // W02
      ];
      const weeks = getAvailableWeeks(transactions);
      expect(weeks).toEqual(['2025-W02', '2025-W03']);
    });

    it('should return empty array for no transactions', () => {
      const weeks = getAvailableWeeks([]);
      expect(weeks).toEqual([]);
    });
  });

  describe('getNextWeek and getPreviousWeek', () => {
    it('should navigate to next week', () => {
      expect(getNextWeek('2025-W02')).toBe('2025-W03');
    });

    it('should navigate across year boundary (forward)', () => {
      expect(getNextWeek('2024-W52')).toBe('2025-W01');
    });

    it('should navigate to previous week', () => {
      expect(getPreviousWeek('2025-W03')).toBe('2025-W02');
    });

    it('should navigate across year boundary (backward)', () => {
      expect(getPreviousWeek('2025-W01')).toBe('2024-W52');
    });

    it('should handle week 53 navigation', () => {
      expect(getNextWeek('2020-W53')).toBe('2021-W01');
      expect(getPreviousWeek('2021-W01')).toBe('2020-W53');
    });

    it('should support roundtrip navigation', () => {
      const week = '2025-W15';
      expect(getPreviousWeek(getNextWeek(week))).toBe(week);
      expect(getNextWeek(getPreviousWeek(week))).toBe(week);
    });
  });
});
