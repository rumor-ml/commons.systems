import { Category } from './types';

export const CATEGORY_COLORS: Record<Category, string> = {
  income: '#10b981',
  housing: '#ef4444',
  utilities: '#f59e0b',
  groceries: '#8b5cf6',
  dining: '#ec4899',
  transportation: '#3b82f6',
  healthcare: '#14b8a6',
  entertainment: '#f97316',
  shopping: '#a855f7',
  travel: '#06b6d4',
  investment: '#6366f1',
  other: '#6b7280',
};

export const CATEGORY_LABELS: Record<Category, string> = {
  income: 'Income',
  housing: 'Housing',
  utilities: 'Utilities',
  groceries: 'Groceries',
  dining: 'Dining',
  transportation: 'Transportation',
  healthcare: 'Healthcare',
  entertainment: 'Entertainment',
  shopping: 'Shopping',
  travel: 'Travel',
  investment: 'Investment',
  other: 'Other',
};
