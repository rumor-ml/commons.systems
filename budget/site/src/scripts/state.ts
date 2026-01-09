import { CATEGORIES } from '../islands/constants';
import { Category, BudgetPlan, TimeGranularity, WeekId } from '../islands/types';

export interface BudgetState {
  hiddenCategories: string[];
  showVacation: boolean;
  budgetPlan: BudgetPlan | null;
  viewGranularity: TimeGranularity;
  selectedWeek: WeekId | null; // null = current week
  planningMode: boolean;
}

export class StateManager {
  private static STORAGE_KEY = 'budget-state';

  private static showWarningBanner(message: string): void {
    const banner = document.createElement('div');
    banner.className =
      'fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-warning text-white px-6 py-3 rounded-lg shadow-lg max-w-2xl';

    const container = document.createElement('div');
    container.className = 'flex items-center gap-3';

    const icon = document.createElement('span');
    icon.className = 'text-xl';
    icon.textContent = '⚠️';

    const text = document.createElement('p');
    text.className = 'text-sm';
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

    // Auto-dismiss after 10 seconds
    setTimeout(() => banner.remove(), 10000);
  }

  private static showErrorBanner(message: string): void {
    const banner = document.createElement('div');
    banner.className =
      'fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-error text-white px-6 py-3 rounded-lg shadow-lg max-w-2xl';

    const container = document.createElement('div');
    container.className = 'flex items-center gap-3';

    const icon = document.createElement('span');
    icon.className = 'text-xl';
    icon.textContent = '❌';

    const text = document.createElement('p');
    text.className = 'text-sm font-semibold';
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

    // Don't auto-dismiss errors - user must manually close
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

      // Migration: Convert old selectedCategory to hiddenCategories
      if ('selectedCategory' in parsed && parsed.selectedCategory !== null) {
        const hiddenCategories = CATEGORIES.filter((cat) => cat !== parsed.selectedCategory);
        return {
          ...defaultState,
          hiddenCategories,
          showVacation: parsed.showVacation ?? true,
        };
      }

      // Validate and filter hiddenCategories
      let hiddenCategories: string[] = [];
      if (Array.isArray(parsed.hiddenCategories)) {
        hiddenCategories = parsed.hiddenCategories.filter((cat: string) =>
          CATEGORIES.includes(cat as Category)
        );
      }

      // Validate budgetPlan structure
      let budgetPlan: BudgetPlan | null = null;
      if (parsed.budgetPlan && typeof parsed.budgetPlan === 'object') {
        const categoryBudgets = parsed.budgetPlan.categoryBudgets;
        if (categoryBudgets && typeof categoryBudgets === 'object') {
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
          budgetPlan = {
            categoryBudgets: validatedBudgets,
            lastModified: parsed.budgetPlan.lastModified || new Date().toISOString(),
          };
        }
      }

      // Validate viewGranularity
      const viewGranularity: TimeGranularity =
        parsed.viewGranularity === 'week' || parsed.viewGranularity === 'month'
          ? parsed.viewGranularity
          : 'month';

      // Validate selectedWeek (basic ISO week format check)
      let selectedWeek: WeekId | null = null;
      if (typeof parsed.selectedWeek === 'string' && /^\d{4}-W\d{2}$/.test(parsed.selectedWeek)) {
        selectedWeek = parsed.selectedWeek;
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
