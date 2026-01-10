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
  createCashFlowPrediction,
} from '../islands/types';
import {
  updateQualifierBreakdown,
  filterTransactions,
  getDisplayAmount,
} from '../islands/qualifierUtils';
import { StateManager } from './state';
import {
  getISOWeek,
  getWeekBoundaries,
  getCurrentWeek,
  getNextWeek,
  getPreviousWeek,
} from '../utils/weekDates';

// Re-export week utilities from weekDates.ts
export { getISOWeek, getWeekBoundaries, getCurrentWeek, getNextWeek, getPreviousWeek };

/**
 * Transform transactions to weekly aggregates
 */
export function aggregateTransactionsByWeek(
  transactions: Transaction[],
  filters: { hiddenCategories: Set<string>; showVacation: boolean }
): WeeklyData[] {
  // Filter out transfers and apply category/vacation filters
  const filteredTransactions = filterTransactions(transactions, filters);

  // Group by week and category
  const weeklyMap = new Map<
    WeekId,
    Map<Category, { amount: number; qualifiers: QualifierBreakdown }>
  >();

  filteredTransactions.forEach((txn) => {
    const week = getISOWeek(txn.date);
    const displayAmount = getDisplayAmount(txn);

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
    updateQualifierBreakdown(current.qualifiers, txn, displayAmount);

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
      // Skip this week - invalid week ID format or date calculation error.
      // Transactions from this week are excluded from weekly aggregation.
      // Monthly view uses LESS STRICT parsing (YYYY-MM substring extraction)
      // that doesn't validate ISO week format, so transactions may appear there.
      // However, invalid dates like "2025-02-31" would still be problematic.
      // User is notified via error banner below (search for 'showErrorBanner').
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
    const message = `Data quality issue: ${skippedWeeks.size} week(s) excluded due to invalid dates: ${weekList}. Transactions from these weeks are excluded from WEEKLY view but will still appear in MONTHLY view. Check browser console for affected transaction details.`;

    console.error(message);
    console.error(
      'TO FIX: Review the transaction dates shown above and re-import with valid YYYY-MM-DD format'
    );

    // Check if we skipped ALL weeks
    if (weeklyData.length === 0) {
      StateManager.showErrorBanner(
        `CRITICAL: All transaction data excluded due to date errors. Weekly view is unavailable. ` +
          `Switch to Monthly view or reimport transactions with valid YYYY-MM-DD dates. ` +
          `Skipped weeks: ${weekList}`
      );
    } else {
      // Partial data available - use existing error message
      StateManager.showErrorBanner(
        `⚠️ ${skippedWeeks.size} week(s) of data excluded due to date errors. Your charts are incomplete. See console for details on affected transactions.`
      );
    }
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
 * @param fromWeek - Start week (inclusive) for rollover calculation window.
 *   Should be the first week where budget tracking began, or the earliest week in weeklyData.
 *   Using a week later than budget start will exclude earlier rollover accumulation from results.
 *   Example: If budget started '2025-W01', always pass '2025-W01' to include full rollover history.
 * @param toWeek - End week (exclusive). Calculates rollover accumulated up to but not including toWeek.
 *   Example: pass '2025-W05' to get rollover available for W05 budget adjustment (accumulated through end of W04).
 *   The returned rollover adjusts toWeek's effective budget target.
 * @returns Map of category to accumulated rollover amount available for toWeek's budget adjustment (accumulated through end of toWeek-1, excluding toWeek's transactions)
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

    // Warn about data for non-budgeted categories
    weekData.forEach((data) => {
      if (!budgetPlan.categoryBudgets[data.category]) {
        console.warn(
          `Found transaction data for ${data.category} in week ${week} but no budget configured for this category`
        );
      }
    });

    Object.entries(budgetPlan.categoryBudgets).forEach(([category, budget]) => {
      if (!budget.rolloverEnabled) return;

      const cat = category as Category;
      const actual = weekData.find((d) => d.category === cat)?.amount || 0;
      const target = budget.weeklyTarget;

      // Validate numeric values before arithmetic
      if (!Number.isFinite(actual) || !Number.isFinite(target)) {
        console.error(`Invalid numeric value in rollover calculation for ${cat} week ${week}`, {
          actual,
          target,
        });

        // Notify user that rollover calculation has failed
        StateManager.showErrorBanner(
          `CRITICAL: Rollover calculation failed for ${cat} due to invalid data in week ${week}. ` +
            `Your rollover balances cannot be calculated. Check console for details and reimport your transactions.`
        );

        // Throw to prevent returning corrupted data
        throw new Error(
          `Rollover calculation failed: Invalid numeric value for ${cat} in week ${week} (actual=${actual}, target=${target})`
        );
      }

      const variance = actual - target;

      // Variance = actual - target (see calculateWeeklyComparison JSDoc)
      // For expenses: Positive variance = under budget (good), negative = over budget (bad)
      // For income: Positive variance = exceeding target (good), negative = below target (bad)
      // Positive variance (unspent budget) accumulates in rollover, becoming available for future weeks.
      // Negative variance (overspending) reduces future rollover availability.
      const currentRollover = rolloverMap.get(cat) || 0;

      // Validate rollover accumulation stays finite
      const newRollover = currentRollover + variance;
      if (!Number.isFinite(newRollover)) {
        console.error(
          `Rollover overflow for ${cat}: ${currentRollover} + ${variance} = ${newRollover}`
        );

        // Notify user that rollover calculation has failed
        StateManager.showErrorBanner(
          `CRITICAL: Rollover calculation failed for ${cat}: accumulated rollover has exceeded valid range. ` +
            `Your rollover balances cannot be calculated. Consider resetting your budget plan.`
        );

        // Throw to prevent returning corrupted data
        throw new Error(
          `Rollover calculation failed: Overflow for ${cat} (${currentRollover} + ${variance} = ${newRollover})`
        );
      }

      rolloverMap.set(cat, newRollover);
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

  // Track which categories have transaction data this week
  const categoriesWithData = new Set(weekData.map((d) => d.category));

  // Create comparison for each category with a budget
  Object.entries(budgetPlan.categoryBudgets).forEach(([category, budget]) => {
    const cat = category as Category;
    const weekDataForCategory = weekData.find((d) => d.category === cat);
    const actual = weekDataForCategory?.amount || 0;

    // Log warning if category has budget but no transaction data
    // This could indicate missing data or legitimate zero spending
    if (!categoriesWithData.has(cat) && Math.abs(budget.weeklyTarget) > 0) {
      console.warn(
        `Category ${cat} has budget ($${budget.weeklyTarget}) but no transaction data for week ${week}. ` +
          `This could indicate: (1) no spending/income this week (expected), or (2) data filtering error (unexpected).`
      );
    }

    const target = budget.weeklyTarget;
    const rolloverAccumulated = rolloverMap.get(cat) || 0;

    try {
      comparisons.push(
        createWeeklyBudgetComparison(week, cat, actual, target, rolloverAccumulated)
      );
    } catch (error) {
      console.error(`Skipping budget comparison for ${cat}:`, error);

      // Show critical error to user
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Invalid numeric value')) {
        StateManager.showErrorBanner(
          `CRITICAL: Budget comparison failed for ${cat} due to invalid data. ` +
            `Your budget display may be incorrect. Check console and reimport your budget plan.`
        );
      } else if (errorMessage.includes('Arithmetic overflow')) {
        StateManager.showErrorBanner(
          `CRITICAL: Budget comparison calculation failed for ${cat} due to arithmetic overflow. ` +
            `Your accumulated rollover may be too large. Consider resetting your budget plan.`
        );
      }

      // Skip this category, continue with others
    }
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
    // Log detailed context for debugging
    console.warn('Cash flow prediction: No historic data available', {
      totalTransactionWeeks: allWeeks.length,
      historicDataPoints: historicData.length,
      weeksToAverage,
      budgetCategoriesCount: Object.keys(budgetPlan.categoryBudgets).length,
    });

    // Check if historicData is completely empty or just filtered out
    if (historicData.length === 0) {
      console.warn(
        'Historic data array is empty - possible data import failure or filtering issue'
      );
    }

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

  const historicAvgIncome = recentWeeks.length > 0 ? totalHistoricIncome / recentWeeks.length : 0;
  const historicAvgExpense = recentWeeks.length > 0 ? totalHistoricExpense / recentWeeks.length : 0;

  return createCashFlowPrediction(
    totalIncomeTarget,
    totalExpenseTarget,
    historicAvgIncome,
    historicAvgExpense
  );
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
