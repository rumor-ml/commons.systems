import { CATEGORIES } from '../islands/constants';
import {
  Category,
  BudgetPlan,
  TimeGranularity,
  WeekId,
  parseWeekId,
  isValidCategoryBudget,
} from '../islands/types';
import { logger } from '../utils/logger';

/**
 * Type guard to check if an unknown value has the shape of a CategoryBudget.
 * @param budget - Unknown value to check
 * @returns true if budget has weeklyTarget (number) and rolloverEnabled (boolean)
 */
function isCategoryBudgetLike(
  budget: unknown
): budget is { weeklyTarget: number; rolloverEnabled: boolean } {
  return (
    typeof budget === 'object' &&
    budget !== null &&
    'weeklyTarget' in budget &&
    'rolloverEnabled' in budget &&
    typeof (budget as Record<string, unknown>).weeklyTarget === 'number' &&
    typeof (budget as Record<string, unknown>).rolloverEnabled === 'boolean'
  );
}

/**
 * Validate budgetPlan structure from localStorage.
 * @param parsed - Raw parsed object from localStorage
 * @returns Validated BudgetPlan or null if invalid
 */
function validateBudgetPlan(parsed: any): BudgetPlan | null {
  if (!parsed.budgetPlan || typeof parsed.budgetPlan !== 'object') {
    return null;
  }

  const categoryBudgets = parsed.budgetPlan.categoryBudgets;
  if (!categoryBudgets || typeof categoryBudgets !== 'object') {
    return null;
  }

  // Validate each category budget entry
  const validatedBudgets: Partial<
    Record<Category, { weeklyTarget: number; rolloverEnabled: boolean }>
  > = {};

  for (const [category, budget] of Object.entries(categoryBudgets)) {
    if (!CATEGORIES.includes(category as Category)) {
      logger.warn(`Skipping invalid category: ${category}`);
      continue;
    }

    if (!isCategoryBudgetLike(budget)) {
      logger.warn(`Skipping invalid budget structure for ${category}`, budget);
      continue;
    }

    const categoryBudget = {
      weeklyTarget: budget.weeklyTarget,
      rolloverEnabled: budget.rolloverEnabled,
    };

    if (!isValidCategoryBudget(categoryBudget, category as Category)) {
      logger.warn(`Skipping invalid budget for ${category}`, budget);
      continue;
    }

    validatedBudgets[category as Category] = categoryBudget;
  }

  return {
    categoryBudgets: validatedBudgets,
    lastModified: parsed.budgetPlan.lastModified || new Date().toISOString(),
  };
}

/**
 * Application view type
 * Note: Values map to Route type in router.ts:
 *   'main' → '/' and 'planning' → '/plan'
 * Consider using Route type directly in future refactor to eliminate duplication.
 */
export type ViewType = 'main' | 'planning';

/**
 * Bar aggregation for chart display
 */
export type BarAggregation = 'monthly' | 'weekly';

/**
 * Budget application state (persisted to localStorage)
 * @property hiddenCategories - Categories hidden in visualization
 * @property showVacation - Whether to include vacation spending
 * @property budgetPlan - User's budget configuration (null = no budget set)
 * @property currentView - Current application view ('main' or 'planning')
 * @property dateRangeStart - Start date for date range filter (YYYY-MM-DD, null = no start limit)
 * @property dateRangeEnd - End date for date range filter (YYYY-MM-DD, null = no end limit)
 * @property barAggregation - Time aggregation for chart bars ('monthly' or 'weekly')
 * @property visibleIndicators - Set of category indicators visible on chart (empty = none visible)
 * @property showNetIncomeIndicator - Whether to show the net income indicator line
 */
export interface BudgetState {
  readonly hiddenCategories: readonly Category[];
  readonly showVacation: boolean;
  readonly budgetPlan: BudgetPlan | null;
  readonly currentView: ViewType;
  readonly dateRangeStart: string | null;
  readonly dateRangeEnd: string | null;
  readonly barAggregation: BarAggregation;
  readonly visibleIndicators: readonly Category[];
  readonly showNetIncomeIndicator: boolean;
}

export class StateManager {
  private static STORAGE_KEY = 'budget-state';

