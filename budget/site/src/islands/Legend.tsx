import React from 'react';
import { Category, CategoryFilter } from './types';

interface LegendProps {
  categoryFilter: CategoryFilter;
  onCategoryToggle: (category: Category) => void;
  showVacation: boolean;
  onVacationToggle: () => void;
}

const CATEGORIES: Category[] = [
  'income',
  'housing',
  'utilities',
  'groceries',
  'dining',
  'transportation',
  'healthcare',
  'entertainment',
  'shopping',
  'travel',
  'investment',
  'other',
];

const CATEGORY_COLORS: Record<Category, string> = {
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

const CATEGORY_LABELS: Record<Category, string> = {
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

export function Legend({
  categoryFilter,
  onCategoryToggle,
  showVacation,
  onVacationToggle,
}: LegendProps) {
  return (
    <div className="p-6 bg-bg-elevated rounded-lg shadow-lg">
      <h3 className="text-xl font-semibold mb-4 text-text-primary">Filters</h3>

      {/* Vacation Toggle */}
      <div className="mb-6 pb-6 border-b border-bg-hover">
        <label className="flex items-center gap-3 cursor-pointer hover:bg-bg-hover p-2 rounded transition-colors">
          <input
            type="checkbox"
            checked={showVacation}
            onChange={onVacationToggle}
            className="w-5 h-5 rounded border-2 border-primary text-primary focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-bg-elevated cursor-pointer"
          />
          <span className="text-text-primary font-medium">Show Vacation Expenses</span>
        </label>
      </div>

      {/* Category Filters */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
          Categories
        </h4>
        {CATEGORIES.map((category) => (
          <label
            key={category}
            className="flex items-center gap-3 cursor-pointer hover:bg-bg-hover p-2 rounded transition-colors"
          >
            <input
              type="checkbox"
              checked={categoryFilter[category]}
              onChange={() => onCategoryToggle(category)}
              className="w-5 h-5 rounded border-2 border-primary text-primary focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-bg-elevated cursor-pointer"
            />
            <div
              className="w-4 h-4 rounded shadow-sm"
              style={{
                backgroundColor: CATEGORY_COLORS[category],
                opacity: categoryFilter[category] ? 1 : 0.3,
              }}
            />
            <span
              className={`text-sm ${
                categoryFilter[category] ? 'text-text-primary' : 'text-text-tertiary'
              }`}
            >
              {CATEGORY_LABELS[category]}
            </span>
          </label>
        ))}
      </div>

      {/* Legend for lines */}
      <div className="mt-6 pt-6 border-t border-bg-hover">
        <h4 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
          Indicators
        </h4>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-0.5 bg-primary"></div>
            <span className="text-sm text-text-secondary">Net Income</span>
          </div>
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-0.5 bg-primary opacity-70"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(to right, #00d4ed 0, #00d4ed 5px, transparent 5px, transparent 10px)',
              }}
            ></div>
            <span className="text-sm text-text-secondary">3-Month Avg</span>
          </div>
        </div>
      </div>
    </div>
  );
}
