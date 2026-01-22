import { useState, useEffect, useMemo, useCallback } from 'react';
import { BudgetPlan, CategoryBudget, WeeklyData, Category, CategoryHistoricAverage } from './types';
import { CATEGORIES, CATEGORY_LABELS } from './constants';
import { predictCashFlow } from '../scripts/weeklyAggregation';
import { dispatchBudgetEvent } from '../utils/events';
import { formatCurrency } from '../utils/currency';
import { StateManager } from '../scripts/state';
import { navigateTo } from '../scripts/router';

interface BudgetPlanningPageProps {
  budgetPlan: BudgetPlan;
  historicData: WeeklyData[];
  categoryAverages: CategoryHistoricAverage[];
}

export function BudgetPlanningPage({
  budgetPlan,
  historicData,
  categoryAverages,
}: BudgetPlanningPageProps) {
  // Initialize form state from existing budget plan (defaults to empty object if null/undefined)
  const [categoryBudgets, setCategoryBudgets] = useState<Partial<Record<Category, CategoryBudget>>>(
    budgetPlan?.categoryBudgets || {}
  );

  // Validation errors for user feedback
  const [validationErrors, setValidationErrors] = useState<Partial<Record<Category, string>>>({});

  // Create a map of category to historic average for easy lookup
  const averageMap = useMemo(() => {
    const map = new Map<Category, number>();
    categoryAverages.forEach((avg) => {
      map.set(avg.category, avg.averageWeekly);
    });
    return map;
  }, [categoryAverages]);

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
    // Allow empty string to clear budget
    if (value.trim() === '') {
      // Remove category from budget (omitted key = unconfigured, not zero budget)
      const updated = { ...categoryBudgets };
      delete updated[category];
      setCategoryBudgets(updated);
      clearValidationError(category);
      return;
    }

    // Parse numeric value
    const numericValue = parseFloat(value);

    // Check for parsing errors
    if (isNaN(numericValue) || !Number.isFinite(numericValue)) {
      showValidationError(
        category,
        'Please enter a valid number',
        `Invalid numeric input for ${category}: "${value}"`
      );
      return;
    }

    // Validate the value
    const error = validateCategoryBudget(category, numericValue);
    if (error) {
      showValidationError(category, error);
      return;
    }

    // Clear validation error if value is valid
    clearValidationError(category);

    // Update budget with new target
    setCategoryBudgets((prev) => ({
      ...prev,
      [category]: {
        weeklyTarget: numericValue,
        rolloverEnabled: prev[category]?.rolloverEnabled ?? false,
      },
    }));
  };

  const handleRolloverChange = (category: Category, enabled: boolean) => {
    const currentBudget = categoryBudgets[category];

    if (!currentBudget) {
      // If no budget exists yet, create one with 0 target (user must set target)
      setCategoryBudgets((prev) => ({
        ...prev,
        [category]: {
          weeklyTarget: 0,
          rolloverEnabled: enabled,
        },
      }));
      return;
    }

    setCategoryBudgets((prev) => ({
      ...prev,
      [category]: {
        ...currentBudget,
        rolloverEnabled: enabled,
      },
    }));
  };

  const handleSave = () => {
    // Validate all budgets before saving
    if (!validateAllBudgets()) {
      StateManager.showErrorBanner(
        'Cannot save budget plan: Please fix the validation errors shown below.'
      );
      return;
    }

    const plan: BudgetPlan = {
      categoryBudgets,
      lastModified: new Date().toISOString(),
    };

    // Dispatch save event
    dispatchBudgetEvent('budget:plan-save', { budgetPlan: plan });

    // Navigate back to main view
    navigateTo('/');
  };

  const handleCancel = () => {
    // Navigate back to main view without saving
    navigateTo('/');
  };

  // Split categories into income and expenses
  const incomeCategories = CATEGORIES.filter((cat) => cat === 'income');
  const expenseCategories = CATEGORIES.filter((cat) => cat !== 'income');

  return (
    <div className="budget-planning-page">
      {/* Header */}
      <div className="planning-header">
        <div>
          <h1 className="text-3xl font-bold text-primary">Budget Planning</h1>
          <p className="text-text-secondary mt-2">
            Set weekly budget targets for each category. Historic averages are shown to help guide
            your planning.
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={handleCancel} className="btn btn-ghost">
            Cancel
          </button>
          <button onClick={handleSave} className="btn btn-primary">
            Save Budget
          </button>
        </div>
      </div>

      {/* Prediction Summary Card */}
      {prediction && (
        <div className="prediction-card card card-elevated mb-6">
          <h2 className="text-xl font-semibold mb-4 text-text-primary">Budget Projection</h2>
          <div className="prediction-grid">
            <div>
              <div className="text-text-secondary text-sm">Predicted Weekly Net Income</div>
              <div
                className={`text-2xl font-bold ${prediction.predictedNetIncome >= 0 ? 'text-success' : 'text-error'}`}
              >
                {formatCurrency(prediction.predictedNetIncome)}
              </div>
            </div>
            <div>
              <div className="text-text-secondary text-sm">Historic Weekly Average</div>
              <div className="text-2xl font-bold text-text-primary">
                {formatCurrency(prediction.historicAvgIncome - prediction.historicAvgExpense)}
              </div>
            </div>
            <div>
              <div className="text-text-secondary text-sm">Change from Historic</div>
              <div
                className={`text-2xl font-bold ${prediction.variance >= 0 ? 'text-success' : 'text-error'}`}
              >
                {prediction.variance >= 0 ? '+' : ''}
                {formatCurrency(prediction.variance)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Budget Configuration */}
      <div className="budget-sections">
        {/* Income Section */}
        <div className="budget-section card">
          <h2 className="text-xl font-semibold mb-4 text-success">Income</h2>
          <div className="category-list">
            {incomeCategories.map((category) => {
              const budget = categoryBudgets[category];
              const average = averageMap.get(category) || 0;
              const error = validationErrors[category];

              return (
                <div key={category} className="category-row">
                  <div className="category-info">
                    <label className="label font-medium">{CATEGORY_LABELS[category]}</label>
                    <div className="text-text-secondary text-sm">
                      Historic avg: {formatCurrency(average)}/week
                    </div>
                  </div>
                  <div className="category-controls">
                    <div className="input-group">
                      <input
                        type="number"
                        className={`input ${error ? 'input-error' : ''}`}
                        value={budget?.weeklyTarget ?? ''}
                        onChange={(e) => handleTargetChange(category, e.target.value)}
                        placeholder="e.g., 5000"
                        step="100"
                      />
                      {error && <div className="text-error text-sm mt-1">{error}</div>}
                    </div>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={budget?.rolloverEnabled ?? false}
                        onChange={(e) => handleRolloverChange(category, e.target.checked)}
                        disabled={!budget}
                      />
                      <span className="text-sm">Enable rollover</span>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Expenses Section */}
        <div className="budget-section card">
          <h2 className="text-xl font-semibold mb-4 text-error">Expenses</h2>
          <div className="category-list">
            {expenseCategories.map((category) => {
              const budget = categoryBudgets[category];
              const average = averageMap.get(category) || 0;
              const error = validationErrors[category];

              return (
                <div key={category} className="category-row">
                  <div className="category-info">
                    <label className="label font-medium">{CATEGORY_LABELS[category]}</label>
                    <div className="text-text-secondary text-sm">
                      Historic avg: {formatCurrency(average)}/week
                    </div>
                  </div>
                  <div className="category-controls">
                    <div className="input-group">
                      <input
                        type="number"
                        className={`input ${error ? 'input-error' : ''}`}
                        value={budget?.weeklyTarget ?? ''}
                        onChange={(e) => handleTargetChange(category, e.target.value)}
                        placeholder="e.g., -500"
                        step="50"
                      />
                      {error && <div className="text-error text-sm mt-1">{error}</div>}
                    </div>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={budget?.rolloverEnabled ?? false}
                        onChange={(e) => handleRolloverChange(category, e.target.checked)}
                        disabled={!budget}
                      />
                      <span className="text-sm">Enable rollover</span>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
