import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { BudgetPlan, CategoryBudget, WeeklyData, Category } from './types';
import { CATEGORIES, CATEGORY_LABELS } from './constants';
import { predictCashFlow } from '../scripts/weeklyAggregation';
import { dispatchBudgetEvent } from '../utils/events';
import { formatCurrency } from '../utils/currency';
import { StateManager } from '../scripts/state';

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

  // Refs for focus trap
  const modalContentRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

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

    try {
      return predictCashFlow(plan, historicData);
    } catch (error) {
      console.error('Cash flow prediction failed:', error);

      // Show critical error to user
      const errorMessage = error instanceof Error ? error.message : String(error);
      StateManager.showErrorBanner(
        `Cash flow prediction unavailable: ${errorMessage}. Your budget plan may contain invalid values.`
      );

      // Return null to indicate prediction failure (error banner already shown to user)
      // UI will display "Prediction Unavailable" instead of misleading zeros
      return null;
    }
  }, [debouncedBudgets, historicData]);

  // Validation function for a single category budget
  const validateCategoryBudget = useCallback((category: Category, value: number): string | null => {
    // Validate numeric input
    if (!Number.isFinite(value)) {
      return 'Please enter a valid number (e.g., -500 for expenses)';
    }

    // Validate non-zero
    if (value === 0) {
      return 'Budget target cannot be zero. Leave empty for no budget, or enter a non-zero value.';
    }

    // Validate range
    const absValue = Math.abs(value);
    if (absValue > 1000000) {
      return 'Budget value is unusually large (max $1,000,000)';
    }

    // Validate sign for expense categories
    const isExpenseCategory = category !== 'income';
    if (isExpenseCategory && value > 0) {
      return 'Expense budgets should be negative (e.g., -500)';
    }

    return null;
  }, []);

  // Validate all category budgets
  const validateAllBudgets = useCallback((): boolean => {
    const errors: Partial<Record<Category, string>> = {};
    let hasErrors = false;

    Object.entries(categoryBudgets).forEach(([category, budget]) => {
      if (budget && typeof budget.weeklyTarget === 'number') {
        const error = validateCategoryBudget(category as Category, budget.weeklyTarget);
        if (error) {
          errors[category as Category] = error;
          hasErrors = true;
        }
      }
    });

    if (hasErrors) {
      setValidationErrors(errors);
    }

    return !hasErrors;
  }, [categoryBudgets, validateCategoryBudget]);

  const handleTargetChange = (category: Category, value: string) => {
    // TODO(#1390): Remove console.warn calls after 1+ month of stable validation (keep user-facing error messages)
    // Allow empty string to clear budget
    if (value.trim() === '') {
      // Remove category from budget (omitted key = unconfigured, not zero budget)
      const updated = { ...categoryBudgets };
      delete updated[category];
      setCategoryBudgets(updated);
      // Clear validation error for this category
      clearValidationError(category);
      return;
    }

    const numValue = parseFloat(value);

    // Validate numeric input
    if (!Number.isFinite(numValue)) {
      showValidationError(
        category,
        'Please enter a valid number (e.g., -500 for expenses)',
        `Invalid budget value for ${category}: "${value}"`
      );
      return;
    }

    // Validate non-zero (matches isValidCategoryBudget requirements)
    if (numValue === 0) {
      showValidationError(
        category,
        'Budget target cannot be zero. Leave empty for no budget, or enter a non-zero value.',
        `Zero budget value for ${category} - use empty field to indicate no budget`
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
    // Validate all budgets before saving
    if (!validateAllBudgets()) {
      // Validation errors are already set by validateAllBudgets
      // User will see error messages in the form
      return;
    }

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

  // Focus trap: Move focus to modal on mount and trap Tab navigation
  useEffect(() => {
    // Store the currently focused element to restore later
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Focus the modal content
    if (modalContentRef.current) {
      modalContentRef.current.focus();
    }

    // Trap focus within modal
    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !modalContentRef.current) return;

      const focusableElements = modalContentRef.current.querySelectorAll<HTMLElement>(
        'button, input, [tabindex]:not([tabindex="-1"])'
      );
      const focusableArray = Array.from(focusableElements);

      if (focusableArray.length === 0) return;

      const firstElement = focusableArray[0];
      const lastElement = focusableArray[focusableArray.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: if on first element, wrap to last
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab: if on last element, wrap to first
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener('keydown', handleTabKey);

    return () => {
      document.removeEventListener('keydown', handleTabKey);
      // Restore focus to previous element when modal closes
      if (previousFocusRef.current) {
        previousFocusRef.current.focus();
      }
    };
  }, []);

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

  // Determine variance color (only if prediction is available)
  const varianceClass =
    prediction && prediction.variance >= 0 ? 'variance-positive' : 'variance-negative';
  const varianceSymbol = prediction && prediction.variance >= 0 ? '+' : '';

  return (
    <div className="plan-editor-modal" onClick={handleCancel}>
      <div
        ref={modalContentRef}
        tabIndex={-1}
        className="plan-editor-content card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <h2 className="text-2xl font-semibold mb-2 text-text-primary">Budget Planning</h2>

          {/* Cash Flow Prediction */}
          <div className="mb-6 p-4 bg-bg-surface rounded-lg">
            <div className="text-sm text-text-secondary mb-1">Predicted Net Income (per week)</div>
            {prediction === null ? (
              <div className="text-error">
                <div className="text-xl font-bold mb-1">Prediction Unavailable</div>
                <div className="text-sm">
                  Cash flow prediction failed. Please check the error banner for details.
                </div>
              </div>
            ) : (
              <>
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
              </>
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
