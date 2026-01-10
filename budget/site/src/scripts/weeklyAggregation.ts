import {
  Transaction,
  WeeklyData,
  WeekId,
  Category,
  BudgetPlan,
  WeeklyBudgetComparison,
  CashFlowPrediction,
  QualifierBreakdown,
  createQualifierBreakdown,
  validateWeeklyData,
  createWeeklyBudgetComparison,
} from '../islands/types';
import { StateManager } from './state';

/**
 * Determine the ISO week identifier for a given date.
 * Uses ISO 8601 week date system (Monday = week start).
 * @param date - ISO date string (YYYY-MM-DD)
 * @returns ISO week identifier in format YYYY-WNN (e.g., "2025-W01")
 */
export function getISOWeek(date: string): WeekId {
  const d = new Date(date);
  // Set to nearest Thursday (ISO week date system)
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  // Get first day of year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  // Calculate full weeks to nearest Thursday
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  // Return ISO week identifier
  return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}` as WeekId;
}

/**
 * Get week boundaries (Monday-Sunday) for an ISO week identifier
 */
export function getWeekBoundaries(weekId: WeekId): { start: string; end: string } {
  const match = weekId.match(/^(\d{4})-W(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid week ID: ${weekId}`);
  }

  const year = parseInt(match[1], 10);
  const week = parseInt(match[2], 10);

  // ISO 8601: Week 1 is the week with the first Thursday of the year
  // Calculate the first day of week 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const firstMonday = new Date(jan4);
  firstMonday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));

  // Calculate the Monday of the target week
  const weekStart = new Date(firstMonday);
  weekStart.setUTCDate(firstMonday.getUTCDate() + (week - 1) * 7);

  // Calculate the Sunday of the target week
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

  return {
    start: weekStart.toISOString().substring(0, 10),
    end: weekEnd.toISOString().substring(0, 10),
  };
}

/**
 * Get the current week ID
 */
export function getCurrentWeek(): WeekId {
  return getISOWeek(new Date().toISOString().substring(0, 10));
}

/**
 * Transform transactions to weekly aggregates
 */
export function aggregateTransactionsByWeek(
  transactions: Transaction[],
  filters: { hiddenCategories: Set<string>; showVacation: boolean }
): WeeklyData[] {
  // Filter out transfers and apply category/vacation filters
  const filteredTransactions = transactions.filter((txn) => {
    if (txn.transfer) return false;
    if (!filters.showVacation && txn.vacation) return false;
    if (filters.hiddenCategories.has(txn.category)) return false;
    return true;
  });

  // Group by week and category
  const weeklyMap = new Map<
    WeekId,
    Map<Category, { amount: number; qualifiers: QualifierBreakdown }>
  >();

  filteredTransactions.forEach((txn) => {
    const week = getISOWeek(txn.date);
    const displayAmount = txn.redeemable ? txn.amount * txn.redemptionRate : txn.amount;

    if (!weeklyMap.has(week)) {
      weeklyMap.set(week, new Map());
    }

    const categoryMap = weeklyMap.get(week)!;
    const current = categoryMap.get(txn.category) || {
      amount: 0,
      qualifiers: createQualifierBreakdown(),
    };

    // Update amount
    current.amount += displayAmount;

    // Track qualifier breakdowns
    if (txn.redeemable) {
      current.qualifiers.redeemable += displayAmount;
    } else {
      current.qualifiers.nonRedeemable += displayAmount;
    }

    if (txn.vacation) {
      current.qualifiers.vacation += displayAmount;
    } else {
      current.qualifiers.nonVacation += displayAmount;
    }

    current.qualifiers.transactionCount++;

    categoryMap.set(txn.category, current);
  });

  // Convert to array format
  const weeklyData: WeeklyData[] = [];
  const skippedWeeks = new Set<WeekId>();
  const skippedTransactionsByWeek = new Map<WeekId, Transaction[]>();

  weeklyMap.forEach((categoryMap, week) => {
    let boundaries;
    try {
      boundaries = getWeekBoundaries(week);
    } catch (error) {
      console.error(`Failed to get boundaries for week ${week}:`, error);

      // Track transactions that will be excluded
      const affectedTransactions = filteredTransactions.filter((t) => getISOWeek(t.date) === week);
      skippedTransactionsByWeek.set(week, affectedTransactions);

      skippedWeeks.add(week);
      // Skip this week - invalid week ID format or date calculation error. Transactions will not appear in any view (both weekly and monthly).
      // User is notified via error banner below (lines 165-167).
      return;
    }

    categoryMap.forEach((data, category) => {
      const weeklyDataItem: WeeklyData = {
        week,
        category,
        amount: data.amount,
        isIncome: data.amount > 0,
        qualifiers: data.qualifiers,
        weekStartDate: boundaries.start,
        weekEndDate: boundaries.end,
      };

      // Validate consistency to catch silent corruption
      if (!validateWeeklyData(weeklyDataItem, getWeekBoundaries)) {
        console.error(`Skipping invalid WeeklyData for ${category} in ${week}`);
        return;
      }

      weeklyData.push(weeklyDataItem);
    });
  });

  // Notify user if any weeks were skipped
  if (skippedWeeks.size > 0) {
    // Log detailed transaction information for each skipped week
    skippedTransactionsByWeek.forEach((transactions, week) => {
      const totalAmount = transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
      console.error(`Excluding ${transactions.length} transactions from week ${week}:`, {
        transactions: transactions.map((t) => ({
          date: t.date,
          amount: t.amount,
          category: t.category,
          description: t.description,
        })),
        totalAmount,
      });
    });

    const weekList = Array.from(skippedWeeks).join(', ');
    const message = `Data quality issue: ${skippedWeeks.size} week(s) excluded due to invalid dates: ${weekList}. Transactions from these weeks are PERMANENTLY excluded from all views. Check browser console for affected transaction details.`;

    console.error(message);
    console.error(
      'TO FIX: Review the transaction dates shown above and re-import with valid YYYY-MM-DD format'
    );

    // Critical data loss - use error banner
    StateManager.showErrorBanner(
      `⚠️ ${skippedWeeks.size} week(s) of data excluded due to date errors. Your charts are incomplete. See console for details on affected transactions.`
    );
  }

  // Sort by week and category
  weeklyData.sort((a, b) => {
    const weekCompare = a.week.localeCompare(b.week);
    if (weekCompare !== 0) return weekCompare;
    return a.category.localeCompare(b.category);
  });

  return weeklyData;
}

