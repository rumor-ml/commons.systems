import { CATEGORIES } from '../islands/constants';

export interface BudgetState {
  hiddenCategories: string[];
  showVacation: boolean;
}

export class StateManager {
  private static STORAGE_KEY = 'budget-state';

  // All valid categories for migration and validation
  private static ALL_CATEGORIES = CATEGORIES;

  static load(): BudgetState {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);

      if (!stored) {
        return {
          hiddenCategories: [],
          showVacation: true,
        };
      }

      const parsed = JSON.parse(stored);

      // Migration: Convert old selectedCategory to hiddenCategories
      if ('selectedCategory' in parsed && parsed.selectedCategory !== null) {
        const hiddenCategories = this.ALL_CATEGORIES.filter(
          cat => cat !== parsed.selectedCategory
        );
        return {
          hiddenCategories,
          showVacation: parsed.showVacation ?? true,
        };
      }

      // Validate and filter hiddenCategories
      let hiddenCategories: string[] = [];
      if (Array.isArray(parsed.hiddenCategories)) {
        hiddenCategories = parsed.hiddenCategories.filter(cat =>
          this.ALL_CATEGORIES.includes(cat)
        );
      }

      return {
        hiddenCategories,
        showVacation: parsed.showVacation ?? true,
      };
    } catch (error) {
      // TODO: See issue #384 - Add user-facing warnings and detailed error context for localStorage failures
      console.error('Failed to load state from localStorage:', error);
      return {
        hiddenCategories: [],
        showVacation: true,
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
