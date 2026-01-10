import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
import { Transaction, WeeklyData, WeekId, Category, BudgetPlan, weekId } from '../islands/types';
import { StateManager } from './state';
import * as types from '../islands/types';

describe('weeklyAggregation', () => {
  describe('getISOWeek', () => {
    it('should calculate ISO week for year boundary transitions', () => {
      // 2024-12-30 is Monday of 2025-W01
      expect(getISOWeek('2024-12-30')).toBe(weekId('2025-W01'));
      expect(getISOWeek('2024-12-31')).toBe(weekId('2025-W01'));
      expect(getISOWeek('2025-01-01')).toBe(weekId('2025-W01'));
      expect(getISOWeek('2025-01-05')).toBe('2025-W01'); // Sunday
    });

    it('should calculate ISO week for last week of year', () => {
      // 2024-12-23 is Monday of 2024-W52
      expect(getISOWeek('2024-12-23')).toBe(weekId('2024-W52'));
      expect(getISOWeek('2024-12-29')).toBe('2024-W52'); // Sunday
    });

    it('should handle week 53 years', () => {
      // 2020 had 53 ISO weeks
      // 2020-12-28 is Monday of 2020-W53
      expect(getISOWeek('2020-12-28')).toBe(weekId('2020-W53'));
      expect(getISOWeek('2020-12-31')).toBe(weekId('2020-W53'));
    });

    it('should calculate week 1 correctly', () => {
      // 2025-01-06 is Monday of 2025-W02
      expect(getISOWeek('2025-01-06')).toBe(weekId('2025-W02'));
      // 2025-W01 starts on 2024-12-30
      expect(getISOWeek('2024-12-30')).toBe(weekId('2025-W01'));
    });

    it('should handle mid-year dates', () => {
      expect(getISOWeek('2025-06-15')).toBe(weekId('2025-W24'));
    });

    it('should reject invalid dates that get normalized (Feb 31st)', () => {
      expect(() => getISOWeek('2025-02-31')).toThrow(
        'Invalid date: 2025-02-31 was normalized to 2025-03-03'
      );
    });

    it('should reject invalid dates that get normalized (Apr 31st)', () => {
      expect(() => getISOWeek('2025-04-31')).toThrow(
        'Invalid date: 2025-04-31 was normalized to 2025-05-01'
      );
    });

    it('should reject invalid dates on non-leap years (Feb 29th)', () => {
      expect(() => getISOWeek('2025-02-29')).toThrow(
        'Invalid date: 2025-02-29 was normalized to 2025-03-01'
      );
    });

    it('should accept valid dates on leap years (Feb 29th)', () => {
      // 2024 is a leap year
      expect(getISOWeek('2024-02-29')).toBe(weekId('2024-W09'));
    });
  });

  describe('getWeekBoundaries', () => {
    it('should return correct boundaries for year boundary week', () => {
      const boundaries = getWeekBoundaries(weekId(weekId('2025-W01')));
      expect(boundaries.start).toBe('2024-12-30'); // Monday
      expect(boundaries.end).toBe('2025-01-05'); // Sunday
    });

    it('should return correct boundaries for week 52', () => {
      const boundaries = getWeekBoundaries(weekId(weekId('2024-W52')));
      expect(boundaries.start).toBe('2024-12-23'); // Monday
      expect(boundaries.end).toBe('2024-12-29'); // Sunday
    });

    it('should return correct boundaries for week 53', () => {
      const boundaries = getWeekBoundaries(weekId(weekId('2020-W53')));
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
      category: 'groceries' as Category,
      amount: -100,
      description: 'Test',
      transfer: false,
      vacation: false,
      redeemable: false,
      redemptionRate: 0,
      statementIds: [],
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
        createTransaction({ id: 'txn-1', category: 'groceries' as Category, amount: -100 }),
        createTransaction({ id: 'txn-2', category: 'entertainment' as Category, amount: -50 }),
      ];
      const result = aggregateTransactionsByWeek(transactions, {
        hiddenCategories: new Set(['entertainment']),
        showVacation: true,
      });
      expect(result.length).toBe(1);
      expect(result[0].category).toBe('groceries');
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
      expect(result[0].week).toBe(weekId('2025-W02'));
      expect(result[1].week).toBe(weekId('2025-W03'));
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
        createTransaction({ id: 'txn-1', category: 'income' as Category, amount: 1000 }), // income
        createTransaction({ id: 'txn-2', category: 'groceries' as Category, amount: -100 }), // expense
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
      week: weekId(weekId('2025-W02')) as WeekId,
      category: 'groceries' as Category,
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
        groceries: {
          weeklyTarget: -500,
          rolloverEnabled: true,
        },
        income: {
          weeklyTarget: 2000,
          rolloverEnabled: true,
        },
      },
      lastModified: new Date().toISOString(),
    });

    it('should calculate rollover for expense category with surplus', () => {
      const weeklyData = [
        createWeeklyData({ week: weekId('2025-W02'), amount: -400 }), // spent $400 with $500 budget
      ];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2025-W02'),
        weekId('2025-W03')
      );
      // variance = actual - target = -400 - (-500) = 100 (surplus)
      expect(rollover.get('groceries')).toBe(100);
    });

    it('should calculate rollover for expense category with deficit', () => {
      const weeklyData = [
        createWeeklyData({ week: weekId('2025-W02'), amount: -600 }), // spent $600 with $500 budget
      ];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2025-W02'),
        weekId('2025-W03')
      );
      // variance = actual - target = -600 - (-500) = -100 (deficit)
      expect(rollover.get('groceries')).toBe(-100);
    });

    it('should accumulate rollover across multiple weeks', () => {
      const weeklyData = [
        createWeeklyData({ week: weekId('2025-W02'), amount: -400 }), // +100 surplus
        createWeeklyData({ week: weekId('2025-W03'), amount: -600 }), // -100 deficit
        createWeeklyData({ week: weekId('2025-W04'), amount: -450 }), // +50 surplus
      ];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2025-W02'),
        weekId('2025-W05')
      );
      // cumulative: 100 + (-100) + 50 = 50
      expect(rollover.get('groceries')).toBe(50);
    });

    it('should handle income category rollover', () => {
      const weeklyData = [
        createWeeklyData({
          week: weekId(weekId('2025-W02')),
          category: 'income' as Category,
          amount: 2500, // earned $2500 with $2000 target
          isIncome: true,
        }),
      ];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2025-W02'),
        weekId('2025-W03')
      );
      // variance = 2500 - 2000 = 500 (surplus)
      expect(rollover.get('income')).toBe(500);
    });

    it('should handle missing week data', () => {
      const weeklyData = [
        createWeeklyData({ week: weekId('2025-W02'), amount: -400 }), // week 3 missing
        createWeeklyData({ week: weekId(weekId('2025-W04')), amount: -450 }),
      ];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2025-W02'),
        weekId('2025-W05')
      );
      // W02: -400 - (-500) = 100
      // W03: no data, so not processed (missing weeks are skipped)
      // W04: -450 - (-500) = 50
      // total: 100 + 50 = 150
      expect(rollover.get('groceries')).toBe(150);
    });

    it('should skip categories with rollover disabled', () => {
      const weeklyData = [createWeeklyData({ week: weekId(weekId('2025-W02')), amount: -400 })];
      const budgetPlan: BudgetPlan = {
        categoryBudgets: {
          groceries: {
            weeklyTarget: -500,
            rolloverEnabled: false, // disabled
          },
        },
        lastModified: new Date().toISOString(),
      };
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2025-W02'),
        weekId('2025-W03')
      );
      expect(rollover.has('groceries')).toBe(false);
    });

    it('should return zero when fromWeek equals toWeek', () => {
      const weeklyData = [createWeeklyData({ week: weekId(weekId('2025-W02')), amount: -400 })];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2025-W02'),
        weekId('2025-W02')
      );
      expect(rollover.get('groceries')).toBe(0);
    });

    it('should accumulate rollover across year boundary (2024-W52 to 2025-W02)', () => {
      const weeklyData = [
        createWeeklyData({ week: weekId('2024-W52'), amount: -400 }), // +100 surplus in last week of 2024
        createWeeklyData({ week: weekId('2025-W01'), amount: -450 }), // +50 surplus in first week of 2025
        createWeeklyData({ week: weekId('2025-W02'), amount: -550 }), // -50 deficit
      ];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2024-W52'),
        weekId('2025-W03')
      );
      // cumulative: 100 + 50 + (-50) = 100
      expect(rollover.get('groceries')).toBe(100);
    });

    it('should accumulate rollover across week 53 year boundary (2020-W53 to 2021-W01)', () => {
      const weeklyData = [
        createWeeklyData({ week: weekId('2020-W53'), amount: -300 }), // +200 surplus in week 53
        createWeeklyData({ week: weekId('2021-W01'), amount: -450 }), // +50 surplus in first week of 2021
      ];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2020-W53'),
        weekId('2021-W02')
      );
      // cumulative: 200 + 50 = 250
      expect(rollover.get('groceries')).toBe(250);
    });

    it('should handle rollover spanning multiple year boundaries', () => {
      const weeklyData = [
        createWeeklyData({ week: weekId('2023-W52'), amount: -400 }), // +100 surplus
        createWeeklyData({ week: weekId('2024-W01'), amount: -450 }), // +50 surplus
        createWeeklyData({ week: weekId('2024-W52'), amount: -550 }), // -50 deficit
        createWeeklyData({ week: weekId('2025-W01'), amount: -500 }), // 0 variance
      ];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2023-W52'),
        weekId('2025-W02')
      );
      // cumulative: 100 + 50 + (-50) + 0 = 100
      expect(rollover.get('groceries')).toBe(100);
    });

    it('should calculate rollover for multiple categories without interference', () => {
      const weeklyData = [
        // Category A (groceries): rollover enabled, surplus
        createWeeklyData({
          week: weekId(weekId('2025-W02')),
          category: 'groceries' as Category,
          amount: -400,
        }),
        // Category B (dining): rollover enabled, deficit
        createWeeklyData({
          week: weekId(weekId('2025-W02')),
          category: 'dining' as Category,
          amount: -300,
        }),
        // Category C (entertainment): rollover disabled, surplus
        createWeeklyData({
          week: weekId(weekId('2025-W02')),
          category: 'entertainment' as Category,
          amount: -50,
        }),
      ];

      const budgetPlan: BudgetPlan = {
        categoryBudgets: {
          groceries: {
            weeklyTarget: -500,
            rolloverEnabled: true,
          },
          dining: {
            weeklyTarget: -200,
            rolloverEnabled: true,
          },
          entertainment: {
            weeklyTarget: -100,
            rolloverEnabled: false,
          },
        },
        lastModified: new Date().toISOString(),
      };

      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2025-W02'),
        weekId('2025-W03')
      );

      // groceries: -400 - (-500) = +100 surplus
      expect(rollover.get('groceries')).toBe(100);

      // Dining: -300 - (-200) = -100 deficit
      expect(rollover.get('dining')).toBe(-100);

      // Entertainment: rollover disabled, should not be in map
      expect(rollover.has('entertainment')).toBe(false);

      // Verify map size - only 2 categories with rollover enabled
      expect(rollover.size).toBe(2);
    });

    it('should handle duplicate weeks for same category gracefully', () => {
      const weeklyData = [
        createWeeklyData({ week: weekId('2025-W02'), amount: -400 }), // +100 surplus
        createWeeklyData({ week: weekId('2025-W02'), amount: -100 }), // duplicate week, different amount
      ];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2025-W02'),
        weekId('2025-W03')
      );
      // Week is processed once. The find() on line 223 of implementation will match
      // the first entry with amount -400
      // variance = -400 - (-500) = 100
      expect(rollover.get('groceries')).toBe(100);
    });

    it('should handle NaN amounts gracefully', () => {
      const weeklyData = [
        createWeeklyData({ week: weekId(weekId('2025-W02')), amount: NaN }),
        createWeeklyData({ week: weekId('2025-W03'), amount: -400 }), // +100 surplus
      ];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2025-W02'),
        weekId('2025-W04')
      );
      // NaN is falsy, so `NaN || 0` = 0
      // W02: actual = 0 (NaN || 0), variance = 0 - (-500) = 500
      // W03: actual = -400, variance = -400 - (-500) = 100
      // Total: 500 + 100 = 600
      expect(rollover.get('groceries')).toBe(600);
    });

    it('should handle Infinity amounts gracefully', () => {
      const weeklyData = [
        createWeeklyData({ week: weekId(weekId('2025-W02')), amount: -Infinity }),
        createWeeklyData({ week: weekId('2025-W03'), amount: -400 }), // +100 surplus
      ];
      const budgetPlan = createBudgetPlan();
      // Should throw on invalid Infinity value instead of silently skipping
      expect(() =>
        calculateRolloverAccumulation(
          weeklyData,
          budgetPlan,
          weekId('2025-W02'),
          weekId('2025-W04')
        )
      ).toThrow(
        'Rollover calculation failed: Invalid numeric value for groceries in week 2025-W02'
      );
    });

    it('should handle NaN weekly targets gracefully', () => {
      const weeklyData = [createWeeklyData({ week: weekId(weekId('2025-W02')), amount: -400 })];
      const budgetPlan: BudgetPlan = {
        categoryBudgets: {
          groceries: {
            weeklyTarget: NaN,
            rolloverEnabled: true,
          },
        },
        lastModified: new Date().toISOString(),
      };
      // Should throw on invalid NaN target instead of silently skipping
      expect(() =>
        calculateRolloverAccumulation(
          weeklyData,
          budgetPlan,
          weekId('2025-W02'),
          weekId('2025-W03')
        )
      ).toThrow(
        'Rollover calculation failed: Invalid numeric value for groceries in week 2025-W02'
      );
    });

    it('should handle reversed week range (fromWeek > toWeek)', () => {
      const weeklyData = [
        createWeeklyData({ week: weekId(weekId('2025-W02')), amount: -400 }),
        createWeeklyData({ week: weekId(weekId('2025-W03')), amount: -450 }),
        createWeeklyData({ week: weekId(weekId('2025-W04')), amount: -500 }),
      ];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2025-W05'), // fromWeek is after toWeek
        weekId('2025-W02')
      );
      // No weeks should be processed when range is reversed
      expect(rollover.get('groceries')).toBe(0);
    });

    it('should handle categories not in budget plan', () => {
      const weeklyData = [
        createWeeklyData({ week: weekId(weekId('2025-W02')), amount: -400 }),
        createWeeklyData({
          week: weekId(weekId('2025-W02')),
          category: 'travel' as Category,
          amount: -200,
        }),
      ];
      const budgetPlan = createBudgetPlan(); // only has Groceries and Income
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2025-W02'),
        weekId('2025-W03')
      );
      // Groceries should be calculated normally
      expect(rollover.get('groceries')).toBe(100);
      // Travel category not in budget plan, should not appear
      expect(rollover.has('travel')).toBe(false);
    });

    it('should handle very long time ranges efficiently', () => {
      // Create 100+ weeks of data spanning multiple years
      const weeklyData: WeeklyData[] = [];

      // 2023: W01-W52 (52 weeks)
      for (let i = 1; i <= 52; i++) {
        const weekNum = String(i).padStart(2, '0');
        weeklyData.push(
          createWeeklyData({
            week: `2023-W${weekNum}` as WeekId,
            amount: -450, // +50 surplus each week
          })
        );
      }

      // 2024: W01-W52 (52 weeks, total: 104 weeks)
      for (let i = 1; i <= 52; i++) {
        const weekNum = String(i).padStart(2, '0');
        weeklyData.push(
          createWeeklyData({
            week: `2024-W${weekNum}` as WeekId,
            amount: -450, // +50 surplus each week
          })
        );
      }

      const budgetPlan = createBudgetPlan();
      const startTime = performance.now();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2023-W01'),
        weekId('2025-W01') // All of 2023 and 2024 = 104 weeks
      );
      const endTime = performance.now();

      // Should accumulate: 50 * 104 = 5200
      expect(rollover.get('groceries')).toBe(5200);

      // Performance check: should complete in reasonable time (< 100ms)
      const duration = endTime - startTime;
      expect(duration).toBeLessThan(100);
    });

    it('should accumulate rollover across 4+ weeks correctly', () => {
      const weeklyData = [
        createWeeklyData({ week: weekId('2025-W01'), amount: -400 }), // underspend $100
        createWeeklyData({ week: weekId('2025-W02'), amount: -450 }), // underspend $50, total +$150
        createWeeklyData({ week: weekId('2025-W03'), amount: -530 }), // overspend $30, total +$120
        createWeeklyData({ week: weekId('2025-W04'), amount: -500 }), // exactly on budget, total +$120
      ];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2025-W01'),
        weekId('2025-W05')
      );
      // cumulative: 100 + 50 + (-30) + 0 = 120
      expect(rollover.get('groceries')).toBe(120);
    });

    it('should handle rollover toggle mid-history correctly', () => {
      const weeklyData = [
        createWeeklyData({ week: weekId('2025-W01'), amount: -400 }), // +100 surplus
        createWeeklyData({ week: weekId('2025-W02'), amount: -400 }), // +100 surplus, total +$200
        createWeeklyData({ week: weekId('2025-W03'), amount: -450 }), // +50 surplus (but rollover disabled)
        createWeeklyData({ week: weekId('2025-W04'), amount: -500 }), // exactly on budget
      ];

      let budgetPlan: BudgetPlan = {
        categoryBudgets: {
          groceries: {
            weeklyTarget: -500,
            rolloverEnabled: true, // enabled for W01-W02
          },
        },
        lastModified: new Date().toISOString(),
      };

      // Calculate rollover through W02 with rollover enabled
      const rolloverW03 = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2025-W01'),
        weekId('2025-W03')
      );
      expect(rolloverW03.get('groceries')).toBe(200);

      // Toggle rollover off after W02
      budgetPlan = {
        ...budgetPlan,
        categoryBudgets: {
          ...budgetPlan.categoryBudgets,
          groceries: {
            ...budgetPlan.categoryBudgets.groceries!,
            rolloverEnabled: false,
          },
        },
      };

      // With rollover disabled, W03 should NOT accumulate any rollover
      const rolloverW04Disabled = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2025-W03'),
        weekId('2025-W04')
      );
      expect(rolloverW04Disabled.has('groceries')).toBe(false);
    });

    it('should handle negative rollover accumulation (debt)', () => {
      const weeklyData = [
        createWeeklyData({ week: weekId('2025-W01'), amount: -600 }), // overspend by $100
        createWeeklyData({ week: weekId('2025-W02'), amount: -550 }), // overspend by $50, total -$150 debt
      ];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2025-W01'),
        weekId('2025-W03')
      );
      // cumulative: -100 + (-50) = -150 (debt carried forward)
      expect(rollover.get('groceries')).toBe(-150);
    });

    it('should handle sparse data crossing year boundary with missing weeks', () => {
      const weeklyData = [
        createWeeklyData({ week: weekId('2024-W50'), amount: -400 }), // +100 surplus
        // W51 missing
        createWeeklyData({ week: weekId('2024-W52'), amount: -450 }), // +50 surplus
        // 2025-W01 missing (year boundary)
        createWeeklyData({ week: weekId('2025-W02'), amount: -550 }), // -50 deficit
      ];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2024-W50'),
        weekId('2025-W03')
      );
      // Only weeks with data are processed: W50(+100) + W52(+50) + W02(-50) = 100
      // Missing weeks (W51, W01) are skipped
      expect(rollover.get('groceries')).toBe(100);
    });

    it('should handle weeklyData containing weeks outside the specified range', () => {
      const weeklyData = [
        createWeeklyData({ week: weekId('2024-W48'), amount: -300 }), // before range, should be excluded
        createWeeklyData({ week: weekId('2024-W52'), amount: -400 }), // +100 surplus, in range
        createWeeklyData({ week: weekId('2025-W01'), amount: -450 }), // +50 surplus, in range
        createWeeklyData({ week: weekId('2025-W02'), amount: -550 }), // -50 deficit, in range
        createWeeklyData({ week: weekId('2025-W05'), amount: -200 }), // after range, should be excluded
      ];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2024-W52'),
        weekId('2025-W03')
      );
      // Only W52, W01, W02 should be processed (fromWeek inclusive, toWeek exclusive)
      // cumulative: 100 + 50 + (-50) = 100
      expect(rollover.get('groceries')).toBe(100);
    });

    it('should handle year boundary with week 53 and sparse data', () => {
      const weeklyData = [
        createWeeklyData({ week: weekId('2020-W52'), amount: -400 }), // +100 surplus
        // W53 missing (but exists in 2020)
        createWeeklyData({ week: weekId('2021-W01'), amount: -450 }), // +50 surplus
        createWeeklyData({ week: weekId('2021-W02'), amount: -500 }), // 0 variance
      ];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2020-W52'),
        weekId('2021-W03')
      );
      // W52(+100) + W01(+50) + W02(0) = 150
      // W53 is missing but doesn't affect rollover calculation
      expect(rollover.get('groceries')).toBe(150);
    });

    it('should correctly filter week range boundaries (inclusive fromWeek, exclusive toWeek)', () => {
      const weeklyData = [
        createWeeklyData({ week: weekId('2025-W01'), amount: -400 }), // fromWeek: included
        createWeeklyData({ week: weekId('2025-W02'), amount: -450 }), // middle: included
        createWeeklyData({ week: weekId('2025-W03'), amount: -550 }), // toWeek: excluded
      ];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2025-W01'),
        weekId('2025-W03')
      );
      // Only W01(+100) and W02(+50) should be included, W03 is excluded
      expect(rollover.get('groceries')).toBe(150);
    });

    it('should handle very sparse data across multiple year boundaries', () => {
      const weeklyData = [
        createWeeklyData({ week: weekId('2023-W52'), amount: -400 }), // +100
        // Many missing weeks
        createWeeklyData({ week: weekId('2024-W26'), amount: -450 }), // +50
        // More missing weeks
        createWeeklyData({ week: weekId('2024-W52'), amount: -550 }), // -50
        // Year boundary missing weeks
        createWeeklyData({ week: weekId('2025-W10'), amount: -500 }), // 0
      ];
      const budgetPlan = createBudgetPlan();
      const rollover = calculateRolloverAccumulation(
        weeklyData,
        budgetPlan,
        weekId('2023-W52'),
        weekId('2025-W11')
      );
      // cumulative: 100 + 50 + (-50) + 0 = 100
      expect(rollover.get('groceries')).toBe(100);
    });

    it('should throw on rollover overflow', () => {
      const weeklyData = [
        createWeeklyData({ week: weekId('2025-W01'), amount: Number.MAX_VALUE }),
        createWeeklyData({ week: weekId('2025-W02'), amount: Number.MAX_VALUE }),
      ];
      const budgetPlan: BudgetPlan = {
        categoryBudgets: {
          groceries: {
            weeklyTarget: -500, // Large negative vs MAX_VALUE positive creates overflow
            rolloverEnabled: true,
          },
        },
        lastModified: new Date().toISOString(),
      };

      expect(() =>
        calculateRolloverAccumulation(
          weeklyData,
          budgetPlan,
          weekId('2025-W01'),
          weekId('2025-W03')
        )
      ).toThrow('Rollover calculation failed: Overflow for groceries');
    });
  });

  describe('calculateRolloverAccumulation error banners', () => {
    const createWeeklyData = (overrides: Partial<WeeklyData>): WeeklyData => ({
      week: weekId(weekId('2025-W02')) as WeekId,
      category: 'groceries' as Category,
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
        groceries: {
          weeklyTarget: -500,
          rolloverEnabled: true,
        },
        income: {
          weeklyTarget: 2000,
          rolloverEnabled: true,
        },
      },
      lastModified: new Date().toISOString(),
    });

    beforeEach(() => {
      vi.spyOn(StateManager, 'showErrorBanner').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should show error banner for invalid numeric value before throwing', () => {
      const weeklyData = [createWeeklyData({ week: weekId('2025-W02'), amount: -Infinity })];
      const budgetPlan = createBudgetPlan();

      expect(() =>
        calculateRolloverAccumulation(
          weeklyData,
          budgetPlan,
          weekId('2025-W02'),
          weekId('2025-W03')
        )
      ).toThrow('Invalid numeric value');

      expect(StateManager.showErrorBanner).toHaveBeenCalledWith(
        expect.stringContaining(
          'CRITICAL: Rollover calculation failed for groceries due to invalid data'
        )
      );
      expect(StateManager.showErrorBanner).toHaveBeenCalledWith(
        expect.stringContaining('Your rollover balances cannot be calculated')
      );
    });

    it('should show error banner for overflow before throwing', () => {
      const weeklyData = [
        createWeeklyData({ week: weekId('2025-W01'), amount: Number.MAX_VALUE }),
        createWeeklyData({ week: weekId('2025-W02'), amount: Number.MAX_VALUE }),
      ];
      const budgetPlan: BudgetPlan = {
        categoryBudgets: {
          groceries: {
            weeklyTarget: -500,
            rolloverEnabled: true,
          },
        },
        lastModified: new Date().toISOString(),
      };

      expect(() =>
        calculateRolloverAccumulation(
          weeklyData,
          budgetPlan,
          weekId('2025-W01'),
          weekId('2025-W03')
        )
      ).toThrow('Overflow');

      expect(StateManager.showErrorBanner).toHaveBeenCalledWith(
        expect.stringContaining(
          'CRITICAL: Rollover calculation failed for groceries: accumulated rollover has exceeded valid range'
        )
      );
      expect(StateManager.showErrorBanner).toHaveBeenCalledWith(
        expect.stringContaining('Consider resetting your budget plan')
      );
    });
  });

  describe('calculateWeeklyComparison', () => {
    const createWeeklyData = (overrides: Partial<WeeklyData>): WeeklyData => ({
      week: weekId(weekId('2025-W02')) as WeekId,
      category: 'groceries' as Category,
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
        groceries: {
          weeklyTarget: -500,
          rolloverEnabled: true,
        },
        income: {
          weeklyTarget: 2000,
          rolloverEnabled: false,
        },
      },
      lastModified: new Date().toISOString(),
    });

    it('should calculate comparison with budget but no transactions', () => {
      const weeklyData: WeeklyData[] = [];
      const budgetPlan = createBudgetPlan();
      const comparison = calculateWeeklyComparison(
        weeklyData,
        budgetPlan,
        weekId(weekId('2025-W02'))
      );

      const groceries = comparison.find((c) => c.category === 'groceries');
      expect(groceries).toBeDefined();
      expect(groceries!.actual).toBe(0);
      expect(groceries!.target).toBe(-500);
      expect(groceries!.variance).toBe(500); // 0 - (-500) = 500 (overspent by 500)
    });

    it('should calculate comparison with transactions but no budget', () => {
      const weeklyData = [
        createWeeklyData({ category: 'entertainment' as Category, amount: -100 }),
      ];
      const budgetPlan = createBudgetPlan();
      const comparison = calculateWeeklyComparison(
        weeklyData,
        budgetPlan,
        weekId(weekId('2025-W02'))
      );

      // Entertainment has no budget, should not appear in comparison
      expect(comparison.find((c) => c.category === 'entertainment')).toBeUndefined();
    });

    it('should calculate variance correctly', () => {
      const weeklyData = [createWeeklyData({ week: weekId(weekId('2025-W02')), amount: -400 })];
      const budgetPlan = createBudgetPlan();
      const comparison = calculateWeeklyComparison(
        weeklyData,
        budgetPlan,
        weekId(weekId('2025-W02'))
      );

      const groceries = comparison.find((c) => c.category === 'groceries');
      expect(groceries!.variance).toBe(100); // -400 - (-500) = 100
    });

    it('should include rollover in effectiveTarget', () => {
      const weeklyData = [
        createWeeklyData({ week: weekId('2025-W02'), amount: -400 }), // creates 100 rollover
        createWeeklyData({ week: weekId(weekId('2025-W03')), amount: -0 }),
      ];
      const budgetPlan = createBudgetPlan();
      const comparison = calculateWeeklyComparison(
        weeklyData,
        budgetPlan,
        weekId(weekId('2025-W03'))
      );

      const groceries = comparison.find((c) => c.category === 'groceries');
      expect(groceries!.rolloverAccumulated).toBe(100);
      expect(groceries!.effectiveTarget).toBe(-400); // -500 + 100 = -400
    });

    it('should return comparison for all categories in budget plan', () => {
      const weeklyData = [createWeeklyData({ week: weekId(weekId('2025-W02')), amount: -400 })];
      const budgetPlan = createBudgetPlan();
      const comparison = calculateWeeklyComparison(
        weeklyData,
        budgetPlan,
        weekId(weekId('2025-W02'))
      );

      expect(comparison.length).toBe(2); // Groceries and Income
      expect(comparison.find((c) => c.category === 'groceries')).toBeDefined();
      expect(comparison.find((c) => c.category === 'income')).toBeDefined();
    });
  });

  describe('calculateWeeklyComparison error handling', () => {
    const createWeeklyData = (overrides: Partial<WeeklyData>): WeeklyData => ({
      week: weekId(weekId('2025-W02')) as WeekId,
      category: 'groceries' as Category,
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
        groceries: {
          weeklyTarget: -500,
          rolloverEnabled: true,
        },
        income: {
          weeklyTarget: 2000,
          rolloverEnabled: false,
        },
      },
      lastModified: new Date().toISOString(),
    });

    beforeEach(() => {
      vi.spyOn(StateManager, 'showErrorBanner').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should skip category and show error banner when createWeeklyBudgetComparison throws', () => {
      // Mock createWeeklyBudgetComparison to throw for one category
      vi.spyOn(types, 'createWeeklyBudgetComparison').mockImplementation(
        (week, category, actual, target, rollover) => {
          if (category === 'groceries') {
            throw new Error('Invalid numeric value in comparison');
          }
          // For other categories, return a valid comparison
          return {
            week,
            category,
            actual,
            target,
            variance: actual - target,
            rolloverAccumulated: rollover,
            effectiveTarget: target + rollover,
          };
        }
      );

      const weeklyData = [createWeeklyData({ week: weekId('2025-W02'), amount: -400 })];
      const budgetPlan: BudgetPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: -500, rolloverEnabled: true },
          income: { weeklyTarget: 2000, rolloverEnabled: false },
        },
        lastModified: new Date().toISOString(),
      };

      const comparison = calculateWeeklyComparison(weeklyData, budgetPlan, weekId('2025-W02'));

      // Should skip groceries but include income
      expect(comparison.find((c) => c.category === 'groceries')).toBeUndefined();
      expect(comparison.find((c) => c.category === 'income')).toBeDefined();

      // Should show error banner
      expect(StateManager.showErrorBanner).toHaveBeenCalledWith(
        expect.stringContaining('Budget comparison failed for groceries due to invalid data')
      );
    });

    it('should show specific error banner for arithmetic overflow', () => {
      vi.spyOn(types, 'createWeeklyBudgetComparison').mockImplementation(
        (week, category, actual, target, rollover) => {
          if (category === 'groceries') {
            throw new Error('Arithmetic overflow in calculation');
          }
          return {
            week,
            category,
            actual,
            target,
            variance: actual - target,
            rolloverAccumulated: rollover,
            effectiveTarget: target + rollover,
          };
        }
      );

      const weeklyData = [];
      const budgetPlan = createBudgetPlan();

      calculateWeeklyComparison(weeklyData, budgetPlan, weekId('2025-W02'));

      expect(StateManager.showErrorBanner).toHaveBeenCalledWith(
        expect.stringContaining('arithmetic overflow')
      );
      expect(StateManager.showErrorBanner).toHaveBeenCalledWith(
        expect.stringContaining('Consider resetting your budget plan')
      );
    });
  });

  describe('predictCashFlow', () => {
    const createWeeklyData = (overrides: Partial<WeeklyData>): WeeklyData => ({
      week: weekId(weekId('2025-W02')) as WeekId,
      category: 'groceries' as Category,
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
        groceries: {
          weeklyTarget: -500,
          rolloverEnabled: true,
        },
        income: {
          weeklyTarget: 2000,
          rolloverEnabled: false,
        },
      },
      lastModified: new Date().toISOString(),
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
          week: weekId(weekId('2025-W01')),
          category: 'income' as Category,
          amount: 2000,
          isIncome: true,
        }),
        createWeeklyData({ week: weekId(weekId('2025-W01')), amount: -400 }),
        createWeeklyData({
          week: weekId(weekId('2025-W02')),
          category: 'income' as Category,
          amount: 2200,
          isIncome: true,
        }),
        createWeeklyData({ week: weekId(weekId('2025-W02')), amount: -600 }),
        createWeeklyData({
          week: weekId(weekId('2025-W03')),
          category: 'income' as Category,
          amount: 1800,
          isIncome: true,
        }),
        createWeeklyData({ week: weekId(weekId('2025-W03')), amount: -500 }),
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
          week: weekId(weekId('2025-W01')),
          category: 'income' as Category,
          amount: 1000,
          isIncome: true,
        }),
        createWeeklyData({
          week: weekId(weekId('2025-W02')),
          category: 'income' as Category,
          amount: 2000,
          isIncome: true,
        }),
        createWeeklyData({
          week: weekId(weekId('2025-W03')),
          category: 'income' as Category,
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
          week: weekId(weekId('2025-W01')),
          category: 'income' as Category,
          amount: 1500,
          isIncome: true,
        }),
        createWeeklyData({ week: weekId(weekId('2025-W01')), amount: -400 }),
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
          week: weekId(weekId('2025-W01')),
          category: 'income' as Category,
          amount: 2000,
          isIncome: true,
        }),
        createWeeklyData({ week: weekId(weekId('2025-W01')), amount: -500 }),
      ];
      const budgetPlan = createBudgetPlan();
      const prediction = predictCashFlow(budgetPlan, historicData, 12);

      // Should use all available weeks (1 week)
      expect(prediction.historicAvgIncome).toBe(2000);
      expect(prediction.historicAvgExpense).toBe(500);
    });

    it('should handle empty budget plan gracefully', () => {
      const emptyBudgetPlan: BudgetPlan = {
        categoryBudgets: {},
        lastModified: new Date().toISOString(),
      };
      const prediction = predictCashFlow(emptyBudgetPlan, [], 12);

      expect(prediction.totalIncomeTarget).toBe(0);
      expect(prediction.totalExpenseTarget).toBe(0);
      expect(prediction.predictedNetIncome).toBe(0);
      expect(prediction.historicAvgIncome).toBe(0);
      expect(prediction.historicAvgExpense).toBe(0);
      expect(prediction.variance).toBe(0);
    });

    it('should handle historic data with only expenses (no income)', () => {
      const historicData = [
        createWeeklyData({ week: weekId(weekId('2025-W01')), amount: -400 }),
        createWeeklyData({ week: weekId(weekId('2025-W02')), amount: -600 }),
        createWeeklyData({ week: weekId(weekId('2025-W03')), amount: -500 }),
      ];
      const budgetPlan = createBudgetPlan();
      const prediction = predictCashFlow(budgetPlan, historicData, 12);

      // Average expense: (400 + 600 + 500) / 3 = 500
      expect(prediction.historicAvgIncome).toBe(0);
      expect(prediction.historicAvgExpense).toBe(500);
      expect(prediction.predictedNetIncome).toBe(1500); // 2000 - 500
      expect(prediction.variance).toBe(2000); // 1500 - (-500)
    });

    it('should handle historic data with only income (no expenses)', () => {
      const historicData = [
        createWeeklyData({
          week: weekId(weekId('2025-W01')),
          category: 'income' as Category,
          amount: 2000,
          isIncome: true,
        }),
        createWeeklyData({
          week: weekId(weekId('2025-W02')),
          category: 'income' as Category,
          amount: 2200,
          isIncome: true,
        }),
        createWeeklyData({
          week: weekId(weekId('2025-W03')),
          category: 'income' as Category,
          amount: 1800,
          isIncome: true,
        }),
      ];
      const budgetPlan = createBudgetPlan();
      const prediction = predictCashFlow(budgetPlan, historicData, 12);

      // Average income: (2000 + 2200 + 1800) / 3 = 2000
      expect(prediction.historicAvgIncome).toBe(2000);
      expect(prediction.historicAvgExpense).toBe(0);
      expect(prediction.predictedNetIncome).toBe(1500); // 2000 - 500
      expect(prediction.variance).toBe(-500); // 1500 - 2000
    });

    it('should handle sparse historic data with missing weeks', () => {
      const historicData = [
        createWeeklyData({
          week: weekId(weekId('2025-W01')),
          category: 'income' as Category,
          amount: 2000,
          isIncome: true,
        }),
        createWeeklyData({ week: weekId(weekId('2025-W01')), amount: -500 }),
        // W02 missing
        createWeeklyData({
          week: weekId(weekId('2025-W03')),
          category: 'income' as Category,
          amount: 2200,
          isIncome: true,
        }),
        createWeeklyData({ week: weekId(weekId('2025-W03')), amount: -400 }),
        // W04 missing
        createWeeklyData({
          week: weekId(weekId('2025-W05')),
          category: 'income' as Category,
          amount: 1800,
          isIncome: true,
        }),
        createWeeklyData({ week: weekId(weekId('2025-W05')), amount: -600 }),
      ];
      const budgetPlan = createBudgetPlan();
      const prediction = predictCashFlow(budgetPlan, historicData, 12);

      // Average income: (2000 + 2200 + 1800) / 3 = 2000
      // Average expense: (500 + 400 + 600) / 3 = 500
      expect(prediction.historicAvgIncome).toBe(2000);
      expect(prediction.historicAvgExpense).toBe(500);
    });

    it('should handle zero values in budget targets', () => {
      const budgetPlanWithZeros: BudgetPlan = {
        categoryBudgets: {
          groceries: {
            weeklyTarget: 0,
            rolloverEnabled: true,
          },
          income: {
            weeklyTarget: 0,
            rolloverEnabled: false,
          },
        },
        lastModified: new Date().toISOString(),
      };
      const prediction = predictCashFlow(budgetPlanWithZeros, [], 12);

      expect(prediction.totalIncomeTarget).toBe(0);
      expect(prediction.totalExpenseTarget).toBe(0);
      expect(prediction.predictedNetIncome).toBe(0);
    });

    it('should handle zero historic data without crashing', () => {
      const budgetPlan = createBudgetPlan();
      const prediction = predictCashFlow(budgetPlan, [], 12);

      expect(prediction.historicAvgIncome).toBe(0);
      expect(prediction.historicAvgExpense).toBe(0);
      expect(prediction.variance).toBe(prediction.predictedNetIncome); // variance = predicted - 0
    });

    it('should handle single week of historic data', () => {
      const historicData = [
        createWeeklyData({
          week: weekId('2025-W01'),
          category: 'income' as Category,
          amount: 1800,
          isIncome: true,
        }),
        createWeeklyData({ week: weekId('2025-W01'), amount: -400 }),
      ];
      const budgetPlan = createBudgetPlan();
      const prediction = predictCashFlow(budgetPlan, historicData, 12);

      // Should use the single week without division by zero
      expect(prediction.historicAvgIncome).toBe(1800);
      expect(prediction.historicAvgExpense).toBe(400);
      // Predicted: 2000 - 500 = 1500, Historic: 1800 - 400 = 1400, Variance: 100
      expect(prediction.variance).toBe(100);
    });

    it('should handle extreme budget vs historic variance', () => {
      const historicData = [
        createWeeklyData({
          week: weekId('2025-W01'),
          category: 'income' as Category,
          amount: 100,
          isIncome: true,
        }),
        createWeeklyData({ week: weekId('2025-W01'), amount: -50 }),
      ];

      const extremeBudgetPlan: BudgetPlan = {
        categoryBudgets: {
          income: {
            weeklyTarget: 10000, // 100x historic
            rolloverEnabled: false,
          },
          groceries: {
            weeklyTarget: -5000, // 100x historic
            rolloverEnabled: true,
          },
        },
        lastModified: new Date().toISOString(),
      };

      const prediction = predictCashFlow(extremeBudgetPlan, historicData, 12);

      // Historic: 100 - 50 = 50
      // Predicted: 10000 - 5000 = 5000
      // Variance: 5000 - 50 = 4950
      expect(prediction.historicAvgIncome).toBe(100);
      expect(prediction.historicAvgExpense).toBe(50);
      expect(prediction.predictedNetIncome).toBe(5000);
      expect(prediction.variance).toBe(4950);
      expect(Number.isFinite(prediction.variance)).toBe(true); // No overflow
    });

    it('should throw error for NaN propagation in variance calculation', () => {
      const historicDataWithNaN = [
        createWeeklyData({
          week: weekId('2025-W01'),
          category: 'income' as Category,
          amount: NaN,
          isIncome: true,
        }),
        createWeeklyData({ week: weekId('2025-W01'), amount: -500 }),
      ];
      const budgetPlan = createBudgetPlan();

      // createCashFlowPrediction now throws on invalid inputs instead of returning 0s
      expect(() => predictCashFlow(budgetPlan, historicDataWithNaN, 12)).toThrow(
        'Cash flow prediction failed: Invalid numeric values in inputs'
      );
    });

    it('should throw error for Infinity in historic data', () => {
      const historicDataWithInfinity = [
        createWeeklyData({
          week: weekId('2025-W01'),
          category: 'income' as Category,
          amount: Infinity,
          isIncome: true,
        }),
        createWeeklyData({ week: weekId('2025-W01'), amount: -500 }),
      ];
      const budgetPlan = createBudgetPlan();

      // createCashFlowPrediction now throws on invalid inputs instead of returning 0s
      expect(() => predictCashFlow(budgetPlan, historicDataWithInfinity, 12)).toThrow(
        'Cash flow prediction failed: Invalid numeric values in inputs'
      );
    });
  });

  describe('getAvailableWeeks', () => {
    const createTransaction = (overrides: Partial<Transaction>): Transaction => ({
      id: 'txn-1',
      date: '2025-01-06',
      category: 'groceries' as Category,
      amount: -100,
      description: 'Test',
      transfer: false,
      vacation: false,
      redeemable: false,
      redemptionRate: 0,
      statementIds: [],
      ...overrides,
    });

    it('should return unique weeks sorted', () => {
      const transactions = [
        createTransaction({ date: '2025-01-06' }), // W02
        createTransaction({ date: '2025-01-13' }), // W03
        createTransaction({ date: '2025-01-07' }), // W02
      ];
      const weeks = getAvailableWeeks(transactions);
      expect(weeks).toEqual([weekId('2025-W02'), weekId('2025-W03')]);
    });

    it('should return empty array for no transactions', () => {
      const weeks = getAvailableWeeks([]);
      expect(weeks).toEqual([]);
    });
  });

  describe('getNextWeek and getPreviousWeek', () => {
    it('should navigate to next week', () => {
      expect(getNextWeek(weekId(weekId('2025-W02')))).toBe(weekId('2025-W03'));
    });

    it('should navigate across year boundary (forward)', () => {
      expect(getNextWeek(weekId(weekId('2024-W52')))).toBe(weekId('2025-W01'));
    });

    it('should navigate to previous week', () => {
      expect(getPreviousWeek(weekId(weekId('2025-W03')))).toBe(weekId('2025-W02'));
    });

    it('should navigate across year boundary (backward)', () => {
      expect(getPreviousWeek(weekId(weekId('2025-W01')))).toBe(weekId('2024-W52'));
    });

    it('should handle week 53 navigation', () => {
      expect(getNextWeek(weekId(weekId('2020-W53')))).toBe(weekId('2021-W01'));
      expect(getPreviousWeek(weekId(weekId('2021-W01')))).toBe(weekId('2020-W53'));
    });

    it('should support roundtrip navigation', () => {
      const week = weekId('2025-W15') as WeekId;
      expect(getPreviousWeek(getNextWeek(week))).toBe(week);
      expect(getNextWeek(getPreviousWeek(week))).toBe(week);
    });
  });
});