/**
 * Calculate cumulative rollover for categories with rollover enabled.
 * Accumulates budget variance from fromWeek (inclusive) to toWeek (exclusive).
 * Negative rollover indicates accumulated debt, positive indicates accumulated surplus.
 * @param weeklyData - All weekly transaction data
 * @param budgetPlan - Budget plan with category targets and rollover settings
 * @param fromWeek - Start week (inclusive) - typically first week of data
 * @param toWeek - End week (exclusive). Calculates rollover accumulated up to but not including toWeek.
 *   Example: pass '2025-W05' to get rollover available for W05 budget adjustment (accumulated through end of W04).
 *   The returned rollover adjusts toWeek's effective budget target.
 * @returns Map of category to accumulated rollover amount at the start of toWeek
 */
export function calculateRolloverAccumulation(
  weeklyData: WeeklyData[],
  budgetPlan: BudgetPlan,
  fromWeek: WeekId,
  toWeek: WeekId
): Map<Category, number> {
  const rolloverMap = new Map<Category, number>();

  // Get all weeks between fromWeek and toWeek (inclusive of fromWeek, exclusive of toWeek)
  const weeks = Array.from(new Set(weeklyData.map((d) => d.week)))
    .filter((w) => w >= fromWeek && w < toWeek)
    .sort();

  // Initialize rollover for each category with budget
  Object.entries(budgetPlan.categoryBudgets).forEach(([category, budget]) => {
    if (budget.rolloverEnabled) {
      rolloverMap.set(category as Category, 0);
    }
  });

  // Calculate cumulative rollover week by week
  weeks.forEach((week) => {
    const weekData = weeklyData.filter((d) => d.week === week);

    Object.entries(budgetPlan.categoryBudgets).forEach(([category, budget]) => {
      if (!budget.rolloverEnabled) return;

      const cat = category as Category;
      const actual = weekData.find((d) => d.category === cat)?.amount || 0;
      const target = budget.weeklyTarget;
      const variance = actual - target;

      // See calculateWeeklyComparison JSDoc for variance calculation convention
      const currentRollover = rolloverMap.get(cat) || 0;
      rolloverMap.set(cat, currentRollover + variance);
    });
  });

  return rolloverMap;
}

/**
 * Calculate budget vs actual for a specific week.
 *
 * Variance calculation convention:
 * - Positive variance: Spending less than budget (good for expenses) OR earning more than target (good for income)
 * - Negative variance: Spending more than budget (bad for expenses) OR earning less than target (bad for income)
 * - Formula: variance = actual - target (works consistently for both income and expenses)
 */
export function calculateWeeklyComparison(
  weeklyData: WeeklyData[],
  budgetPlan: BudgetPlan,
  week: WeekId
): WeeklyBudgetComparison[] {
  const comparisons: WeeklyBudgetComparison[] = [];

  // Get the first week in the data to use as the rollover start point
  const allWeeks = Array.from(new Set(weeklyData.map((d) => d.week))).sort();
  const firstWeek = allWeeks[0] || week;

  // Calculate rollover up to the target week
  const rolloverMap = calculateRolloverAccumulation(weeklyData, budgetPlan, firstWeek, week);

  // Get data for the target week
  const weekData = weeklyData.filter((d) => d.week === week);

  // Create comparison for each category with a budget
  Object.entries(budgetPlan.categoryBudgets).forEach(([category, budget]) => {
    const cat = category as Category;
    const actual = weekData.find((d) => d.category === cat)?.amount || 0;
    const target = budget.weeklyTarget;
    const rolloverAccumulated = rolloverMap.get(cat) || 0;

    comparisons.push(createWeeklyBudgetComparison(week, cat, actual, target, rolloverAccumulated));
  });

  return comparisons;
}

