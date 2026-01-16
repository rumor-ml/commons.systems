import { useMemo } from 'react';
import { Category, Transaction, BudgetPlan } from './types';
import { CATEGORY_COLORS, CATEGORY_LABELS } from './constants';
import { getDisplayAmount } from './qualifierUtils';
import { dispatchBudgetEvent } from '../utils/events';
import { formatCurrency } from '../utils/currency';

interface LegendProps {
  transactions: Transaction[];
  hiddenCategories: string[];
  showVacation: boolean;
  budgetPlan?: BudgetPlan | null;
  visibleIndicators?: readonly Category[];
  showNetIncomeIndicator?: boolean;
}

interface CategorySummary {
  category: Category;
  total: number;
  count: number;
}

export function Legend({
  transactions,
  hiddenCategories,
  showVacation,
  budgetPlan = null,
  visibleIndicators = [],
  showNetIncomeIndicator = true,
}: LegendProps) {
  // Derived state: whether we have a valid budget plan with categories
  const hasBudgetPlan = Boolean(budgetPlan && Object.keys(budgetPlan.categoryBudgets).length > 0);

  // Helper to calculate monthly/all-time summaries without budget comparison
  function calculateMonthlySummaries(
    transactions: Transaction[],
    showVacation: boolean
  ): CategorySummary[] {
    const summaries = new Map<Category, { total: number; count: number }>();

    transactions
      .filter((txn) => !txn.transfer && (showVacation || !txn.vacation))
      .forEach((txn) => {
        const current = summaries.get(txn.category) || { total: 0, count: 0 };
        const displayAmount = getDisplayAmount(txn);
        summaries.set(txn.category, {
          total: current.total + displayAmount,
          count: current.count + 1,
        });
      });

    return Array.from(summaries.entries()).map(([category, data]) => ({
      category,
      total: data.total,
      count: data.count,
      target: undefined,
      variance: undefined,
      rolloverAccumulated: undefined,
      hasRollover: false,
    }));
  }

  // Calculate category summaries from transactions
  const categorySummaries = useMemo(() => {
    // Guard clause: validate transactions prop
    if (!transactions || !Array.isArray(transactions)) {
      return [];
    }

    return calculateMonthlySummaries(transactions, showVacation);
  }, [transactions, showVacation, hiddenCategories]);

  const handleVacationToggle = () => {
    dispatchBudgetEvent('budget:vacation-toggle', { showVacation: !showVacation });
  };

  const handleCategoryToggle = (category: Category) => {
    dispatchBudgetEvent('budget:category-toggle', { category });
  };

  const handleIndicatorToggle = (category: Category) => {
    dispatchBudgetEvent('budget:indicator-toggle', { category });
  };

  const handleNetIncomeToggle = () => {
    dispatchBudgetEvent('budget:net-income-toggle', { showNetIncomeIndicator: !showNetIncomeIndicator });
  };

  return (
    <div className="p-6 bg-bg-elevated rounded-lg shadow-lg">
      <h3 className="text-xl font-semibold mb-4 text-text-primary">Filters</h3>

      {/* Vacation Toggle */}
      <div className="mb-6 pb-6 border-b border-bg-hover">
        <label className="flex items-center gap-3 cursor-pointer hover:bg-bg-hover p-2 rounded transition-colors">
          <input
            type="checkbox"
            checked={showVacation}
            onChange={handleVacationToggle}
            className="w-5 h-5 rounded border-2 border-primary text-primary focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-bg-elevated cursor-pointer"
          />
          <span className="text-text-primary font-medium">Show Vacation Expenses</span>
        </label>
      </div>

      {/* Category Summary */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
          Categories (click to toggle)
        </h4>
        {categorySummaries.length > 0 ? (
          categorySummaries.map(({ category, total, count }) => {
            const isHidden = hiddenCategories.includes(category);
            const budget = budgetPlan?.categoryBudgets[category];
            const weeklyBudget = budget?.weeklyTarget || 0;
            const hasRollover = budget?.rolloverEnabled || false;
            const isIndicatorVisible = visibleIndicators.includes(category);

            return (
              <div
                key={category}
                className={`p-3 rounded-lg legend-category-row ${isHidden ? 'legend-category-hidden' : ''}`}
                style={{
                  backgroundColor: CATEGORY_COLORS[category],
                }}
              >
                <div className="flex items-center justify-between">
                  <div
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleCategoryToggle(category);
                      }
                    }}
                    onClick={() => handleCategoryToggle(category)}
                    className="flex items-center gap-2 cursor-pointer flex-1"
                  >
                    <span className="text-sm text-white font-medium">
                      {CATEGORY_LABELS[category]}
                    </span>
                    {hasRollover && <span className="text-xs text-white">🔄</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <div className="text-sm text-white font-semibold">${formatCurrency(total)}</div>
                      <div className="text-xs text-white opacity-90">{count} txns</div>
                    </div>
                    {budget && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleIndicatorToggle(category);
                        }}
                        className={`btn btn-sm ${isIndicatorVisible ? 'btn-primary' : 'btn-ghost'} text-white`}
                        title="Toggle budget indicator line"
                      >
                        📊
                      </button>
                    )}
                  </div>
                </div>
                {budget && (
                  <div className="mt-2 text-xs text-white opacity-90">
                    Weekly budget: ${formatCurrency(weeklyBudget)} | Balance: ${formatCurrency(weeklyBudget - total)}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <p className="text-sm text-text-tertiary">No transactions to display</p>
        )}
      </div>

      {/* Legend for indicators */}
      <div className="mt-6 pt-6 border-t border-bg-hover">
        <h4 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
          Indicators
        </h4>
        <div className="space-y-3">
          {/* Net Income Toggle */}
          <label className="flex items-center gap-3 cursor-pointer hover:bg-bg-hover p-2 rounded transition-colors">
            <input
              type="checkbox"
              checked={showNetIncomeIndicator}
              onChange={handleNetIncomeToggle}
              className="w-4 h-4 rounded border-2 border-primary text-primary focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-bg-elevated cursor-pointer"
            />
            <div className="flex items-center gap-2 flex-1">
              <div className="w-8 h-0.5 bg-primary"></div>
              <span className="text-sm text-text-secondary">Net Income</span>
            </div>
          </label>

          <div className="flex items-center gap-3 pl-2">
            <div
              className="w-8 h-0.5 bg-primary opacity-70"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(to right, #00d4ed 0, #00d4ed 5px, transparent 5px, transparent 10px)',
              }}
            ></div>
            <span className="text-sm text-text-secondary">3-Month Avg</span>
          </div>

          {/* Line type legend for budget indicators */}
          {hasBudgetPlan && (
            <>
              <div className="text-xs text-text-tertiary uppercase tracking-wide mt-4 mb-2">
                Budget Lines
              </div>
              <div className="flex items-center gap-3 pl-2">
                <div className="w-8 h-0.5 bg-text-secondary"></div>
                <span className="text-xs text-text-tertiary">Actual Spending</span>
              </div>
              <div className="flex items-center gap-3 pl-2">
                <div
                  className="w-8 h-0.5 bg-text-secondary opacity-70"
                  style={{
                    backgroundImage:
                      'repeating-linear-gradient(to right, currentColor 0, currentColor 5px, transparent 5px, transparent 10px)',
                  }}
                ></div>
                <span className="text-xs text-text-tertiary">3-Period Trailing Avg</span>
              </div>
              <div className="flex items-center gap-3 pl-2">
                <div
                  className="w-8 h-0.5 bg-text-secondary opacity-50"
                  style={{
                    backgroundImage:
                      'repeating-linear-gradient(to right, currentColor 0, currentColor 2px, transparent 2px, transparent 5px)',
                  }}
                ></div>
                <span className="text-xs text-text-tertiary">Budget Target</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
