import { useMemo } from 'react';
import { Category, Transaction } from './types';
import { CATEGORY_COLORS, CATEGORY_LABELS } from './constants';

interface LegendProps {
  transactions: Transaction[];
  hiddenCategories: string[];
  showVacation: boolean;
}

export function Legend({ transactions, hiddenCategories, showVacation }: LegendProps) {
  // Calculate category summaries from transactions
  const categorySummaries = useMemo(() => {
    // Guard clause: validate transactions prop
    if (!transactions || !Array.isArray(transactions)) {
      return [];
    }

    const summaries = new Map<Category, { total: number; count: number }>();

    transactions
      .filter((txn) => !txn.transfer && (showVacation || !txn.vacation))
      .forEach((txn) => {
        const current = summaries.get(txn.category) || { total: 0, count: 0 };
        const displayAmount = txn.redeemable ? txn.amount * txn.redemptionRate : txn.amount;
        summaries.set(txn.category, {
          total: current.total + displayAmount,
          count: current.count + 1,
        });
      });

    return Array.from(summaries.entries()).map(([category, data]) => ({
      category,
      total: data.total,
      count: data.count,
    }));
  }, [transactions, showVacation]);

  const handleVacationToggle = () => {
    // Dispatch custom event for vacation toggle
    const event = new CustomEvent('budget:vacation-toggle', {
      detail: { showVacation: !showVacation },
      bubbles: true,
    });
    document.dispatchEvent(event);
  };

  const handleCategoryToggle = (category: Category) => {
    // Dispatch custom event for category toggle
    const event = new CustomEvent('budget:category-toggle', {
      detail: { category },
      bubbles: true,
    });
    document.dispatchEvent(event);
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
            return (
              <div
                key={category}
                onClick={() => handleCategoryToggle(category)}
                className={`flex items-center justify-between p-3 rounded-lg cursor-pointer legend-category-row ${isHidden ? 'legend-category-hidden' : ''}`}
                style={{
                  backgroundColor: CATEGORY_COLORS[category],
                }}
              >
                <span className="text-sm text-white font-medium">{CATEGORY_LABELS[category]}</span>
                <div className="text-right">
                  <div className="text-sm text-white font-semibold">
                    $
                    {Math.abs(total).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </div>
                  <div className="text-xs text-white opacity-90">{count} txns</div>
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-sm text-text-tertiary">No transactions to display</p>
        )}
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
