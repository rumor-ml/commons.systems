import { CATEGORIES } from './constants';

// Re-export Transaction, Statement, DateString and helpers from firestore.ts (single source of truth)
export type { Transaction, Statement, DateString } from '../scripts/firestore';
export { createDateString, isValidDateString } from '../scripts/firestore';

export type Category =
  | 'income'
  | 'housing'
  | 'utilities'
  | 'groceries'
  | 'dining'
  | 'transportation'
  | 'healthcare'
  | 'entertainment'
  | 'shopping'
  | 'travel'
  | 'investment'
  | 'other';

export interface Account {
  id: string;
  institutionId: string;
  name: string;
  type: 'checking' | 'savings' | 'credit' | 'investment';
}

export interface Institution {
  id: string;
  name: string;
}

export interface QualifierBreakdown {
  redeemable: number;
  nonRedeemable: number;
  vacation: number;
  nonVacation: number;
  transactionCount: number;
}

/**
 * Factory function to create a new QualifierBreakdown with all fields initialized to zero.
 * Ensures consistent initialization across the codebase.
 */
export function createQualifierBreakdown(): QualifierBreakdown {
  return {
    redeemable: 0,
    nonRedeemable: 0,
    vacation: 0,
    nonVacation: 0,
    transactionCount: 0,
  };
}

/**
 * Validate that QualifierBreakdown sums are consistent.
 * redeemable + nonRedeemable should equal vacation + nonVacation (orthogonal categorization).
 */
export function validateQualifierBreakdown(q: QualifierBreakdown): boolean {
  const redeemableTotal = q.redeemable + q.nonRedeemable;
  const vacationTotal = q.vacation + q.nonVacation;
  const tolerance = 0.01; // floating point tolerance

  if (Math.abs(redeemableTotal - vacationTotal) > tolerance) {
    console.error('QualifierBreakdown inconsistent:', {
      redeemableTotal,
      vacationTotal,
      breakdown: q,
    });
    return false;
  }
  return true;
}

// TODO(#386): Use branded YearMonth type, remove redundant isIncome, validate qualifier sums
export interface MonthlyData {
  month: string; // YYYY-MM format
  category: Category;
  amount: number; // Can be positive or negative
  isIncome: boolean;
  qualifiers: QualifierBreakdown;
}

// TODO(#386): Replace index signature with explicit Record<Category, boolean> or exhaustive interface
export interface CategoryFilter {
  [category: string]: boolean;
}

export interface TooltipData {
  month: string;
  category: Category;
  amount: number;
  isIncome: boolean;
  qualifiers: QualifierBreakdown;
  x: number;
  y: number;
}

// Time granularity enum
export type TimeGranularity = 'week' | 'month';

// Week identifier (ISO 8601: "2025-W01")
// Branded type for compile-time distinction
// IMPORTANT: Always construct via parseWeekId() or weekId() to ensure valid format.
// Manual string casting bypasses validation and can introduce invalid identifiers.
// TODO(#1882): Consider applying this pattern to DateString and other branded types (see commendation)
export type WeekId = string & { readonly __brand: 'WeekId' };

/**
 * Validates and parses a string into a WeekId.
 * @param value - String to validate (expected format: "YYYY-WNN")
 * @returns WeekId if valid, null otherwise
 */
export function parseWeekId(value: string): WeekId | null {
  // Strengthen regex to reject week 00 upfront
  if (!/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(value)) {
    return null;
  }

  return value as WeekId;
}

/**
 * Safe constructor for WeekId that throws on invalid input.
 * @param value - String to convert to WeekId
 * @returns WeekId if valid
 * @throws Error if value is not a valid week identifier
 */
export function weekId(value: string): WeekId {
  const parsed = parseWeekId(value);
  if (!parsed) {
    throw new Error(`Invalid WeekId format: ${value}`);
  }
  return parsed;
}

/**
 * Budget configuration for a category
 * @property weeklyTarget - Target spending/earning per week (must be non-zero)
 *   - Positive values for income categories (e.g., 5000 for $5k/week income)
 *   - Negative values for expense categories (e.g., -500 for $500/week spending)
 *   - To indicate no budget for a category, omit it from categoryBudgets object (don't use zero or null)
 * @property rolloverEnabled - Whether unspent budget carries to next week
 */
export interface CategoryBudget {
  readonly weeklyTarget: number;
  readonly rolloverEnabled: boolean;
}

/**
 * Validates a CategoryBudget for a given category.
 * @param budget - The budget to validate
 * @param category - The category this budget applies to
 * @returns true if valid, false otherwise
 */
export function isValidCategoryBudget(budget: CategoryBudget, category: Category): boolean {
  if (budget.weeklyTarget === 0) return false;
  if (Math.abs(budget.weeklyTarget) > 1000000) return false;

  // Income should have positive target, expenses negative
  if (category === 'income' && budget.weeklyTarget < 0) return false;
  if (category !== 'income' && budget.weeklyTarget > 0) return false;

  return true;
}

/**
 * Factory function to create a validated CategoryBudget.
 * @param category - The category this budget applies to
 * @param weeklyTarget - Target spending/earning per week
 * @param rolloverEnabled - Whether unspent budget carries to next week
 * @returns CategoryBudget if valid, null otherwise
 */