  /**
   * Create and display a banner notification
   * @param message - Text to display
   * @param type - Banner style ('warning' or 'error')
   * @param autoDismiss - If true, banner auto-dismisses after 10s. If false, remains until manually closed.
   */
  private static createBanner(
    message: string,
    type: 'warning' | 'error',
    autoDismiss: boolean
  ): void {
    const banner = document.createElement('div');
    banner.className = `fixed top-4 left-1/2 -translate-x-1/2 z-50 ${
      type === 'error' ? 'bg-error' : 'bg-warning'
    } text-white px-6 py-3 rounded-lg shadow-lg max-w-2xl`;

    const container = document.createElement('div');
    container.className = 'flex items-center gap-3';

    const icon = document.createElement('span');
    icon.className = 'text-xl';
    icon.textContent = type === 'error' ? '❌' : '⚠️';

    const text = document.createElement('p');
    text.className = type === 'error' ? 'text-sm font-semibold' : 'text-sm';
    text.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'ml-4 text-white hover:text-gray-200';
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => banner.remove();

    container.appendChild(icon);
    container.appendChild(text);
    container.appendChild(closeBtn);
    banner.appendChild(container);
    document.body.appendChild(banner);

    if (autoDismiss) {
      setTimeout(() => banner.remove(), 10000);
    }
  }

  public static showWarningBanner(message: string): void {
    this.createBanner(message, 'warning', true);
  }

  public static showErrorBanner(message: string): void {
    this.createBanner(message, 'error', false);
  }

  static load(): BudgetState {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);

      const defaultState: BudgetState = {
        hiddenCategories: [],
        showVacation: true,
        budgetPlan: null,
        currentView: 'main',
        dateRangeStart: null,
        dateRangeEnd: null,
        barAggregation: 'monthly',
        visibleIndicators: [],
        showNetIncomeIndicator: true,
      };

      if (!stored) {
        return defaultState;
      }

      const parsed = JSON.parse(stored);

      // TODO(2026-06): Remove selectedCategory migration (added 2026-01).
      //   Safe to remove after 6mo if no user error reports about lost preferences.
      //   Before removal: Test scenarios:
      //   1. Fresh install with no localStorage (should use defaults)
      //   2. Upgrade from old format (selectedCategory) to new (hiddenCategories)
      //   3. Already using new format (should not break)
      //   After removal: Drop selectedCategory handling from load() entirely.
      // Migration: Convert old selectedCategory format to hiddenCategories.
      if ('selectedCategory' in parsed && parsed.selectedCategory !== null) {
        const hiddenCategories = CATEGORIES.filter((cat) => cat !== parsed.selectedCategory);
        return {
          ...defaultState,
          hiddenCategories,
          showVacation: parsed.showVacation ?? true,
        };
      }

      // TODO(2026-07): Remove planningMode migration (added 2026-01).
      //   Safe to remove after 6mo if no user error reports about navigation issues.
      //   Before removal: Test scenarios:
      //   1. Fresh install with no localStorage (should default to 'main')
      //   2. Upgrade from old format (planningMode: boolean) to new (currentView: ViewType)
      //   3. Already using new format (should not break)
      //   After removal: Drop planningMode handling from load() entirely.
      // Migration: Convert old planningMode to currentView
      let currentView: ViewType = 'main';
      if ('planningMode' in parsed) {
        currentView = parsed.planningMode === true ? 'planning' : 'main';
      } else if (parsed.currentView === 'planning' || parsed.currentView === 'main') {
        currentView = parsed.currentView;
      }

      // Validate and filter hiddenCategories
      let hiddenCategories: Category[] = [];
      if (Array.isArray(parsed.hiddenCategories)) {
        hiddenCategories = parsed.hiddenCategories.filter((cat: string) =>
          CATEGORIES.includes(cat as Category)
        ) as Category[];
      }

      // Validate budgetPlan structure
      const budgetPlan = validateBudgetPlan(parsed);

      // Validate dateRangeStart and dateRangeEnd
      const dateRangeStart =
        typeof parsed.dateRangeStart === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(parsed.dateRangeStart)
          ? parsed.dateRangeStart
          : null;

