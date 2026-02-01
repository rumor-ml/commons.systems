// TODO(#1526): Add header comment explaining component purpose, props, and usage
import React from 'react';

interface TransactionFiltersProps {
  startDate: string;
  endDate: string;
  category: string;
  searchQuery: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  onCategoryChange: (category: string) => void;
  onSearchChange: (query: string) => void;
  onReset: () => void;
}

const CATEGORIES = [
  'all',
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

function formatCategoryLabel(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function TransactionFilters({
  startDate,
  endDate,
  category,
  searchQuery,
  onStartDateChange,
  onEndDateChange,
  onCategoryChange,
  onSearchChange,
  onReset,
}: TransactionFiltersProps) {
  return (
    <div className="bg-bg-surface rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text-primary">Filters</h3>
        <button
          onClick={onReset}
          className="text-sm text-primary hover:text-primary-hover transition-colors"
        >
          Reset All
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Date Range */}
        <div>
          <label htmlFor="startDate" className="block text-sm font-medium text-text-secondary mb-1">
            Start Date
          </label>
          <input
            type="date"
            id="startDate"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            className="input w-full"
          />
        </div>

        <div>
          <label htmlFor="endDate" className="block text-sm font-medium text-text-secondary mb-1">
            End Date
          </label>
          <input
            type="date"
            id="endDate"
            value={endDate}
            onChange={(e) => onEndDateChange(e.target.value)}
            className="input w-full"
          />
        </div>

        {/* Category Filter */}
        <div>
          <label htmlFor="category" className="block text-sm font-medium text-text-secondary mb-1">
            Category
          </label>
          <select
            id="category"
            value={category}
            onChange={(e) => onCategoryChange(e.target.value)}
            className="input w-full"
          >
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {formatCategoryLabel(cat)}
              </option>
            ))}
          </select>
        </div>

        {/* Search */}
        <div>
          <label htmlFor="search" className="block text-sm font-medium text-text-secondary mb-1">
            Search Description
          </label>
          <input
            type="text"
            id="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search transactions..."
            className="input w-full"
          />
        </div>
      </div>
    </div>
  );
}
