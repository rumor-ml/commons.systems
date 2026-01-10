import { useMemo } from 'react';
import { Category, Transaction, BudgetPlan, TimeGranularity, WeekId } from './types';
import { CATEGORY_COLORS, CATEGORY_LABELS } from './constants';
import {
  aggregateTransactionsByWeek,
  calculateWeeklyComparison,
  getCurrentWeek,
} from '../scripts/weeklyAggregation';
import { getDisplayAmount } from './qualifierUtils';
import { dispatchBudgetEvent } from '../utils/events';
import { formatCurrency } from '../utils/currency';

interface LegendProps {
  transactions: Transaction[];
  hiddenCategories: string[];
  showVacation: boolean;
  budgetPlan?: BudgetPlan | null;
  granularity?: TimeGranularity;
  selectedWeek?: WeekId | null;
}

interface CategorySummary {
  category: Category;
  total: number;
  count: number;
  target?: number;
  variance?: number;
  rolloverAccumulated?: number;
  hasRollover: boolean;
}

export function Legend({
  transactions,
  hiddenCategories,
  showVacation,
  budgetPlan = null,
  granularity = 'month',
  selectedWeek = null,
}: LegendProps) {
  // Derived state: whether we have a valid budget plan with categories
  const hasBudgetPlan = Boolean(budgetPlan && Object.keys(budgetPlan.categoryBudgets).length > 0);

  // Helper to determine budget status: over, under, or null
  function getBudgetStatus(
    target: number | undefined,
    variance: number | undefined
  ): 'over' | 'under' | null {
    if (target === undefined || variance === undefined) return null;
    const varianceIsPositive = variance > 0;
    const isIncomeCategory = target > 0;
    // Budget status determines visual indicator color:
    // 'under' = performing well (green), 'over' = performing poorly (red)
    //
    // Examples:
    // - Expense category (target=-500): actual=-400, variance=+100 → status='under' (spent less, good)
    // - Expense category (target=-500): actual=-600, variance=-100 → status='over' (overspent, bad)
    // - Income category (target=2000): actual=2200, variance=+200 → status='under' (earned more, good)
    // - Income category (target=2000): actual=1800, variance=-200 → status='over' (earned less, bad)
    //
    // Implementation: variance and target have same sign → 'under', different signs → 'over'
    return varianceIsPositive === isIncomeCategory ? 'under' : 'over';
  }

  // Helper to calculate weekly budget summaries with comparisons
  function calculateWeeklySummaries(
    transactions: Transaction[],
    plan: BudgetPlan,
    activeWeek: WeekId,
    hiddenSet: Set<string>,
    showVacation: boolean
  ): CategorySummary[] {
    try {
      const weeklyData = aggregateTransactionsByWeek(transactions, {
        hiddenCategories: hiddenSet,
        showVacation,
      });
      const weekData = weeklyData.filter((d) => d.week === activeWeek);
      const comparisons = calculateWeeklyComparison(weeklyData, plan, activeWeek);

      // Map comparisons to summary format
      return comparisons.map((c) => ({
        category: c.category,
        total: c.actual,
        count: weekData.find((d) => d.category === c.category)?.qualifiers.transactionCount || 0,
        target: c.target,
        variance: c.variance,
        rolloverAccumulated: c.rolloverAccumulated,
        hasRollover: plan.categoryBudgets[c.category]?.rolloverEnabled || false,
      }));
    } catch (err) {
      console.error('Failed to calculate weekly summaries:', err);
      // Return fallback summaries without budget comparison
      return calculateMonthlySummaries(transactions, showVacation);
    }
  }

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

    // Show budget comparison in weekly mode when budget plan is configured. Otherwise (monthly mode or no budget plan), show all-time totals.
    if (granularity === 'week' && hasBudgetPlan) {
      // TypeScript: budgetPlan is guaranteed non-null here due to hasBudgetPlan check
      const plan = budgetPlan!;
      const hiddenSet = new Set(hiddenCategories);
      const activeWeek = selectedWeek || getCurrentWeek();
      return calculateWeeklySummaries(transactions, plan, activeWeek, hiddenSet, showVacation);
    }

    return calculateMonthlySummaries(transactions, showVacation);
  }, [transactions, showVacation, granularity, budgetPlan, selectedWeek, hiddenCategories]);

  const handleVacationToggle = () => {
    dispatchBudgetEvent('budget:vacation-toggle', { showVacation: !showVacation });
  };

  const handleCategoryToggle = (category: Category) => {
    dispatchBudgetEvent('budget:category-toggle', { category });
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
          categorySummaries.map(
            ({ category, total, count, target, variance, rolloverAccumulated, hasRollover }) => {
              const isHidden = hiddenCategories.includes(category);
              const budgetStatus = getBudgetStatus(target, variance);
              const isOverBudget = budgetStatus === 'over';
              const isUnderBudget = budgetStatus === 'under';
              const hasBudget = budgetStatus !== null;

              return (
                <div
                  key={category}
                  onClick={() => handleCategoryToggle(category)}
                  className={`flex items-center justify-between p-3 rounded-lg cursor-pointer legend-category-row ${isHidden ? 'legend-category-hidden' : ''}`}
                  style={{
                    backgroundColor: CATEGORY_COLORS[category],
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white font-medium">
                      {CATEGORY_LABELS[category]}
                    </span>
                    {hasBudget && (
                      <>
                        {isUnderBudget && <span className="text-xs text-white">✓</span>}
                        {isOverBudget && <span className="text-xs text-white">✗</span>}
                        {hasRollover && <span className="text-xs text-white">🔄</span>}
                      </>
                    )}
                  </div>
                  <div className="text-right">
                    {hasBudget && target !== undefined ? (
                      <>
                        <div className="text-sm text-white font-semibold">
                          ${formatCurrency(total)}
                          {' / '}${formatCurrency(target)}
                        </div>
                        {rolloverAccumulated !== undefined && rolloverAccumulated !== 0 && (
                          <div className="text-xs text-white opacity-90">
                            Rollover: ${rolloverAccumulated.toFixed(2)}
                          </div>
                        )}
                        <div className="text-xs text-white opacity-90">{count} txns</div>
                      </>
                    ) : (
                      <>
                        <div className="text-sm text-white font-semibold">
                          ${formatCurrency(total)}
                        </div>
                        <div className="text-xs text-white opacity-90">{count} txns</div>
                      </>
                    )}
                  </div>
                </div>
              );
            }
          )
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
          {granularity === 'week' && hasBudgetPlan ? (
            <>
              <div className="flex items-center gap-3">
                <span className="text-sm text-text-secondary">✓ Under budget</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-text-secondary">✗ Over budget</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-text-secondary">🔄 Rollover enabled</span>
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
