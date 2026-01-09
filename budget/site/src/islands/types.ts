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
export type WeekId = string;

// Budget plan for a category
export interface CategoryBudget {
  weeklyTarget: number; // Dollars per week (negative for expenses)
  rolloverEnabled: boolean; // Unspent amounts carry over
}

// Complete budget plan
export interface BudgetPlan {
  categoryBudgets: Partial<Record<Category, CategoryBudget>>;
  lastModified: string; // ISO timestamp
}

// Weekly aggregated data (parallel to MonthlyData)
export interface WeeklyData {
  week: WeekId; // "2025-W01"
  category: Category;
  amount: number;
  isIncome: boolean;
  qualifiers: QualifierBreakdown;
  weekStartDate: string; // ISO date of Monday
  weekEndDate: string; // ISO date of Sunday
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