export function createCategoryBudget(
  category: Category,
  weeklyTarget: number,
  rolloverEnabled: boolean
): CategoryBudget | null {
  const budget: CategoryBudget = { weeklyTarget, rolloverEnabled };

  if (!isValidCategoryBudget(budget, category)) {
    return null;
  }

  return budget;
}

/**
 * Complete budget plan configuration
 * @property categoryBudgets - Budget targets per category.
 *   Missing categories indicate no budget has been set for that category.
 *   Use undefined/omit key rather than null to indicate "no budget".
 * @property lastModified - ISO 8601 timestamp of last modification (UTC)
 */
export interface BudgetPlan {
  readonly categoryBudgets: Partial<Record<Category, CategoryBudget>>;
  readonly lastModified: string;
}

/**
 * Creates a new BudgetPlan with validated timestamp and category budgets.
 * @param categoryBudgets - Initial category budgets (defaults to empty)
 * @param lastModified - Optional ISO timestamp (defaults to current time)
 * @returns A new BudgetPlan instance, or null if validation fails
 */
export function createBudgetPlan(
  categoryBudgets: Partial<Record<Category, CategoryBudget>> = {},
  lastModified?: string
): BudgetPlan | null {
  // Validate all category budgets
  for (const [category, budget] of Object.entries(categoryBudgets)) {
    // Type guard: ensure key is actually a valid Category
    if (!CATEGORIES.includes(category as Category)) {
      console.error(`Invalid category key: ${category}`);
      return null;
    }

    if (!isValidCategoryBudget(budget, category as Category)) {
      console.error(`Invalid budget for ${category}:`, budget);
      return null;
    }
  }

  const timestamp = lastModified || new Date().toISOString();
  if (!isValidISOTimestamp(timestamp)) {
    console.error(`Invalid timestamp: ${timestamp}`);
    return null;
  }

  return {
    categoryBudgets,
    lastModified: timestamp,
  };
}

/**
 * Validates that a string is a valid ISO 8601 timestamp.
 * @param value - String to validate
 * @returns true if value is a valid ISO timestamp, false otherwise
 */
export function isValidISOTimestamp(value: string): boolean {
  const date = new Date(value);
  return date.toISOString() === value;
}

/**
 * Weekly aggregated transaction data
 * @property week - ISO week identifier (source of truth)
 * @property category - Transaction category
 * @property amount - Total amount for the week
 * @property isIncome - Whether this represents income (amount > 0)
 * @property qualifiers - Breakdown of transaction qualifiers
 * @property weekStartDate - Derived from week (Monday). Must match getWeekBoundaries(week).start
 * @property weekEndDate - Derived from week (Sunday). Must match getWeekBoundaries(week).end
 *
 * IMPORTANT: This type contains derived fields that must stay consistent with the week identifier.
 * ALWAYS construct via aggregateTransactionsByWeek() factory to ensure date consistency.
 * Manual construction risks creating inconsistent instances. Use validateWeeklyData() to verify
 * consistency if manual construction is unavoidable.
 */
export interface WeeklyData {
  readonly week: WeekId;
  readonly category: Category;
  readonly amount: number;
  readonly isIncome: boolean;
  readonly qualifiers: Readonly<QualifierBreakdown>;
  readonly weekStartDate: string;
  readonly weekEndDate: string;
}

/**
 * Validates that a WeeklyData object has consistent week and date fields.
 * Checks that weekStartDate and weekEndDate match the week identifier.
 * @param data - WeeklyData to validate
 * @param getWeekBoundaries - Function to get week boundaries (REQUIRED - caller must provide)
 * @returns true if valid, false if week/date mismatch detected
 * @throws Error if week date calculation fails
 */
export function validateWeeklyData(
  data: WeeklyData,
  getWeekBoundaries: (weekId: WeekId) => { start: string; end: string }
): boolean {
  try {
    const boundaries = getWeekBoundaries(data.week);

    const datesMatch =
      data.weekStartDate === boundaries.start && data.weekEndDate === boundaries.end;

    const amountSignMatch = data.amount > 0 === data.isIncome;

    if (!datesMatch) {
      console.error(`WeeklyData validation failed: week ${data.week} has inconsistent dates`, {
        expected: boundaries,
        actual: { start: data.weekStartDate, end: data.weekEndDate },
      });
    }

    if (!amountSignMatch) {
      console.error(`WeeklyData validation failed: amount sign mismatch`, {
        amount: data.amount,
        isIncome: data.isIncome,
      });
    }

    return datesMatch && amountSignMatch;
  } catch (error) {
    // CRITICAL: Re-throw calculation errors instead of returning false
    console.error(
      `WeeklyData validation failed: week date calculation error for ${data.week}`,
      error
    );
    throw error; // Don't silently convert exceptions to false
  }
}

