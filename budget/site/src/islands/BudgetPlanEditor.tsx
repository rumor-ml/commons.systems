import { useState, useEffect, useMemo, useCallback } from 'react';
import { BudgetPlan, CategoryBudget, WeeklyData, Category } from './types';
import { CATEGORIES, CATEGORY_LABELS } from './constants';
import { predictCashFlow } from '../scripts/weeklyAggregation';
import { dispatchBudgetEvent } from '../utils/events';
import { formatCurrency } from '../utils/currency';

interface BudgetPlanEditorProps {
  budgetPlan: BudgetPlan;
  historicData: WeeklyData[];
  onSave: (plan: BudgetPlan) => void;
  onCancel: () => void;
}

export function BudgetPlanEditor({
  budgetPlan,
  historicData,
  onSave,
  onCancel,
}: BudgetPlanEditorProps) {
  // Initialize form state from existing budget plan (defaults to empty object if null/undefined)
  const [categoryBudgets, setCategoryBudgets] = useState<Partial<Record<Category, CategoryBudget>>>(
    budgetPlan.categoryBudgets || {}
  );

  // Validation errors for user feedback
  const [validationErrors, setValidationErrors] = useState<Partial<Record<Category, string>>>({});

  // Helper to clear validation error for a category
  const clearValidationError = (category: Category) => {
    setValidationErrors((prev) => {
      const next = { ...prev };
      delete next[category];
      return next;
    });
  };

  // Helper to show validation error with optional console warning
  const showValidationError = (category: Category, message: string, warnMessage?: string) => {
    if (warnMessage) {
      console.warn(warnMessage);
    }
    setValidationErrors((prev) => ({
      ...prev,
      [category]: message,
    }));
  };

  // Debounced prediction calculation
  const [debouncedBudgets, setDebouncedBudgets] = useState(categoryBudgets);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedBudgets(categoryBudgets);
    }, 300);

    return () => clearTimeout(timer);
  }, [categoryBudgets]);

  // Calculate cash flow prediction
  const prediction = useMemo(() => {
    const plan: BudgetPlan = {
      categoryBudgets: debouncedBudgets,
      lastModified: new Date().toISOString(),
    };

    return predictCashFlow(plan, historicData);
  }, [debouncedBudgets, historicData]);

  const handleTargetChange = (category: Category, value: string) => {
    // TODO(#1390): Remove console.warn calls for expected user validation failures
    // These warnings were added during development to debug validation logic behavior.
    // They can be safely removed once validation has been stable in production for 1+ month
    // without user reports of unexpected validation errors. Keep the user-facing error messages.
    // Allow empty string to clear budget
    if (value.trim() === '') {
      // Remove category from budget object entirely (not just set to 0).
      // Setting to 0 would be invalid per isValidCategoryBudget() which rejects zero targets,
      // and would create misleading UI state. Omitting the key properly indicates "no budget set".
      const updated = { ...categoryBudgets };
      delete updated[category];
      setCategoryBudgets(updated);
      // Clear validation error for this category
      clearValidationError(category);
      return;
    }

    const numValue = parseFloat(value);

    // Validate numeric input
    if (isNaN(numValue)) {
      showValidationError(
        category,
        'Please enter a valid number (e.g., -500 for expenses)',
        `Invalid budget value for ${category}: "${value}"`
      );
      return;
    }

    // Validate range
    const absValue = Math.abs(numValue);
    if (absValue > 1000000) {
      showValidationError(
        category,
        'Budget value is unusually large (max $1,000,000)',
        `Unusually large budget value for ${category}: ${numValue}`
      );
      return;
    }

    // Validate whole string was parsed (detect "123abc" scenarios)
    if (value.trim() !== numValue.toString() && !value.includes('.')) {
      showValidationError(
        category,
        'Invalid characters in number',
        `Partial numeric parsing for ${category}: "${value}" → ${numValue}`
      );
      return;
    }

    // Validate sign for expense categories
    const isExpenseCategory = category !== 'income';
    if (isExpenseCategory && numValue > 0) {
      showValidationError(
        category,
        'Expense budgets should be negative (e.g., -500)',
        `Budget for expense category ${category} should be negative, got ${numValue}. Consider using -${numValue} instead.`
      );
      return;
    }

    // Clear validation error for this category
    clearValidationError(category);

    setCategoryBudgets({
      ...categoryBudgets,
      [category]: {
        weeklyTarget: numValue,
        rolloverEnabled: categoryBudgets[category]?.rolloverEnabled ?? true,
      },
    });
  };

  const handleRolloverToggle = (category: Category) => {
    const current = categoryBudgets[category];
    if (!current) return;

    setCategoryBudgets({
      ...categoryBudgets,
      [category]: {
        ...current,
        rolloverEnabled: !current.rolloverEnabled,
      },
    });
  };

  const handleSave = () => {
    const plan: BudgetPlan = {
      categoryBudgets,
      lastModified: new Date().toISOString(),
    };

    dispatchBudgetEvent('budget:plan-save', { budgetPlan: plan });

    onSave(plan);
  };

  const handleCancel = useCallback(() => {
    dispatchBudgetEvent('budget:plan-cancel');

    onCancel();
  }, [onCancel]);

  // Handle Escape key to close modal
  // TODO(#1386): Add accessibility tests for keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleCancel]);

  // Handle Enter key in input fields to save
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  };

  // Determine variance color
  const varianceClass = prediction.variance >= 0 ? 'variance-positive' : 'variance-negative';
  const varianceSymbol = prediction.variance >= 0 ? '+' : '';

  return (
    <div className="plan-editor-modal" onClick={handleCancel}>
      <div className="plan-editor-content card" onClick={(e) => e.stopPropagation()}>
        <div className="p-6">
          <h2 className="text-2xl font-semibold mb-2 text-text-primary">Budget Planning</h2>

          {/* Cash Flow Prediction */}
          <div className="mb-6 p-4 bg-bg-surface rounded-lg">
            <div className="text-sm text-text-secondary mb-1">Predicted Net Income (per week)</div>
            <div className="text-3xl font-bold text-text-primary">
              ${formatCurrency(prediction.predictedNetIncome)}
            </div>
            {prediction.historicAvgIncome > 0 && (
              <div className={`text-sm ${varianceClass}`}>
                {varianceSymbol}${formatCurrency(prediction.variance)} vs historic ($
                {formatCurrency(prediction.historicAvgIncome - prediction.historicAvgExpense)})
              </div>
            )}
            <div className="mt-2 text-xs text-text-tertiary">
              Income: ${formatCurrency(prediction.totalIncomeTarget)} | Expenses: $
              {formatCurrency(prediction.totalExpenseTarget)}
            </div>
            {prediction.historicAvgIncome > 0 && (
              <div className="text-xs text-text-tertiary">
                Historic avg: ${formatCurrency(prediction.historicAvgIncome)} income, $
                {formatCurrency(prediction.historicAvgExpense)} expenses
              </div>
            )}
            {prediction.historicAvgIncome === 0 && (
              <div className="text-xs text-text-tertiary">
                No historic data available for comparison
              </div>
            )}
          </div>

          {/* Category Budget Inputs */}
          <div className="space-y-2 mb-6 max-h-96 overflow-y-auto">
            <div className="grid grid-cols-[2fr_1fr_auto] gap-4 px-3 pb-2 border-b border-bg-hover text-sm font-semibold text-text-secondary">
              <div>Category</div>
              <div>Weekly Target ($)</div>
              <div>Rollover</div>
            </div>
            {CATEGORIES.map((category) => {
              const budget = categoryBudgets[category];
              const isIncome = category === 'income';

              return (
                <div key={category} className="budget-input-row">
                  <div className="text-text-primary font-medium">{CATEGORY_LABELS[category]}</div>
                  <div>
                    <input
                      type="number"
                      step="0.01"
                      placeholder={isIncome ? '2000' : '-500'}
                      value={budget?.weeklyTarget ?? ''}
                      onChange={(e) => handleTargetChange(category, e.target.value)}
                      onKeyDown={handleInputKeyDown}
                      className={`input w-full ${validationErrors[category] ? 'input-error' : ''}`}
                    />
                    {validationErrors[category] && (
                      <div className="text-xs text-error mt-1">{validationErrors[category]}</div>
                    )}
                  </div>
                  <div className="flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={budget?.rolloverEnabled ?? false}
                      onChange={() => handleRolloverToggle(category)}
                      disabled={!budget}
                      className="w-5 h-5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Help Text */}
          <div className="mb-6 p-3 bg-bg-surface rounded text-xs text-text-tertiary">
            <strong>Tips:</strong>
            <ul className="list-disc ml-4 mt-1">
              <li>Income should be positive (e.g., 2000), expenses negative (e.g., -500)</li>
              <li>Rollover allows unspent budget to carry forward week-to-week</li>
              <li>Leave a category empty to exclude it from budget planning</li>
            </ul>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 justify-end">
            <button onClick={handleCancel} className="btn btn-ghost">
              Cancel
            </button>
            <button onClick={handleSave} className="btn btn-primary">
              Save Budget Plan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
