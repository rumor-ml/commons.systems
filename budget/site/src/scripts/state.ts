export interface BudgetState {
  hiddenCategories: string[];
  showVacation: boolean;
}

export class StateManager {
  private static STORAGE_KEY = 'budget-state';

  // All valid categories for migration and validation
  private static ALL_CATEGORIES = [
    'income',
    'housing',
    'utilities',
    'groceries',
    'dining',
    'transportation',
    'healthcare',
    'entertainment',
    'shopping',
    'travel',
    'investment',
    'other',
  ];

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
      console.error('Failed to save state to localStorage:', error);
      return { ...this.load(), ...state };
    }
  }
}