/**
 * Budget vs actual comparison with derived fields
 * @property variance - Derived: actual - target
 * @property effectiveTarget - Derived: target + rolloverAccumulated
 *
 * IMPORTANT: This type contains derived fields that must be calculated correctly.
 * ALWAYS construct via createWeeklyBudgetComparison() factory to ensure correct
 * variance and effectiveTarget calculations. Manual construction risks arithmetic
 * errors or invalid numeric values.
 */
export interface WeeklyBudgetComparison {
  readonly week: WeekId;
  readonly category: Category;
  readonly actual: number;
  readonly target: number;
  readonly variance: number; // actual - target
  readonly rolloverAccumulated: number; // Cumulative from previous weeks
  readonly effectiveTarget: number; // target + rolloverAccumulated
}

/**
 * Creates a WeeklyBudgetComparison with validated derived fields.
 * Ensures variance and effectiveTarget are calculated correctly.
 * @param week - Week identifier
 * @param category - Category
 * @param actual - Actual spending/income
 * @param target - Budget target
 * @param rolloverAccumulated - Cumulative rollover
 * @returns WeeklyBudgetComparison with correct derived fields
 */
export function createWeeklyBudgetComparison(
  week: WeekId,
  category: Category,
  actual: number,
  target: number,
  rolloverAccumulated: number
): WeeklyBudgetComparison {
  // Validate all numeric inputs
  if (
    !Number.isFinite(actual) ||
    !Number.isFinite(target) ||
    !Number.isFinite(rolloverAccumulated)
  ) {
    console.error(`Invalid numeric value in budget comparison for ${category}`, {
      actual,
      target,
      rolloverAccumulated,
    });

    // Throw instead of returning corrupted data
    throw new Error(
      `Budget comparison failed: Invalid numeric value for ${category} ` +
        `(actual=${actual}, target=${target}, rolloverAccumulated=${rolloverAccumulated})`
    );
  }

  const variance = actual - target;
  const effectiveTarget = target + rolloverAccumulated;

  // Validate derived values
  if (!Number.isFinite(variance) || !Number.isFinite(effectiveTarget)) {
    console.error(`Arithmetic overflow in budget comparison for ${category}`, {
      actual,
      target,
      rolloverAccumulated,
      variance,
      effectiveTarget,
    });

    // Throw instead of returning corrupted data
    throw new Error(
      `Budget comparison failed: Arithmetic overflow for ${category} ` +
        `(variance=${variance}, effectiveTarget=${effectiveTarget})`
    );
  }

  return {
    week,
    category,
    actual,
    target,
    variance,
    rolloverAccumulated,
    effectiveTarget,
  };
}

// Predicted cash flow
export interface CashFlowPrediction {
  readonly totalIncomeTarget: number;
  readonly totalExpenseTarget: number;
  readonly predictedNetIncome: number;
  readonly historicAvgIncome: number;
  readonly historicAvgExpense: number;
  readonly variance: number; // predicted - historic
}

/**
 * Factory function to create CashFlowPrediction with validated derived fields.
 */
export function createCashFlowPrediction(
  totalIncomeTarget: number,
  totalExpenseTarget: number,
  historicAvgIncome: number,
  historicAvgExpense: number
): CashFlowPrediction {
  // Validate all numeric inputs
  if (
    !Number.isFinite(totalIncomeTarget) ||
    !Number.isFinite(totalExpenseTarget) ||
    !Number.isFinite(historicAvgIncome) ||
    !Number.isFinite(historicAvgExpense)
  ) {
    console.error('Invalid numeric value in cash flow prediction', {
      totalIncomeTarget,
      totalExpenseTarget,
      historicAvgIncome,
      historicAvgExpense,
    });

    // Throw instead of returning corrupted data
    throw new Error(
      'Cash flow prediction failed: Invalid numeric values in inputs ' +
        `(totalIncomeTarget=${totalIncomeTarget}, totalExpenseTarget=${totalExpenseTarget}, ` +
        `historicAvgIncome=${historicAvgIncome}, historicAvgExpense=${historicAvgExpense})`
    );
  }

  const predictedNetIncome = totalIncomeTarget - totalExpenseTarget;
  const historicNetIncome = historicAvgIncome - historicAvgExpense;

  // Validate derived values
  if (!Number.isFinite(predictedNetIncome) || !Number.isFinite(historicNetIncome)) {
    console.error('Arithmetic overflow in cash flow prediction', {
      predictedNetIncome,
      historicNetIncome,
    });

    // Throw instead of returning corrupted data
    throw new Error(
      'Cash flow prediction failed: Arithmetic overflow in calculations ' +
        `(predictedNetIncome=${predictedNetIncome}, historicNetIncome=${historicNetIncome})`
    );
  }

  const variance = predictedNetIncome - historicNetIncome;

  // Validate variance
  if (!Number.isFinite(variance)) {
    console.error('Arithmetic overflow in variance calculation', { variance });

    // Throw instead of returning corrupted data
    throw new Error(
      `Cash flow prediction failed: Arithmetic overflow in variance calculation (variance=${variance})`
    );
  }

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
 * Historic average for a specific category
 * @property category - The budget category
 * @property averageWeekly - Average weekly amount for this category
 */
export interface CategoryHistoricAverage {
  readonly category: Category;
  readonly averageWeekly: number;
}