/**
 * Predict cash flow from budget plan + historic averages
 * Uses the last N weeks of data to calculate historic averages (default: 12 weeks)
 */
export function predictCashFlow(
  budgetPlan: BudgetPlan,
  historicData: WeeklyData[],
  weeksToAverage: number = 12
): CashFlowPrediction {
  // Calculate budget plan totals
  let totalIncomeTarget = 0;
  let totalExpenseTarget = 0;

  Object.values(budgetPlan.categoryBudgets).forEach((budget) => {
    if (budget.weeklyTarget > 0) {
      totalIncomeTarget += budget.weeklyTarget;
    } else {
      totalExpenseTarget += Math.abs(budget.weeklyTarget);
    }
  });

  const predictedNetIncome = totalIncomeTarget - totalExpenseTarget;

  // Calculate historic averages from last N weeks
  const allWeeks = Array.from(new Set(historicData.map((d) => d.week))).sort();
  const recentWeeks = allWeeks.slice(-weeksToAverage);

  if (recentWeeks.length === 0) {
    // No historic data
    return {
      totalIncomeTarget,
      totalExpenseTarget,
      predictedNetIncome,
      historicAvgIncome: 0,
      historicAvgExpense: 0,
      variance: predictedNetIncome,
    };
  }

  // Calculate average weekly income and expenses
  let totalHistoricIncome = 0;
  let totalHistoricExpense = 0;

  recentWeeks.forEach((week) => {
    const weekData = historicData.filter((d) => d.week === week);
    weekData.forEach((d) => {
      if (d.isIncome) {
        totalHistoricIncome += d.amount;
      } else {
        totalHistoricExpense += Math.abs(d.amount);
      }
    });
  });

  const historicAvgIncome = totalHistoricIncome / recentWeeks.length;
  const historicAvgExpense = totalHistoricExpense / recentWeeks.length;
  const historicNetIncome = historicAvgIncome - historicAvgExpense;
  const variance = predictedNetIncome - historicNetIncome;

  return {
    totalIncomeTarget,
    totalExpenseTarget,
    predictedNetIncome,
    historicAvgIncome,
    historicAvgExpense,
    variance,
  };
}

/**
 * Get list of available weeks from transaction data
 */
export function getAvailableWeeks(transactions: Transaction[]): WeekId[] {
  const weeks = new Set<WeekId>();
  transactions.forEach((txn) => {
    weeks.add(getISOWeek(txn.date));
  });
  return Array.from(weeks).sort();
}

/**
 * Navigate to the next week (ISO 8601 week system).
 * Correctly handles year boundaries and weeks with 53 weeks.
 * @param currentWeek - Current ISO week identifier (e.g., "2024-W52")
 * @returns Next week identifier (e.g., "2025-W01")
 */
export function getNextWeek(currentWeek: WeekId): WeekId {
  try {
    const boundaries = getWeekBoundaries(currentWeek);
    const nextMonday = new Date(boundaries.start);
    nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
    return getISOWeek(nextMonday.toISOString().substring(0, 10));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to calculate next week from ${currentWeek}:`, error);

    // Preserve original error as cause
    const enhancedError = new Error(
      `Invalid week ID "${currentWeek}": cannot calculate next week. ${errorMessage}. Expected format: YYYY-WNN (e.g., "2025-W01")`,
      { cause: error }
    );
    throw enhancedError;
  }
}

/**
 * Navigate to the previous week (ISO 8601 week system).
 * Correctly handles year boundaries and weeks with 53 weeks.
 * @param currentWeek - Current ISO week identifier (e.g., "2025-W01")
 * @returns Previous week identifier (e.g., "2024-W52")
 */
export function getPreviousWeek(currentWeek: WeekId): WeekId {
  try {
    const boundaries = getWeekBoundaries(currentWeek);
    const prevMonday = new Date(boundaries.start);
    prevMonday.setUTCDate(prevMonday.getUTCDate() - 7);
    return getISOWeek(prevMonday.toISOString().substring(0, 10));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to calculate previous week from ${currentWeek}:`, error);

    // Preserve original error as cause
    const enhancedError = new Error(
      `Invalid week ID "${currentWeek}": cannot calculate previous week. ${errorMessage}. Expected format: YYYY-WNN (e.g., "2025-W01")`,
      { cause: error }
    );
    throw enhancedError;
  }
}
