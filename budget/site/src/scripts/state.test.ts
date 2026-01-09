import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StateManager, BudgetState } from './state';
import { CATEGORIES } from '../islands/constants';

describe('StateManager', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore all mocks after each test
    vi.restoreAllMocks();
  });

  describe('load() - Default State', () => {
    it('returns default state when localStorage is empty', () => {
      const state = StateManager.load();

      expect(state).toEqual({
        hiddenCategories: [],
        showVacation: true,
        budgetPlan: null,
        viewGranularity: 'month',
        selectedWeek: null,
        planningMode: false,
      });
    });

    it('returns default state when localStorage returns null', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);

      const state = StateManager.load();

      expect(state).toEqual({
        hiddenCategories: [],
        showVacation: true,
        budgetPlan: null,
        viewGranularity: 'month',
        selectedWeek: null,
        planningMode: false,
      });
    });
  });

  describe('load() - Error Recovery', () => {
    it('returns default state when JSON is corrupted', () => {
      localStorage.setItem('budget-state', '{invalid json');

      const state = StateManager.load();

      expect(state).toEqual({
        hiddenCategories: [],
        showVacation: true,
        budgetPlan: null,
        viewGranularity: 'month',
        selectedWeek: null,
        planningMode: false,
      });
    });

    it('returns default state when JSON parse throws', () => {
      localStorage.setItem('budget-state', 'not json at all');

      const state = StateManager.load();

      expect(state).toEqual({
        hiddenCategories: [],
        showVacation: true,
        budgetPlan: null,
        viewGranularity: 'month',
        selectedWeek: null,
        planningMode: false,
      });
    });

    it('returns default state when localStorage.getItem throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('localStorage unavailable');
      });

      const state = StateManager.load();

      expect(state).toEqual({
        hiddenCategories: [],
        showVacation: true,
        budgetPlan: null,
        viewGranularity: 'month',
        selectedWeek: null,
        planningMode: false,
      });
    });
  });

  describe('load() - Migration from selectedCategory', () => {
    it('migrates old selectedCategory to hiddenCategories', () => {
      const oldState = {
        selectedCategory: 'groceries',
        showVacation: false,
      };
      localStorage.setItem('budget-state', JSON.stringify(oldState));

      const state = StateManager.load();

      // All categories except 'groceries' should be hidden
      const expectedHidden = CATEGORIES.filter((cat) => cat !== 'groceries');
      expect(state.hiddenCategories).toEqual(expectedHidden);
      expect(state.showVacation).toBe(false);
    });

    it('migrates and preserves showVacation when present', () => {
      const oldState = {
        selectedCategory: 'dining',
        showVacation: true,
      };
      localStorage.setItem('budget-state', JSON.stringify(oldState));

      const state = StateManager.load();

      expect(state.showVacation).toBe(true);
    });

    it('defaults showVacation to true when missing during migration', () => {
      const oldState = {
        selectedCategory: 'housing',
      };
      localStorage.setItem('budget-state', JSON.stringify(oldState));

      const state = StateManager.load();

      expect(state.showVacation).toBe(true);
    });

    it('handles null selectedCategory during migration', () => {
      const oldState = {
        selectedCategory: null,
        showVacation: false,
      };
      localStorage.setItem('budget-state', JSON.stringify(oldState));

      const state = StateManager.load();

      // Should not trigger migration path when selectedCategory is null
      expect(state.hiddenCategories).toEqual([]);
    });
  });

  describe('load() - hiddenCategories Validation', () => {
    it('filters out invalid categories from hiddenCategories', () => {
      const storedState = {
        hiddenCategories: ['groceries', 'invalid-category', 'dining', 'fake-cat'],
        showVacation: true,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.hiddenCategories).toEqual(['groceries', 'dining']);
    });

    it('preserves valid categories in hiddenCategories', () => {
      const storedState = {
        hiddenCategories: ['income', 'housing', 'utilities'],
        showVacation: true,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.hiddenCategories).toEqual(['income', 'housing', 'utilities']);
    });

    it('returns empty array when hiddenCategories is not an array', () => {
      const storedState = {
        hiddenCategories: 'not-an-array',
        showVacation: true,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.hiddenCategories).toEqual([]);
    });

    it('returns empty array when hiddenCategories is missing', () => {
      const storedState = {
        showVacation: true,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.hiddenCategories).toEqual([]);
    });
  });

  describe('load() - budgetPlan Validation', () => {
    it('preserves valid budgetPlan structure', () => {
      const validBudgetPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: 100, rolloverEnabled: true },
          dining: { weeklyTarget: 50, rolloverEnabled: false },
        },
        lastModified: '2025-01-09T12:00:00Z',
      };
      const storedState = {
        budgetPlan: validBudgetPlan,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.budgetPlan).toEqual(validBudgetPlan);
    });

    it('rejects budgetPlan with invalid weeklyTarget (non-number)', () => {
      const invalidBudgetPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: '100', rolloverEnabled: true }, // string instead of number
        },
        lastModified: '2025-01-09T12:00:00Z',
      };
      const storedState = {
        budgetPlan: invalidBudgetPlan,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      // Invalid entry should be filtered out
      expect(state.budgetPlan?.categoryBudgets).toEqual({});
    });

    it('rejects budgetPlan with invalid rolloverEnabled (non-boolean)', () => {
      const invalidBudgetPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: 100, rolloverEnabled: 'true' }, // string instead of boolean
        },
        lastModified: '2025-01-09T12:00:00Z',
      };
      const storedState = {
        budgetPlan: invalidBudgetPlan,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      // Invalid entry should be filtered out
      expect(state.budgetPlan?.categoryBudgets).toEqual({});
    });

    it('returns null budgetPlan when categoryBudgets is missing', () => {
      const invalidBudgetPlan = {
        lastModified: '2025-01-09T12:00:00Z',
      };
      const storedState = {
        budgetPlan: invalidBudgetPlan,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.budgetPlan).toBeNull();
    });

    it('filters out invalid category keys from categoryBudgets', () => {
      const budgetPlanWithInvalidCat = {
        categoryBudgets: {
          groceries: { weeklyTarget: 100, rolloverEnabled: true },
          'invalid-category': { weeklyTarget: 50, rolloverEnabled: false },
          dining: { weeklyTarget: 75, rolloverEnabled: true },
        },
        lastModified: '2025-01-09T12:00:00Z',
      };
      const storedState = {
        budgetPlan: budgetPlanWithInvalidCat,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.budgetPlan?.categoryBudgets).toEqual({
        groceries: { weeklyTarget: 100, rolloverEnabled: true },
        dining: { weeklyTarget: 75, rolloverEnabled: true },
      });
    });

    it('defaults lastModified when missing', () => {
      const budgetPlanNoTimestamp = {
        categoryBudgets: {
          groceries: { weeklyTarget: 100, rolloverEnabled: true },
        },
      };
      const storedState = {
        budgetPlan: budgetPlanNoTimestamp,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.budgetPlan?.lastModified).toBeDefined();
      // Should be a valid ISO timestamp
      expect(new Date(state.budgetPlan!.lastModified).toString()).not.toBe('Invalid Date');
    });

    it('returns null budgetPlan when budgetPlan is not an object', () => {
      const storedState = {
        budgetPlan: 'not-an-object',
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.budgetPlan).toBeNull();
    });
  });

  describe('load() - viewGranularity Validation', () => {
    it('preserves valid "week" granularity', () => {
      const storedState = {
        viewGranularity: 'week',
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.viewGranularity).toBe('week');
    });

    it('preserves valid "month" granularity', () => {
      const storedState = {
        viewGranularity: 'month',
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.viewGranularity).toBe('month');
    });

    it('defaults to "month" for invalid granularity', () => {
      const storedState = {
        viewGranularity: 'year',
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.viewGranularity).toBe('month');
    });

    it('defaults to "month" when viewGranularity is missing', () => {
      const storedState = {};
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.viewGranularity).toBe('month');
    });
  });

  describe('load() - selectedWeek Validation', () => {
    it('preserves valid ISO week format (2025-W01)', () => {
      const storedState = {
        selectedWeek: '2025-W01',
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.selectedWeek).toBe('2025-W01');
    });

    it('preserves valid ISO week format (2025-W52)', () => {
      const storedState = {
        selectedWeek: '2025-W52',
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.selectedWeek).toBe('2025-W52');
    });

    it('returns null for invalid week format (missing W)', () => {
      const storedState = {
        selectedWeek: '2025-01',
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.selectedWeek).toBeNull();
    });

    it('returns null for invalid week format (wrong pattern)', () => {
      const storedState = {
        selectedWeek: 'Week-01-2025',
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.selectedWeek).toBeNull();
    });

    it('returns null when selectedWeek is not a string', () => {
      const storedState = {
        selectedWeek: 12345,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.selectedWeek).toBeNull();
    });

    it('returns null when selectedWeek is missing', () => {
      const storedState = {};
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.selectedWeek).toBeNull();
    });
  });

  describe('load() - planningMode Validation', () => {
    it('preserves planningMode when true', () => {
      const storedState = {
        planningMode: true,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.planningMode).toBe(true);
    });

    it('preserves planningMode when false', () => {
      const storedState = {
        planningMode: false,
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.planningMode).toBe(false);
    });

    it('defaults to false when planningMode is missing', () => {
      const storedState = {};
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.planningMode).toBe(false);
    });

    it('defaults to false when planningMode is not boolean', () => {
      const storedState = {
        planningMode: 'true',
      };
      localStorage.setItem('budget-state', JSON.stringify(storedState));

      const state = StateManager.load();

      expect(state.planningMode).toBe(false);
    });
  });

  describe('save() - Success', () => {
    it('saves partial state update', () => {
      const initialState: BudgetState = {
        hiddenCategories: ['groceries'],
        showVacation: true,
        budgetPlan: null,
        viewGranularity: 'month',
        selectedWeek: null,
        planningMode: false,
      };
      localStorage.setItem('budget-state', JSON.stringify(initialState));

      const updated = StateManager.save({ planningMode: true });

      expect(updated.planningMode).toBe(true);
      expect(updated.hiddenCategories).toEqual(['groceries']);

      // Verify it was persisted
      const loaded = StateManager.load();
      expect(loaded.planningMode).toBe(true);
      expect(loaded.hiddenCategories).toEqual(['groceries']);
    });

    it('merges with existing state', () => {
      const initialState: BudgetState = {
        hiddenCategories: ['dining', 'entertainment'],
        showVacation: false,
        budgetPlan: null,
        viewGranularity: 'week',
        selectedWeek: '2025-W05',
        planningMode: false,
      };
      localStorage.setItem('budget-state', JSON.stringify(initialState));

      const updated = StateManager.save({
        hiddenCategories: ['income'],
        viewGranularity: 'month',
      });

      expect(updated).toEqual({
        hiddenCategories: ['income'],
        showVacation: false,
        budgetPlan: null,
        viewGranularity: 'month',
        selectedWeek: '2025-W05',
        planningMode: false,
      });
    });

    it('returns updated state after save', () => {
      const updated = StateManager.save({
        showVacation: false,
        selectedWeek: '2025-W10',
      });

      expect(updated.showVacation).toBe(false);
      expect(updated.selectedWeek).toBe('2025-W10');
    });
  });

  describe('save() - Error Recovery', () => {
    it('returns merged state when localStorage.setItem throws (quota exceeded)', () => {
      const initialState: BudgetState = {
        hiddenCategories: [],
        showVacation: true,
        budgetPlan: null,
        viewGranularity: 'month',
        selectedWeek: null,
        planningMode: false,
      };
      localStorage.setItem('budget-state', JSON.stringify(initialState));

      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      const updated = StateManager.save({ planningMode: true });

      // Should still return updated in-memory state
      expect(updated.planningMode).toBe(true);
      expect(updated.hiddenCategories).toEqual([]);
    });

    it('handles save failure gracefully without crashing', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Storage unavailable');
      });

      // Should not throw
      expect(() => {
        StateManager.save({ showVacation: false });
      }).not.toThrow();
    });

    it('returns updated state even when persistence fails', () => {
      const initialState: BudgetState = {
        hiddenCategories: ['income'],
        showVacation: true,
        budgetPlan: null,
        viewGranularity: 'month',
        selectedWeek: null,
        planningMode: false,
      };
      localStorage.setItem('budget-state', JSON.stringify(initialState));

      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Write failed');
      });

      const updated = StateManager.save({
        hiddenCategories: ['groceries', 'dining'],
        viewGranularity: 'week',
      });

      expect(updated.hiddenCategories).toEqual(['groceries', 'dining']);
      expect(updated.viewGranularity).toBe('week');
      expect(updated.showVacation).toBe(true); // Preserved from initial state
    });
  });

  describe('Integration - Complex Scenarios', () => {
    it('handles multiple save/load cycles correctly', () => {
      // First save
      StateManager.save({ hiddenCategories: ['groceries'] });
      let loaded = StateManager.load();
      expect(loaded.hiddenCategories).toEqual(['groceries']);

      // Second save
      StateManager.save({ planningMode: true });
      loaded = StateManager.load();
      expect(loaded.hiddenCategories).toEqual(['groceries']);
      expect(loaded.planningMode).toBe(true);

      // Third save
      StateManager.save({ viewGranularity: 'week', selectedWeek: '2025-W08' });
      loaded = StateManager.load();
      expect(loaded.viewGranularity).toBe('week');
      expect(loaded.selectedWeek).toBe('2025-W08');
      expect(loaded.planningMode).toBe(true);
      expect(loaded.hiddenCategories).toEqual(['groceries']);
    });

    it('recovers from corrupted state and allows new saves', () => {
      // Corrupt the state
      localStorage.setItem('budget-state', 'corrupted{data');

      // Load returns default state
      let loaded = StateManager.load();
      expect(loaded.hiddenCategories).toEqual([]);

      // Save new state
      StateManager.save({ hiddenCategories: ['dining'], planningMode: true });

      // Load again - should have the saved state
      loaded = StateManager.load();
      expect(loaded.hiddenCategories).toEqual(['dining']);
      expect(loaded.planningMode).toBe(true);
    });

    it('handles partial budgetPlan updates', () => {
      const budgetPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: 100, rolloverEnabled: true },
        },
        lastModified: '2025-01-09T12:00:00Z',
      };

      StateManager.save({ budgetPlan });

      const loaded = StateManager.load();
      expect(loaded.budgetPlan).toEqual(budgetPlan);

      // Update with new budget plan
      const updatedPlan = {
        categoryBudgets: {
          groceries: { weeklyTarget: 100, rolloverEnabled: true },
          dining: { weeklyTarget: 50, rolloverEnabled: false },
        },
        lastModified: '2025-01-10T12:00:00Z',
      };

      StateManager.save({ budgetPlan: updatedPlan });

      const reloaded = StateManager.load();
      expect(reloaded.budgetPlan).toEqual(updatedPlan);
    });
  });
});