      const dateRangeEnd =
        typeof parsed.dateRangeEnd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.dateRangeEnd)
          ? parsed.dateRangeEnd
          : null;

      // Validate barAggregation
      const barAggregation: BarAggregation =
        parsed.barAggregation === 'weekly' || parsed.barAggregation === 'monthly'
          ? parsed.barAggregation
          : 'monthly';

      // Validate visibleIndicators
      let visibleIndicators: Category[] = [];
      if (Array.isArray(parsed.visibleIndicators)) {
        visibleIndicators = parsed.visibleIndicators.filter((cat: string) =>
          CATEGORIES.includes(cat as Category)
        ) as Category[];
      }

      // Validate showNetIncomeIndicator
      const showNetIncomeIndicator = parsed.showNetIncomeIndicator !== false;

      return {
        hiddenCategories,
        showVacation: parsed.showVacation ?? true,
        budgetPlan,
        currentView,
        dateRangeStart,
        dateRangeEnd,
        barAggregation,
        visibleIndicators,
        showNetIncomeIndicator,
      };
    } catch (error) {
      // TODO(#1387): Consider distinguishing localStorage failure types for better user messaging
      logger.error('Failed to load state from localStorage', error);

      // Show user-facing warning
      this.showWarningBanner(
        'Failed to load your saved preferences. Using defaults. If you are in private browsing mode, your changes will not be saved.'
      );

      return {
        hiddenCategories: [],
        showVacation: true,
        budgetPlan: null,
        currentView: 'main',
        dateRangeStart: null,
        dateRangeEnd: null,
        barAggregation: 'monthly',
        visibleIndicators: [],
        showNetIncomeIndicator: true,
      };
    }
  }

  static save(state: Partial<BudgetState>): BudgetState {
    const current = this.load();

    // Build updated state by merging current and provided state
    const updated: BudgetState = {
      ...current,
      ...state,
    };

    // Validate merged state before persisting
    if (updated.dateRangeStart && !/^\d{4}-\d{2}-\d{2}$/.test(updated.dateRangeStart)) {
      logger.warn('Invalid dateRangeStart format, using null', {
        dateRangeStart: updated.dateRangeStart,
      });
      (updated as { dateRangeStart: string | null }).dateRangeStart = null;
    }
    if (updated.dateRangeEnd && !/^\d{4}-\d{2}-\d{2}$/.test(updated.dateRangeEnd)) {
      logger.warn('Invalid dateRangeEnd format, using null', {
        dateRangeEnd: updated.dateRangeEnd,
      });
      (updated as { dateRangeEnd: string | null }).dateRangeEnd = null;
    }

    // Validate barAggregation
    if (updated.barAggregation !== 'monthly' && updated.barAggregation !== 'weekly') {
      logger.warn('Invalid barAggregation, defaulting to monthly', {
        barAggregation: updated.barAggregation,
      });
      (updated as { barAggregation: BarAggregation }).barAggregation = 'monthly';
    }

    // Validate hiddenCategories (filter out invalid categories)
    if (Array.isArray(updated.hiddenCategories)) {
      const validCategories = updated.hiddenCategories.filter((cat) => CATEGORIES.includes(cat));
      if (validCategories.length !== updated.hiddenCategories.length) {
        logger.warn('Filtered invalid categories from hiddenCategories');
        (updated as { hiddenCategories: Category[] }).hiddenCategories = validCategories;
      }
    }

    // Validate visibleIndicators (filter out invalid categories)
    if (Array.isArray(updated.visibleIndicators)) {
      const validIndicators = updated.visibleIndicators.filter((cat) => CATEGORIES.includes(cat));
      if (validIndicators.length !== updated.visibleIndicators.length) {
        logger.warn('Filtered invalid categories from visibleIndicators');
        (updated as { visibleIndicators: Category[] }).visibleIndicators = validIndicators;
      }
    }

    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(updated));

      // Reload from localStorage to verify persistence
      const persisted = this.load();

      // Verify write succeeded by comparing budgetPlan if it was part of the update
      if (state.budgetPlan !== undefined) {
        const budgetPlanMatches =
          JSON.stringify(persisted.budgetPlan) === JSON.stringify(updated.budgetPlan);

        if (!budgetPlanMatches) {
          throw new Error('State verification failed: persisted data does not match intended save');
        }
      }

      // Return what was actually persisted
      return persisted;
    } catch (error) {
      logger.error('Failed to save state to localStorage', error);

      // Critical: Budget plan data is being lost
      if (state.budgetPlan) {
        this.showErrorBanner(
          'Failed to save your budget plan! Your changes will be lost on refresh. You may be in private browsing mode or your browser storage may be full.'
        );
      } else {
        this.showWarningBanner(
          'Failed to save your preferences. Changes may not persist on refresh.'
        );
      }

      // TODO(#1464): Add proper error handling at all call sites to prevent unhandled rejections
      // Throw error instead of returning stale state
      throw new Error(
        `State save failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
