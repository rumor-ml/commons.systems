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

export interface MonthlyData {
  month: string; // YYYY-MM format
  category: Category;
  amount: number; // Can be positive or negative
  isIncome: boolean;
  qualifiers: QualifierBreakdown;
}

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
