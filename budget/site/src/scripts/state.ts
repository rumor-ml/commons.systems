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

// TODO: See issue #445 - Add unit tests for migration, validation, and error recovery logic
export class StateManager {
  private static STORAGE_KEY = 'budget-state';

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
      // TODO: See issue #384 - Add user-facing warnings and detailed error context for localStorage failures
      console.error('Failed to load state from localStorage:', error);
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
      // TODO: See issue #384 - Add user-facing warnings for save failures (preferences won't persist)
      console.error('Failed to save state to localStorage:', error);
      return { ...this.load(), ...state };
    }
  }
}
