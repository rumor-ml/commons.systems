import { CATEGORIES } from '../islands/constants';
import { Category, BudgetPlan, TimeGranularity, WeekId, parseWeekId } from '../islands/types';

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
    if (
      CATEGORIES.includes(category as Category) &&
      budget &&
      typeof budget === 'object' &&
      'weeklyTarget' in budget &&
      'rolloverEnabled' in budget &&
      typeof (budget as any).weeklyTarget === 'number' &&
      typeof (budget as any).rolloverEnabled === 'boolean'
    ) {
      validatedBudgets[category as Category] = {
        weeklyTarget: (budget as any).weeklyTarget,
        rolloverEnabled: (budget as any).rolloverEnabled,
      };
    }
  }

  return {
    categoryBudgets: validatedBudgets,
    lastModified: parsed.budgetPlan.lastModified || new Date().toISOString(),
  };
}

/**
 * Budget application state (persisted to localStorage)
 * @property hiddenCategories - Categories hidden in visualization
 * @property showVacation - Whether to include vacation spending
 * @property budgetPlan - User's budget configuration (null = no budget set)
 * @property viewGranularity - Time aggregation level for historic view
 * @property selectedWeek - Specific week for week view, or null to show current week.
 *   null = components call getCurrentWeek() on each render (ensures "current week" stays current across days)
 *   Non-null = user has navigated to a specific historical week (persisted for session continuity)
 *   Should be null when viewGranularity is 'month' (weekly navigation is disabled in monthly view).
 * @property planningMode - Whether budget plan editor is visible
 */
export interface BudgetState {
  readonly hiddenCategories: readonly Category[];
  readonly showVacation: boolean;
  readonly budgetPlan: BudgetPlan | null;
  readonly viewGranularity: TimeGranularity;
  readonly selectedWeek: WeekId | null; // null = current week
  readonly planningMode: boolean;
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
        viewGranularity: 'month',
        selectedWeek: null,
        planningMode: false,
      };

      if (!stored) {
        return defaultState;
      }

      const parsed = JSON.parse(stored);

      // TODO(2026-06): Remove selectedCategory migration (added 2026-01).
      //   Safe to remove after 6mo if no user error reports about lost preferences.
      //   Before removal: Test clean install + upgrade path.
      // Migration: Convert old selectedCategory format to hiddenCategories.
      if ('selectedCategory' in parsed && parsed.selectedCategory !== null) {
        const hiddenCategories = CATEGORIES.filter((cat) => cat !== parsed.selectedCategory);
        return {
          ...defaultState,
          hiddenCategories,
          showVacation: parsed.showVacation ?? true,
        };
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

      // Validate viewGranularity
      const viewGranularity: TimeGranularity =
        parsed.viewGranularity === 'week' || parsed.viewGranularity === 'month'
          ? parsed.viewGranularity
          : 'month';

      // Validate selectedWeek
      let selectedWeek: WeekId | null = null;
      if (typeof parsed.selectedWeek === 'string') {
        selectedWeek = parseWeekId(parsed.selectedWeek);
      }

      return {
        hiddenCategories,
        showVacation: parsed.showVacation ?? true,
        budgetPlan,
        viewGranularity,
        selectedWeek,
        planningMode: parsed.planningMode === true,
      };
    } catch (error) {
      // TODO(#1387): Distinguish between error types (JSON parse, localStorage access, validation) and provide specific user guidance
      console.error('Failed to load state from localStorage:', error);

      // Show user-facing warning
      this.showWarningBanner(
        'Failed to load your saved preferences. Using defaults. If you are in private browsing mode, your changes will not be saved.'
      );

      return {
        hiddenCategories: [],
        showVacation: true,
        budgetPlan: null,
        viewGranularity: 'month',
        selectedWeek: null,
        planningMode: false,
      };
    }
  }

  static save(state: Partial<BudgetState>): BudgetState {
    try {
      const current = this.load();
      const updated = { ...current, ...state };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(updated));
      return updated;
    } catch (error) {
      console.error('Failed to save state to localStorage:', error);

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

      return { ...this.load(), ...state };
    }
  }
}
