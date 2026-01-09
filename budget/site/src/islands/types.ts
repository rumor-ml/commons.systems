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

// TODO: See issue #386 - Add readonly modifiers, branded types for IDs, validation, constrain redemptionRate to [0,1]
export interface Transaction {
  id: string;
  date: string; // ISO date
  description: string;
  amount: number; // Positive = income, Negative = expense
  category: Category;
  redeemable: boolean;
  vacation: boolean;
  transfer: boolean;
  redemptionRate: number; // Default 0.5
  linkedTransactionId?: string; // For transfer pairs
  statementIds: string[]; // Belongs to multiple statements
}

export interface Statement {
  id: string;
  accountId: string;
  startDate: string;
  endDate: string;
  transactionIds: string[];
}

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

// TODO: See issue #386 - Use branded YearMonth type, remove redundant isIncome, validate qualifier sums
export interface MonthlyData {
  month: string; // YYYY-MM format
  category: Category;
  amount: number; // Can be positive or negative
  isIncome: boolean;
  qualifiers: QualifierBreakdown;
}

// TODO: See issue #386 - Replace index signature with explicit Record<Category, boolean> or exhaustive interface
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
export type WeekId = string & { readonly __brand: 'WeekId' };

/**
 * Validates and parses a string into a WeekId.
 * @param value - String to validate (expected format: "YYYY-WNN")
 * @returns WeekId if valid, null otherwise
 */
export function parseWeekId(value: string): WeekId | null {
  if (!/^\d{4}-W\d{2}$/.test(value)) {
    return null;
  }

  // Validate week number is in valid range
  const match = value.match(/^(\d{4})-W(\d{2})$/);
  const week = parseInt(match![2], 10);
  if (week < 1 || week > 53) {
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
 * @property weeklyTarget - Target spending/earning per week
 *   - Positive values for income categories (e.g., 5000 for $5k/week income)
 *   - Negative values for expense categories (e.g., -500 for $500/week spending)
 *   - Zero is not a valid target (use absence of budget instead)
 * @property rolloverEnabled - Whether unspent budget carries to next week
 */
export interface CategoryBudget {
  weeklyTarget: number;
  rolloverEnabled: boolean;
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
 * Creates a new BudgetPlan with validated timestamp.
 * @param categoryBudgets - Initial category budgets (defaults to empty)
 * @returns A new BudgetPlan instance
 */
export function createBudgetPlan(
  categoryBudgets: Partial<Record<Category, CategoryBudget>> = {}
): BudgetPlan {
  return {
    categoryBudgets,
    lastModified: new Date().toISOString(),
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
 * WARNING: Construct via aggregateTransactionsByWeek() or similar factory function that calls
 * getWeekBoundaries() to ensure consistency between week and date boundaries.
 * Do not manually construct WeeklyData instances.
 */
export interface WeeklyData {
  week: WeekId;
  category: Category;
  amount: number;
  isIncome: boolean;
  qualifiers: QualifierBreakdown;
  weekStartDate: string;
  weekEndDate: string;
}

// Budget vs actual comparison
export interface WeeklyBudgetComparison {
  week: WeekId;
  category: Category;
  actual: number;
  target: number;
  variance: number; // actual - target
  rolloverAccumulated: number; // Cumulative from previous weeks
  effectiveTarget: number; // target + rolloverAccumulated
}

// Predicted cash flow
export interface CashFlowPrediction {
  totalIncomeTarget: number;
  totalExpenseTarget: number;
  predictedNetIncome: number;
  historicAvgIncome: number;
  historicAvgExpense: number;
  variance: number; // predicted - historic
}
